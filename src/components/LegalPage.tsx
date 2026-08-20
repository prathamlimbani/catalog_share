import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, CalendarDays, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

/**
 * Shared chrome for the four legal documents (/privacy, /terms, /refund,
 * /account-deletion).
 *
 * The typography plugin was added to this project after these documents were
 * written, so `prose` cannot be trusted to style anything here. Every heading,
 * paragraph and list below therefore carries explicit utility classes, and the
 * exported helpers exist so the four pages cannot drift apart visually.
 */

interface LegalPageProps {
  title: string;
  effectiveDate: string;
  /** Shown next to the effective date when a document has been revised. */
  lastUpdated?: string;
  children: ReactNode;
}

const LEGAL_LINKS: ReadonlyArray<{ to: string; label: string }> = [
  { to: "/privacy", label: "Privacy Policy" },
  { to: "/terms", label: "Terms & Conditions" },
  { to: "/refund", label: "Refund Policy" },
  { to: "/account-deletion", label: "Account Deletion" },
];

const LegalPage = ({ title, effectiveDate, lastUpdated, children }: LegalPageProps) => {
  const navigate = useNavigate();

  // These URLs are handed to Google Play and shared directly, so a visitor can
  // land here with an empty history stack — popping it would leave a dead end.
  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/");
  };

  return (
    <div className="min-h-screen bg-background">
      <header
        className="sticky top-0 z-50 border-b border-border bg-card/90 backdrop-blur-md"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-1 px-2 sm:h-16 sm:gap-2 sm:px-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={goBack}
            aria-label="Go back"
            className="min-touch-target shrink-0"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="truncate text-base font-semibold text-foreground sm:text-lg">{title}</h1>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 pt-6 sm:px-6">
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
            Effective date: {effectiveDate}
          </span>
          {lastUpdated && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Last updated: {lastUpdated}
            </span>
          )}
        </div>

        <div className="pb-4">{children}</div>

        <Separator className="my-8" />

        <nav aria-label="Legal documents" className="flex flex-wrap gap-x-4 gap-y-2">
          {LEGAL_LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <p
          className="mt-6 text-xs text-muted-foreground"
          style={{ paddingBottom: "calc(2.5rem + env(safe-area-inset-bottom))" }}
        >
          CatalogShare, India &middot; catalogshare123@gmail.com
        </p>
      </main>
    </div>
  );
};

/** Section heading. Numbering is passed in by the page so the order stays obvious. */
export const LegalHeading = ({ children }: { children: ReactNode }) => (
  <h2 className="mt-6 mb-2 text-lg font-semibold text-foreground first:mt-0">{children}</h2>
);

export const LegalSubHeading = ({ children }: { children: ReactNode }) => (
  <h3 className="mt-4 mb-1.5 text-sm font-semibold text-foreground">{children}</h3>
);

export const LegalText = ({ children }: { children: ReactNode }) => (
  <p className="mb-3 text-sm leading-relaxed text-muted-foreground">{children}</p>
);

export const LegalList = ({ children, ordered = false }: { children: ReactNode; ordered?: boolean }) => {
  const classes = "mb-3 space-y-1.5 pl-5 marker:text-primary";
  return ordered ? (
    <ol className={`list-decimal ${classes}`}>{children}</ol>
  ) : (
    <ul className={`list-disc ${classes}`}>{children}</ul>
  );
};

export const LegalItem = ({ children }: { children: ReactNode }) => (
  <li className="text-sm leading-relaxed text-muted-foreground">{children}</li>
);

/** Emphasised callout for the one or two facts a reader must not miss. */
export const LegalNote = ({ children }: { children: ReactNode }) => (
  <div className="mb-4 rounded-xl border border-primary/25 bg-accent/60 p-4">
    <p className="text-sm leading-relaxed text-accent-foreground">{children}</p>
  </div>
);

/** Inline emphasis inside muted body copy, without dropping to a hardcoded colour. */
export const LegalStrong = ({ children }: { children: ReactNode }) => (
  <strong className="font-semibold text-foreground">{children}</strong>
);

export const LegalLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer noopener"
    className="font-medium text-primary underline underline-offset-2"
  >
    {children}
  </a>
);

export default LegalPage;
