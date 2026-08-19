/**
 * Read-only mirrors of the company row and the product catalogue.
 *
 * These exist so the estimate screens are fully usable offline: the item picker
 * needs products, and the PDF header needs the company name, GSTIN and logo.
 * The logo is stored as a data URI because a remote <img> inside the PDF
 * capture target renders blank (and stalls html2canvas) with no network.
 */

import { getDB, metaSet, META_KEYS, type OfflineCompany, type OfflineProduct } from "./db";
import { urlToDataUri } from "@/native/files";

// ------------------------------------------------------------- company

export async function getMirroredCompany(): Promise<OfflineCompany | null> {
  try {
    const db = await getDB();
    const rows = await db.getAll("company");
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function mirrorCompany(company: Record<string, unknown> | null): Promise<void> {
  if (!company?.id) return;

  try {
    const db = await getDB();
    const previous = await db.get("company", String(company.id));

    const logoUrl = (company.logo_url as string) ?? null;
    let logoDataUri = previous?.logo_data_uri ?? null;

    // Re-fetch the logo only when the URL actually changed.
    if (logoUrl && logoUrl !== previous?.logo_url) {
      logoDataUri = await urlToDataUri(logoUrl);
    } else if (!logoUrl) {
      logoDataUri = null;
    }

    const record: OfflineCompany = {
      id: String(company.id),
      name: (company.name as string) ?? "",
      slug: (company.slug as string) ?? null,
      email: (company.email as string) ?? null,
      phone: (company.phone as string) ?? null,
      address: (company.address as string) ?? null,
      gst_number: (company.gst_number as string) ?? null,
      logo_url: logoUrl,
      logo_data_uri: logoDataUri,
      subscription_plan: (company.subscription_plan as string) ?? "free",
      subscription_expires_at: (company.subscription_expires_at as string) ?? null,
      trial_started_at: (company.trial_started_at as string) ?? null,
      upi_id: (company.upi_id as string) ?? null,
      cachedAt: new Date().toISOString(),
    };

    // Clear any stale row for a different account before writing this one.
    const all = await db.getAll("company");
    const tx = db.transaction("company", "readwrite");
    for (const row of all) {
      if (row.id !== record.id) await tx.store.delete(row.id);
    }
    await tx.store.put(record);
    await tx.done;
  } catch (err) {
    console.warn("[mirror] company mirror failed:", err);
  }
}

// ------------------------------------------------------------ products

export async function getMirroredProducts(companyId: string): Promise<OfflineProduct[]> {
  try {
    const db = await getDB();
    const rows = await db.getAllFromIndex("products", "by_company", companyId);
    return rows.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  } catch {
    return [];
  }
}

export async function mirrorProducts(
  companyId: string,
  products: Array<Record<string, unknown>>,
): Promise<void> {
  if (!companyId) return;

  try {
    const db = await getDB();
    const tx = db.transaction("products", "readwrite");
    const store = tx.objectStore("products");

    // Replace the whole slice for this company so deleted products disappear.
    const existing = await store.index("by_company").getAllKeys(companyId);
    for (const key of existing) await store.delete(key);

    for (const p of products) {
      if (!p?.id) continue;
      await store.put({
        id: String(p.id),
        company_id: companyId,
        name: (p.name as string) ?? "",
        price: Number(p.price) || 0,
        category: (p.category as string) ?? null,
        size: (p.size as string) ?? null,
        in_stock: p.in_stock !== false,
        image_url: (p.image_url as string) ?? null,
        features: (p.features as string[]) ?? null,
        feature_sizes: (p.feature_sizes as Record<string, unknown>) ?? null,
        updated_at: (p.updated_at as string) ?? null,
      } satisfies OfflineProduct);
    }

    await tx.done;
    await metaSet(META_KEYS.productsPulledAt, new Date().toISOString());
  } catch (err) {
    console.warn("[mirror] product mirror failed:", err);
  }
}
