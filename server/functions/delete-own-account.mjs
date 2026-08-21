import { adminClient, callerClient, corsHeaders, json } from "./runtime.mjs";

/**
 * delete-own-account — the self-service erasure endpoint behind
 * /account-deletion, required by Google Play.
 *
 * SECURITY: the target is ALWAYS the caller resolved from the verified JWT.
 * The request body is never read, so there is no parameter an attacker could
 * point at somebody else's account. That is the one invariant this file has;
 * do not add a `userId` input to it.
 *
 * PORTED from supabase/functions/delete-own-account/index.ts. The body is
 * unchanged apart from the Deno-isms: `serve(...)` became the default export,
 * the TypeScript annotations were erased, and the local `corsHeaders` / `json`
 * definitions plus the three `Deno.env.get(...)` reads were replaced by
 * runtime.mjs's shared versions — `callerClient(authHeader)` and `adminClient()`
 * build exactly the same two clients (anon key + the caller's Authorization
 * header for identity, service role for the deletes) that this file built by
 * hand.
 */

/** Every upload in this app lands in one public bucket. */
const BUCKET = "product-images";

/**
 * Recursively collect every object path under a folder. Supabase returns at
 * most `limit` rows per call and marks nested folders with a null id, so both
 * paging and recursion are needed to be sure nothing is left behind.
 */
async function listAllPaths(admin, folder) {
  const paths = [];
  const limit = 100;
  let offset = 0;

  for (;;) {
    const { data, error } = await admin.storage.from(BUCKET).list(folder, { limit, offset });
    if (error) {
      console.error(`storage list failed for "${folder}":`, error.message);
      break;
    }
    if (!data || data.length === 0) break;

    for (const entry of data) {
      const full = folder ? `${folder}/${entry.name}` : entry.name;
      // Folders come back with no id; only real objects can be removed.
      if (!entry.id) {
        paths.push(...(await listAllPaths(admin, full)));
      } else {
        paths.push(full);
      }
    }

    if (data.length < limit) break;
    offset += data.length;
  }

  return paths;
}

/** Names directly inside a folder, without recursing — used for prefix matching. */
async function listNames(admin, folder) {
  const names = [];
  const limit = 100;
  let offset = 0;

  for (;;) {
    const { data, error } = await admin.storage.from(BUCKET).list(folder, { limit, offset });
    if (error) {
      console.error(`storage list failed for "${folder}":`, error.message);
      break;
    }
    if (!data || data.length === 0) break;
    for (const entry of data) if (entry.id) names.push(entry.name);
    if (data.length < limit) break;
    offset += data.length;
  }

  return names;
}

async function removePaths(admin, paths) {
  if (paths.length === 0) return 0;

  let removed = 0;
  // The remove API takes an array; chunk it so a large catalogue cannot blow
  // past the request size limit.
  for (let i = 0; i < paths.length; i += 100) {
    const chunk = paths.slice(i, i + 100);
    const { error } = await admin.storage.from(BUCKET).remove(chunk);
    if (error) {
      console.error("storage remove failed:", error.message);
      continue;
    }
    removed += chunk.length;
  }
  return removed;
}

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Unauthorized" }, 401);
    }

    // Verify the JWT with the anon client — this is what proves who the caller
    // is. The service-role client below can bypass RLS, so it must never be
    // used to work out identity.
    const supabaseCaller = callerClient(authHeader);

    const {
      data: { user: caller },
      error: callerError,
    } = await supabaseCaller.auth.getUser();

    if (callerError || !caller) {
      return json({ error: "Unauthorized" }, 401);
    }

    const ownerId = caller.id;

    const admin = adminClient();

    // Resolve the caller's own company. A user can exist without one (they
    // signed up but abandoned onboarding), which is not an error here.
    const { data: company, error: companyError } = await admin
      .from("companies")
      .select("id")
      .eq("owner_id", ownerId)
      .maybeSingle();

    if (companyError) {
      console.error("company lookup failed:", companyError.message);
      return json({ error: "Could not resolve your account" }, 500);
    }

    const companyId = company?.id ?? null;
    let storageRemoved = 0;

    if (companyId) {
      // Product images live under a folder named after the company id.
      const productImagePaths = await listAllPaths(admin, companyId);

      // Logo and UPI QR uploads are keyed by owner id: logos/<uuid>.<ext>.
      const logoNames = await listNames(admin, "logos");
      const qrNames = await listNames(admin, "qr");
      const ownerOwned = [
        ...logoNames.filter((n) => n.startsWith(`${ownerId}.`)).map((n) => `logos/${n}`),
        ...qrNames.filter((n) => n.startsWith(`${ownerId}.`)).map((n) => `qr/${n}`),
      ];

      // Shared estimate PDFs are named estimates/<invoiceId>-<timestamp>.pdf,
      // so the invoice ids have to be read before the rows are deleted.
      const { data: invoices } = await admin.from("invoices").select("id").eq("company_id", companyId);
      const invoiceIds = new Set((invoices ?? []).map((row) => row.id));
      let estimatePaths = [];
      if (invoiceIds.size > 0) {
        const estimateNames = await listNames(admin, "estimates");
        estimatePaths = estimateNames
          .filter((name) => {
            const id = name.slice(0, 36); // UUID length
            return invoiceIds.has(id);
          })
          .map((name) => `estimates/${name}`);
      }

      storageRemoved = await removePaths(admin, [
        ...productImagePaths,
        ...ownerOwned,
        ...estimatePaths,
      ]);

      // Rows are deleted explicitly rather than relying on the ON DELETE
      // CASCADE from companies, so a failure surfaces here instead of leaving
      // orphans behind quietly.
      const cascades = [
        { table: "analytics_events", column: "company_id" },
        { table: "invoices", column: "company_id" },
        { table: "products", column: "company_id" },
        { table: "subscriptions", column: "company_id" },
      ];

      for (const { table, column } of cascades) {
        const { error } = await admin.from(table).delete().eq(column, companyId);
        // A table that does not exist in this project must not abort the whole
        // erasure — the auth user still has to go.
        if (error) console.error(`failed deleting ${table}:`, error.message);
      }

      const { error: companyDeleteError } = await admin.from("companies").delete().eq("id", companyId);
      if (companyDeleteError) {
        console.error("failed deleting company:", companyDeleteError.message);
        return json({ error: "Could not delete your company data" }, 500);
      }
    }

    // Role assignments are keyed off the auth user rather than the company.
    const { error: rolesError } = await admin.from("user_roles").delete().eq("user_id", ownerId);
    if (rolesError) console.error("failed deleting user_roles:", rolesError.message);

    // Last, because everything above is authorised by this user existing.
    const { error: authDeleteError } = await admin.auth.admin.deleteUser(ownerId);
    if (authDeleteError) {
      console.error("failed deleting auth user:", authDeleteError.message);
      return json(
        { error: "Your data was deleted but the login could not be removed. Please contact support." },
        500,
      );
    }

    console.log(`deleted account ${ownerId} (company ${companyId ?? "none"}), ${storageRemoved} files`);

    return json({ success: true, filesRemoved: storageRemoved });
  } catch (err) {
    console.error("delete-own-account error:", err);
    return json({ error: "Internal server error" }, 500);
  }
}
