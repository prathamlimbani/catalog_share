// @vitest-environment node
/**
 * The self-hosted storage service, driven by the real supabase-js client.
 *
 * The first version of the service wrote the request body to disk verbatim.
 * That passed every curl test and would have stored every photo chosen in the
 * app wrapped in a multipart envelope, because supabase-js sends a File as
 * multipart/form-data. So these tests do not hand-craft requests: they go
 * through `supabase.storage.from(bucket).upload(...)` exactly as the app does,
 * and assert on the bytes that land on disk.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SECRET = "test-secret-that-is-long-enough-for-hs256";
const BUCKET = "product-images";

function jwt(claims: Record<string, unknown>, secret = SECRET): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = enc({ alg: "HS256", typ: "JWT" });
  const body = enc({ exp: Math.floor(Date.now() / 1000) + 3600, ...claims });
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

/** Bytes chosen to contain every sequence the multipart parser keys on. */
function awkwardImageBytes(size = 200_000): Buffer {
  const buf = randomBytes(size);
  // Scatter CRLFs, boundary-looking dashes and "\r\n--" runs through the
  // payload so a parser that searched for the wrong thing would corrupt it.
  for (let i = 1000; i < size - 16; i += 7919) {
    buf.write("\r\n--\r\n\r\n--", i, "latin1");
  }
  buf.write("\xff\xd8\xff\xe0", 0, "latin1"); // JPEG SOI
  return buf;
}

let root: string;
let server: Server;
let baseUrl: string;
let asUser: SupabaseClient;
let asAnon: SupabaseClient;
let asService: SupabaseClient;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "cs-storage-"));
  process.env.STORAGE_ROOT = root;
  process.env.JWT_SECRET = SECRET;
  mkdirSync(join(root, BUCKET), { recursive: true });

  // Imported after the env is set: the module reads its config at load time.
  const mod = await import("../../supabase/selfhost-storage-server.mjs");
  server = mod.createStorageServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;

  const anonKey = jwt({ role: "anon" });
  const userKey = jwt({ role: "authenticated", sub: "11111111-1111-1111-1111-111111111111" });

  asUser = createClient(baseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${userKey}` } },
  });
  asAnon = createClient(baseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const serviceKey = jwt({ role: "service_role" });
  asService = createClient(baseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${serviceKey}` } },
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
});

describe("uploads through supabase-js", () => {
  it("stores exactly the file bytes when the client sends a Blob (multipart)", async () => {
    const bytes = awkwardImageBytes();
    const blob = new Blob([bytes], { type: "image/jpeg" });

    const { data, error } = await asUser.storage.from(BUCKET).upload("company-a/photo.jpg", blob);

    expect(error).toBeNull();
    expect(data?.path).toBe("company-a/photo.jpg");
    expect(data?.fullPath).toBe(`${BUCKET}/company-a/photo.jpg`);

    const onDisk = readFileSync(join(root, BUCKET, "company-a", "photo.jpg"));
    expect(onDisk.length).toBe(bytes.length);
    expect(onDisk.equals(bytes)).toBe(true);
    // No multipart envelope leaked into the stored object.
    expect(onDisk.subarray(0, 2).toString("latin1")).toBe("\xff\xd8");
  });

  it("stores a raw body verbatim when the client sends an ArrayBuffer", async () => {
    const bytes = awkwardImageBytes(50_000);
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

    const { error } = await asUser.storage
      .from(BUCKET)
      .upload("company-a/raw.png", arrayBuffer, { contentType: "image/png" });

    expect(error).toBeNull();
    expect(readFileSync(join(root, BUCKET, "company-a", "raw.png")).equals(bytes)).toBe(true);
  });

  it("refuses to overwrite unless upsert is requested, then overwrites", async () => {
    const first = new Blob([Buffer.from("first")], { type: "image/png" });
    const second = new Blob([Buffer.from("second")], { type: "image/png" });

    expect((await asUser.storage.from(BUCKET).upload("logos/u.png", first)).error).toBeNull();

    const dup = await asUser.storage.from(BUCKET).upload("logos/u.png", second);
    expect(dup.error?.message).toMatch(/already exists/i);
    expect(readFileSync(join(root, BUCKET, "logos", "u.png"), "utf8")).toBe("first");

    const over = await asUser.storage.from(BUCKET).upload("logos/u.png", second, { upsert: true });
    expect(over.error).toBeNull();
    expect(readFileSync(join(root, BUCKET, "logos", "u.png"), "utf8")).toBe("second");
  });

  it("rejects anonymous uploads", async () => {
    const { error } = await asAnon.storage
      .from(BUCKET)
      .upload("company-b/anon.jpg", new Blob([Buffer.from("x")], { type: "image/jpeg" }));
    expect(error).not.toBeNull();
    expect(existsSync(join(root, BUCKET, "company-b", "anon.jpg"))).toBe(false);
  });

  it("rejects a token signed with the wrong secret", async () => {
    const forged = createClient(baseUrl, jwt({ role: "anon" }), {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${jwt({ role: "authenticated" }, "other")}` } },
    });
    const { error } = await forged.storage
      .from(BUCKET)
      .upload("company-b/forged.jpg", new Blob([Buffer.from("x")], { type: "image/jpeg" }));
    expect(error).not.toBeNull();
  });

  it("rejects file types that could be served as a page", async () => {
    for (const name of ["company-b/page.html", "company-b/script.js", "company-b/noext"]) {
      const { error } = await asUser.storage
        .from(BUCKET)
        .upload(name, new Blob([Buffer.from("<script>")], { type: "text/html" }));
      expect(error, name).not.toBeNull();
    }
  });

  it("cannot climb out of the bucket directory", async () => {
    const { error } = await asUser.storage
      .from(BUCKET)
      .upload("../../escape.jpg", new Blob([Buffer.from("x")], { type: "image/jpeg" }));
    expect(error).not.toBeNull();
    expect(existsSync(join(root, "escape.jpg"))).toBe(false);
  });

  it("rejects an unknown bucket", async () => {
    const { error } = await asUser.storage
      .from("other-bucket")
      .upload("a.jpg", new Blob([Buffer.from("x")], { type: "image/jpeg" }));
    expect(error).not.toBeNull();
  });
});

describe("listing and removal (what account deletion relies on — service role only)", () => {
  it("lists files with ids and folders with null ids, one level at a time", async () => {
    mkdirSync(join(root, BUCKET, "company-c", "nested"), { recursive: true });
    writeFileSync(join(root, BUCKET, "company-c", "one.jpg"), "1");
    writeFileSync(join(root, BUCKET, "company-c", "nested", "two.jpg"), "2");

    const { data, error } = await asService.storage.from(BUCKET).list("company-c", { limit: 100, offset: 0 });
    expect(error).toBeNull();
    const byName = new Map((data ?? []).map((e) => [e.name, e]));
    expect(byName.get("one.jpg")?.id).toBeTruthy();
    expect(byName.get("one.jpg")?.metadata?.mimetype).toBe("image/jpeg");
    expect(byName.get("nested")?.id).toBeNull();
    expect(byName.has("two.jpg")).toBe(false);
  });

  it("returns an empty list for a prefix that does not exist", async () => {
    const { data, error } = await asService.storage.from(BUCKET).list("nowhere");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("removes the named objects and skips ones that are already gone", async () => {
    const { data, error } = await asService.storage
      .from(BUCKET)
      .remove(["company-c/one.jpg", "company-c/nested/two.jpg", "company-c/missing.jpg"]);
    expect(error).toBeNull();
    expect((data ?? []).map((d) => d.name).sort()).toEqual(["company-c/nested/two.jpg", "company-c/one.jpg"]);
    expect(existsSync(join(root, BUCKET, "company-c", "one.jpg"))).toBe(false);
  });

  it("refuses a MERCHANT token listing or removing — no cross-tenant enumeration or deletion", async () => {
    // asUser is a plain authenticated caller: the exact token an attacker would
    // hold. It may upload, but must not be able to see or delete the bucket.
    expect((await asUser.storage.from(BUCKET).list("company-a")).error).not.toBeNull();
    expect((await asUser.storage.from(BUCKET).remove(["company-a/photo.jpg"])).error).not.toBeNull();
    expect(existsSync(join(root, BUCKET, "company-a", "photo.jpg"))).toBe(true);
  });

  it("refuses anonymous listing and removal", async () => {
    expect((await asAnon.storage.from(BUCKET).list("company-a")).error).not.toBeNull();
    expect((await asAnon.storage.from(BUCKET).remove(["company-a/photo.jpg"])).error).not.toBeNull();
    expect(existsSync(join(root, BUCKET, "company-a", "photo.jpg"))).toBe(true);
  });
});

describe("parseMultipart", () => {
  it("splits a textbook body into named parts", async () => {
    const { parseMultipart } = await import("../../supabase/selfhost-storage-server.mjs");
    const b = "XyZ";
    const body = Buffer.from(
      `--${b}\r\nContent-Disposition: form-data; name="cacheControl"\r\n\r\n3600\r\n` +
        `--${b}\r\nContent-Disposition: form-data; name=""; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\nDATA\r\n--\r\n` +
        `--${b}--\r\n`,
      "latin1",
    );
    const parts = parseMultipart(body, b);
    expect(parts.map((p) => p.name)).toEqual(["cacheControl", ""]);
    expect(parts[0].data.toString()).toBe("3600");
    expect(parts[1].filename).toBe("a.jpg");
    expect(parts[1].contentType).toBe("image/jpeg");
    expect(parts[1].data.toString("latin1")).toBe("DATA\r\n--");
  });

  it("throws on a body without a closing boundary", async () => {
    const { parseMultipart } = await import("../../supabase/selfhost-storage-server.mjs");
    const body = Buffer.from(`--B\r\nContent-Disposition: form-data; name=""\r\n\r\nDATA`, "latin1");
    expect(() => parseMultipart(body, "B")).toThrow();
  });
});
