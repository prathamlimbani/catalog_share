import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = "CatalogShare <noreply@catalogshare.online>";
const REPLY_TO = "catalogshare123@gmail.com";
const ADMIN_EMAIL = "catalogshare123@gmail.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface EmailPayload {
  type: "welcome" | "invoice" | "expiry_reminder" | "admin_new_company" | "admin_new_subscription" | "admin_plan_change" | "plan_status";
  to: string;
  companyName: string;
  // invoice / subscription fields
  planName?: string;
  amount?: number; // in paise
  paymentId?: string;
  expiresAt?: string;
  startsAt?: string;
  // expiry reminder fields
  daysLeft?: number;
  // admin fields
  companyEmail?: string;
  previousPlan?: string;
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

function adminNewCompanyHtml(companyName: string, companyEmail: string): string {
  const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>New Company Joined</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',system-ui,sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#10b981,#059669);padding:28px 32px;">
      <h1 style="color:white;margin:0;font-size:22px;font-weight:800;">🎉 New Company Joined!</h1>
      <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px;">CatalogShare Admin Alert</p>
    </div>
    <div style="padding:28px 32px;">
      <p style="font-size:15px;color:#111827;margin:0 0 20px;">A new company has registered on CatalogShare.</p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
        <tr style="background:#f9fafb;">
          <td style="padding:12px 16px;color:#6b7280;font-size:13px;border-bottom:1px solid #e5e7eb;">Company Name</td>
          <td style="padding:12px 16px;font-weight:700;font-size:13px;border-bottom:1px solid #e5e7eb;">${companyName}</td>
        </tr>
        <tr>
          <td style="padding:12px 16px;color:#6b7280;font-size:13px;border-bottom:1px solid #e5e7eb;">Email</td>
          <td style="padding:12px 16px;font-size:13px;border-bottom:1px solid #e5e7eb;">${companyEmail}</td>
        </tr>
        <tr style="background:#f9fafb;">
          <td style="padding:12px 16px;color:#6b7280;font-size:13px;">Joined At</td>
          <td style="padding:12px 16px;font-size:13px;">${now} IST</td>
        </tr>
      </table>
      <div style="margin-top:20px;">
        <a href="https://www.catalogshare.online/master" style="display:inline-block;background:linear-gradient(135deg,#10b981,#059669);color:white;text-decoration:none;padding:10px 24px;border-radius:50px;font-weight:700;font-size:13px;">View in Master Admin →</a>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function adminNewSubscriptionHtml(companyName: string, companyEmail: string, planName: string, amount: number, expiresAt: string): string {
  const amountStr = (amount / 100).toFixed(0);
  const expiryDate = new Date(expiresAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>New Subscription</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',system-ui,sans-serif;">
  <div style="max-width:520px;margin:40px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#6366f1,#a855f7);padding:28px 32px;">
      <h1 style="color:white;margin:0;font-size:22px;font-weight:800;">💰 New Subscription!</h1>
      <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px;">CatalogShare Admin Alert</p>
    </div>
    <div style="padding:28px 32px;">
      <p style="font-size:15px;color:#111827;margin:0 0 20px;">A company has purchased a subscription plan.</p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
        <tr style="background:#f9fafb;">
          <td style="padding:12px 16px;color:#6b7280;font-size:13px;border-bottom:1px solid #e5e7eb;">Company</td>
          <td style="padding:12px 16px;font-weight:700;font-size:13px;border-bottom:1px solid #e5e7eb;">${companyName}</td>
        </tr>
        <tr>
          <td style="padding:12px 16px;color:#6b7280;font-size:13px;border-bottom:1px solid #e5e7eb;">Email</td>
          <td style="padding:12px 16px;font-size:13px;border-bottom:1px solid #e5e7eb;">${companyEmail}</td>
        </tr>
        <tr style="background:#f9fafb;">
          <td style="padding:12px 16px;color:#6b7280;font-size:13px;border-bottom:1px solid #e5e7eb;">Plan</td>
          <td style="padding:12px 16px;font-weight:700;font-size:13px;border-bottom:1px solid #e5e7eb;color:#6366f1;">${planName}</td>
        </tr>
        <tr>
          <td style="padding:12px 16px;color:#6b7280;font-size:13px;border-bottom:1px solid #e5e7eb;">Amount Paid</td>
          <td style="padding:12px 16px;font-weight:800;font-size:16px;border-bottom:1px solid #e5e7eb;color:#059669;">₹${amountStr}</td>
        </tr>
        <tr style="background:#f9fafb;">
          <td style="padding:12px 16px;color:#6b7280;font-size:13px;border-bottom:1px solid #e5e7eb;">Valid Until</td>
          <td style="padding:12px 16px;font-size:13px;border-bottom:1px solid #e5e7eb;">${expiryDate}</td>
        </tr>
        <tr>
          <td style="padding:12px 16px;color:#6b7280;font-size:13px;">Purchased At</td>
          <td style="padding:12px 16px;font-size:13px;">${now} IST</td>
        </tr>
      </table>
      <div style="margin-top:20px;">
        <a href="https://www.catalogshare.online/master" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#a855f7);color:white;text-decoration:none;padding:10px 24px;border-radius:50px;font-weight:700;font-size:13px;">View in Master Admin →</a>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function planChangeEmailHtml(payload: EmailPayload): string {
  const planLabel = payload.planName || "Unknown";
  const prevLabel = payload.previousPlan || "Free Plan";
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
  <title>Your CatalogShare Plan Has Changed</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',system-ui,sans-serif;">
  <div style="max-width:600px;margin:40px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="background:linear-gradient(135deg,#6366f1,#a855f7);padding:32px;display:flex;align-items:center;gap:16px;">
      <img src="https://www.catalogshare.online/logo.png" alt="CatalogShare" style="height:56px;border-radius:10px;background:white;padding:6px;" />
      <div>
        <h1 style="color:white;margin:0;font-size:24px;font-weight:800;">CatalogShare</h1>
        <p style="color:rgba(255,255,255,0.85);margin:4px 0 0;font-size:13px;">Subscription Plan Updated</p>
      </div>
    </div>
    <div style="padding:32px;">
      <p style="font-size:16px;color:#111827;margin:0 0 20px;">Dear <strong>${payload.companyName}</strong>,</p>
      <p style="color:#374151;font-size:14px;margin:0 0 24px;">Your subscription plan has been updated by CatalogShare Admin. Please find the details below.</p>
      <div style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;margin-bottom:24px;">
        <div style="background:#f8f9fa;padding:12px 16px;border-bottom:1px solid #e5e7eb;">
          <strong style="font-size:14px;color:#111827;">Plan Change Summary</strong>
        </div>
        <table style="width:100%;border-collapse:collapse;">
          <tr style="border-bottom:1px solid #f0f0f0;">
            <td style="padding:12px 16px;color:#6b7280;font-size:13px;">Previous Plan</td>
            <td style="padding:12px 16px;font-weight:600;font-size:13px;text-align:right;">${prevLabel}</td>
          </tr>
          <tr style="border-bottom:1px solid #f0f0f0;">
            <td style="padding:12px 16px;color:#6b7280;font-size:13px;">New Plan</td>
            <td style="padding:12px 16px;font-weight:700;font-size:13px;text-align:right;color:#6366f1;">${planLabel}</td>
          </tr>
          <tr style="border-bottom:1px solid #f0f0f0;">
            <td style="padding:12px 16px;color:#6b7280;font-size:13px;">Effective From</td>
            <td style="padding:12px 16px;font-weight:600;font-size:13px;text-align:right;">${invoiceDate}</td>
          </tr>
          <tr>
            <td style="padding:12px 16px;color:#6b7280;font-size:13px;">Valid Until</td>
            <td style="padding:12px 16px;font-weight:600;font-size:13px;text-align:right;">${expiryDate}</td>
          </tr>
        </table>
      </div>
      <div style="background:#dcfce7;border-radius:10px;padding:12px 16px;margin-bottom:24px;display:flex;align-items:center;gap:8px;">
        <span style="font-size:18px;">✅</span>
        <span style="color:#16a34a;font-weight:600;font-size:14px;">Plan updated successfully! Your invoice is attached as a PDF.</span>
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

async function generateInvoicePdf(payload: EmailPayload): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]); // A4
  const { width, height } = page.getSize();

  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const purple = rgb(0.39, 0.4, 0.95); // #6366f1
  const darkGray = rgb(0.07, 0.09, 0.15);
  const gray = rgb(0.42, 0.45, 0.49);
  const white = rgb(1, 1, 1);
  const lightBg = rgb(0.97, 0.97, 0.98);

  // ── Header band ──
  page.drawRectangle({ x: 0, y: height - 120, width, height: 120, color: purple });
  page.drawText("CatalogShare", { x: 40, y: height - 55, size: 28, font: fontBold, color: white });
  page.drawText("Subscription Invoice", { x: 40, y: height - 80, size: 14, font: fontRegular, color: rgb(1, 1, 1) });

  // ── Invoice meta ──
  let y = height - 160;
  const invoiceDate = payload.startsAt
    ? new Date(payload.startsAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const expiryDate = payload.expiresAt
    ? new Date(payload.expiresAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : "N/A";
  const amount = payload.amount ? (payload.amount / 100).toFixed(2) : "0.00";
  const paymentId = payload.paymentId || "ADMIN";

  page.drawText("Invoice Date:", { x: 40, y, size: 11, font: fontRegular, color: gray });
  page.drawText(invoiceDate, { x: 200, y, size: 11, font: fontBold, color: darkGray });

  y -= 30;
  page.drawText("Invoice ID:", { x: 40, y, size: 11, font: fontRegular, color: gray });
  page.drawText(paymentId.substring(0, 30), { x: 200, y, size: 11, font: fontBold, color: darkGray });

  // ── Divider ──
  y -= 25;
  page.drawLine({ start: { x: 40, y }, end: { x: width - 40, y }, thickness: 1, color: lightBg });

  // ── Company details ──
  y -= 30;
  page.drawText("Bill To", { x: 40, y, size: 13, font: fontBold, color: purple });
  y -= 22;
  page.drawText(payload.companyName, { x: 40, y, size: 12, font: fontBold, color: darkGray });
  if (payload.companyEmail) {
    y -= 18;
    page.drawText(payload.companyEmail, { x: 40, y, size: 10, font: fontRegular, color: gray });
  }

  // ── Table header ──
  y -= 40;
  page.drawRectangle({ x: 40, y: y - 5, width: width - 80, height: 28, color: purple });
  page.drawText("Description", { x: 50, y: y + 2, size: 11, font: fontBold, color: white });
  page.drawText("Details", { x: 380, y: y + 2, size: 11, font: fontBold, color: white });

  // ── Table rows ──
  const rows = [
    ["Plan", payload.planName || "Subscription"],
    ["Previous Plan", payload.previousPlan || "Free Plan"],
    ["Effective From", invoiceDate],
    ["Valid Until", expiryDate],
    ["Payment ID", paymentId.substring(0, 30)],
    ["Status", "Active"],
  ];

  y -= 30;
  for (let i = 0; i < rows.length; i++) {
    const rowY = y - i * 28;
    if (i % 2 === 0) {
      page.drawRectangle({ x: 40, y: rowY - 8, width: width - 80, height: 28, color: lightBg });
    }
    page.drawText(rows[i][0], { x: 50, y: rowY, size: 10, font: fontRegular, color: gray });
    page.drawText(rows[i][1], { x: 380, y: rowY, size: 10, font: fontBold, color: darkGray });
  }

  // ── Total ──
  y = y - rows.length * 28 - 15;
  page.drawRectangle({ x: 40, y: y - 10, width: width - 80, height: 40, color: purple });
  page.drawText("Total Amount", { x: 50, y: y + 5, size: 13, font: fontBold, color: white });
  page.drawText(`Rs. ${amount}`, { x: 380, y: y + 5, size: 16, font: fontBold, color: white });

  // ── Footer ──
  page.drawText("Thank you for choosing CatalogShare · www.catalogshare.online", {
    x: 130, y: 40, size: 10, font: fontRegular, color: gray,
  });

  return await pdfDoc.save();
}

function planStatusEmailHtml(companyName: string, currentPlan: string, expiresAt?: string): string {
  const planLabel = currentPlan === 'pro' ? 'Pro Plan' : currentPlan === 'growth' ? 'Growth Plan' : 'Free Plan';
  const planColor = currentPlan === 'pro' ? '#a855f7' : currentPlan === 'growth' ? '#3b82f6' : '#10b981';
  const headerGradient = currentPlan === 'pro'
    ? 'linear-gradient(135deg,#a855f7,#6366f1)'
    : currentPlan === 'growth'
      ? 'linear-gradient(135deg,#3b82f6,#06b6d4)'
      : 'linear-gradient(135deg,#10b981,#059669)';
  const expiryInfo = expiresAt && currentPlan !== 'free'
    ? `<tr><td style="padding:12px 16px;color:#6b7280;font-size:13px;">Valid Until</td><td style="padding:12px 16px;font-weight:600;font-size:13px;text-align:right;">${new Date(expiresAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td></tr>`
    : '';

  const growthUpsell = currentPlan === 'free' ? `
      <div style="background:linear-gradient(135deg,#eff6ff,#dbeafe);border:2px solid #93c5fd;border-radius:12px;padding:24px;margin:24px 0;">
        <h3 style="margin:0 0 12px;color:#1d4ed8;font-size:17px;font-weight:800;">🚀 Upgrade to Growth Plan — Just ₹199/month</h3>
        <p style="color:#1e40af;font-size:14px;margin:0 0 16px;line-height:1.6;">Unlock more products and grow your business faster!</p>
        <table style="width:100%;">
          <tr><td style="padding:6px 0;font-size:14px;color:#1e3a5f;">✅ <strong>Up to 300 Products</strong> (vs 40 on Free)</td></tr>
          <tr><td style="padding:6px 0;font-size:14px;color:#1e3a5f;">✅ <strong>Better Visibility</strong> — get discovered by more customers</td></tr>
          <tr><td style="padding:6px 0;font-size:14px;color:#1e3a5f;">✅ <strong>Standard Support</strong> — we've got your back</td></tr>
          <tr><td style="padding:6px 0;font-size:14px;color:#1e3a5f;">✅ <strong>30-Day Plan</strong> — cancel anytime, no commitments</td></tr>
        </table>
        <div style="margin-top:20px;text-align:center;">
          <a href="https://www.catalogshare.online/billing" style="display:inline-block;background:linear-gradient(135deg,#3b82f6,#06b6d4);color:white;text-decoration:none;padding:14px 36px;border-radius:50px;font-weight:700;font-size:15px;box-shadow:0 4px 14px rgba(59,130,246,0.3);">
            Upgrade to Growth →
          </a>
        </div>
      </div>` : '';

  const paidPlanInfo = currentPlan !== 'free' ? `
      <div style="background:#dcfce7;border-radius:10px;padding:12px 16px;margin:20px 0;display:flex;align-items:center;gap:8px;">
        <span style="font-size:18px;">✅</span>
        <span style="color:#16a34a;font-weight:600;font-size:14px;">Your plan is active! Thank you for being a valued subscriber.</span>
      </div>
      ${currentPlan === 'growth' ? `<p style="color:#374151;font-size:14px;line-height:1.7;margin:16px 0;">Want even more? The <strong style="color:#a855f7;">Pro Plan (₹349/month)</strong> gives you <strong>500+ products</strong>, <strong>Priority Support</strong>, and a <strong>Featured Listing</strong>.</p>` : ''}` : '';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Your CatalogShare Plan Status</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:'Segoe UI',system-ui,sans-serif;">
  <div style="max-width:600px;margin:40px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <div style="background:${headerGradient};padding:40px 32px;text-align:center;">
      <img src="https://www.catalogshare.online/logo.png" alt="CatalogShare" style="height:56px;border-radius:10px;background:white;padding:6px;margin-bottom:16px;" />
      <h1 style="color:white;margin:0;font-size:26px;font-weight:800;">Your Plan Status</h1>
      <p style="color:rgba(255,255,255,0.9);margin:8px 0 0;font-size:14px;">Here's a quick update on your CatalogShare subscription</p>
    </div>
    <div style="padding:36px 32px;">
      <p style="font-size:17px;color:#111827;margin:0 0 20px;">Hi <strong>${companyName}</strong>,</p>
      <div style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;margin-bottom:20px;">
        <div style="background:#f8f9fa;padding:12px 16px;border-bottom:1px solid #e5e7eb;">
          <strong style="font-size:14px;color:#111827;">Current Subscription</strong>
        </div>
        <table style="width:100%;border-collapse:collapse;">
          <tr style="border-bottom:1px solid #f0f0f0;">
            <td style="padding:12px 16px;color:#6b7280;font-size:13px;">Plan</td>
            <td style="padding:12px 16px;font-weight:700;font-size:15px;text-align:right;color:${planColor};">${planLabel}</td>
          </tr>
          <tr style="border-bottom:1px solid #f0f0f0;">
            <td style="padding:12px 16px;color:#6b7280;font-size:13px;">Product Limit</td>
            <td style="padding:12px 16px;font-weight:600;font-size:13px;text-align:right;">${currentPlan === 'pro' ? '500+' : currentPlan === 'growth' ? '300' : '40'} products</td>
          </tr>
          ${expiryInfo}
        </table>
      </div>
      ${growthUpsell}
      ${paidPlanInfo}
      <div style="text-align:center;margin-top:24px;">
        <a href="https://www.catalogshare.online/billing" style="display:inline-block;background:${headerGradient};color:white;text-decoration:none;padding:14px 32px;border-radius:50px;font-weight:700;font-size:15px;">
          View My Billing →
        </a>
      </div>
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
    let recipientEmail = to; // default: send to the company email

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
      case "admin_new_company":
        subject = `🎉 New Company Joined: ${companyName}`;
        html = adminNewCompanyHtml(companyName, payload.companyEmail || to);
        recipientEmail = ADMIN_EMAIL; // override: send to admin
        break;
      case "admin_new_subscription":
        subject = `💰 New Subscription: ${companyName} → ${payload.planName}`;
        html = adminNewSubscriptionHtml(companyName, payload.companyEmail || to, payload.planName || "Unknown", payload.amount || 0, payload.expiresAt || "");
        recipientEmail = ADMIN_EMAIL; // override: send to admin
        break;
      case "admin_plan_change": {
        // Generate PDF invoice
        const pdfBytes = await generateInvoicePdf(payload);
        const pdfBase64 = btoa(String.fromCharCode(...pdfBytes));
        const planLabel = payload.planName || "Subscription";
        const changeSubject = `📋 Plan Updated: ${companyName} → ${planLabel}`;
        const changeHtml = planChangeEmailHtml(payload);
        const attachment = {
          filename: `invoice_${companyName.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_${planLabel.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.pdf`,
          content: pdfBase64,
        };

        // 1) Send to the company
        const companyRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: FROM_EMAIL,
            to: [to],
            reply_to: REPLY_TO,
            subject: changeSubject,
            html: changeHtml,
            attachments: [attachment],
          }),
        });
        const companyData = await companyRes.json();
        if (!companyRes.ok) {
          console.error("Resend company email error:", companyData);
        }

        // 2) Send to admin
        const adminRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: FROM_EMAIL,
            to: [ADMIN_EMAIL],
            reply_to: REPLY_TO,
            subject: `💰 Admin: Plan Changed for ${companyName} → ${planLabel}`,
            html: changeHtml,
            attachments: [attachment],
          }),
        });
        const adminData = await adminRes.json();
        if (!adminRes.ok) {
          console.error("Resend admin email error:", adminData);
        }

        return new Response(JSON.stringify({
          success: true,
          company_email_id: companyData.id || null,
          admin_email_id: adminData.id || null,
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      case "plan_status":
        subject = `📊 Your CatalogShare Plan: ${payload.planName || 'Free Plan'}`;
        html = planStatusEmailHtml(companyName, payload.planName?.toLowerCase().replace(' plan', '') || 'free', payload.expiresAt);
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
        to: [recipientEmail],
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
