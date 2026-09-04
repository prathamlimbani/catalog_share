import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/PasswordInput";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { KeyRound, ArrowLeft, CheckCircle, AlertTriangle, Loader2, MessageCircle } from "lucide-react";
import { authErrorMessage } from "@/lib/errorMessages";
import { authConfig, loadAuthConfig } from "@/lib/authConfig";
import { INDIA, localNumberError, toE164 } from "@/lib/phone";
import PhoneField from "@/components/auth/PhoneField";
import OtpChallenge from "@/components/auth/OtpChallenge";

/** Deliberately loose: the server is the authority, this only catches typos. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MIN_PASSWORD_LENGTH = 6;

const ForgotPassword = () => {
    /**
     * WhatsApp first, email second.
     *
     * The channel is chosen up front rather than derived, because "I have lost
     * my password" and "I have also lost access to that inbox" are the same
     * sentence for a lot of merchants — the whole reason WhatsApp is now the
     * permanent channel.
     */
    const [step, setStep] = useState<"email" | "otp" | "wa" | "wa-code" | "done">("email");
    const [channel, setChannel] = useState<"whatsapp" | "email">("email");
    const [phone, setPhone] = useState("");
    const [phoneCountry, setPhoneCountry] = useState(INDIA.code);
    const [email, setEmail] = useState("");
    const [otp, setOtp] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [resending, setResending] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<{
        email?: string;
        phone?: string;
        otp?: string;
        newPassword?: string;
        confirmPassword?: string;
    }>({});

    const clearFieldError = (field: keyof typeof fieldErrors) =>
        setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));

    // Default to WhatsApp once the settings say it is available. Done in an
    // effect rather than in useState so the choice follows the admin toggle
    // instead of whatever was true when the module first loaded.
    useEffect(() => {
        void loadAuthConfig().then((config) => {
            if (config.whatsappResetEnabled) setChannel("whatsapp");
        });
    }, []);

    /**
     * Start the WhatsApp reset.
     *
     * The new password is collected HERE, before the code, because verifying
     * the code and setting the password are one server call — see verifyOtp.
     * Splitting them would leave a window where a correct code authorises a
     * separate unauthenticated "change this password" request, which is the
     * whole account.
     */
    const handleWhatsAppStart = (e: React.FormEvent) => {
        e.preventDefault();

        const errors: typeof fieldErrors = {};
        const phoneError = localNumberError(phone, INDIA);
        if (phoneError) errors.phone = phoneError;
        if (newPassword.length < MIN_PASSWORD_LENGTH) {
            errors.newPassword = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
        }
        if (newPassword !== confirmPassword) errors.confirmPassword = "Both passwords must match.";
        setFieldErrors(errors);
        setFormError(null);
        if (Object.keys(errors).length > 0) return;

        setStep("wa-code");
    };

    /**
     * No redirectTo on purpose: the user types the emailed code into the next
     * step (verifyOtp), so the link is never followed — and inside Capacitor
     * the origin is "https://localhost", which GoTrue rejects as an
     * unregistered redirect URL and the whole reset fails.
     */
    const requestOtp = async (address: string) => {
        const { error } = await supabase.auth.resetPasswordForEmail(address);
        if (error) throw error;
    };

    const handleSendOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = email.trim();
        if (!trimmed) {
            setFieldErrors({ email: "Enter the email you registered with." });
            return;
        }
        if (!EMAIL_PATTERN.test(trimmed)) {
            setFieldErrors({ email: "That doesn't look like an email address." });
            return;
        }
        setFieldErrors({});
        setFormError(null);
        setLoading(true);
        try {
            await requestOtp(trimmed);
            toast.success("Reset code sent. Check your inbox.");
            setStep("otp");
        } catch (error) {
            const message = authErrorMessage(error, "Couldn't send the reset code. Please try again.");
            setFormError(message);
            toast.error(message);
        } finally {
            setLoading(false);
        }
    };

    /** Codes expire, and mail is slow — without this the only way out was to
     *  go back a step and retype the address. */
    const handleResend = async () => {
        setResending(true);
        setFormError(null);
        try {
            await requestOtp(email.trim());
            toast.success("A new code is on its way.");
        } catch (error) {
            const message = authErrorMessage(error, "Couldn't resend the code. Please try again.");
            setFormError(message);
            toast.error(message);
        } finally {
            setResending(false);
        }
    };

    const handleResetPassword = async (e: React.FormEvent) => {
        e.preventDefault();

        const errors: typeof fieldErrors = {};
        if (!otp.trim()) errors.otp = "Enter the code from the email.";
        if (newPassword.length < MIN_PASSWORD_LENGTH) {
            errors.newPassword = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
        }
        if (newPassword !== confirmPassword) errors.confirmPassword = "Both passwords must match.";
        setFieldErrors(errors);
        setFormError(null);
        if (Object.keys(errors).length > 0) return;

        setLoading(true);
        try {
            // Verify OTP and get session
            const { error: verifyError } = await supabase.auth.verifyOtp({
                email: email.trim(),
                token: otp.trim(),
                type: "recovery",
            });
            if (verifyError) throw verifyError;

            // Update password
            const { error: updateError } = await supabase.auth.updateUser({
                password: newPassword,
            });
            if (updateError) throw updateError;

            toast.success("Password reset successfully.");
            setStep("done");
        } catch (error) {
            const message = authErrorMessage(error, "Couldn't reset your password. Please try again.");
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

    if (step === "done") {
        return (
            <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/5 to-background px-4 py-8">
                <Card className="w-full max-w-md">
                    <CardHeader className="text-center">
                        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                            <CheckCircle className="h-8 w-8 text-primary" />
                        </div>
                        <CardTitle className="text-2xl">Password reset</CardTitle>
                        <CardDescription>Your password has been changed successfully</CardDescription>
                    </CardHeader>
                    <CardContent className="text-center">
                        <Button className="h-12 w-full text-base" asChild>
                            <Link to="/login">Go to login</Link>
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    // The WhatsApp code screen. The new password was collected on the previous
    // step and travels with the code, because verifying and setting the password
    // are one server call.
    if (step === "wa-code") {
        return (
            <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/5 to-background px-4 py-8">
                <Card className="w-full max-w-md">
                    <CardHeader className="text-center">
                        <CardTitle className="text-2xl">Check WhatsApp</CardTitle>
                        <CardDescription>
                            Enter the code to finish setting your new password.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {errorBanner}
                        <OtpChallenge
                            purpose="reset"
                            phone={toE164(phone, INDIA)}
                            newPassword={newPassword}
                            onVerified={() => {
                                toast.success("Password reset successfully.");
                                setStep("done");
                            }}
                            onCancel={() => {
                                setFormError(null);
                                setStep("wa");
                            }}
                            cancelLabel="Use a different number"
                        />
                    </CardContent>
                </Card>
            </div>
        );
    }

    if (step === "wa") {
        return (
            <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/5 to-background px-4 py-8">
                <Card className="w-full max-w-md">
                    <CardHeader className="text-center">
                        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                            <KeyRound className="h-6 w-6 text-primary" />
                        </div>
                        <CardTitle className="text-2xl">Reset by WhatsApp</CardTitle>
                        <CardDescription>
                            Your new password first, then we send a code to confirm it is you.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleWhatsAppStart} noValidate className="space-y-4">
                            {errorBanner}
                            <PhoneField
                                id="reset-phone"
                                label="Your registered WhatsApp number"
                                required
                                lockCountry
                                countryCode={phoneCountry}
                                onCountryChange={setPhoneCountry}
                                value={phone}
                                onValueChange={(local) => {
                                    setPhone(local);
                                    clearFieldError("phone");
                                }}
                                error={fieldErrors.phone}
                                hint="The number your CatalogShare account was verified with."
                            />
                            <div className="space-y-2">
                                <Label htmlFor="wa-newPassword">New password</Label>
                                <PasswordInput
                                    id="wa-newPassword"
                                    autoComplete="new-password"
                                    value={newPassword}
                                    onChange={(e) => {
                                        setNewPassword(e.target.value);
                                        clearFieldError("newPassword");
                                    }}
                                    placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                                    aria-invalid={!!fieldErrors.newPassword}
                                    aria-describedby={fieldErrors.newPassword ? "wa-newPassword-error" : undefined}
                                    className="h-11"
                                />
                                {fieldErrors.newPassword && (
                                    <p id="wa-newPassword-error" className="text-sm font-medium text-destructive">
                                        {fieldErrors.newPassword}
                                    </p>
                                )}
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="wa-confirmPassword">Confirm password</Label>
                                <PasswordInput
                                    id="wa-confirmPassword"
                                    autoComplete="new-password"
                                    value={confirmPassword}
                                    onChange={(e) => {
                                        setConfirmPassword(e.target.value);
                                        clearFieldError("confirmPassword");
                                    }}
                                    placeholder="Type it again"
                                    aria-invalid={!!fieldErrors.confirmPassword}
                                    aria-describedby={fieldErrors.confirmPassword ? "wa-confirmPassword-error" : undefined}
                                    className="h-11"
                                />
                                {fieldErrors.confirmPassword && (
                                    <p id="wa-confirmPassword-error" className="text-sm font-medium text-destructive">
                                        {fieldErrors.confirmPassword}
                                    </p>
                                )}
                            </div>
                            {/* Same expectation-setting as the email path: we never
                                confirm whether a number has an account, because that
                                would make this screen a way to look one up. */}
                            <p className="text-xs text-muted-foreground">
                                If this number has an account, a code arrives on WhatsApp within a minute.
                            </p>
                            <Button type="submit" className="h-12 w-full text-base">
                                Send code on WhatsApp
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                className="h-11 w-full text-sm text-muted-foreground"
                                onClick={() => {
                                    setChannel("email");
                                    setFormError(null);
                                    setFieldErrors({});
                                    setStep("email");
                                }}
                            >
                                Use email instead
                            </Button>
                            <p className="text-center text-sm text-muted-foreground">
                                Remember your password?{" "}
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

    if (step === "otp") {
        return (
            <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary/5 to-background px-4 py-8">
                <Card className="w-full max-w-md">
                    <CardHeader className="text-center">
                        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                            <KeyRound className="h-6 w-6 text-primary" />
                        </div>
                        <CardTitle className="text-2xl">Enter code and new password</CardTitle>
                        <CardDescription className="break-anywhere">
                            We sent a reset code to <strong>{email.trim()}</strong>
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleResetPassword} noValidate className="space-y-4">
                            {errorBanner}
                            <div className="space-y-2">
                                <Label htmlFor="otp">Reset code</Label>
                                <Input
                                    id="otp"
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    autoCapitalize="none"
                                    spellCheck={false}
                                    value={otp}
                                    onChange={(e) => {
                                        setOtp(e.target.value);
                                        clearFieldError("otp");
                                    }}
                                    placeholder="Enter reset code"
                                    maxLength={8}
                                    aria-invalid={!!fieldErrors.otp}
                                    aria-describedby={fieldErrors.otp ? "otp-error" : undefined}
                                    className="h-12 text-center text-lg tracking-widest"
                                />
                                {fieldErrors.otp && (
                                    <p id="otp-error" className="text-sm font-medium text-destructive">
                                        {fieldErrors.otp}
                                    </p>
                                )}
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="newPassword">New password</Label>
                                <PasswordInput
                                    id="newPassword"
                                    autoComplete="new-password"
                                    value={newPassword}
                                    onChange={(e) => {
                                        setNewPassword(e.target.value);
                                        clearFieldError("newPassword");
                                    }}
                                    placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                                    aria-invalid={!!fieldErrors.newPassword}
                                    aria-describedby={fieldErrors.newPassword ? "newPassword-error" : undefined}
                                    className="h-11"
                                />
                                {fieldErrors.newPassword && (
                                    <p id="newPassword-error" className="text-sm font-medium text-destructive">
                                        {fieldErrors.newPassword}
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
                                        clearFieldError("confirmPassword");
                                    }}
                                    placeholder="Re-enter password"
                                    aria-invalid={!!fieldErrors.confirmPassword}
                                    aria-describedby={fieldErrors.confirmPassword ? "confirmPassword-error" : undefined}
                                    className="h-11"
                                />
                                {fieldErrors.confirmPassword && (
                                    <p id="confirmPassword-error" className="text-sm font-medium text-destructive">
                                        {fieldErrors.confirmPassword}
                                    </p>
                                )}
                            </div>
                            <Button type="submit" className="h-12 w-full text-base" disabled={loading}>
                                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {loading ? "Resetting..." : "Reset password"}
                            </Button>
                            <div className="flex flex-col items-center gap-1">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="h-11 text-sm"
                                    onClick={() => void handleResend()}
                                    disabled={resending || loading}
                                >
                                    {resending ? "Sending..." : "Didn't get it? Send a new code"}
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="h-11 gap-1 text-sm text-muted-foreground"
                                    onClick={() => {
                                        setStep("email");
                                        setFormError(null);
                                        setFieldErrors({});
                                    }}
                                    disabled={loading}
                                >
                                    <ArrowLeft className="h-3 w-3" /> Change email
                                </Button>
                            </div>
                        </form>
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
                        <KeyRound className="h-6 w-6 text-primary" />
                    </div>
                    <CardTitle className="text-2xl">Forgot password</CardTitle>
                    <CardDescription>Enter your email to receive a reset code</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSendOtp} noValidate className="space-y-4">
                        {errorBanner}
                        <div className="space-y-2">
                            <Label htmlFor="email">Email address</Label>
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
                                    clearFieldError("email");
                                }}
                                placeholder="you@company.com"
                                aria-invalid={!!fieldErrors.email}
                                aria-describedby={fieldErrors.email ? "reset-email-error" : undefined}
                                className="h-11"
                            />
                            {fieldErrors.email && (
                                <p id="reset-email-error" className="text-sm font-medium text-destructive">
                                    {fieldErrors.email}
                                </p>
                            )}
                        </div>
                        {/* Supabase will not confirm whether an address is registered, so the
                            copy has to set that expectation instead of promising an email. */}
                        <p className="text-xs text-muted-foreground">
                            If this email has an account, a reset code will arrive within a minute.
                        </p>
                        <Button type="submit" className="h-12 w-full text-base" disabled={loading}>
                            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {loading ? "Sending..." : "Send reset code"}
                        </Button>
                        {/* Offered only when the admin has WhatsApp reset on, so
                            this is never a route to a screen that refuses. */}
                        {authConfig().whatsappResetEnabled && (
                            <Button
                                type="button"
                                variant="outline"
                                className="h-11 w-full text-sm"
                                onClick={() => {
                                    setChannel("whatsapp");
                                    setFormError(null);
                                    setFieldErrors({});
                                    setStep("wa");
                                }}
                            >
                                <MessageCircle className="mr-2 h-4 w-4" />
                                Reset by WhatsApp instead
                            </Button>
                        )}
                        <p className="text-center text-sm text-muted-foreground">
                            Remember your password?{" "}
                            <Link to="/login" className="text-primary hover:underline">
                                Login
                            </Link>
                        </p>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
};

export default ForgotPassword;
