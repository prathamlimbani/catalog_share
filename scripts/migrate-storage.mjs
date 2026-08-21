/**
 * Copy the `product-images` bucket out of Supabase and into the self-hosted
 * storage, then rewrite the URLs held in the database.
 *
 *     SUPABASE_SECRET_KEY=sb_secret_xxx node scripts/migrate-storage.mjs
 *
 * Downloads to ./supabase-export/storage/, which is then shipped to the server
 * in one archive rather than 200 individual authenticated uploads.
 *
 * WHY THE URL REWRITE MATTERS
 * Image URLs are stored as absolute Supabase CDN links in companies.logo_url,
 * companies.upi_qr_url and products.image_url / products.images. Copying the
 * files alone changes nothing: every image would still be served from Supabase,
 * and would break the day that project is deleted. The rewrite is the migration;
 * the download is just what makes the rewrite safe.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const URL_BASE = process.env.SUPABASE_URL ?? "https://yoiqsyjitpchkbodkvpa.supabase.co";
const SECRET = process.env.SUPABASE_SECRET_KEY ?? "";
const BUCKET = "product-images";
const OUT = join("supabase-export", "storage");

if (!SECRET) {
  console.error("\nSUPABASE_SECRET_KEY is required.\n");
  process.exit(1);
}

const headers = { apikey: SECRET, Authorization: `Bearer ${SECRET}` };

/**
 * List a bucket, recursing into folders.
 *
 * The list endpoint returns folders as entries with a null `id`, and does NOT
 * recurse on its own - a flat call finds only the top level, which on this
 * bucket is almost entirely folders.
 */
async function list(prefix = "") {
  const found = [];
  let offset = 0;
  for (;;) {
    const res = await fetch(`${URL_BASE}/storage/v1/object/list/${BUCKET}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix, limit: 100, offset, sortBy: { column: "name", order: "asc" } }),
    });
    if (!res.ok) throw new Error(`list ${prefix}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const page = await res.json();
    if (!page.length) break;

    for (const entry of page) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        found.push(...(await list(path)));
      } else {
        found.push({ path, size: entry.metadata?.size ?? 0 });
      }
    }
    if (page.length < 100) break;
    offset += 100;
  }
  return found;
}

console.log(`\nListing ${BUCKET}\n`);
const files = await list();
const total = files.reduce((n, f) => n + Number(f.size || 0), 0);
console.log(`  ${files.length} files, ${(total / 1024 / 1024).toFixed(1)} MB\n`);

let ok = 0;
let failed = 0;

for (const f of files) {
  const dest = join(OUT, f.path);
  if (existsSync(dest)) {
    ok += 1;
    continue;
  }
  try {
    const res = await fetch(`${URL_BASE}/storage/v1/object/${BUCKET}/${encodeURI(f.path)}`, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, buf);
    ok += 1;
    if (ok % 25 === 0) console.log(`  ${ok}/${files.length}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAILED ${f.path}: ${err.message}`);
  }
}

console.log(`\n  downloaded ${ok}, failed ${failed}`);

// The rewrite runs against the self-hosted database, so it is emitted as SQL
// rather than executed here.
const rewrite = `-- Point every stored image URL at the self-hosted bucket.
--
-- Copying the files changes nothing on its own: these columns hold absolute
-- Supabase CDN links, so every image would still be served from Supabase and
-- would break the day that project is deleted.
--
-- The old host is left in place for any URL whose file did NOT come across, so
-- a missed file keeps working rather than turning into a broken image.

UPDATE public.companies
   SET logo_url = replace(logo_url,
        '${URL_BASE}/storage/v1/object/public/${BUCKET}/',
        'https://app.catalogshare.online/backend/storage/v1/object/public/${BUCKET}/')
 WHERE logo_url LIKE '${URL_BASE}%';

UPDATE public.companies
   SET upi_qr_url = replace(upi_qr_url,
        '${URL_BASE}/storage/v1/object/public/${BUCKET}/',
        'https://app.catalogshare.online/backend/storage/v1/object/public/${BUCKET}/')
 WHERE upi_qr_url LIKE '${URL_BASE}%';

UPDATE public.products
   SET image_url = replace(image_url,
        '${URL_BASE}/storage/v1/object/public/${BUCKET}/',
        'https://app.catalogshare.online/backend/storage/v1/object/public/${BUCKET}/')
 WHERE image_url LIKE '${URL_BASE}%';

-- images is text[]; rewrite each element.
UPDATE public.products p
   SET images = sub.arr
  FROM (
    SELECT id, array_agg(
             replace(elem,
               '${URL_BASE}/storage/v1/object/public/${BUCKET}/',
               'https://app.catalogshare.online/backend/storage/v1/object/public/${BUCKET}/')
             ORDER BY ord) AS arr
      FROM public.products, unnest(images) WITH ORDINALITY AS t(elem, ord)
     GROUP BY id
  ) sub
 WHERE p.id = sub.id AND p.images IS NOT NULL;

SELECT 'companies.logo_url'  AS col, count(*) FILTER (WHERE logo_url  LIKE '%app.catalogshare.online%') AS moved,
       count(*) FILTER (WHERE logo_url LIKE '%supabase.co%') AS still_remote FROM public.companies
UNION ALL
SELECT 'products.image_url', count(*) FILTER (WHERE image_url LIKE '%app.catalogshare.online%'),
       count(*) FILTER (WHERE image_url LIKE '%supabase.co%') FROM public.products;
`;

writeFileSync(join("supabase-export", "rewrite-image-urls.sql"), rewrite);
console.log(`  wrote supabase-export/rewrite-image-urls.sql\n`);
