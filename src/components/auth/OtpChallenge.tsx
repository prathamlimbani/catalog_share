/**
 * The code-entry step, shared by every place a WhatsApp OTP is required:
 * registration, login 2FA, password reset and changing the WhatsApp number.
 *
 * One component because the parts that are easy to get wrong are the same every
 * time — the resend cooldown, auto-submitting on the sixth digit, keeping the
 * typed code when a request fails, and saying WHY a code could not be sent
 * rather than leaving a dead button. Four copies of that is four chances for
 * one of them to be subtly worse.
 *
 * What it never does: decide whether the code is right. It hands the digits to
 * `verifyOtp` and reports the answer. A component that could approve its own
 * challenge would be decoration.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { authConfig } from "@/lib/authConfig";
import { maskForDisplay } from "@/lib/phone";
import { sendOtp, verifyOtp, type OtpPurpose, type OtpVerifyResult } from "@/lib/otp";
import { cn } from "@/lib/utils";

export interface OtpChallengeProps {
  purpose: OtpPurpose;
  /** Any shape; normalised before it reaches the server. */
  phone: string;
  /** Optional second copy of the code, when email verification is on. */
  email?: string | null;
  /** Sent with a `reset` verification, which changes the password in one call. */
  newPassword?: string;
  /**
   * Called once the server has accepted the code.
   *
   * Handed the whole result, because `phone_login` returns a single-use token
   * the caller has to redeem for a session — a bare `() => void` would drop it.
   */
  onVerified: (result: OtpVerifyResult) => void;
  /** Back out — re-enter the number, cancel the change. Omit to hide. */
  onCancel?: () => void;
  cancelLabel?: string;
  /** Send a code as soon as this mounts. */
  autoSend?: boolean;
  title?: string;
  description?: string;
  className?: string;
}

export function OtpChallenge({
  purpose,
  phone,
  email,
  newPassword,
  onVerified,
  onCancel,
  cancelLabel = "Use a different number",
  autoSend = true,
  title = "Enter the code",
  description,
  className,
}: OtpChallengeProps) {
  const config = authConfig();
  const length = config.otpLength;

  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  // A rewarded-ad-style double-tap guard: a tap reads the state of the render it
  // happened on, so two touches in one frame both see "idle" and fire two
  // requests — which on this screen means two codes and the first one invalid.
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const request = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setSending(true);
    setError(null);
    setNotice(null);

    const result = await sendOtp(purpose, phone, { email });
    if (!alive.current) {
      busy.current = false;
      return;
    }

    if (result.ok) {
      setNotice(
        result.alsoEmailed
          ? "Code sent on WhatsApp and by email."
          : `Code sent on WhatsApp to ${maskForDisplay(phone)}.`,
      );
      setCooldown(result.resendAfterSeconds ?? config.otpResendSeconds);
    } else {
      setError(result.error ?? "Could not send the code.");
      // A rate limit already knows how long to wait; honour it rather than
      // letting the merchant tap into the same refusal again.
      if (result.retryAfter) setCooldown(result.retryAfter);
    }

    setSending(false);
    busy.current = false;
  }, [purpose, phone, email, config.otpResendSeconds]);

  // Send on mount. The ref guard matters here too: React 18 StrictMode mounts
  // twice in development, and without it every developer session burns two
  // WhatsApp messages per screen.
  const sentOnce = useRef(false);
  useEffect(() => {
    if (!autoSend || sentOnce.current) return;
    sentOnce.current = true;
    void request();
  }, [autoSend, request]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          window.clearInterval(id);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [cooldown]);

  const submit = useCallback(
    async (value: string) => {
      if (busy.current) return;
      busy.current = true;
      setVerifying(true);
      setError(null);
      setNotice(null);

      const result = await verifyOtp(purpose, phone, value, { newPassword });
      if (!alive.current) {
        busy.current = false;
        return;
      }

      setVerifying(false);
      busy.current = false;

      if (result.ok) {
        onVerified(result);
        return;
      }

      setError(result.error ?? "That code is not right.");
      // Clear the box on a wrong code so the next attempt starts clean — but
      // NOT when the attempts are gone, where the box should stay disabled-
      // looking and the message is the thing to read.
      if (result.reason !== "attempts_exhausted") setCode("");
    },
    [purpose, phone, newPassword, onVerified],
  );

  const handleChange = (value: string) => {
    setCode(value);
    setError(null);
    // Auto-submit on the last digit. Typing six digits and then hunting for a
    // button is a step nobody needs.
    if (value.length === length) void submit(value);
  };

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          <MessageCircle className="h-6 w-6" aria-hidden="true" />
        </span>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {description ?? (
            <>
              We sent a {length}-digit code on WhatsApp to{" "}
              <span className="font-medium text-foreground">{maskForDisplay(phone)}</span>. It is
              valid for {config.otpTtlMinutes} minutes.
            </>
          )}
        </p>
      </div>

      <div className="flex flex-col items-center gap-2">
        <Label htmlFor="otp-code" className="sr-only">
          Verification code
        </Label>
        <InputOTP
          id="otp-code"
          maxLength={length}
          value={code}
          onChange={handleChange}
          disabled={verifying || sending}
          autoFocus
        >
          <InputOTPGroup>
            {Array.from({ length }, (_, i) => (
              <InputOTPSlot key={i} index={i} className="h-12 w-11 text-lg" />
            ))}
          </InputOTPGroup>
        </InputOTP>

        {verifying && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Checking…
          </p>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg bg-destructive/10 px-3 py-2 text-center text-sm leading-relaxed text-destructive"
        >
          {error}
        </p>
      )}

      {!error && notice && (
        <p className="text-center text-xs leading-relaxed text-muted-foreground">{notice}</p>
      )}

      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full"
          disabled={sending || verifying || cooldown > 0}
          onClick={() => void request()}
        >
          {sending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          {sending
            ? "Sending…"
            : cooldown > 0
              ? `Resend in ${cooldown}s`
              : "Resend the code"}
        </Button>

        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            className="h-10 w-full text-muted-foreground"
            onClick={onCancel}
            disabled={verifying}
          >
            {cancelLabel}
          </Button>
        )}
      </div>

      <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
        Not getting it? Check the number is on WhatsApp and that you have signal. CatalogShare never
        asks for this code by phone or email.
      </p>
    </div>
  );
}

export default OtpChallenge;
