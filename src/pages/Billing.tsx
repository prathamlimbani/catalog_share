import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/AdminLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Crown, CreditCard, Download, CalendarClock, RefreshCw, Receipt, CheckCircle2, XCircle, Clock, Mail } from "lucide-react";
import { SubscriptionDialog, getPlanLimit, getPlanName } from "@/components/SubscriptionDialog";

// Generate and download a PDF-like invoice as an HTML blob
function downloadInvoice(payment: any, company: any) {
    const invoiceDate = new Date(payment.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    const expiryDate = payment.expires_at ? new Date(payment.expires_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "N/A";
    const amount = (payment.amount / 100).toFixed(2);

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Invoice - ${payment.razorpay_payment_id || payment.id}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: #f8f9fa; padding: 40px; }
    .invoice { max-width: 600px; margin: auto; background: white; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); overflow: hidden; }
    .header { background: linear-gradient(135deg, #6366f1, #a855f7); color: white; padding: 32px; display: flex; align-items: center; gap: 16px; }
    .header img { height: 56px; width: auto; border-radius: 10px; background: white; padding: 6px; }
    .header-text h1 { font-size: 28px; font-weight: 800; margin-bottom: 4px; }
    .header-text p { opacity: 0.85; font-size: 14px; }
    .body { padding: 32px; }
    .row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f0f0f0; }
    .row:last-child { border-bottom: none; }
    .label { color: #6b7280; font-size: 14px; }
    .value { font-weight: 600; font-size: 14px; text-align: right; }
    .total { background: #f8f9fa; margin: 20px -32px -32px; padding: 24px 32px; display: flex; justify-content: space-between; align-items: center; }
    .total .label { font-size: 16px; font-weight: 600; color: #111; }
    .total .value { font-size: 24px; font-weight: 800; color: #6366f1; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 700; text-transform: uppercase; }
    .badge-active { background: #dcfce7; color: #16a34a; }
    .badge-expired { background: #fee2e2; color: #dc2626; }
    .footer { text-align: center; padding: 16px; color: #9ca3af; font-size: 12px; }
  </style>
</head>
<body>
  <div class="invoice">
    <div class="header">
      <img src="https://www.catalogshare.online/logo.png" alt="CatalogShare" />
      <div class="header-text">
        <h1>CatalogShare</h1>
        <p>Subscription Invoice</p>
      </div>
    </div>
    <div class="body">
      <div class="row">
        <span class="label">Invoice ID</span>
        <span class="value">${(payment.razorpay_payment_id || payment.id).substring(0, 20)}</span>
      </div>
      <div class="row">
        <span class="label">Company</span>
        <span class="value">${company?.name || "—"}</span>
      </div>
      <div class="row">
        <span class="label">Plan</span>
        <span class="value">${getPlanName(payment.plan)}</span>
      </div>
      <div class="row">
        <span class="label">Payment Date</span>
        <span class="value">${invoiceDate}</span>
      </div>
      <div class="row">
        <span class="label">Valid Until</span>
        <span class="value">${expiryDate}</span>
      </div>
      <div class="row">
        <span class="label">Status</span>
        <span class="value"><span class="badge ${payment.status === 'active' ? 'badge-active' : 'badge-expired'}">${payment.status}</span></span>
      </div>
      <div class="row">
        <span class="label">Payment ID</span>
        <span class="value" style="font-size:12px; word-break:break-all;">${payment.razorpay_payment_id || "—"}</span>
      </div>
      <div class="total">
        <span class="label">Total Amount</span>
        <span class="value">₹${amount}</span>
      </div>
    </div>
    <div class="footer">
      <p>Thank you for choosing CatalogShare · www.catalogshare.online</p>
    </div>
  </div>
  <script>window.onload = () => window.print();</script>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    if (!win) {
        // Fallback: download as .html
        const a = document.createElement("a");
        a.href = url;
        a.download = `invoice_${payment.razorpay_payment_id || payment.id}.html`;
        a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Export for Master Admin use
export { downloadInvoice };

const Billing = () => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    // Get current user
    const { data: session } = useQuery({
        queryKey: ["billing-session"],
        queryFn: async () => {
            const { data } = await supabase.auth.getSession();
            return data.session;
        },
    });

    // Get company
    const { data: company, isLoading: companyLoading } = useQuery({
        queryKey: ["current-company"],
        queryFn: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return null;
            const { data } = await supabase.from("companies").select("*").eq("owner_id", user.id).maybeSingle();
            return data;
        },
        enabled: !!session,
    });

    // Get payment history
    const { data: payments, isLoading: paymentsLoading } = useQuery({
        queryKey: ["billing-payments", company?.id],
        queryFn: async () => {
            const { data, error } = await (supabase as any)
                .from("subscriptions")
                .select("*")
                .eq("company_id", company!.id)
                .order("created_at", { ascending: false });
            if (error) throw error;
            return data || [];
        },
        enabled: !!company?.id,
    });

    // Get product count
    const { data: productCount } = useQuery({
        queryKey: ["billing-product-count", company?.id],
        queryFn: async () => {
            const { count } = await supabase
                .from("products")
                .select("*", { count: "exact", head: true })
                .eq("company_id", company!.id);
            return count || 0;
        },
        enabled: !!company?.id,
    });

    useEffect(() => {
        supabase.auth.getSession().then(({ data }) => {
            if (!data.session) navigate("/login");
        });
    }, [navigate]);

    const handleLogout = async () => {
        await supabase.auth.signOut();
        navigate("/login");
    };

    const currentPlan = (company as any)?.subscription_plan || "free";
    const planLimit = getPlanLimit(currentPlan);
    const expiresAt = (company as any)?.subscription_expires_at;
    const isExpired = expiresAt && new Date(expiresAt) < new Date();

    // Auto-send expiry reminder email if plan expires within 7 days
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (!company || !expiresAt || currentPlan === "free" || isExpired) return;

        const msUntilExpiry = new Date(expiresAt).getTime() - Date.now();
        const daysLeft = Math.ceil(msUntilExpiry / (1000 * 60 * 60 * 24));

        if (daysLeft > 7) return;

        // Only send once per browser session to avoid spam
        const reminderSentKey = `expiry_reminder_sent_${company.id}`;
        if (sessionStorage.getItem(reminderSentKey)) return;
        sessionStorage.setItem(reminderSentKey, "1");

        supabase.functions.invoke("send-emails", {
            body: {
                type: "expiry_reminder",
                to: company.email,
                companyName: company.name,
                expiresAt,
                daysLeft,
            },
        }).catch((e: any) => console.warn("Expiry reminder email failed (non-blocking):", e));
    }, [company, expiresAt, currentPlan, isExpired]);

    const getStatusIcon = (status: string) => {
        if (status === "active") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
        if (status === "expired") return <XCircle className="h-4 w-4 text-red-500" />;
        return <Clock className="h-4 w-4 text-amber-500" />;
    };

    const getStatusColor = (status: string) => {
        if (status === "active") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
        if (status === "expired") return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
        return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
    };

    return (
        <AdminLayout
            company={company}
            searchQuery=""
            onSearchChange={() => { }}
            onLogout={handleLogout}
        >
            <div className="max-w-4xl mx-auto space-y-8">
                {/* Page Header */}
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <CreditCard className="h-6 w-6 text-primary" />
                        Payment & Billing
                    </h1>
                    <p className="text-muted-foreground text-sm mt-1">Manage your subscription, view payment history, and download invoices.</p>
                </div>

                {/* Current Plan Card */}
                {companyLoading ? (
                    <Skeleton className="h-40 w-full" />
                ) : company && (
                    <Card className={`border-0 shadow-md overflow-hidden ${currentPlan === 'pro' ? 'bg-gradient-to-r from-purple-500/5 to-pink-500/5 ring-1 ring-purple-500/20' : currentPlan === 'growth' ? 'bg-gradient-to-r from-blue-500/5 to-cyan-500/5 ring-1 ring-blue-500/20' : 'bg-gradient-to-r from-emerald-500/5 to-teal-500/5 ring-1 ring-emerald-500/20'}`}>
                        <CardContent className="p-6">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                <div className="flex items-center gap-4">
                                    <div className={`p-3 rounded-xl ${currentPlan === 'pro' ? 'bg-purple-500/10' : currentPlan === 'growth' ? 'bg-blue-500/10' : 'bg-emerald-500/10'}`}>
                                        <Crown className={`h-7 w-7 ${currentPlan === 'pro' ? 'text-purple-500' : currentPlan === 'growth' ? 'text-blue-500' : 'text-emerald-500'}`} />
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-bold">{getPlanName(currentPlan)}</h2>
                                        <div className="flex items-center gap-3 mt-1">
                                            <Badge className={getStatusColor(isExpired ? "expired" : "active")}>
                                                {isExpired ? "EXPIRED" : "ACTIVE"}
                                            </Badge>
                                            <span className="text-sm text-muted-foreground">
                                                {productCount}/{planLimit === 9999 ? '∞' : planLimit} products used
                                            </span>
                                        </div>
                                        {expiresAt && currentPlan !== 'free' && (
                                            <p className={`text-xs mt-1 ${isExpired ? 'text-red-500 font-bold' : 'text-muted-foreground'}`}>
                                                <CalendarClock className="h-3 w-3 inline mr-1" />
                                                {isExpired ? 'Expired on' : 'Renews on'} {new Date(expiresAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                                            </p>
                                        )}
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    {/* Renewal / Upgrade */}
                                    {currentPlan !== 'free' && isExpired && (
                                        <SubscriptionDialog
                                            companyId={company.id}
                                            companyName={company.name}
                                            companyEmail={company.email}
                                            currentPlan="free"
                                        >
                                            <Button className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold shadow-sm">
                                                <RefreshCw className="h-4 w-4 mr-2" /> Renew Plan
                                            </Button>
                                        </SubscriptionDialog>
                                    )}
                                    {currentPlan !== 'pro' && !isExpired && (
                                        <SubscriptionDialog
                                            companyId={company.id}
                                            companyName={company.name}
                                            companyEmail={company.email}
                                            currentPlan={currentPlan}
                                        >
                                            <Button className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-bold shadow-sm">
                                                <Crown className="h-4 w-4 mr-2" /> Upgrade Plan
                                            </Button>
                                        </SubscriptionDialog>
                                    )}
                                    {currentPlan !== 'free' && !isExpired && (
                                        <SubscriptionDialog
                                            companyId={company.id}
                                            companyName={company.name}
                                            companyEmail={company.email}
                                            currentPlan="free"
                                        >
                                            <Button variant="outline" className="font-bold">
                                                <RefreshCw className="h-4 w-4 mr-2" /> Renew
                                            </Button>
                                        </SubscriptionDialog>
                                    )}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Payment History */}
                <div>
                    <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
                        <Receipt className="h-5 w-5 text-muted-foreground" />
                        Payment History
                    </h2>
                    {paymentsLoading ? (
                        <div className="space-y-3">
                            {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
                        </div>
                    ) : payments && payments.length > 0 ? (
                        <div className="space-y-3">
                            {payments.map((payment: any) => (
                                <Card key={payment.id} className="hover:shadow-md transition-shadow">
                                    <CardContent className="p-4">
                                        <div className="flex items-center justify-between gap-4 flex-wrap">
                                            <div className="flex items-center gap-3 min-w-0">
                                                {getStatusIcon(payment.status)}
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="font-bold text-sm">{getPlanName(payment.plan)}</span>
                                                        <Badge className={`text-[10px] ${getStatusColor(payment.status)}`}>{payment.status.toUpperCase()}</Badge>
                                                    </div>
                                                    <p className="text-xs text-muted-foreground mt-0.5">
                                                        {new Date(payment.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                                                        {payment.expires_at && ` → ${new Date(payment.expires_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`}
                                                    </p>
                                                    {payment.razorpay_payment_id && (
                                                        <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                                                            ID: {payment.razorpay_payment_id}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3 shrink-0">
                                                <span className="font-bold text-lg">₹{(payment.amount / 100).toFixed(0)}</span>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    className="h-8 text-xs"
                                                    onClick={() => downloadInvoice(payment, company)}
                                                >
                                                    <Download className="h-3.5 w-3.5 mr-1" /> Invoice
                                                </Button>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    ) : (
                        <Card className="bg-muted/30">
                            <CardContent className="p-8 text-center text-muted-foreground">
                                <Receipt className="h-10 w-10 mx-auto mb-3 opacity-30" />
                                <p className="font-medium">No payments yet</p>
                                <p className="text-sm mt-1">Your payment history will appear here once you subscribe to a plan.</p>
                            </CardContent>
                        </Card>
                    )}
                </div>

                {/* Customer Care Section */}
                <div className="bg-primary/5 rounded-2xl p-8 sm:p-12 border border-primary/10 text-center mt-8">
                    <h2 className="text-2xl sm:text-3xl font-bold mb-4">Customer Care Support</h2>
                    <p className="text-muted-foreground mb-6 max-w-xl mx-auto">
                        Need assistance or have any queries? Our dedicated support team is here to help you out. Click below to reach out directly to us!
                    </p>
                    <Button asChild size="lg" className="rounded-full gap-2 px-8">
                        <a href="mailto:catalogshare123@gmail.com?subject=custome%20care%20support">
                            <Mail className="h-5 w-5" />
                            Contact Customer Care
                        </a>
                    </Button>
                    <div className="mt-4 inline-flex items-center justify-center gap-2 text-sm text-muted-foreground bg-background rounded-full px-4 py-2 shadow-sm border">
                        <span>Direct Email:</span>
                        <span className="font-semibold text-foreground">catalogshare123@gmail.com</span>
                    </div>
                </div>
            </div>
        </AdminLayout>
    );
};

export default Billing;
