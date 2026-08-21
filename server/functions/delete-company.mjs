/**
 * delete-company
 *
 * Ported from supabase/functions/delete-company/index.ts. The body is unchanged
 * apart from the Deno-isms: `serve(...)` became a default-exported handler, the
 * esm.sh import became the npm package, the two `createClient(...)` calls became
 * the runtime's `adminClient()` / `callerClient(authHeader)` (same keys, same
 * options), the local `corsHeaders` copy is now imported from ./runtime.mjs, the
 * JSON responses go through the runtime's `json()` (same body, same status, same
 * headers), and the TypeScript-only `!` non-null assertions were dropped because
 * this is plain .mjs.
 *
 * An admin-only destructive endpoint: it verifies the caller's JWT with a
 * caller-scoped client, checks user_roles for "admin" with the admin client,
 * then deletes the company row and the owner's auth user. That order of checks
 * is deliberate and is preserved exactly.
 */

import { corsHeaders, json, adminClient, callerClient } from "./runtime.mjs";

export default async function handler(req) {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Create admin client with service_role key (can delete auth users)
    const supabaseAdmin = adminClient();

    // Create a client with the caller's JWT to verify they are an admin
    const authHeader = req.headers.get("Authorization");
    const supabaseCaller = callerClient(authHeader);

    // Verify the caller is authenticated
    const { data: { user: caller }, error: callerError } = await supabaseCaller.auth.getUser();
    if (callerError || !caller) {
      return json({ error: "Unauthorized" }, 401);
    }

    // Verify the caller has admin role
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("role", "admin");

    if (!roles || roles.length === 0) {
      return json({ error: "Forbidden: admin role required" }, 403);
    }

    // Get the company ID from request body
    const { companyId } = await req.json();
    if (!companyId) {
      return json({ error: "companyId is required" }, 400);
    }

    // Look up the company to get the owner_id
    const { data: company, error: companyError } = await supabaseAdmin
      .from("companies")
      .select("owner_id")
      .eq("id", companyId)
      .single();

    if (companyError || !company) {
      return json({ error: "Company not found" }, 404);
    }

    const ownerId = company.owner_id;

    // Delete company row (cascades to products, subscriptions, analytics_events)
    const { error: deleteError } = await supabaseAdmin
      .from("companies")
      .delete()
      .eq("id", companyId);

    if (deleteError) {
      console.error("Failed to delete company:", deleteError);
      return json({ error: "Failed to delete company data" }, 500);
    }

    // Delete the auth user so the email can be reused
    const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(ownerId);
    if (authDeleteError) {
      console.error("Failed to delete auth user:", authDeleteError);
      // Company is already deleted — log but don't fail the whole operation
    }

    return json({ success: true }, 200);
  } catch (err) {
    console.error("delete-company error:", err);
    return json({ error: "Internal server error" }, 500);
  }
}
