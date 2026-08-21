/**
 * Minimal Supabase Storage replacement.
 *
 * The app uses exactly two operations against one public bucket
 * (`product-images`): `.upload()` and `.getPublicUrl()`. getPublicUrl does not
 * even hit the network - supabase-js just builds
 * `${url}/storage/v1/object/public/${bucket}/${path}` - so the only thing that
 * genuinely needs a server is the upload.
 *
 * That is why this is 150 lines instead of the full storage-api container: the
 * real thing brings S3 abstraction, image transformation, multi-tenancy and its
 * own database schema to serve a use case that is "write a file, serve it back".
 * Reads are handled by nginx straight off disk, which is faster than proxying
 * them through Node anyway.
 *
 * Files land in /var/www/catalogshare-storage/<bucket>/<path>.
 *
 * SECURITY
 * Uploads require a valid JWT signed with the same secret GoTrue uses, with
 * role `authenticated` or `service_role`. Anonymous upload would be an open
 * file drop on a public URL - free hosting for anything anyone wants to serve
 * from your domain.
 */

import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdirSync, createWriteStream, existsSync, statSync } from "node:fs";
import { dirname, join, normalize, extname } from "node:path";

const PORT = Number(process.env.PORT ?? 5013);
const ROOT = process.env.STORAGE_ROOT ?? "/var/www/catalogshare-storage";
const JWT_SECRET = process.env.JWT_SECRET ?? "";

/** Buckets that may be written to. An unknown bucket is a typo or an attack. */
const BUCKETS = new Set(["product-images"]);

/** Play flags large APKs, and a merchant does not need to upload a 50MB photo. */
const MAX_BYTES = 15 * 1024 * 1024;

/**
 * Extensions allowed on disk.
 *
 * The bucket is served publicly from our own domain, so anything executable or
 * script-like here is a stored-XSS vector on app.catalogshare.online. PDFs are
 * allowed because invoices are uploaded as PDFs.
 */
const ALLOWED = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".heic", ".svg", ".pdf",
]);

function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

function verifyJwt(token) {
  if (!token || !JWT_SECRET) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;

  const expected = createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest();
  let given;
  try {
    given = Buffer.from(s, "base64url");
  } catch {
    return null;
  }
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  let claims;
  try {
    claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (claims.exp && Date.now() / 1000 > claims.exp) return null;
  return claims;
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": typeof body === "string" ? "text/plain" : "application/json",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(payload);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  if (path === "/health") return send(res, 200, "healthy");

  // supabase-js posts to /object/<bucket>/<path> once nginx has stripped the
  // /backend/storage/v1 prefix.
  const match = /^\/object\/([a-z0-9-]+)\/(.+)$/i.exec(path);
  if (!match || (req.method !== "POST" && req.method !== "PUT")) {
    return send(res, 404, { error: "Not found" });
  }

  const [, bucket, rawKey] = match;
  if (!BUCKETS.has(bucket)) return send(res, 404, { error: "Bucket not found" });

  const claims = verifyJwt((req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
  if (!claims || !["authenticated", "service_role"].includes(claims.role)) {
    return send(res, 401, { error: "Unauthorized" });
  }

  // normalize() collapses ".." BEFORE the prefix check, so a crafted key cannot
  // climb out of the bucket directory and write anywhere on disk.
  const key = decodeURIComponent(rawKey);
  const bucketDir = join(ROOT, bucket);
  const dest = normalize(join(bucketDir, key));
  if (!dest.startsWith(bucketDir + "/") && dest !== bucketDir) {
    return send(res, 400, { error: "Invalid path" });
  }

  const ext = extname(dest).toLowerCase();
  if (!ALLOWED.has(ext)) return send(res, 400, { error: `File type ${ext || "(none)"} is not allowed` });

  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > MAX_BYTES) return send(res, 413, { error: "File is too large" });

  mkdirSync(dirname(dest), { recursive: true });

  let written = 0;
  let aborted = false;
  const out = createWriteStream(dest);

  req.on("data", (chunk) => {
    written += chunk.length;
    // Content-Length can lie; count what actually arrives.
    if (written > MAX_BYTES && !aborted) {
      aborted = true;
      out.destroy();
      req.destroy();
      log("[storage] rejected oversize upload", bucket, key);
    }
  });

  req.pipe(out);

  out.on("finish", () => {
    if (aborted) return;
    log("[storage] stored", `${bucket}/${key}`, `${written}b`);
    send(res, 200, { Key: `${bucket}/${key}`, path: key, id: `${bucket}/${key}` });
  });

  out.on("error", (err) => {
    if (aborted) return send(res, 413, { error: "File is too large" });
    log("[storage] write failed", err.message);
    send(res, 500, { error: "Could not store the file" });
  });
});

if (!JWT_SECRET) {
  console.error("[storage] JWT_SECRET is not set - refusing to start, every upload would be unauthenticated");
  process.exit(1);
}

mkdirSync(join(ROOT, "product-images"), { recursive: true });

server.listen(PORT, "127.0.0.1", () => {
  log(`[storage] listening on 127.0.0.1:${PORT}, root ${ROOT}`);
});
