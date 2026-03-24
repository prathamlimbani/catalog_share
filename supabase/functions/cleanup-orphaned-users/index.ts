import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Verify the caller is an admin
    const authHeader = req.headers.get("Authorization")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseCaller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: { user: caller } } = await supabaseCaller.auth.getUser();
    if (!caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("role", "admin");

    if (!roles || roles.length === 0) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get all company owner_ids
    const { data: companies } = await supabaseAdmin
      .from("companies")
      .select("owner_id");
    const activeOwnerIds = new Set((companies || []).map((c: any) => c.owner_id));

    // Also keep admin user IDs (from user_roles)
    const { data: adminRoles } = await supabaseAdmin
      .from("user_roles")
      .select("user_id");
    const adminIds = new Set((adminRoles || []).map((r: any) => r.user_id));

    // List all auth users (paginate through all)
    let allUsers: any[] = [];
    let page = 1;
    while (true) {
      const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 100 });
      if (error) throw error;
      if (!users || users.length === 0) break;
      allUsers = allUsers.concat(users);
      if (users.length < 100) break;
      page++;
    }

    // Find orphaned users: not an active company owner AND not an admin
    const orphaned = allUsers.filter(u => !activeOwnerIds.has(u.id) && !adminIds.has(u.id));

    // Delete orphaned users
    const deleted: string[] = [];
    const failed: string[] = [];
    for (const user of orphaned) {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(user.id);
      if (error) {
        console.error(`Failed to delete ${user.email}:`, error);
        failed.push(user.email);
      } else {
        deleted.push(user.email);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      totalAuthUsers: allUsers.length,
      orphanedFound: orphaned.length,
      deleted,
      failed,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("cleanup error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
