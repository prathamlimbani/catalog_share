import { useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/PasswordInput";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Store, Upload, Mail, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import ColorThemePicker from "@/components/ColorThemePicker";
import { authErrorMessage } from "@/lib/errorMessages";
import { phoneDigits, safeExternalUrl } from "@/lib/storefront";

/** Deliberately loose: the server is the authority, this only catches typos. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MIN_PASSWORD_LENGTH = 6;

/** Supabase storage rejects far larger files, but silently and late. */
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

/** The extension in the storage path; the filename cannot be trusted to have one. */
const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

type SignupErrors = { email?: string; password?: string; confirmPassword?: string; terms?: string };
type CompanyErrors = { companyName?: string; phone?: string; googleMapsUrl?: string; logo?: string };

const Register = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState<"signup" | "company">("signup");
  const [loading, setLoading] = useState(false);
  const [resuming, setResuming] = useState(true);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [signupErrors, setSignupErrors] = useState<SignupErrors>({});
  const [companyErrors, setCompanyErrors] = useState<CompanyErrors>({});

  // Auth fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Company fields
  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState("+91");
  const [address, setAddress] = useState("");
  const [gstNumber, setGstNumber] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [themePrimary, setThemePrimary] = useState("25 95% 53%");
  const [themeAccent, setThemeAccent] = useState("25 95% 95%");
  const [contactName1, setContactName1] = useState("");
  const [contactPhone1, setContactPhone1] = useState("+91");
  const [contactName2, setContactName2] = useState("");
  const [contactPhone2, setContactPhone2] = useState("+91");
  const [googleMapsUrl, setGoogleMapsUrl] = useState("");

  // The object URL behind the preview, so it can be revoked exactly once.
  const previewUrlRef = useRef<string | null>(null);

  /**
   * Pick up an interrupted registration.
   *
   * Step 1 creates the account and signs the user in; step 2 creates the
   * company. Closing the app in between left an account with no company, and
   * coming back to /register put the user on step 1 again — where signing up
   * with the same email fails with "already registered" and there is no way
   * forward at all.
   */
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const user = data.session?.user;
        if (cancelled || !user) return;

        const { data: companies } = await supabase
          .from("companies")
          .select("id")
          .eq("owner_id", user.id)
          .limit(1);
        if (cancelled) return;

        if (companies && companies.length > 0) {
          navigate("/dashboard", { replace: true });
          return;
        }

        setEmail(user.email ?? "");
        setStep("company");
      } catch (error) {
        // Offline on a cold start: fall through to step 1 rather than block.
        console.warn("Could not check for an existing registration", error);
      } finally {
        if (!cancelled) setResuming(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  // Revoke on unmount; every replacement is revoked as it happens.
  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  /** Short readable suffix; base36 keeps it URL-safe. */
  const randomSuffix = () => Math.random().toString(36).slice(2, 8);

  const generateSlug = (name: string) => {
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .trim();
    // A name with no Latin characters (Hindi, Gujarati…) strips to "", which
    // saved slug="" — a store nobody can open and nothing in the UI can repair,
    // since CompanyEditDialog has no slug field.
    return base || `store-${randomSuffix()}`;
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    const errors: SignupErrors = {};
    if (!email.trim()) errors.email = "Enter an email address.";
    else if (!EMAIL_PATTERN.test(email.trim())) errors.email = "That doesn't look like an email address.";
    if (password.length < MIN_PASSWORD_LENGTH) {
      errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (password !== confirmPassword) errors.confirmPassword = "Both passwords must match.";
    if (!agreedToTerms) errors.terms = "You must agree to the terms to continue.";
    setSignupErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) return;

    setLoading(true);
    try {
      const { error } = await supabase.auth.signUp({ email: email.trim(), password });
      if (error) throw error;
      // Immediately sign in so the session is active for company creation
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) throw signInError;
      toast.success("Account created. Now set up your company.");
      setStep("company");
    } catch (error) {
      const message = authErrorMessage(error, "Signup failed. Please try again.");
      setFormError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Clearing the input lets the same file be re-picked after a rejection.
    e.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setCompanyErrors((prev) => ({ ...prev, logo: "Choose an image file (PNG, JPG or WebP)." }));
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setCompanyErrors((prev) => ({
        ...prev,
        logo: "That image is over 5 MB. Pick a smaller one, or crop it first.",
      }));
      return;
    }

    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const url = URL.createObjectURL(file);
    previewUrlRef.current = url;
    setLogoFile(file);
    setLogoPreview(url);
    setCompanyErrors((prev) => ({ ...prev, logo: undefined }));
  };

  const clearLogo = () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setLogoFile(null);
    setLogoPreview(null);
    setCompanyErrors((prev) => ({ ...prev, logo: undefined }));
  };

  /** Signing out is the only way back to step 1 once the account exists. */
  const startOver = async () => {
    setLoading(true);
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.warn("Sign out failed", error);
    } finally {
      setLoading(false);
    }
    clearLogo();
    setPassword("");
    setConfirmPassword("");
    setAgreedToTerms(false);
    setFormError(null);
    setSignupErrors({});
    setCompanyErrors({});
    setStep("signup");
  };

  const handleCompanySetup = async (e: React.FormEvent) => {
    e.preventDefault();

    const errors: CompanyErrors = {};
    if (!companyName.trim()) errors.companyName = "Your customers will see this name — it can't be blank.";
    if (phoneDigits(phone).length < 10) errors.phone = "Enter a WhatsApp number with the country code, e.g. +919876543210.";
    if (googleMapsUrl.trim() && !safeExternalUrl(googleMapsUrl)) {
      errors.googleMapsUrl = "Paste the full link, starting with https://";
    }
    setCompanyErrors((prev) => ({ ...errors, logo: prev.logo }));
    setFormError(null);
    if (Object.keys(errors).length > 0) return;

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Your session expired. Please log in again.");

      let logoUrl: string | null = null;
      let logoFailed = false;
      if (logoFile) {
        // The account already exists by this point, so an optional image must
        // never be the reason a merchant ends up with a login and no catalog.
        try {
          const ext = EXTENSION_BY_TYPE[logoFile.type] ?? "png";
          const path = `logos/${user.id}.${ext}`;
          const { error: uploadError } = await supabase.storage
            .from("product-images")
            .upload(path, logoFile, { upsert: true });
          if (uploadError) throw uploadError;
          const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(path);
          logoUrl = urlData.publicUrl;
        } catch (uploadError) {
          logoFailed = true;
          console.warn("Logo upload failed", uploadError);
        }
      }

      let slug = generateSlug(companyName);
      const { data: existing } = await supabase.from("companies").select("slug").eq("slug", slug);
      if (existing && existing.length > 0) {
        slug = `${slug}-${Date.now().toString(36)}`;
      }

      const contactPhoneOrNull = (value: string) => {
        const cleaned = value.replace(/\s+/g, "");
        return !cleaned || cleaned === "+91" ? null : cleaned;
      };

      const companyEmail = email.trim() || user.email || "";

      const insertCompany = (companySlug: string) =>
        supabase.from("companies").insert({
          owner_id: user.id,
          name: companyName.trim(),
          slug: companySlug,
          phone: phone.replace(/\s+/g, ""),
          email: companyEmail,
          address: address.trim() || null,
          gst_number: gstNumber.trim() || null,
          logo_url: logoUrl,
          theme_primary: themePrimary,
          theme_accent: themeAccent,
          contact_name_1: contactName1.trim() || null,
          contact_phone_1: contactPhoneOrNull(contactPhone1),
          contact_name_2: contactName2.trim() || null,
          contact_phone_2: contactPhoneOrNull(contactPhone2),
          google_maps_url: safeExternalUrl(googleMapsUrl),
        });

      let { error } = await insertCompany(slug);

      // The availability check above races with any other signup happening right
      // now. Losing that race is a 23505 unique violation, which used to throw
      // away the whole registration even though a fresh suffix fixes it.
      if (error?.code === "23505") {
        slug = `${generateSlug(companyName)}-${randomSuffix()}`;
        ({ error } = await insertCompany(slug));
      }

      if (error) throw error;

      // Send welcome email to the company (fire-and-forget)
      supabase.functions.invoke("send-emails", {
        body: {
          type: "welcome",
          to: companyEmail,
          companyName: companyName.trim(),
        },
      }).catch((err: unknown) => console.warn("Welcome email failed (non-blocking):", err));

      // Send admin notification to catalogshare123@gmail.com
      supabase.functions.invoke("send-emails", {
        body: {
          type: "admin_new_company",
          to: companyEmail,         // companyEmail passed as `to` so admin HTML can show it
          companyName: companyName.trim(),
          companyEmail,
        },
      }).catch((err: unknown) => console.warn("Admin new-company email failed (non-blocking):", err));

      if (logoFailed) {
        toast.warning("Your catalog is ready, but the logo didn't upload. Add it again from Settings.");
      } else {
        toast.success("Company created. Welcome to your dashboard.");
      }
      navigate("/dashboard");
    } catch (error) {
      const message = authErrorMessage(error, "Setup failed. Please try again.");
      setFormError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const errorBanner = formError && (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <span className="break-anywhere">{formError}</span>
    </div>
  );

  // Deciding which step to show needs the session; rendering step 1 first and
  // snapping to step 2 flashed a form the user must not fill in again.
  if (resuming) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // Step 1: Email & Password
  if (step === "signup") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/5 to-background px-4 py-8">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Mail className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-2xl">Create your account</CardTitle>
            <CardDescription>Step 1 of 2: set up your login credentials</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSignup} noValidate className="space-y-4">
              {errorBanner}
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
                    setSignupErrors((prev) => ({ ...prev, email: undefined }));
                  }}
                  placeholder="you@company.com"
                  aria-invalid={!!signupErrors.email}
                  aria-describedby={signupErrors.email ? "email-error" : undefined}
                  className="h-11"
                />
                {signupErrors.email && (
                  <p id="email-error" className="text-sm font-medium text-destructive">
                    {signupErrors.email}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <PasswordInput
                  id="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setSignupErrors((prev) => ({ ...prev, password: undefined }));
                  }}
                  placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                  aria-invalid={!!signupErrors.password}
                  aria-describedby={signupErrors.password ? "password-error" : undefined}
                  className="h-11"
                />
                {signupErrors.password && (
                  <p id="password-error" className="text-sm font-medium text-destructive">
                    {signupErrors.password}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm password</Label>
                <PasswordInput
                  id="confirmPassword"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setSignupErrors((prev) => ({ ...prev, confirmPassword: undefined }));
                  }}
                  placeholder="Re-enter password"
                  aria-invalid={!!signupErrors.confirmPassword}
                  aria-describedby={signupErrors.confirmPassword ? "confirmPassword-error" : undefined}
                  className="h-11"
                />
                {signupErrors.confirmPassword && (
                  <p id="confirmPassword-error" className="text-sm font-medium text-destructive">
                    {signupErrors.confirmPassword}
                  </p>
                )}
              </div>
              <div className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label>Terms and conditions</Label>
                  <div className="h-32 w-full overflow-y-auto rounded-md border bg-muted/30 p-4 text-xs text-muted-foreground">
                    <h4 className="mb-2 text-sm font-semibold text-foreground">Platform Terms of Service</h4>
                    <p className="mb-2">Welcome to CatalogShare. By creating an account, you agree to the following terms and conditions:</p>
                    <p className="mb-2">1. <strong>Platform Independence:</strong> CatalogShare is a platform offering catalog creation services. You are solely responsible for the content you upload.</p>
                    <p className="mb-2">2. <strong>Under Development:</strong> Please note that this platform is currently under active development. You may encounter bugs, service interruptions, or incomplete features.</p>
                    <p className="mb-2 font-semibold text-foreground">3. <strong>No Refund Policy:</strong> As this service is in active development and provides immediate value through digital infrastructure, all purchases and subscription funds are strictly non-refundable.</p>
                    <p className="mb-2">4. <strong>Data Privacy:</strong> We respect your privacy but reserve the right to modify our service offerings at any time.</p>
                    <p className="mb-2">5. <strong>Account Termination:</strong> We reserve the right to suspend or terminate accounts that violate our community guidelines or engage in fraudulent activities.</p>
                    <p>By proceeding, you acknowledge that you have read and understood these terms.</p>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <Checkbox
                      id="terms"
                      checked={agreedToTerms}
                      onCheckedChange={(checked) => {
                        setAgreedToTerms(checked === true);
                        setSignupErrors((prev) => ({ ...prev, terms: undefined }));
                      }}
                      aria-describedby={signupErrors.terms ? "terms-error" : undefined}
                    />
                    <Label htmlFor="terms" className="flex min-h-11 cursor-pointer items-center text-sm font-medium">
                      I agree to the terms and conditions
                    </Label>
                  </div>
                  {signupErrors.terms && (
                    <p id="terms-error" className="text-sm font-medium text-destructive">
                      {signupErrors.terms}
                    </p>
                  )}
                </div>
              </div>
              <Button type="submit" className="h-12 w-full text-base" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {loading ? "Creating account..." : "Create account"}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link to="/login" className="text-primary hover:underline">
                  Login
                </Link>
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Step 2: Company Setup
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/5 to-background px-4 py-8">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Store className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Set up your company</CardTitle>
          <CardDescription className="break-anywhere">
            Step 2 of 2: tell us about your business
            {email ? ` — signed in as ${email}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCompanySetup} noValidate className="space-y-4">
            {errorBanner}
            <div className="space-y-2">
              <Label htmlFor="companyName">Company name *</Label>
              <Input
                id="companyName"
                value={companyName}
                onChange={(e) => {
                  setCompanyName(e.target.value);
                  setCompanyErrors((prev) => ({ ...prev, companyName: undefined }));
                }}
                placeholder="Your Business Name"
                maxLength={120}
                aria-invalid={!!companyErrors.companyName}
                aria-describedby={companyErrors.companyName ? "companyName-error" : undefined}
                className="h-11"
              />
              {companyErrors.companyName && (
                <p id="companyName-error" className="text-sm font-medium text-destructive">
                  {companyErrors.companyName}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">WhatsApp number *</Label>
              <Input
                id="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setCompanyErrors((prev) => ({ ...prev, phone: undefined }));
                }}
                placeholder="+919876543210"
                aria-invalid={!!companyErrors.phone}
                aria-describedby={companyErrors.phone ? "phone-error" : undefined}
                className="h-11"
              />
              {companyErrors.phone ? (
                <p id="phone-error" className="text-sm font-medium text-destructive">
                  {companyErrors.phone}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Orders from your catalog arrive on this number.</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">Address (optional)</Label>
              <Input
                id="address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Your business address"
                maxLength={250}
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="gstNumber">GST number (optional)</Label>
              <Input
                id="gstNumber"
                value={gstNumber}
                onChange={(e) => setGstNumber(e.target.value)}
                placeholder="e.g. 22AAAAA0000A1Z5"
                maxLength={20}
                autoCapitalize="characters"
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label>Company logo (optional)</Label>
              <div className="flex flex-wrap items-center gap-3">
                {logoPreview && (
                  <img src={logoPreview} alt="Logo preview" className="h-12 w-12 rounded-lg border object-cover" />
                )}
                <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-input px-4 text-sm hover:bg-accent">
                  <Upload className="h-4 w-4" />
                  {logoFile ? "Change logo" : "Upload logo"}
                  <input type="file" accept="image/*" onChange={handleLogoSelect} className="hidden" />
                </label>
                {logoFile && (
                  <Button type="button" variant="ghost" className="h-11 gap-1 text-sm" onClick={clearLogo}>
                    <X className="h-4 w-4" /> Remove
                  </Button>
                )}
              </div>
              {companyErrors.logo ? (
                <p className="text-sm font-medium text-destructive">{companyErrors.logo}</p>
              ) : (
                <p className="text-xs text-muted-foreground">PNG, JPG or WebP, up to 5 MB.</p>
              )}
            </div>
            <ColorThemePicker
              selectedPrimary={themePrimary}
              onSelect={(primary, accent) => { setThemePrimary(primary); setThemeAccent(accent); }}
              plan="free"
            />
            <div className="mt-2 border-t pt-4">
              <h3 className="mb-3 text-sm font-semibold">About / contact page (optional)</h3>
              {/* One column on a 360px screen: two 150px inputs side by side
                  could not fit a name and a phone number legibly. */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="contactName1">Contact name 1</Label>
                  <Input
                    id="contactName1"
                    value={contactName1}
                    onChange={(e) => setContactName1(e.target.value)}
                    placeholder="e.g. John Doe"
                    maxLength={80}
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactPhone1">Contact phone 1</Label>
                  <Input
                    id="contactPhone1"
                    type="tel"
                    inputMode="tel"
                    value={contactPhone1}
                    onChange={(e) => setContactPhone1(e.target.value)}
                    placeholder="e.g. +9198765..."
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactName2">Contact name 2</Label>
                  <Input
                    id="contactName2"
                    value={contactName2}
                    onChange={(e) => setContactName2(e.target.value)}
                    placeholder="e.g. Jane Doe"
                    maxLength={80}
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactPhone2">Contact phone 2</Label>
                  <Input
                    id="contactPhone2"
                    type="tel"
                    inputMode="tel"
                    value={contactPhone2}
                    onChange={(e) => setContactPhone2(e.target.value)}
                    placeholder="e.g. +9198765..."
                    className="h-11"
                  />
                </div>
              </div>
              <div className="mt-3 space-y-2">
                <Label htmlFor="googleMapsUrl">Google Maps link</Label>
                <Input
                  id="googleMapsUrl"
                  type="url"
                  inputMode="url"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={googleMapsUrl}
                  onChange={(e) => {
                    setGoogleMapsUrl(e.target.value);
                    setCompanyErrors((prev) => ({ ...prev, googleMapsUrl: undefined }));
                  }}
                  placeholder="Paste Google Maps share link"
                  aria-invalid={!!companyErrors.googleMapsUrl}
                  aria-describedby={companyErrors.googleMapsUrl ? "googleMapsUrl-error" : undefined}
                  className="h-11"
                />
                {companyErrors.googleMapsUrl && (
                  <p id="googleMapsUrl-error" className="text-sm font-medium text-destructive">
                    {companyErrors.googleMapsUrl}
                  </p>
                )}
              </div>
            </div>
            <Button type="submit" className="h-12 w-full text-base" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {loading ? "Setting up..." : "Create my catalog"}
            </Button>
            {/* The account already exists, so step 1 is unreachable by going
                back — signing out is the only honest way to start again. */}
            <Button
              type="button"
              variant="ghost"
              className="h-11 w-full text-sm text-muted-foreground"
              onClick={() => void startOver()}
              disabled={loading}
            >
              Use a different account
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default Register;
