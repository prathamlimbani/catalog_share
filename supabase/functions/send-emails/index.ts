import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = "CatalogShare <noreply@catalogshare.online>";
const REPLY_TO = "catalogshare123@gmail.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface EmailPayload {
  type: "welcome" | "invoice" | "expiry_reminder";
  to: string;
  companyName: string;
  // invoice fields
  planName?: string;
  amount?: number; // in paise
  paymentId?: string;
  expiresAt?: string;
  startsAt?: string;
  // expiry reminder fields
  daysLeft?: number;
}

function welcomeEmailHtml(companyName: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Welcome to CatalogShare</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',system-ui,sans-serif;">
  <div style="max-width:600px;margin:40px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#6366f1,#a855f7);padding:40px 32px;text-align:center;">
      <img src="https://www.catalogshare.online/logo.png" alt="CatalogShare" style="height:56px;border-radius:10px;background:white;padding:6px;margin-bottom:16px;" />
      <h1 style="color:white;margin:0;font-size:28px;font-weight:800;">Welcome to CatalogShare!</h1>
      <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:15px;">Your digital catalog journey starts here 🎉</p>
    </div>
    <div style="padding:36px 32px;">
      <p style="font-size:17px;color:#111827;margin:0 0 16px;">Hi <strong>${companyName}</strong>,</p>
      <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 20px;">
        Thank you for joining <strong>CatalogShare</strong>! We're thrilled to have you on board. Your company is now set up and ready to go.
      </p>
      <p style="color:#374151;font-size:15px;line-height:1.7;margin:0 0 24px;">
        You can now start adding your products, customize your catalog, and share it with your customers — all in one place.
      </p>
      <div style="background:#f8f9fa;border-radius:12px;padding:20px;margin:0 0 28px;">
        <h3 style="margin:0 0 12px;color:#111827;font-size:15px;">🚀 Get started with:</h3>
        <ul style="margin:0;padding:0 0 0 20px;color:#374151;font-size:14px;line-height:2;">
          <li>Add your products with photos and descriptions</li>
          <li>Share your unique catalog link with customers</li>
          <li>Manage orders and track your business</li>
          <li>Upgrade your plan for more products &amp; features</li>
        </ul>
      </div>
      <a href="https://www.catalogshare.online/dashboard" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#a855f7);color:white;text-decoration:none;padding:14px 32px;border-radius:50px;font-weight:700;font-size:15px;">
        Go to My Dashboard →
      </a>
    </div>
    <div style="background:#f8f9fa;padding:20px 32px;text-align:center;border-top:1px solid #e5e7eb;">
      <p style="margin:0;color:#6b7280;font-size:12px;">
        Questions? Reply to this email or contact us at catalogshare123@gmail.com<br>
        © 2025 CatalogShare · <a href="https://www.catalogshare.online" style="color:#6366f1;text-decoration:none;">catalogshare.online</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

function invoiceEmailHtml(payload: EmailPayload): string {
  const amount = payload.amount ? (payload.amount / 100).toFixed(2) : "0.00";
  const invoiceDate = payload.startsAt
    ? new Date(payload.startsAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const expiryDate = payload.expiresAt
    ? new Date(payload.expiresAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "N/A";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Your CatalogShare Invoice</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',system-ui,sans-serif;">
  <div style="max-width:600px;margin:40px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#6366f1,#a855f7);padding:32px;display:flex;align-items:center;gap:16px;">
      <img src="https://www.catalogshare.online/logo.png" alt="CatalogShare" style="height:56px;border-radius:10px;background:white;padding:6px;" />
      <div>
        <h1 style="color:white;margin:0;font-size:24px;font-weight:800;">CatalogShare</h1>
        <p style="color:rgba(255,255,255,0.85);margin:4px 0 0;font-size:13px;">Subscription Invoice</p>
      </div>
    </div>
    <div style="padding:32px;">
      <p style="font-size:16px;color:#111827;margin:0 0 20px;">Dear <strong>${payload.companyName}</strong>,</p>
      <p style="color:#374151;font-size:14px;margin:0 0 24px;">Thank you for subscribing! Here is your payment confirmation and invoice.</p>
      <div style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;margin-bottom:24px;">
        <div style="background:#f8f9fa;padding:12px 16px;border-bottom:1px solid #e5e7eb;">
          <strong style="font-size:14px;color:#111827;">Invoice Summary</strong>
        </div>
        <table style="width:100%;border-collapse:collapse;">
          <tr style="border-bottom:1px solid #f0f0f0;">
            <td style="padding:12px 16px;color:#6b7280;font-size:13px;">Plan</td>
            <td style="padding:12px 16px;font-weight:600;font-size:13px;text-align:right;">${payload.planName || "Subscription"}</td>
          </tr>
          <tr style="border-bottom:1px solid #f0f0f0;">
            <td style="padding:12px 16px;color:#6b7280;font-size:13px;">Payment Date</td>
            <td style="padding:12px 16px;font-weight:600;font-size:13px;text-align:right;">${invoiceDate}</td>
          </tr>
          <tr style="border-bottom:1px solid #f0f0f0;">
            <td style="padding:12px 16px;color:#6b7280;font-size:13px;">Valid Until</td>
            <td style="padding:12px 16px;font-weight:600;font-size:13px;text-align:right;">${expiryDate}</td>
          </tr>
          ${payload.paymentId ? `<tr style="border-bottom:1px solid #f0f0f0;">
            <td style="padding:12px 16px;color:#6b7280;font-size:13px;">Payment ID</td>
            <td style="padding:12px 16px;font-size:11px;font-family:monospace;text-align:right;word-break:break-all;">${payload.paymentId}</td>
          </tr>` : ""}
          <tr style="background:#f8f9fa;">
            <td style="padding:16px;font-weight:700;font-size:15px;color:#111827;">Total Amount</td>
            <td style="padding:16px;font-weight:800;font-size:22px;color:#6366f1;text-align:right;">₹${amount}</td>
          </tr>
        </table>
      </div>
      <div style="background:#dcfce7;border-radius:10px;padding:12px 16px;margin-bottom:24px;display:flex;align-items:center;gap:8px;">
        <span style="font-size:18px;">✅</span>
        <span style="color:#16a34a;font-weight:600;font-size:14px;">Payment Successful — Your plan is now active!</span>
      </div>
      <a href="https://www.catalogshare.online/billing" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#a855f7);color:white;text-decoration:none;padding:12px 28px;border-radius:50px;font-weight:700;font-size:14px;">
        View My Billing →
      </a>
    </div>
    <div style="background:#f8f9fa;padding:20px 32px;text-align:center;border-top:1px solid #e5e7eb;">
      <p style="margin:0;color:#6b7280;font-size:12px;">
        Need help? Contact us at catalogshare123@gmail.com<br>
        © 2025 CatalogShare · <a href="https://www.catalogshare.online" style="color:#6366f1;text-decoration:none;">catalogshare.online</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

function expiryReminderEmailHtml(payload: EmailPayload): string {
  const expiryDate = payload.expiresAt
    ? new Date(payload.expiresAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "soon";
  const daysLeft = payload.daysLeft ?? 7;
  const urgencyColor = daysLeft <= 2 ? "#dc2626" : daysLeft <= 5 ? "#d97706" : "#2563eb";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Your CatalogShare Plan is Expiring Soon</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',system-ui,sans-serif;">
  <div style="max-width:600px;margin:40px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#f59e0b,#ef4444);padding:32px;text-align:center;">
      <img src="https://www.catalogshare.online/logo.png" alt="CatalogShare" style="height:48px;border-radius:10px;background:white;padding:6px;margin-bottom:12px;" />
      <h1 style="color:white;margin:0;font-size:24px;font-weight:800;">⏰ Plan Expiring Soon!</h1>
      <p style="color:rgba(255,255,255,0.9);margin:8px 0 0;font-size:14px;">Action required to keep your catalog running</p>
    </div>
    <div style="padding:36px 32px;">
      <p style="font-size:16px;color:#111827;margin:0 0 16px;">Hi <strong>${payload.companyName}</strong>,</p>
      <div style="background:#fff7ed;border:2px solid ${urgencyColor}33;border-radius:12px;padding:20px;margin:0 0 24px;text-align:center;">
        <p style="margin:0 0 8px;font-size:14px;color:#374151;">Your current plan expires on</p>
        <p style="margin:0 0 8px;font-size:28px;font-weight:800;color:${urgencyColor};">${expiryDate}</p>
        <p style="margin:0;font-size:14px;font-weight:600;color:${urgencyColor};">${daysLeft} day${daysLeft === 1 ? "" : "s"} remaining</p>
      </div>
      <p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 16px;">
        Once your plan expires, your catalog will be limited to the <strong>Free Plan</strong> (40 products). To keep all your products visible and avoid any interruption to your business, please renew your subscription.
      </p>
      <p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 24px;">
        Renew now and continue growing your business with CatalogShare! 🚀
      </p>
      <a href="https://www.catalogshare.online/billing" style="display:inline-block;background:linear-gradient(135deg,#f59e0b,#ef4444);color:white;text-decoration:none;padding:14px 32px;border-radius:50px;font-weight:700;font-size:15px;">
        Renew My Plan →
      </a>
    </div>
    <div style="background:#f8f9fa;padding:20px 32px;text-align:center;border-top:1px solid #e5e7eb;">
      <p style="margin:0;color:#6b7280;font-size:12px;">
        Questions? Contact us at catalogshare123@gmail.com<br>
        © 2025 CatalogShare · <a href="https://www.catalogshare.online" style="color:#6366f1;text-decoration:none;">catalogshare.online</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload: EmailPayload = await req.json();
    const { type, to, companyName } = payload;

    if (!type || !to || !companyName) {
      return new Response(JSON.stringify({ error: "Missing required fields: type, to, companyName" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let subject = "";
    let html = "";

    switch (type) {
      case "welcome":
        subject = `🎉 Welcome to CatalogShare, ${companyName}!`;
        html = welcomeEmailHtml(companyName);
        break;
      case "invoice":
        subject = `✅ Payment Confirmed — ${payload.planName || "Subscription"} Invoice`;
        html = invoiceEmailHtml(payload);
        break;
      case "expiry_reminder":
        subject = `⏰ Your CatalogShare Plan Expires in ${payload.daysLeft ?? 7} Day${(payload.daysLeft ?? 7) === 1 ? "" : "s"}`;
        html = expiryReminderEmailHtml(payload);
        break;
      default:
        return new Response(JSON.stringify({ error: "Invalid email type" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [to],
        reply_to: REPLY_TO,
        subject,
        html,
      }),
    });

    const resendData = await resendResponse.json();

    if (!resendResponse.ok) {
      console.error("Resend API error:", resendData);
      return new Response(JSON.stringify({ error: "Failed to send email", details: resendData }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, id: resendData.id }), {
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
