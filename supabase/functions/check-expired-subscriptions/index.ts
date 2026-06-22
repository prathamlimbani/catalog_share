import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

    // Admin client bypasses RLS
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    // ── 1. Find all companies with expired paid plans ──
    const { data: expiredCompanies, error: fetchError } = await supabase
      .from("companies")
      .select("id, name, email, subscription_plan, subscription_expires_at")
      .neq("subscription_plan", "free")
      .not("subscription_expires_at", "is", null)
      .lt("subscription_expires_at", new Date().toISOString());

    if (fetchError) {
      console.error("Error fetching expired companies:", fetchError);
      return new Response(JSON.stringify({ error: fetchError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!expiredCompanies || expiredCompanies.length === 0) {
      console.log("No expired subscriptions found.");
      return new Response(JSON.stringify({ message: "No expired subscriptions", processed: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Found ${expiredCompanies.length} companies with expired plans.`);

    const results = {
      reminders_sent: 0,
      downgraded: 0,
      errors: 0,
    };

    const now = Date.now();

    for (const company of expiredCompanies) {
      try {
        const expiryTime = new Date(company.subscription_expires_at).getTime();
        const daysSinceExpiry = Math.floor((now - expiryTime) / (1000 * 60 * 60 * 24));

        console.log(`${company.name}: expired ${daysSinceExpiry} day(s) ago (plan: ${company.subscription_plan})`);

        if (daysSinceExpiry <= 3) {
          // ── Grace period: send renewal reminder ──
          const daysLeft = 3 - daysSinceExpiry;

          const { error: emailError } = await supabase.functions.invoke("send-emails", {
            body: {
              type: "expiry_reminder",
              to: company.email,
              companyName: company.name,
              expiresAt: company.subscription_expires_at,
              daysLeft: daysLeft > 0 ? daysLeft : 0,
            },
          });

          if (emailError) {
            console.error(`Reminder email failed for ${company.name}:`, emailError);
            results.errors++;
          } else {
            console.log(`Reminder sent to ${company.name} (${daysLeft} days left in grace period)`);
            results.reminders_sent++;
          }
        } else {
          // ── Past grace period: auto-downgrade to Free ──
          const oldPlan = company.subscription_plan;
          const oldPlanLabel = oldPlan === "pro" ? "Pro Plan" : "Growth Plan";

          // Update the company to Free
          const { error: updateError } = await supabase
            .from("companies")
            .update({
              subscription_plan: "free",
              subscription_expires_at: null,
            })
            .eq("id", company.id);

          if (updateError) {
            console.error(`Failed to downgrade ${company.name}:`, updateError);
            results.errors++;
            continue;
          }

          console.log(`Downgraded ${company.name} from ${oldPlan} to free.`);
          results.downgraded++;

          // Send downgrade notification to company
          await supabase.functions.invoke("send-emails", {
            body: {
              type: "plan_downgraded",
              to: company.email,
              companyName: company.name,
              previousPlan: oldPlanLabel,
            },
          }).catch((e: any) => {
            console.error(`Downgrade email failed for ${company.name}:`, e);
            results.errors++;
          });

          // Notify admin about the auto-downgrade
          await supabase.functions.invoke("send-emails", {
            body: {
              type: "admin_plan_downgraded",
              to: company.email,
              companyName: company.name,
              companyEmail: company.email,
              previousPlan: oldPlanLabel,
            },
          }).catch((e: any) => {
            console.error(`Admin downgrade email failed for ${company.name}:`, e);
          });
        }
      } catch (companyError) {
        console.error(`Error processing ${company.name}:`, companyError);
        results.errors++;
      }
    }

    console.log("Subscription check complete:", results);

    return new Response(JSON.stringify({
      success: true,
      total_expired: expiredCompanies.length,
      ...results,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
