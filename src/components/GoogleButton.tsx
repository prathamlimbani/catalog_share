import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGoogleSignInConfig } from "@/lib/authProviders";

interface GoogleButtonProps {
  onClick: () => void;
  label?: string;
  loading?: boolean;
  disabled?: boolean;
  /** Render an "or" rule above the button, to sit under an email form. */
  withDivider?: boolean;
}

/** Google's four-colour "G", drawn inline so it needs no asset or network. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true" className="h-[18px] w-[18px] shrink-0">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

/**
 * "Continue with Google".
 *
 * Renders nothing until the server reports a Google client id, so a build
 * that ships before the credentials are pasted in shows only the email form -
 * a Google button that opens a picker and then fails is the one outcome this
 * must never produce.
 */
export function GoogleButton({
  onClick,
  label = "Continue with Google",
  loading = false,
  disabled = false,
  withDivider = true,
}: GoogleButtonProps) {
  const { enabled } = useGoogleSignInConfig();
  if (!enabled) return null;

  return (
    <div className="space-y-4">
      {withDivider && (
        <div className="relative" role="separator" aria-label="or">
          <div className="absolute inset-0 flex items-center" aria-hidden="true">
            <span className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center">
            <span className="bg-card px-2 text-xs uppercase tracking-wider text-muted-foreground">or</span>
          </div>
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        className="h-12 w-full text-base"
        onClick={onClick}
        disabled={disabled || loading}
        aria-busy={loading}
      >
        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GoogleMark />}
        {label}
      </Button>
    </div>
  );
}

export default GoogleButton;
