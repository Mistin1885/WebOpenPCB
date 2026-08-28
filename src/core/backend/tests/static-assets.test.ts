import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHttpServer } from "../http/create-http-server";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";

const previousStaticDir = process.env.OPENPCB_STATIC_DIR;
const tempDirs: string[] = [];

afterEach(() => {
  if (previousStaticDir === undefined) delete process.env.OPENPCB_STATIC_DIR;
  else process.env.OPENPCB_STATIC_DIR = previousStaticDir;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function createStaticServer(): ReturnType<typeof createHttpServer> {
  const dir = mkdtempSync(join(tmpdir(), "openpcb-static-"));
  tempDirs.push(dir);
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>OpenPCB</title>");
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "assets", "worker.mjs"), "export const value = '" + "x".repeat(2048) + "';");
  process.env.OPENPCB_STATIC_DIR = dir;
  return createHttpServer({ diagnosticsStore: new DiagnosticsStore() });
}

describe("production static assets", () => {
  test("serves module scripts with immutable caching and gzip", async () => {
    const response = await createStaticServer().fetch(
      new Request("http://localhost/assets/worker.mjs", {
        headers: { "accept-encoding": "gzip" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/javascript; charset=utf-8",
    );
    expect(response.headers.get("content-encoding")).toBe("gzip");
    expect(response.headers.get("vary")).toContain("Accept-Encoding");
  });

  test("supports HEAD and keeps the SPA entry uncached", async () => {
    const response = await createStaticServer().fetch(
      new Request("http://localhost/route", { method: "HEAD" }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(await response.text()).toBe("");
  });
});
