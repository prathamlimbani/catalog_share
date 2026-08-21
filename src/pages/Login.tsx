import { useState } from "react";
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

/** Deliberately loose: the server is the authority, this only catches typos. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const Login = () => {
  const { checking } = useAuthRedirect();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  /**
   * Filled in only when a login fails for a reason that looks like the network.
   * "Failed to fetch" covers DNS, TLS, a refused connection and a blocked CORS
   * preflight - four different problems the browser refuses to distinguish - so
   * the app probes for itself rather than telling the user to check their wifi.
   */
  const [diagnosis, setDiagnosis] = useState<ConnectionReport | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

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

      // Check if user has a company
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("No user found");

      // Where to land is a nicety; being signed in is the thing that matters.
      // A dropped connection during these two lookups used to throw the user
      // back to the login form even though the session was already live.
      try {
        // Check if master admin
        const { data: roles } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("role", "admin");

        if (roles && roles.length > 0) {
          navigate("/master-admin");
          return;
        }

        // Check if has company
        const { data: companies } = await supabase
          .from("companies")
          .select("slug")
          .eq("owner_id", user.id)
          .limit(1);

        // No company yet, redirect to register step 2
        navigate(companies && companies.length > 0 ? "/dashboard" : "/register");
      } catch {
        navigate("/dashboard");
      }

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

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
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
            <Button type="submit" className="h-12 w-full text-base" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {loading ? "Signing in..." : "Sign in"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Don't have an account?{" "}
              <Link to="/register" className="text-primary hover:underline">
                Register
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;
