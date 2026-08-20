import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart3,
  Check,
  Copy,
  Download,
  ExternalLink,
  MessageCircle,
  QrCode,
  Share2,
  Store,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { beginUserSignOut } from "@/native/bootstrap";
import { useCurrentCompany } from "@/hooks/useCompany";
import { useNetwork } from "@/hooks/useNetwork";
import { AdminLayout } from "@/components/AdminLayout";
import { OfflineState } from "@/components/OfflineBanner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AnalyticsDialog } from "@/components/AnalyticsDialog";
import { notify, openWhatsApp, saveBlob, shareBlob, shareText } from "@/native/files";
import { isNative } from "@/native/platform";
import { storeUrl } from "@/lib/appInfo";

/**
 * "My Store" tab — everything a merchant does with their public catalogue link:
 * copy it, WhatsApp it, print the QR for the shop counter, or open a preview.
 *
 * The QR is rendered locally (no remote QR service), so it still works with no
 * connection — which matters, because the most common place a merchant needs it
 * is standing at a counter with bad signal.
 */
const MyStore = () => {
  const navigate = useNavigate();
  const { data: company, isLoading } = useCurrentCompany();
  const { offline } = useNetwork();
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [savingQr, setSavingQr] = useState(false);

  // `slug` is nullable on the row and the row itself is untyped, so anything
  // that is not a usable string has to fall through to the "not set up" card.
  const slug = typeof company?.slug === "string" && company.slug ? company.slug : undefined;
  const url = useMemo(() => (slug ? storeUrl(slug) : ""), [slug]);
  const companyName = (typeof company?.name === "string" ? company.name.trim() : "") || "";
  const companyId = typeof company?.id === "string" ? company.id : "";

  useEffect(() => {
    if (!url) return;
    let active = true;

    void (async () => {
      try {
        const QRCode = (await import("qrcode")).default;
        const dataUrl = await QRCode.toDataURL(url, {
          width: 720,
          margin: 2,
          errorCorrectionLevel: "M",
          color: { dark: "#0B1020", light: "#FFFFFF" },
        });
        if (active) setQrDataUrl(dataUrl);
      } catch (err) {
        console.warn("[store] QR generation failed:", err);
      }
    })();

    return () => {
      active = false;
    };
  }, [url]);

  const handleLogout = async () => {
    beginUserSignOut();
    await supabase.auth.signOut();
    navigate("/", { replace: true });
  };

  const handleCopy = async () => {
    // Older Android WebViews expose no async clipboard on a non-secure origin,
    // and copying the link is the whole point of this screen — so fall back to
    // the legacy path rather than telling the merchant it simply failed.
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      const field = document.createElement("textarea");
      field.value = url;
      field.style.position = "fixed";
      field.style.left = "-9999px";
      document.body.appendChild(field);
      field.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      } finally {
        field.remove();
      }
    }

    if (!ok) {
      toast.error("Could not copy the link. Long-press it above to copy manually.");
      return;
    }
    setCopied(true);
    void notify("Store link copied");
    setTimeout(() => setCopied(false), 2000);
  };

  const shareMessage = `Browse our full catalogue from ${companyName || "our store"} 👇\n${url}`;

  const handleShare = async () => {
    const ok = await shareText(shareMessage, `${companyName || "Store"} catalogue`, url);
    if (!ok) toast.error("Sharing is not available on this device");
  };

  const handleDownloadQr = async () => {
    if (!qrDataUrl || savingQr) return;
    setSavingQr(true);
    try {
      const blob = await (await fetch(qrDataUrl)).blob();
      const fileName = `${(slug ?? "store").replace(/[^a-z0-9-]/gi, "") || "store"}-qr.png`;
      const result = isNative
        ? await shareBlob(blob, fileName, {
            title: "Store QR code",
            text: shareMessage,
            dialogTitle: "Share store QR",
          })
        : await saveBlob(blob, fileName);
      if (result.ok) void notify("QR code saved");
      else toast.error("Could not save the QR code");
    } catch {
      toast.error("Could not save the QR code");
    } finally {
      setSavingQr(false);
    }
  };

  if (isLoading) {
    return (
      <AdminLayout
        company={company}
        searchQuery=""
        onSearchChange={() => undefined}
        onLogout={handleLogout}
        showSearch={false}
        title="My Store"
      >
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout
      company={company}
      searchQuery=""
      onSearchChange={() => undefined}
      onLogout={handleLogout}
      showSearch={false}
      title="My Store"
    >
      <div className="mx-auto w-full max-w-2xl space-y-4">
        {!slug ? (
          <Card className="p-6 text-center">
            <Store className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <h2 className="text-base font-semibold">Your store isn&apos;t set up yet</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Add your company details to get a shareable catalogue link.
            </p>
            <Button className="mt-4" onClick={() => navigate("/dashboard")}>
              Set up my store
            </Button>
          </Card>
        ) : (
          <>
            {/* Link card */}
            <Card className="overflow-hidden p-0">
              <div className="border-b bg-gradient-to-br from-primary/10 to-transparent px-4 py-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Your catalogue link
                </p>
                <p className="break-anywhere selectable mt-1 font-mono text-sm font-medium text-foreground">
                  {url}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4">
                <Button variant="outline" size="sm" onClick={() => void handleCopy()}>
                  {copied ? (
                    <Check className="mr-1.5 h-4 w-4 text-emerald-500" />
                  ) : (
                    <Copy className="mr-1.5 h-4 w-4" />
                  )}
                  {copied ? "Copied" : "Copy"}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void openWhatsApp("", shareMessage)}
                >
                  <MessageCircle className="mr-1.5 h-4 w-4" />
                  WhatsApp
                </Button>

                <Button variant="outline" size="sm" onClick={() => void handleShare()}>
                  <Share2 className="mr-1.5 h-4 w-4" />
                  Share
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/store/${slug}`)}
                  disabled={offline}
                  title={offline ? "Needs a connection" : undefined}
                >
                  <ExternalLink className="mr-1.5 h-4 w-4" />
                  Preview
                </Button>
              </div>
            </Card>

            {/* QR card */}
            <Card className="p-4">
              <div className="mb-3 flex items-center gap-2">
                <QrCode className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Counter QR code</h2>
              </div>
              <p className="mb-4 text-xs text-muted-foreground">
                Print this and put it on your counter. Customers scan it to open your catalogue —
                no app needed on their side.
              </p>

              <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
                {/* Literal white, not a token: a QR needs a light quiet zone to
                    scan, and a themed card behind it kills the contrast the
                    scanner depends on once the app is in dark mode. */}
                <div className="shrink-0 rounded-xl border bg-white p-3">
                  {qrDataUrl ? (
                    <img
                      src={qrDataUrl}
                      alt={`QR code for ${url}`}
                      className="h-40 w-40 max-w-full object-contain"
                    />
                  ) : (
                    <div className="flex h-40 w-40 items-center justify-center">
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    </div>
                  )}
                </div>

                <div className="flex w-full flex-1 flex-col gap-2">
                  <Button
                    onClick={() => void handleDownloadQr()}
                    disabled={!qrDataUrl || savingQr}
                    className="w-full"
                  >
                    <Download
                      className={savingQr ? "mr-1.5 h-4 w-4 animate-pulse" : "mr-1.5 h-4 w-4"}
                    />
                    {savingQr ? "Preparing…" : isNative ? "Save / share QR" : "Download QR"}
                  </Button>
                  <p className="text-center text-[11px] text-muted-foreground sm:text-left">
                    Works offline — the QR is generated on your device.
                  </p>
                </div>
              </div>

            </Card>

            {/* Analytics */}
            <Card className="p-4">
              <div className="mb-3 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold">Store analytics</h2>
              </div>
              <p className="mb-3 text-xs text-muted-foreground">
                Views, product interest and customer activity on your public catalogue.
              </p>
              {offline ? (
                <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                  Analytics need a connection.
                </p>
              ) : companyId ? (
                <AnalyticsDialog companyId={companyId} />
              ) : (
                <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                  Analytics appear once your company details finish loading.
                </p>
              )}
            </Card>

            {offline && (
              <OfflineState
                feature="Live store preview"
                description="Your link and QR code work offline. Preview and analytics need a connection."
              />
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
};

export default MyStore;
