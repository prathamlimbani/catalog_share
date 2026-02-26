import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { KeyRound, ArrowLeft, CheckCircle } from "lucide-react";

const ForgotPassword = () => {
    const [step, setStep] = useState<"email" | "otp" | "done">("email");
    const [email, setEmail] = useState("");
    const [otp, setOtp] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [loading, setLoading] = useState(false);

    const handleSendOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: window.location.origin + "/forgot-password",
            });
            if (error) throw error;
            toast.success("OTP sent to your email! Check your inbox.");
            setStep("otp");
        } catch (error: any) {
            toast.error(error.message || "Failed to send OTP");
        } finally {
            setLoading(false);
        }
    };

    const handleResetPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (newPassword !== confirmPassword) {
            toast.error("Passwords do not match");
            return;
        }
        if (newPassword.length < 6) {
            toast.error("Password must be at least 6 characters");
            return;
        }
        setLoading(true);
        try {
            // Verify OTP and get session
            const { error: verifyError } = await supabase.auth.verifyOtp({
                email,
                token: otp,
                type: "recovery",
            });
            if (verifyError) throw verifyError;

            // Update password
            const { error: updateError } = await supabase.auth.updateUser({
                password: newPassword,
            });
            if (updateError) throw updateError;

            toast.success("Password reset successfully!");
            setStep("done");
        } catch (error: any) {
            toast.error(error.message || "Failed to reset password");
        } finally {
            setLoading(false);
        }
    };

    if (step === "done") {
        return (
            <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-primary/5 to-background">
                <Card className="w-full max-w-md">
                    <CardHeader className="text-center">
                        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                            <CheckCircle className="h-8 w-8 text-green-600" />
                        </div>
                        <CardTitle className="text-2xl">Password Reset!</CardTitle>
                        <CardDescription>Your password has been changed successfully</CardDescription>
                    </CardHeader>
                    <CardContent className="text-center">
                        <Link to="/login">
                            <Button className="w-full">Go to Login</Button>
                        </Link>
                    </CardContent>
                </Card>
            </div>
        );
    }

    if (step === "otp") {
        return (
            <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-primary/5 to-background">
                <Card className="w-full max-w-md">
                    <CardHeader className="text-center">
                        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                            <KeyRound className="h-6 w-6 text-primary" />
                        </div>
                        <CardTitle className="text-2xl">Enter OTP & New Password</CardTitle>
                        <CardDescription>
                            We sent a reset code to <strong>{email}</strong>
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleResetPassword} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="otp">OTP Code</Label>
                                <Input
                                    id="otp"
                                    value={otp}
                                    onChange={(e) => setOtp(e.target.value)}
                                    placeholder="Enter reset code"
                                    required
                                    maxLength={8}
                                    className="text-center text-lg tracking-widest"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="newPassword">New Password</Label>
                                <Input
                                    id="newPassword"
                                    type="password"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    placeholder="Min 6 characters"
                                    required
                                    minLength={6}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="confirmPassword">Confirm Password</Label>
                                <Input
                                    id="confirmPassword"
                                    type="password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    placeholder="Re-enter password"
                                    required
                                    minLength={6}
                                />
                            </div>
                            <Button type="submit" className="w-full" disabled={loading}>
                                {loading ? "Resetting..." : "Reset Password"}
                            </Button>
                            <button
                                type="button"
                                onClick={() => setStep("email")}
                                className="text-sm text-muted-foreground hover:text-primary flex items-center gap-1 mx-auto"
                            >
                                <ArrowLeft className="h-3 w-3" /> Change email
                            </button>
                        </form>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-primary/5 to-background">
            <Card className="w-full max-w-md">
                <CardHeader className="text-center">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                        <KeyRound className="h-6 w-6 text-primary" />
                    </div>
                    <CardTitle className="text-2xl">Forgot Password</CardTitle>
                    <CardDescription>Enter your email to receive a reset code</CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSendOtp} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="email">Email Address</Label>
                            <Input
                                id="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="you@company.com"
                                required
                            />
                        </div>
                        <Button type="submit" className="w-full" disabled={loading}>
                            {loading ? "Sending..." : "Send OTP Code"}
                        </Button>
                        <p className="text-sm text-center text-muted-foreground">
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
