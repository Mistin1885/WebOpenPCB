import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { DiagnosticsController } from "../controllers/diagnostics-controller";
import { HealthController } from "../controllers/health-controller";
import { ModuleRuntimeDiagnosticsController } from "../controllers/module-runtime-diagnostics-controller";
import { MentionController } from "../mentions/mention-controller";
import type { RequestContext, Middleware } from "./request-context";
import { HttpRouter } from "../router/http-router";
import { RouteParams } from "../router/route-params";
import type { HttpServerConfig } from "./server-config";
import { resolveAllowedOrigins } from "./cors";
import { createCorsMiddleware } from "../middleware/cors-middleware";
import { createErrorMiddleware } from "../middleware/error-middleware";
import { requestLoggingMiddleware } from "../middleware/request-logging-middleware";
import { requestIdMiddleware } from "../middleware/request-id-middleware";

function resolveStaticDir(): string | null {
  const fromEnv = process.env.OPENPCB_STATIC_DIR;
  if (fromEnv) {
    const resolved = join(fromEnv);
    if (existsSync(resolved)) return resolved;
    return null;
  }
  if (process.env.NODE_ENV === "production") {
    const resourcesPath = (process as unknown as Record<string, unknown>).resourcesPath as string | undefined;
    if (resourcesPath) {
      const candidate = join(resourcesPath, "frontend-dist");
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function contentTypeFor(pathname: string): string {
  switch (extname(pathname).toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".js":
    case ".mjs": return "text/javascript; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".json":
    case ".map": return "application/json; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".wasm": return "application/wasm";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".woff2": return "font/woff2";
    default: return "application/octet-stream";
  }
}

async function serveStaticFile(
  staticDir: string,
  pathname: string,
  req: Request,
): Promise<Response | null> {
  const root = resolve(staticDir);
  const filePath = resolve(root, `.${pathname}`);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    return null;
  }
  try {
    const file = await readFile(filePath);
    const contentType = contentTypeFor(filePath);
    const acceptsGzip = /(?:^|,)\s*gzip\s*(?:,|$)/i.test(
      req.headers.get("accept-encoding") ?? "",
    );
    const compressible =
      contentType.startsWith("text/") ||
      contentType.startsWith("application/json") ||
      contentType === "application/wasm" ||
      contentType === "image/svg+xml";
    const shouldCompress = acceptsGzip && compressible && file.byteLength >= 1024;
    const body = shouldCompress ? gzipSync(file) : file;
    const headers = new Headers({
      "content-type": contentType,
      "cache-control": pathname.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    });
    if (shouldCompress) {
      headers.set("content-encoding", "gzip");
      headers.set("vary", "Accept-Encoding");
    }
    return new Response(req.method === "HEAD" ? null : body, { headers });
  } catch {
    return null;
  }
}

async function serveSpaFallback(staticDir: string, method: string): Promise<Response> {
  const indexPath = join(staticDir, "index.html");
  const file = await readFile(indexPath);
  return new Response(method === "HEAD" ? null : file, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-cache",
    },
  });
}

export interface StartedRuntimeServer {
  hostname: string;
  port: number;
  close(): Promise<void>;
}

export interface RuntimeServer {
  fetch(req: Request): Promise<Response>;
  start(): Promise<StartedRuntimeServer>;
}

function buildRequest(
  req: IncomingMessage,
  hostname: string,
  controller: AbortController,
): Request {
  const host = req.headers.host ?? `${hostname}:0`;
  const url = new URL(req.url ?? "/", `http://${host}`);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (typeof value === "string") {
      headers.set(key, value);
    }
  }

  const init: RequestInit & { duplex?: "half" } = {
    method: req.method,
    headers,
    signal: controller.signal,
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>;
    init.duplex = "half";
  }
  return new Request(url, init);
}

async function writeResponse(
  response: Response,
  res: ServerResponse,
): Promise<void> {
  res.statusCode = response.status;
  res.statusMessage = response.statusText;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  if (!response.body) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) res.write(value);
    }
    res.end();
  } finally {
    reader.releaseLock();
  }
}

function applyMiddlewares(
  ctx: RequestContext,
  middlewares: Middleware[],
  handler: () => Promise<Response>,
): Promise<Response> {
  let index = -1;
  const dispatch = async (current: number): Promise<Response> => {
    if (current <= index) {
      throw new Error("next() called multiple times");
    }
    index = current;
    const middleware = middlewares[current];
    if (!middleware) {
      return handler();
    }
    return middleware(ctx, () => dispatch(current + 1));
  };
  return dispatch(0);
}

export function createHttpServer(config: HttpServerConfig): RuntimeServer {
  const router = new HttpRouter();
  const diagnosticsController = new DiagnosticsController(config.diagnosticsStore);
  const moduleRuntimeDiagnosticsController = config.moduleRuntime
    ? new ModuleRuntimeDiagnosticsController(config.moduleRuntime)
    : null;

  const mentionController = new MentionController();

  router.get("/api/health", async () => HealthController.check());
  router.get("/api/diagnostics", async () => diagnosticsController.snapshot());
  router.post("/api/mentions/search", (ctx) => mentionController.search(ctx), MentionController.schemas.search);
  router.get("/api/mentions/resolve/:entityType/:entityId", (ctx) => mentionController.resolve(ctx), MentionController.schemas.resolve);
  router.post("/api/mentions/staleness", (ctx) => mentionController.checkStaleness(ctx), MentionController.schemas.checkStaleness);
  router.get("/api/mentions/types", (ctx) => mentionController.getTypes(ctx));
  router.get("/api/mentions/navigate/:entityType/:entityId", (ctx) => mentionController.getNavigationPath(ctx), MentionController.schemas.getNavigationPath);
  router.get("/api/modules/registry", async () => {
    if (!config.moduleRuntime) {
      return Response.json({
        modules: [],
        loadedModules: [],
      });
    }
    return Response.json(config.moduleRuntime.snapshot());
  });
  if (moduleRuntimeDiagnosticsController && process.env.OPENPCB_DEBUG_DIAGNOSTICS === "true") {
    router.get("/api/diagnostics/debug/modules", async () =>
      moduleRuntimeDiagnosticsController.snapshot(),
    );
  }
  const allowedOrigins = resolveAllowedOrigins({ allowedOrigins: config.allowedOrigins });
  const middlewares: Middleware[] = [
    requestIdMiddleware,
    requestLoggingMiddleware,
    createCorsMiddleware(allowedOrigins),
    createErrorMiddleware(config.diagnosticsStore),
  ];

  const staticDir = resolveStaticDir();

  const fetch = async (req: Request): Promise<Response> => {
    const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    const url = new URL(req.url);
    const ctx: RequestContext = {
      req,
      url,
      query: url.searchParams,
      params: new RouteParams({}),
      requestId,
      signal: req.signal,
      validated: {},
    };

    const baseHandler = async (): Promise<Response> => {
      // Serve static files first for non-API routes when in packaged mode
      if (
        staticDir &&
        (req.method === "GET" || req.method === "HEAD") &&
        !url.pathname.startsWith("/api/") &&
        !url.pathname.startsWith("/ws/")
      ) {
        const staticResponse = await serveStaticFile(staticDir, url.pathname, req);
        if (staticResponse) return staticResponse;
        return serveSpaFallback(staticDir, req.method);
      }

      if (
        url.pathname.startsWith("/api/modules/") &&
        url.pathname !== "/api/modules/registry" &&
        config.moduleRegistry
      ) {
        return config.moduleRegistry.dispatch(ctx);
      }
      return router.dispatch(ctx);
    };

    return applyMiddlewares(ctx, middlewares, baseHandler);
  };

  const start = (): Promise<StartedRuntimeServer> => {
    const hostname = config.host ?? "127.0.0.1";
    const port = config.port ?? 3000;
    const server = createServer((incoming, outgoing) => {
      const controller = new AbortController();
      incoming.on("aborted", () => controller.abort());
      void fetch(buildRequest(incoming, hostname, controller))
        .then((response) => writeResponse(response, outgoing))
        .catch((error: unknown) => {
          if (!outgoing.headersSent) {
            outgoing.statusCode = 500;
            outgoing.setHeader("content-type", "application/problem+json");
          }
          outgoing.end(
            JSON.stringify({
              type: "about:blank",
              title: "Internal Server Error",
              status: 500,
              detail: error instanceof Error ? error.message : "Unknown error",
            }),
          );
        });
    });

    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, hostname, () => {
        server.off("error", reject);
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Backend server did not expose a TCP address"));
          return;
        }
        resolve({
          hostname,
          port: address.port,
          close: () =>
            new Promise<void>((closeResolve, closeReject) => {
              server.close((error) => {
                if (error) closeReject(error);
                else closeResolve();
              });
            }),
        });
      });
    });
  };

  return { fetch, start };
}
