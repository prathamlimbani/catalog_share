import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/PasswordInput";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Store } from "lucide-react";
import { useAuthRedirect } from "@/hooks/useAuthRedirect";
import { checkConnection, type ConnectionReport } from "@/lib/connectionCheck";
import { authErrorMessage } from "@/lib/errorMessages";
import { routeAfterSignIn } from "@/lib/postLogin";
import { oauthErrorFromLocation, signInWithGoogle } from "@/lib/googleAuth";
import { useGoogleSignInConfig } from "@/lib/authProviders";
import { GoogleButton } from "@/components/GoogleButton";
import { authConfig, loadAuthConfig } from "@/lib/authConfig";
import { fetchSecurityState } from "@/lib/otp";
import OtpChallenge from "@/components/auth/OtpChallenge";
import PhoneField from "@/components/auth/PhoneField";
import { INDIA, localNumberError, toE164 } from "@/lib/phone";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mail, Smartphone } from "lucide-react";

/** Deliberately loose: the server is the authority, this only catches typos. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const Login = () => {
  // A Google sign-in on the web returns here with a live session; route a user
  // who has no company yet on to registration instead of leaving them on the
  // form. The password flow never reaches this state (it routes itself).
  const { checking } = useAuthRedirect({ incompleteTo: "/register" });
  const { webClientId } = useGoogleSignInConfig();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  // Seeded from the URL: when Google sign-in fails on the web, GoTrue sends the
  // browser back here with the reason in the query string instead of a session.
  const [formError, setFormError] = useState<string | null>(() => {
    const fromRedirect = oauthErrorFromLocation();
    return fromRedirect ? authErrorMessage(fromRedirect, "Google sign-in didn't finish. Please try again.") : null;
  });
  const [googleLoading, setGoogleLoading] = useState(false);
  /**
   * Filled in only when a login fails for a reason that looks like the network.
   * "Failed to fetch" covers DNS, TLS, a refused connection and a blocked CORS
   * preflight - four different problems the browser refuses to distinguish - so
   * the app probes for itself rather than telling the user to check their wifi.
   */
  const [diagnosis, setDiagnosis] = useState<ConnectionReport | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [loading, setLoading] = useState(false);
  /**
   * Set when the password was right but a WhatsApp code is still owed.
   *
   * WHAT THIS DOES AND DOES NOT PROTECT, stated plainly because it matters:
   * the Supabase session already exists by this point — GoTrue issued it when
   * the password was accepted — so this is a gate on the APP, not on the API.
   * It stops someone who has only the password from using CatalogShare; it does
   * not stop someone who has the password AND is willing to call the REST API
   * directly. Real transport-level MFA needs GoTrue's own factor enrolment,
   * which is a separate piece of work.
   *
   * What keeps it honest is that the PASSED state is server-side:
   * `user_security.last_2fa_at` is written only by the verify-otp function
   * under the service role and is read-only to the account, so the client
   * cannot simply set a flag and walk through.
   */
  const [pendingTwoFactor, setPendingTwoFactor] = useState<{ phone: string } | null>(null);

  /**
   * Which credential the merchant is signing in with.
   *
   * Email keeps the existing password flow untouched. Mobile is passwordless:
   * the WhatsApp code IS the credential, and the session is minted server-side
   * only after that code is checked.
   */
  const [mode, setMode] = useState<"email" | "phone">("email");
  const [phone, setPhone] = useState("");
  const [phoneCountry, setPhoneCountry] = useState(INDIA.code);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  /** Set once the number is submitted, which is what shows the code screen. */
  const [phoneChallenge, setPhoneChallenge] = useState<string | null>(null);
  const navigate = useNavigate();

  // The gates have to be known before the form is submitted, not after.
  useEffect(() => {
    void loadAuthConfig();
  }, []);

  /**
   * Step one of a mobile sign-in: just validate and show the code screen.
   *
   * No request is made here — OtpChallenge sends the code on mount. Doing it
   * here as well would send two, and the first would be silently invalidated.
   */
  const handlePhoneSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const error = localNumberError(phone, INDIA);
    if (error) {
      setPhoneError(error);
      return;
    }
    setPhoneError(null);
    setFormError(null);
    setPhoneChallenge(toE164(phone, INDIA));
  };

  /**
   * Step two: redeem the single-use token for a real session.
   *
   * The token comes back from verify-otp and is only valid for a few seconds.
   * GoTrue issues the session, so refresh and expiry behave exactly as they do
   * for a password login — nothing here invents a session.
   */
  const completePhoneLogin = async (tokenHash?: string) => {
    if (!tokenHash) {
      setPhoneChallenge(null);
      setFormError(
        "Your number was confirmed but the sign-in did not finish. Try your email and password.",
      );
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: "magiclink",
      });
      if (error || !data.session) throw error ?? new Error("No session returned");

      setPhoneChallenge(null);
      await routeAfterSignIn(navigate, data.session.user);
      toast.success("Welcome back!");
    } catch (error) {
      const message = authErrorMessage(
        error,
        "That code was right, but signing in did not finish. Please try again.",
      );
      setPhoneChallenge(null);
      setFormError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    const errors: { email?: string; password?: string } = {};
    if (!email.trim()) errors.email = "Enter the email you registered with.";
    else if (!EMAIL_PATTERN.test(email.trim())) errors.email = "That doesn't look like an email address.";
    if (!password) errors.password = "Enter your password.";
    setFieldErrors(errors);
    setFormError(null);
    setDiagnosis(null);
    if (Object.keys(errors).length > 0) return;

    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: password.trim() });
      if (error) throw error;

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No user found");

      // Second factor, when the admin has switched it on.
      const config = await loadAuthConfig();
      if (config.twoFactorEnabled) {
        const security = await fetchSecurityState(user.id);
        // An account with no VERIFIED number cannot be challenged — there is
        // nowhere to send the code — so it is let through rather than locked
        // out of an app it has no way back into. Turning 2FA on for a merchant
        // base that has not verified yet must not be a mass lockout; the
        // registration gate is what fills that gap over time.
        if (security?.phoneVerified && security.phone && !security.twoFactorExempt) {
          setPendingTwoFactor({ phone: security.phone });
          setLoading(false);
          return;
        }
      }

      // Role → console, company → dashboard, neither → company setup. Shared
      // with the Google path so the two can never disagree.
      await routeAfterSignIn(navigate, user);

      toast.success("Welcome back!");
    } catch (error) {
      // Shown in the card as well as the toast: on a phone the toast is easy
      // to miss, and "nothing happened" is the worst possible feedback here.
      const message = authErrorMessage(error, "Login failed. Please try again.");
      setFormError(message);

      // Only for the network-shaped failures. A wrong password needs no probe,
      // and running one would just add a delay to the common case.
      const raw = String((error as { message?: string })?.message ?? error).toLowerCase();
      if (
        raw.includes("fetch") ||
        raw.includes("network") ||
        raw.includes("load failed")
      ) {
        setDiagnosing(true);
        try {
          setDiagnosis(await checkConnection());
        } finally {
          setDiagnosing(false);
        }
      }
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Google. On the device this resolves with a session and routes like the
   * password path; in the browser it navigates away to Google and this
   * component is gone before the promise settles.
   */
  const handleGoogle = async () => {
    if (googleLoading || loading) return;
    setFormError(null);
    setDiagnosis(null);
    setGoogleLoading(true);
    try {
      const { session, cancelled } = await signInWithGoogle({ webClientId, redirectPath: "/login" });
      if (cancelled) {
        setGoogleLoading(false);
        return;
      }
      // Web: the browser is navigating to Google. Leave the button in its
      // loading state — resetting it would flash the label back for the moment
      // before the page unloads.
      if (!session) return;
      // Native: routes new accounts to /register and returning ones to
      // /dashboard, so a neutral line covers both (not "Welcome back").
      await routeAfterSignIn(navigate, session.user);
      toast.success("Signed in with Google.");
    } catch (error) {
      const message = authErrorMessage(error, "Google sign-in failed. Please try again.");
      setFormError(message);
      toast.error(message);
      setGoogleLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // The second factor. Rendered instead of the form, never beside it, so there
  // is no half-signed-in screen to be confused by.
  if (pendingTwoFactor) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/5 to-background px-4 py-8">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">One more step</CardTitle>
            <CardDescription>
              Your password was accepted. Confirm it is you with the code on WhatsApp.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OtpChallenge
              purpose="login"
              phone={pendingTwoFactor.phone}
              title="Enter the code"
              onVerified={() => {
                setPendingTwoFactor(null);
                void (async () => {
                  const { data: { user } } = await supabase.auth.getUser();
                  if (user) await routeAfterSignIn(navigate, user);
                  toast.success("Welcome back!");
                })();
              }}
              // Signing out is the honest "cancel" here: the session already
              // exists, so simply going back to the form would leave someone
              // signed in having failed the challenge they were just given.
              onCancel={() => {
                setPendingTwoFactor(null);
                setPassword("");
                void supabase.auth.signOut();
              }}
              cancelLabel="Cancel and sign out"
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  // The mobile code screen, shown instead of the form.
  if (phoneChallenge) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/5 to-background px-4 py-8">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Check WhatsApp</CardTitle>
            <CardDescription>
              Enter the code to sign in. No password needed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OtpChallenge
              purpose="phone_login"
              phone={phoneChallenge}
              title="Enter the code"
              onVerified={(result) => void completePhoneLogin(result.tokenHash)}
              onCancel={() => {
                setPhoneChallenge(null);
                setFormError(null);
              }}
              cancelLabel="Use a different number"
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/5 to-background px-4 py-8">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Store className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Login</CardTitle>
          <CardDescription>Access your catalog dashboard</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Only offered when the admin has phone login on AND the app can
              actually reach the settings — DEFAULT_AUTH_CONFIG has it false, so
              a config outage shows the familiar email form rather than a tab
              that leads nowhere. */}
          {authConfig().phoneLoginEnabled && (
            <Tabs
              value={mode}
              onValueChange={(v) => {
                setMode(v as "email" | "phone");
                setFormError(null);
                setDiagnosis(null);
              }}
              className="mb-4"
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="email" className="gap-1.5">
                  <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                  Email
                </TabsTrigger>
                <TabsTrigger value="phone" className="gap-1.5">
                  <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
                  Mobile
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )}

          {authConfig().phoneLoginEnabled && mode === "phone" ? (
            <form onSubmit={handlePhoneSubmit} noValidate className="space-y-4">
              {formError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span className="break-anywhere">{formError}</span>
                </div>
              )}
              <PhoneField
                id="login-phone"
                label="WhatsApp number"
                required
                lockCountry
                autoFocus
                countryCode={phoneCountry}
                onCountryChange={setPhoneCountry}
                value={phone}
                onValueChange={(local) => {
                  setPhone(local);
                  setPhoneError(null);
                }}
                error={phoneError}
                hint="We send a code to this number on WhatsApp. No password needed."
              />
              <Button type="submit" className="h-12 w-full text-base" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Send code on WhatsApp
              </Button>
              <p className="text-center text-xs leading-relaxed text-muted-foreground">
                Use the number on your CatalogShare account. If it has never been confirmed, this
                confirms it at the same time.
              </p>
              <p className="text-center text-sm text-muted-foreground">
                New here?{" "}
                <Link to="/register" className="text-primary hover:underline">
                  Create an account
                </Link>
              </p>
            </form>
          ) : (
          <form onSubmit={handleLogin} noValidate className="space-y-4">
            {formError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span className="break-anywhere">{formError}</span>
              </div>
            )}

            {diagnosing && (
              <p className="text-xs text-muted-foreground">Checking the connection...</p>
            )}

            {diagnosis && (
              <div className="rounded-md border border-border bg-muted/50 p-3 text-xs">
                <p className="font-medium text-foreground">{diagnosis.diagnosis}</p>
                <p className="mt-1 text-muted-foreground">{diagnosis.detail}</p>
                <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                  reachable: {String(diagnosis.reachable)} &middot; cors:{" "}
                  {String(diagnosis.preflightOk)} &middot; api: {String(diagnosis.apiOk)}
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (fieldErrors.email) setFieldErrors((prev) => ({ ...prev, email: undefined }));
                }}
                placeholder="you@company.com"
                aria-invalid={!!fieldErrors.email}
                aria-describedby={fieldErrors.email ? "email-error" : undefined}
                className="h-11"
              />
              {fieldErrors.email && (
                <p id="email-error" className="text-sm font-medium text-destructive">
                  {fieldErrors.email}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <PasswordInput
                id="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (fieldErrors.password) setFieldErrors((prev) => ({ ...prev, password: undefined }));
                }}
                placeholder="Your password"
                aria-invalid={!!fieldErrors.password}
                aria-describedby={fieldErrors.password ? "password-error" : undefined}
                className="h-11"
              />
              {fieldErrors.password && (
                <p id="password-error" className="text-sm font-medium text-destructive">
                  {fieldErrors.password}
                </p>
              )}
            </div>
            <div className="text-right">
              <Link to="/forgot-password" className="inline-flex min-h-11 items-center text-sm text-primary hover:underline">
                Forgot password?
              </Link>
            </div>
            <Button type="submit" className="h-12 w-full text-base" disabled={loading || googleLoading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {loading ? "Signing in..." : "Sign in"}
            </Button>
            <GoogleButton onClick={() => void handleGoogle()} loading={googleLoading} disabled={loading} />
            <p className="text-center text-sm text-muted-foreground">
              Don't have an account?{" "}
              <Link to="/register" className="text-primary hover:underline">
                Register
              </Link>
            </p>
          </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;
