import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Mail, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { beginUserSignOut } from "@/native/bootstrap";
import LegalPage, {
  LegalHeading,
  LegalItem,
  LegalList,
  LegalNote,
  LegalStrong,
  LegalText,
} from "@/components/LegalPage";

/** Typed exactly, case-sensitive, before the confirm button unlocks. */
const CONFIRM_WORD = "DELETE";

const SUPPORT_MAILTO =
  "mailto:catalogshare123@gmail.com" +
  "?subject=" +
  encodeURIComponent("Account deletion request - CatalogShare") +
  "&body=" +
  encodeURIComponent(
    [
      "Please delete my CatalogShare account and all associated data.",
      "",
      "Registered business email: ",
      "Company name: ",
      "Registered phone number: ",
      "",
      "I understand this is permanent and cannot be undone.",
    ].join("\n"),
  );

/**
 * /account-deletion — the URL submitted to Google Play as the account deletion
 * page. It has to satisfy two audiences at once: a Play reviewer who is signed
 * out and only reads the policy, and a signed-in merchant who wants the button.
 */
const DeleteAccount = () => {
  const navigate = useNavigate();
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSessionEmail(data.session?.user?.email ?? null);
      setCheckingSession(false);
    });

    // A reviewer may sign in on this very page; keep the flow in sync with it.
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessionEmail(session?.user?.email ?? null);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const { error } = await supabase.functions.invoke("delete-own-account");
      if (error) throw error;

      // The auth user is gone server-side; clear the local session so the app
      // does not keep replaying a token that no longer resolves.
      // The account is gone; discarding unsynced local work is the point.
      beginUserSignOut({ discardUnsynced: true });
      await supabase.auth.signOut();
      setDialogOpen(false);
      toast.success("Your account and all its data have been deleted.");
      navigate("/", { replace: true });
    } catch (err) {
      console.error("delete-own-account failed:", err);
      setDialogOpen(false);
      toast.error("We could not delete your account automatically", {
        description:
          "Email catalogshare123@gmail.com from your registered address and we will delete it manually within 30 days.",
        duration: 12000,
      });
    } finally {
      setDeleting(false);
      setConfirmText("");
    }
  };

  return (
    <LegalPage
      title="Delete Your Account"
      effectiveDate="19 August 2026"
      lastUpdated="19 August 2026"
    >
      <LegalText>
        This page explains how to permanently delete your CatalogShare account (Google Play package{" "}
        <LegalStrong>in.catalogshare.app</LegalStrong>, website{" "}
        <LegalStrong>https://catalogshare.online</LegalStrong>) and everything stored with it. You can
        do it yourself from inside the app, or ask us to do it by email.
      </LegalText>

      <LegalNote>
        Deletion is <LegalStrong>permanent and cannot be undone</LegalStrong>. Export anything you need
        &mdash; your catalogue and estimates can be exported as CSV and PDF from the dashboard &mdash;
        before you continue.
      </LegalNote>

      <LegalHeading>1. What gets deleted</LegalHeading>
      <LegalText>Requesting deletion removes all of the following, permanently:</LegalText>
      <LegalList ordered>
        <LegalItem>
          <LegalStrong>Your login account</LegalStrong> &mdash; the authentication user holding your
          email address, hashed password and session tokens.
        </LegalItem>
        <LegalItem>
          <LegalStrong>Your company profile</LegalStrong> &mdash; company name, business email, phone
          number, business address, GST number, UPI id, theme settings and store slug.
        </LegalItem>
        <LegalItem>
          <LegalStrong>Your entire product catalogue</LegalStrong> &mdash; every product with its name,
          price, category and description.
        </LegalItem>
        <LegalItem>
          <LegalStrong>All product images</LegalStrong> you uploaded, deleted from our file storage.
        </LegalItem>
        <LegalItem>
          <LegalStrong>All estimates and invoices</LegalStrong> &mdash; including the customer names,
          phone numbers, addresses, line items and amounts they contain, and any estimate PDFs generated
          from them.
        </LegalItem>
        <LegalItem>
          <LegalStrong>Your public store page</LegalStrong> &mdash; your storefront link stops working
          immediately and the slug is released.
        </LegalItem>
        <LegalItem>
          <LegalStrong>Your analytics events</LegalStrong> &mdash; every page-view and product-view row
          recorded for your store.
        </LegalItem>
        <LegalItem>
          <LegalStrong>Your uploaded logo and UPI QR code images.</LegalStrong>
        </LegalItem>
        <LegalItem>
          <LegalStrong>Locally stored data</LegalStrong> on the device where you are signed in &mdash;
          offline estimates held in IndexedDB, cached company details and saved preferences.
        </LegalItem>
      </LegalList>

      <LegalHeading>2. What is retained, and why</LegalHeading>
      <LegalList>
        <LegalItem>
          <LegalStrong>Payment and tax records.</LegalStrong> Indian tax and company law requires a
          seller to keep records of the payments it has received. We therefore retain the Razorpay
          payment id, the amount, the plan and the transaction date for the statutory period (currently
          up to eight years from the end of the relevant financial year). These records are kept in an{" "}
          <LegalStrong>anonymised form</LegalStrong>: your name, email, phone number and company details
          are stripped out, so what remains cannot identify you. They are used only for accounting,
          audit and tax filing, never for marketing or profiling.
        </LegalItem>
        <LegalItem>
          <LegalStrong>Records we are legally ordered to preserve</LegalStrong> in connection with an
          active investigation, dispute or court order, kept only for as long as that obligation lasts.
        </LegalItem>
        <LegalItem>
          <LegalStrong>Aggregate, non-identifying statistics</LegalStrong> &mdash; for example total
          number of stores created in a month. These contain no personal data and cannot be traced back
          to you.
        </LegalItem>
      </LegalList>
      <LegalText>
        Anything sent from your account to somebody else before deletion &mdash; an estimate PDF you
        shared over WhatsApp, a link a customer saved &mdash; is outside our systems and cannot be
        recalled by us.
      </LegalText>

      <LegalHeading>3. How long it takes</LegalHeading>
      <LegalList ordered>
        <LegalItem>
          <LegalStrong>Immediately</LegalStrong> &mdash; when you confirm in the app, your account,
          company, products, images, estimates, storefront and analytics rows are deleted from our live
          systems. You are signed out and your store link stops resolving straight away.
        </LegalItem>
        <LegalItem>
          <LegalStrong>Within 30 days</LegalStrong> &mdash; residual copies in our encrypted backups
          expire and are overwritten. Backups are never restored to bring a deleted account back.
        </LegalItem>
        <LegalItem>
          <LegalStrong>Within 30 days</LegalStrong> &mdash; deletion requests sent by email are actioned
          after we verify that the request came from the registered account holder.
        </LegalItem>
      </LegalList>

      <LegalHeading>4. Deletion is permanent</LegalHeading>
      <LegalText>
        There is no undo, no grace period and no recycle bin. We cannot restore a deleted account, its
        catalogue, its images or its estimates &mdash; not even the next day. Your store slug is
        released and may be taken by another business. If you sign up again later, you start from an
        empty account.
      </LegalText>

      <LegalHeading>5. Delete your account now</LegalHeading>

      {checkingSession ? (
        <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Checking your session&hellip;
        </div>
      ) : sessionEmail ? (
        <Card className="mb-4 border-destructive/40">
          <CardContent className="p-4 sm:p-5">
            <div className="mb-3 flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  You are signed in as {sessionEmail}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Deleting will remove this account and everything listed in section 1. This cannot be
                  undone.
                </p>
              </div>
            </div>
            <Button
              variant="destructive"
              className="w-full sm:w-auto"
              onClick={() => {
                setConfirmText("");
                setDialogOpen(true);
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
              Delete my account
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="mb-4">
          <CardContent className="p-4 sm:p-5">
            <p className="text-sm font-semibold text-foreground">You are not signed in</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              To delete your account yourself, sign in and return to this page. If you cannot sign in,
              email us from your registered business email address and we will delete the account for
              you within 30 days.
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" className="w-full sm:w-auto" onClick={() => navigate("/login")}>
                Sign in
              </Button>
              <Button asChild variant="destructive" className="w-full sm:w-auto">
                <a href={SUPPORT_MAILTO}>
                  <Mail className="mr-2 h-4 w-4" aria-hidden="true" />
                  Request deletion by email
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <LegalHeading>6. Requesting deletion by email</LegalHeading>
      <LegalText>
        If you cannot access the app, email <LegalStrong>catalogshare123@gmail.com</LegalStrong> from
        the business email address registered on the account, with the subject{" "}
        <LegalStrong>Account deletion request</LegalStrong>, and include your company name and
        registered phone number. We verify that the request comes from the account holder, delete the
        account, and confirm by reply. Requests are actioned within{" "}
        <LegalStrong>30 days</LegalStrong>. You can also call{" "}
        <LegalStrong>+91 76250 25686</LegalStrong> (Monday to Saturday, 10:00 to 19:00 IST), though we
        will still ask for the request in writing so the audit trail is clear.
      </LegalText>

      <LegalHeading>7. Deleting the app is not deleting your account</LegalHeading>
      <LegalText>
        Uninstalling CatalogShare removes the app and its local data from that device, but your account,
        catalogue and storefront stay live on our servers. Use the button above, or the email route, to
        delete the account itself.
      </LegalText>

      <LegalHeading>8. Related documents</LegalHeading>
      <LegalText>
        Our Privacy Policy explains what we collect and how long we keep it. Our Refund Policy explains
        what happens to a paid plan &mdash; note that deleting your account does not automatically
        refund an unused period; refunds are governed separately by that policy.
      </LegalText>

      <AlertDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          // Never let a stray backdrop click close the dialog mid-request.
          if (deleting) return;
          setDialogOpen(open);
          if (!open) setConfirmText("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes your company profile, all products and images, all estimates and the customer
              details in them, your public store page and your analytics. It cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <Label htmlFor="delete-confirm">
              Type <span className="font-semibold text-foreground">{CONFIRM_WORD}</span> to confirm
            </Label>
            <Input
              id="delete-confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={CONFIRM_WORD}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              disabled={deleting}
              aria-describedby="delete-confirm-help"
            />
            <p id="delete-confirm-help" className="text-xs text-muted-foreground">
              Exactly as shown, in capitals.
            </p>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Keep my account</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmText !== CONFIRM_WORD || deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                // Radix closes on action click; we close ourselves once the
                // request settles so the spinner stays visible until then.
                e.preventDefault();
                void handleDelete();
              }}
            >
              {deleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  Deleting&hellip;
                </>
              ) : (
                "Delete forever"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </LegalPage>
  );
};

export default DeleteAccount;
