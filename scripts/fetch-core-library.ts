#!/usr/bin/env bun
/**
 * Fetch a CoreLibrary `.opclib` release and verify it end-to-end:
 *
 *   1. Resolve tag (CLI arg → env → latest stable from GitHub API)
 *   2. Download `.opclib` + `SHA256SUMS` + `openpcb-core.pub`
 *   3. Verify SHA-256 against `SHA256SUMS`
 *   4. Verify Ed25519 signature against the committed trusted public key
 *      (`resources/keys/*.pub`) — fail if no key matches
 *   5. Validate manifest: `library.id === "openpcb.core"`, `components.length >= MIN`
 *   6. Copy artifact + sums into `.build/core-library/` (CI) and
 *      `resources/core-library/` (local dev parity)
 *   7. Emit JSON summary on stdout for `release.yml` to consume:
 *        {"tag":"v0.1.0-beta.0","version":"0.1.0-beta.0","components":17,...}
 *
 * Usage:
 *   bun scripts/fetch-core-library.ts                  # latest stable
 *   bun scripts/fetch-core-library.ts --tag=v1.2.3     # explicit tag
 *   bun scripts/fetch-core-library.ts v1.2.3           # positional alias
 *
 * Env:
 *   OPENPCB_SKIP_CORELIB_FETCH=1     skip entirely (offline)
 *   OPENPCB_CORELIB_REPO=owner/name  override default `OpenPCB-app/CoreLibrary`
 *   OPENPCB_CORELIB_TAG=v1.2.3       same as --tag
 *   OPENPCB_CORELIB_MIN_COMPONENTS=N override the default ≥10 guard
 *
 * Public repositories need no credentials. Set GITHUB_TOKEN or GH_TOKEN for
 * private repositories or to avoid anonymous GitHub API rate limits.
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  mkdtempSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { verifyManifest } from "@openpcb/opclib-pack";

const REPO = process.env.OPENPCB_CORELIB_REPO ?? "OpenPCB-app/CoreLibrary";
const MIN_COMPONENTS = Number(
  process.env.OPENPCB_CORELIB_MIN_COMPONENTS ?? "10",
);
const REPO_ROOT = path.resolve(import.meta.dir, "..");
const BUILD_DIR = path.join(REPO_ROOT, ".build", "core-library");
const RESOURCES_DIR = path.join(REPO_ROOT, "resources", "core-library");
const KEYS_DIR = path.join(REPO_ROOT, "resources", "keys");

if (process.env.OPENPCB_SKIP_CORELIB_FETCH === "1") {
  console.error("[corelib:fetch] OPENPCB_SKIP_CORELIB_FETCH=1; skipping");
  process.exit(0);
}

function parseTagArg(): string {
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--tag=")) return a.slice("--tag=".length);
    if (!a.startsWith("--")) return a;
  }
  return process.env.OPENPCB_CORELIB_TAG ?? "";
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name: string;
  prerelease: boolean;
  draft: boolean;
  assets: GitHubReleaseAsset[];
}

function githubHeaders(): Headers {
  const headers = new Headers({
    Accept: "application/vnd.github+json",
    "User-Agent": "OpenPCB-CoreLibrary-fetch",
    "X-GitHub-Api-Version": "2022-11-28",
  });
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

async function githubJson<T>(pathValue: string): Promise<T> {
  const response = await fetch(`https://api.github.com${pathValue}`, {
    headers: githubHeaders(),
  });
  if (!response.ok) {
    throw new Error(
      `GitHub API ${pathValue} failed: HTTP ${response.status} ${response.statusText}`,
    );
  }
  return (await response.json()) as T;
}

async function resolveRelease(requestedTag: string): Promise<GitHubRelease> {
  if (requestedTag) {
    return githubJson<GitHubRelease>(
      `/repos/${REPO}/releases/tags/${encodeURIComponent(requestedTag)}`,
    );
  }
  const releases = await githubJson<GitHubRelease[]>(
    `/repos/${REPO}/releases?per_page=100`,
  );
  const stable = releases.find(
    (release) => !release.draft && !release.prerelease,
  );
  if (!stable) {
    throw new Error(
      `no stable (non-prerelease) releases found on ${REPO}. Use --tag to pin or publish a stable release first.`,
    );
  }
  return stable;
}

async function downloadReleaseAssets(
  release: GitHubRelease,
  destination: string,
): Promise<void> {
  const selected = release.assets.filter(
    (asset) =>
      asset.name.endsWith(".opclib") ||
      asset.name === "SHA256SUMS" ||
      asset.name === "openpcb-core.pub",
  );
  for (const asset of selected) {
    const response = await fetch(asset.browser_download_url, {
      headers: githubHeaders(),
      redirect: "follow",
    });
    if (!response.ok) {
      throw new Error(
        `download ${asset.name} failed: HTTP ${response.status} ${response.statusText}`,
      );
    }
    writeFileSync(
      path.join(destination, asset.name),
      new Uint8Array(await response.arrayBuffer()),
    );
  }
}

const requestedTag = parseTagArg();
const release = await resolveRelease(requestedTag);
const tag = release.tag_name;
const tmp = mkdtempSync(path.join(os.tmpdir(), "openpcb-corelib-"));

try {
  console.error(`[corelib:fetch] tag=${tag} repo=${REPO} tmp=${tmp}`);
  await downloadReleaseAssets(release, tmp);

  const files = readdirSync(tmp);
  const opclib = files.find((f) => f.endsWith(".opclib"));
  if (!opclib) throw new Error("no .opclib asset in release");
  const opclibBytes = new Uint8Array(readFileSync(path.join(tmp, opclib)));

  // Step 3: SHA-256.
  const sums = files.find((f) => f === "SHA256SUMS");
  if (!sums) {
    throw new Error(
      "SHA256SUMS missing from release — refusing to ship unsigned/unverified .opclib",
    );
  }
  const sumsText = readFileSync(path.join(tmp, sums), "utf8");
  const line = sumsText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.endsWith(opclib));
  if (!line) throw new Error(`SHA256SUMS does not list ${opclib}`);
  const declared = line.split(/\s+/)[0]!;
  const actual = sha256Hex(opclibBytes);
  if (declared !== actual) {
    throw new Error(
      `sha256 mismatch for ${opclib}: declared=${declared} actual=${actual}`,
    );
  }
  console.error(`[corelib:fetch] sha256 ok (${actual.slice(0, 16)}…)`);

  // Step 4: Ed25519 signature against committed trusted keys.
  const entries = unzipSync(opclibBytes, {
    filter: (f) => f.name === "library.json",
  });
  const manifestBytes = entries["library.json"];
  if (!manifestBytes) {
    throw new Error("library.json missing from .opclib");
  }
  const manifest = JSON.parse(strFromU8(manifestBytes));
  // Build trusted key set from committed resources/keys/*.pub.
  const trustedKeys = new Map<string, Buffer>();
  if (existsSync(KEYS_DIR)) {
    for (const f of readdirSync(KEYS_DIR)) {
      if (!f.endsWith(".pub")) continue;
      const keyId = f.replace(/\.pub$/, "");
      trustedKeys.set(keyId, readFileSync(path.join(KEYS_DIR, f)));
    }
  }
  // If a signed release publishes openpcb-core.pub, accept it only when its
  // PEM contents match a committed key. Older unsigned releases contain the
  // retired test key; it is not used to authenticate an unsigned manifest.
  // Normalize line endings because Windows checkouts can convert LF → CRLF.
  const releasedPub = files.find((f) => f === "openpcb-core.pub");
  if (releasedPub) {
    const releasedKeyText = readFileSync(path.join(tmp, releasedPub), "utf8")
      .replace(/\r\n/g, "\n")
      .trim();
    let matched = false;
    for (const [, committed] of trustedKeys) {
      const committedText = committed
        .toString("utf8")
        .replace(/\r\n/g, "\n")
        .trim();
      if (committedText === releasedKeyText) {
        matched = true;
        break;
      }
    }
    if (!matched && manifest.signature) {
      throw new Error(
        "released openpcb-core.pub does not match any trusted key in resources/keys/ — refusing to trust",
      );
    }
    if (!matched) {
      console.error(
        "[corelib:fetch] WARNING: ignoring obsolete public-key asset on unsigned release",
      );
    }
  }

  // Signature is enforced when present. Unsigned releases are allowed for now
  // (CoreLibrary's release.yml only signs when OPCLIB_SIGNING_KEY secret is
  // set). Once the secret is wired up, change this to fail-closed.
  let verifiedKeyId = "";
  if (manifest.signature) {
    const verify = verifyManifest(manifest, {
      resolveKey: (keyId) => trustedKeys.get(keyId),
    });
    if (!verify.valid) {
      throw new Error(
        `signature verification failed: keyId=${verify.keyId ?? "(none)"} reason=${verify.reason}`,
      );
    }
    verifiedKeyId = verify.keyId ?? "";
    console.error(`[corelib:fetch] ed25519 ok (keyId=${verifiedKeyId})`);
  } else {
    console.error(
      "[corelib:fetch] WARNING: manifest unsigned — relying on SHA256SUMS only. Configure OPCLIB_SIGNING_KEY on CoreLibrary repo to enforce signatures.",
    );
  }

  // Step 5: Manifest sanity.
  if (manifest.library?.id !== "openpcb.core") {
    throw new Error(
      `manifest library.id mismatch: ${manifest.library?.id ?? "(missing)"}`,
    );
  }
  const counts = {
    components: Array.isArray(manifest.components)
      ? manifest.components.length
      : 0,
    footprints: Array.isArray(manifest.footprints)
      ? manifest.footprints.length
      : 0,
    symbols: Array.isArray(manifest.symbols) ? manifest.symbols.length : 0,
    models3d: Array.isArray(manifest.models3d) ? manifest.models3d.length : 0,
  };
  if (counts.components < MIN_COMPONENTS) {
    throw new Error(
      `manifest has only ${counts.components} components (< ${MIN_COMPONENTS} threshold). Refusing to ship a stub library.`,
    );
  }
  console.error(
    `[corelib:fetch] manifest ok — ${counts.symbols} symbols, ${counts.footprints} footprints, ${counts.components} components`,
  );

  // Step 6: Copy into .build/ and resources/.
  for (const dir of [BUILD_DIR, RESOURCES_DIR]) {
    mkdirSync(dir, { recursive: true });
    // Wipe stale .opclib so the locator picks the new one unambiguously.
    for (const f of readdirSync(dir)) {
      if (f.endsWith(".opclib") || f === "SHA256SUMS") {
        rmSync(path.join(dir, f));
      }
    }
    writeFileSync(path.join(dir, opclib), opclibBytes);
    writeFileSync(path.join(dir, "SHA256SUMS"), sumsText);
  }
  console.error(
    `[corelib:fetch] wrote .build/core-library/${opclib} + resources/core-library/${opclib}`,
  );

  // Step 7: JSON summary on stdout for $GITHUB_OUTPUT consumption.
  const summary = {
    tag,
    version: manifest.library?.version ?? "",
    artifact: opclib,
    sha256: actual,
    keyId: verifiedKeyId,
    symbols: counts.symbols,
    footprints: counts.footprints,
    components: counts.components,
    models3d: counts.models3d,
  };
  process.stdout.write(JSON.stringify(summary) + "\n");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
