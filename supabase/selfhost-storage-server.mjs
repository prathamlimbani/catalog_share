/**
 * Minimal Supabase Storage replacement.
 *
 * The app uses one public bucket (`product-images`) and four operations:
 * `.upload()`, `.getPublicUrl()`, and - from the account-deletion function -
 * `.list()` and `.remove()`. getPublicUrl never hits the network (supabase-js
 * just builds `${url}/storage/v1/object/public/${bucket}/${path}`), and reads
 * are served by nginx straight off disk, so this process only ever handles
 * writes, listings and deletes.
 *
 * That is why this is a few hundred lines instead of the full storage-api
 * container: the real thing brings S3 abstraction, image transformation,
 * multi-tenancy and its own database schema to serve a use case that is "write
 * a file, serve it back".
 *
 * Files land in /var/www/catalogshare-storage/<bucket>/<path>.
 *
 * WIRE FORMAT - the part that went wrong the first time
 * supabase-js does NOT send the file as the request body. For a File/Blob it
 * builds a multipart/form-data body with a `cacheControl` field and the file in
 * an unnamed part; only an ArrayBuffer/string upload arrives raw. The first
 * version of this service wrote the request body to disk verbatim, so any image
 * chosen in the app would have been stored wrapped in its multipart envelope
 * and served back as a broken picture. Both shapes are accepted now, decided by
 * the Content-Type header.
 *
 * SECURITY
 * Writes and deletes require a valid JWT signed with the same secret GoTrue
 * uses, with role `authenticated` or `service_role`. Anonymous upload would be
 * an open file drop on a public URL - free hosting for anything anyone wants to
 * serve from your domain.
 */

import { createServer } from "node:http";
import { createHmac, timingSafeEqual, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, existsSync, statSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, extname, sep } from "node:path";
import { pathToFileURL } from "node:url";

const PORT = Number(process.env.PORT ?? 5013);
const ROOT = process.env.STORAGE_ROOT ?? "/var/www/catalogshare-storage";
const JWT_SECRET = process.env.JWT_SECRET ?? "";

/** Buckets that may be written to. An unknown bucket is a typo or an attack. */
const BUCKETS = new Set(["product-images"]);

/** Play flags large APKs, and a merchant does not need to upload a 50MB photo. */
const MAX_BYTES = 15 * 1024 * 1024;

/**
 * The multipart envelope around a file is a few hundred bytes, but a request
 * body can only be measured once it has arrived, so the cap applied while
 * receiving is a little looser than the cap applied to the file itself.
 */
const MAX_BODY_BYTES = MAX_BYTES + 64 * 1024;

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

const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".heic": "image/heic",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
};

function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

// ----------------------------------------------------------------- auth

export function verifyJwt(token, secret = JWT_SECRET) {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;

  const expected = createHmac("sha256", secret).update(`${h}.${p}`).digest();
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

/**
 * The verified caller, or null, restricted to a set of roles.
 *
 * Uploads are open to any signed-in merchant (the app writes product photos,
 * logos and QR codes on their own behalf). Listing and deleting are NOT: the
 * only caller that needs them is the account-deletion function, which runs with
 * the service role. Left open to `authenticated`, `list` would let any merchant
 * enumerate the whole bucket and `remove` would let them delete another
 * merchant's photos - there is no per-object owner check here to stop them, and
 * the object keys (company id, owner id) are guessable.
 */
function callerOf(req, roles = ["authenticated", "service_role"]) {
  const claims = verifyJwt((req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
  if (!claims || !roles.includes(claims.role)) return null;
  return claims;
}

// ------------------------------------------------------------ responses

/**
 * Error bodies carry both `message` and `error`: storage-js reads `message`
 * first and falls back to `error`, and curl users read whichever is there.
 */
function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": typeof body === "string" ? "text/plain" : "application/json",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(payload);
}

function fail(res, status, message, code = String(status)) {
  return send(res, status, { statusCode: code, error: message, message });
}

// ------------------------------------------------------------- multipart

/**
 * Parse a multipart/form-data body into its parts.
 *
 * Deliberately tiny: there are no external dependencies on this host, and the
 * only producer of these bodies is supabase-js, which emits the textbook
 * layout - a boundary line, headers, a blank line, the data, repeat. Each
 * part is returned with its parsed Content-Disposition so the caller can pick
 * the file out from the `cacheControl` / `metadata` fields next to it.
 *
 * Exported for the tests. Throws on anything that is not well-formed; the
 * caller turns that into a 400.
 */
export function parseMultipart(body, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const partBreak = Buffer.from(`\r\n--${boundary}`);
  const parts = [];

  let pos = body.indexOf(delimiter);
  if (pos < 0) throw new Error("multipart body has no opening boundary");
  pos += delimiter.length;

  for (;;) {
    // "--" straight after a boundary is the closing delimiter.
    if (body[pos] === 0x2d && body[pos + 1] === 0x2d) break;
    if (body[pos] === 0x0d && body[pos + 1] === 0x0a) pos += 2;
    else throw new Error("malformed multipart boundary line");

    const headersEnd = body.indexOf("\r\n\r\n", pos, "latin1");
    if (headersEnd < 0) throw new Error("multipart part has no header terminator");
    const rawHeaders = body.subarray(pos, headersEnd).toString("latin1");
    const dataStart = headersEnd + 4;

    const next = body.indexOf(partBreak, dataStart);
    if (next < 0) throw new Error("multipart part is not terminated");
    const data = body.subarray(dataStart, next);

    const headers = {};
    for (const line of rawHeaders.split("\r\n")) {
      const idx = line.indexOf(":");
      if (idx > 0) headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    }
    const disposition = headers["content-disposition"] ?? "";
    const nameMatch = /(?:^|;)\s*name="([^"]*)"/i.exec(disposition);
    const fileMatch = /(?:^|;)\s*filename="([^"]*)"/i.exec(disposition);

    parts.push({
      name: nameMatch ? nameMatch[1] : null,
      filename: fileMatch ? fileMatch[1] : null,
      contentType: headers["content-type"] ?? null,
      data,
    });

    pos = next + partBreak.length;
  }

  return parts;
}

/**
 * The bytes to store, from whichever shape the client sent.
 *
 * supabase-js puts a Blob in an UNNAMED part (`name=""`) with a filename, and
 * the cache-control hint in a part called `cacheControl`. A FormData passed in
 * by the caller can name the file part anything, so the rule is: the part
 * with a filename wins, then the part with an empty name, then - for a body
 * that is somehow all fields - the largest part.
 */
export function fileFromBody(body, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? "");
  if (!/^multipart\/form-data/i.test(contentType ?? "") || !boundaryMatch) {
    return { data: body, contentType: contentType || null };
  }

  const boundary = (boundaryMatch[1] ?? boundaryMatch[2]).trim();
  const parts = parseMultipart(body, boundary);
  if (parts.length === 0) throw new Error("multipart body has no parts");

  const chosen =
    parts.find((p) => p.filename !== null) ??
    parts.find((p) => p.name === "") ??
    parts.reduce((a, b) => (b.data.length > a.data.length ? b : a));

  return { data: chosen.data, contentType: chosen.contentType };
}

// ---------------------------------------------------------------- paths

/**
 * Resolve a bucket-relative key to a path on disk, or null if it escapes.
 *
 * normalize() collapses ".." BEFORE the prefix check, so a crafted key cannot
 * climb out of the bucket directory and write anywhere on disk.
 *
 * `encoded` says where the key came from: an upload key is a URL PATH segment
 * and arrives percent-encoded, so it is decoded once; a list/remove key comes
 * from a JSON body already decoded, so decoding it again would corrupt any name
 * containing a literal `%` and could even throw. Decode exactly once, at the
 * right layer.
 */
function resolveKey(bucket, rawKey, encoded = false) {
  let key = rawKey;
  if (encoded) {
    try {
      key = decodeURIComponent(rawKey);
    } catch {
      return null;
    }
  }
  if (!key || typeof key !== "string" || key.includes("\0")) return null;
  const bucketDir = join(ROOT, bucket);
  const dest = normalize(join(bucketDir, key));
  if (!dest.startsWith(bucketDir + sep)) return null;
  return { key, dest, bucketDir };
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let received = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      if (tooLarge) return;
      received += chunk.length;
      // Content-Length can lie; count what actually arrives.
      if (received > limit) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => (tooLarge ? reject(Object.assign(new Error("too large"), { tooLarge: true })) : resolve(Buffer.concat(chunks))));
    req.on("error", reject);
  });
}

function parseJson(buf) {
  if (!buf.length) return {};
  return JSON.parse(buf.toString("utf8"));
}

// -------------------------------------------------------------- handlers

async function handleUpload(req, res, bucket, rawKey) {
  if (!callerOf(req)) return fail(res, 401, "Unauthorized");

  // rawKey is a URL path segment, so it is percent-encoded.
  const resolved = resolveKey(bucket, rawKey, true);
  if (!resolved) return fail(res, 400, "Invalid path");
  const { key, dest } = resolved;

  const ext = extname(dest).toLowerCase();
  if (!ALLOWED.has(ext)) return fail(res, 400, `File type ${ext || "(none)"} is not allowed`);

  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > MAX_BODY_BYTES) return fail(res, 413, "File is too large");

  // storage-api's contract: an upload refuses to replace an existing object
  // unless the client said upsert. The app relies on this for nothing today
  // (product photos get unique names, logos always upsert), but a client that
  // asks for it should get it.
  const upsert = String(req.headers["x-upsert"] ?? "false").toLowerCase() === "true";
  if (!upsert && existsSync(dest)) {
    return send(res, 400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
  }

  let body;
  try {
    body = await readBody(req, MAX_BODY_BYTES);
  } catch (err) {
    if (err?.tooLarge) return fail(res, 413, "File is too large");
    return fail(res, 400, "Bad request");
  }

  let file;
  try {
    file = fileFromBody(body, req.headers["content-type"]);
  } catch (err) {
    log("[storage] rejected malformed upload", bucket, key, err.message);
    return fail(res, 400, "Malformed upload body");
  }

  if (file.data.length === 0) return fail(res, 400, "Empty file");
  if (file.data.length > MAX_BYTES) return fail(res, 413, "File is too large");

  // Write beside the target and rename into place, so nginx can never serve a
  // half-written object to a storefront visitor.
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.${randomBytes(6).toString("hex")}.part`;
  try {
    writeFileSync(tmp, file.data);
    renameSync(tmp, dest);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      /* never created */
    }
    log("[storage] write failed", err.message);
    return fail(res, 500, "Could not store the file");
  }

  log("[storage] stored", `${bucket}/${key}`, `${file.data.length}b`, file.contentType ?? "");
  return send(res, 200, { Key: `${bucket}/${key}`, Id: randomUUID(), path: key, id: `${bucket}/${key}` });
}

/**
 * POST /object/list/<bucket>  { prefix, limit, offset, search }
 *
 * Mirrors storage-api's shape closely enough for supabase-js: one level at a
 * time, folders reported with a null id so callers recurse into them.
 *
 * SERVICE ROLE ONLY - see callerOf. A merchant token cannot enumerate the
 * bucket; only the account-deletion function (service role) lists.
 */
async function handleList(req, res, bucket) {
  if (!callerOf(req, ["service_role"])) return fail(res, 401, "Unauthorized");

  let opts;
  try {
    opts = parseJson(await readBody(req, 64 * 1024));
  } catch {
    return fail(res, 400, "Bad request");
  }

  const prefix = String(opts.prefix ?? "").replace(/^\/+|\/+$/g, "");
  const dir = prefix ? resolveKey(bucket, prefix)?.dest : join(ROOT, bucket);
  if (dir === null || dir === undefined) return fail(res, 400, "Invalid prefix");

  const limit = Math.max(1, Math.min(1000, Number(opts.limit ?? 100) || 100));
  const offset = Math.max(0, Number(opts.offset ?? 0) || 0);
  const search = String(opts.search ?? "").toLowerCase();

  let entries = [];
  if (existsSync(dir) && statSync(dir).isDirectory()) {
    entries = readdirSync(dir, { withFileTypes: true })
      .filter((e) => !e.name.endsWith(".part"))
      .filter((e) => !search || e.name.toLowerCase().includes(search))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => {
        if (e.isDirectory()) {
          return { name: e.name, id: null, updated_at: null, created_at: null, last_accessed_at: null, metadata: null };
        }
        const st = statSync(join(dir, e.name));
        const ext = extname(e.name).toLowerCase();
        const stamp = st.mtime.toISOString();
        return {
          name: e.name,
          // Deterministic so the same object lists with the same id every time.
          id: createHmac("sha256", "id").update(`${bucket}/${prefix ? prefix + "/" : ""}${e.name}`).digest("hex").slice(0, 32),
          updated_at: stamp,
          created_at: st.birthtime?.toISOString?.() ?? stamp,
          last_accessed_at: st.atime.toISOString(),
          metadata: { size: st.size, mimetype: MIME_BY_EXT[ext] ?? "application/octet-stream", lastModified: stamp },
        };
      });
  }

  return send(res, 200, entries.slice(offset, offset + limit));
}

/**
 * DELETE /object/<bucket>  { prefixes: [key, ...] }
 *
 * Returns the objects that were actually removed, like storage-api. A key that
 * does not exist is skipped rather than failing the batch, because the caller
 * (account deletion) would otherwise abort erasure over a photo that was
 * already gone.
 *
 * SERVICE ROLE ONLY - see callerOf. A merchant token must not be able to delete
 * anything by key; the app never deletes objects, only the deletion function
 * does, and it holds the service role.
 */
async function handleRemove(req, res, bucket) {
  if (!callerOf(req, ["service_role"])) return fail(res, 401, "Unauthorized");

  let opts;
  try {
    opts = parseJson(await readBody(req, 1024 * 1024));
  } catch {
    return fail(res, 400, "Bad request");
  }

  const prefixes = Array.isArray(opts.prefixes) ? opts.prefixes : [];
  const removed = [];
  for (const raw of prefixes) {
    if (typeof raw !== "string") continue;
    const resolved = resolveKey(bucket, raw);
    if (!resolved) continue;
    try {
      if (existsSync(resolved.dest) && statSync(resolved.dest).isFile()) {
        unlinkSync(resolved.dest);
        removed.push({ name: resolved.key, bucket_id: bucket });
      }
    } catch (err) {
      log("[storage] remove failed", `${bucket}/${resolved.key}`, err.message);
    }
  }

  if (removed.length) log("[storage] removed", removed.map((r) => `${bucket}/${r.name}`).join(", "));
  return send(res, 200, removed);
}

// ---------------------------------------------------------------- server

export function createStorageServer() {
  return createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    // nginx strips /backend/storage/v1 before proxying. Tolerating the prefix
    // here too lets the service be addressed directly (tests, curl, the
    // internal gateway) without a second copy of that rewrite.
    const path = url.pathname.replace(/^\/storage\/v1(?=\/)/, "");

    if (path === "/health") return send(res, 200, "healthy");

    const handle = (p) => p.catch((err) => {
      log("[storage] handler threw", err?.stack ?? err);
      if (!res.headersSent) fail(res, 500, "Internal error");
    });

    let m;
    if ((m = /^\/object\/list\/([a-z0-9-]+)\/?$/i.exec(path)) && req.method === "POST") {
      if (!BUCKETS.has(m[1])) return fail(res, 404, "Bucket not found");
      return handle(handleList(req, res, m[1]));
    }

    if ((m = /^\/object\/([a-z0-9-]+)\/?$/i.exec(path)) && req.method === "DELETE") {
      if (!BUCKETS.has(m[1])) return fail(res, 404, "Bucket not found");
      return handle(handleRemove(req, res, m[1]));
    }

    if ((m = /^\/object\/([a-z0-9-]+)\/(.+)$/i.exec(path)) && (req.method === "POST" || req.method === "PUT")) {
      if (!BUCKETS.has(m[1])) return fail(res, 404, "Bucket not found");
      return handle(handleUpload(req, res, m[1], m[2]));
    }

    return fail(res, 404, "Not found");
  });
}

// Only serve when run directly, so the tests can import the parser and the
// server factory without binding a port.
const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
const runAsMain = invokedDirectly || process.env.STORAGE_SERVE === "1";

if (runAsMain) {
  if (!JWT_SECRET) {
    console.error("[storage] JWT_SECRET is not set - refusing to start, every upload would be unauthenticated");
    process.exit(1);
  }

  for (const bucket of BUCKETS) mkdirSync(join(ROOT, bucket), { recursive: true });

  createStorageServer().listen(PORT, "127.0.0.1", () => {
    log(`[storage] listening on 127.0.0.1:${PORT}, root ${ROOT}`);
  });
}
