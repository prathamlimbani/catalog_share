import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Store, Upload, Mail } from "lucide-react";
import ColorThemePicker from "@/components/ColorThemePicker";

const Register = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState<"signup" | "company">("signup");
  const [loading, setLoading] = useState(false);

  // Auth fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Company fields
  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState("+91 ");
  const [address, setAddress] = useState("");
  const [gstNumber, setGstNumber] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [themePrimary, setThemePrimary] = useState("25 95% 53%");
  const [themeAccent, setThemeAccent] = useState("25 95% 95%");
  const [contactName1, setContactName1] = useState("");
  const [contactPhone1, setContactPhone1] = useState("");
  const [contactName2, setContactName2] = useState("");
  const [contactPhone2, setContactPhone2] = useState("");
  const [googleMapsUrl, setGoogleMapsUrl] = useState("");

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .trim();
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      // Immediately sign in so the session is active for company creation
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      toast.success("Account created! Now set up your company.");
      setStep("company");
    } catch (error: any) {
      toast.error(error.message || "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setLogoFile(file);
      setLogoPreview(URL.createObjectURL(file));
    }
  };

  const handleCompanySetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      let logoUrl: string | null = null;
      if (logoFile) {
        const ext = logoFile.name.split(".").pop();
        const path = `logos/${user.id}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("product-images").upload(path, logoFile, { upsert: true });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(path);
        logoUrl = urlData.publicUrl;
      }

      let slug = generateSlug(companyName);
      const { data: existing } = await supabase.from("companies").select("slug").eq("slug", slug);
      if (existing && existing.length > 0) {
        slug = `${slug}-${Date.now().toString(36)}`;
      }

      const { error } = await supabase.from("companies").insert({
        owner_id: user.id,
        name: companyName.trim(),
        slug,
        phone: phone.trim(),
        email: email.trim(),
        address: address.trim() || null,
        gst_number: gstNumber.trim() || null,
        logo_url: logoUrl,
        theme_primary: themePrimary,
        theme_accent: themeAccent,
        contact_name_1: contactName1.trim() || null,
        contact_phone_1: contactPhone1.trim() || null,
        contact_name_2: contactName2.trim() || null,
        contact_phone_2: contactPhone2.trim() || null,
        google_maps_url: googleMapsUrl.trim() || null,
      });

      if (error) throw error;
      toast.success("Company created! Welcome to your dashboard.");
      navigate("/dashboard");
    } catch (error: any) {
      toast.error(error.message || "Setup failed");
    } finally {
      setLoading(false);
    }
  };

  // Step 1: Email & Password
  if (step === "signup") {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 bg-gradient-to-br from-primary/5 to-background">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
              <Mail className="h-6 w-6 text-primary" />
            </div>
            <CardTitle className="text-2xl">Create Your Account</CardTitle>
            <CardDescription>Step 1 of 2: Set up your login credentials</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSignup} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 6 characters" required minLength={6} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input id="confirmPassword" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Re-enter password" required minLength={6} />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Creating Account..." : "Create Account"}
              </Button>
              <p className="text-sm text-center text-muted-foreground">
                Already have an account? <Link to="/login" className="text-primary hover:underline">Login</Link>
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Step 2: Company Setup
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8 bg-gradient-to-br from-primary/5 to-background">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <Store className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Set Up Your Company</CardTitle>
          <CardDescription>Step 2 of 2: Tell us about your business</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCompanySetup} className="space-y-4">
            <div className="space-y-2">
              <Label>Company Name *</Label>
              <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Your Business Name" required />
            </div>
            <div className="space-y-2">
              <Label>WhatsApp Number *</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 9876543210" required />
            </div>
            <div className="space-y-2">
              <Label>Address (optional)</Label>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Your business address" />
            </div>
            <div className="space-y-2">
              <Label>GST Number (optional)</Label>
              <Input value={gstNumber} onChange={(e) => setGstNumber(e.target.value)} placeholder="e.g. 22AAAAA0000A1Z5" />
            </div>
            <div className="space-y-2">
              <Label>Company Logo (optional)</Label>
              <div className="flex items-center gap-3">
                {logoPreview && (
                  <img src={logoPreview} alt="Logo preview" className="w-12 h-12 rounded-lg object-cover" />
                )}
                <label className="flex items-center gap-2 px-4 py-2 border border-input rounded-md cursor-pointer hover:bg-accent text-sm">
                  <Upload className="h-4 w-4" />
                  {logoFile ? "Change Logo" : "Upload Logo"}
                  <input type="file" accept="image/*" onChange={handleLogoSelect} className="hidden" />
                </label>
              </div>
            </div>
            <ColorThemePicker
              selectedPrimary={themePrimary}
              onSelect={(primary, accent) => { setThemePrimary(primary); setThemeAccent(accent); }}
            />
            <div className="border-t pt-4 mt-2">
              <h3 className="font-semibold text-sm mb-3">About / Contact Page (optional)</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Contact Name 1</Label>
                  <Input value={contactName1} onChange={(e) => setContactName1(e.target.value)} placeholder="e.g. John Doe" />
                </div>
                <div className="space-y-2">
                  <Label>Contact Phone 1</Label>
                  <Input value={contactPhone1} onChange={(e) => setContactPhone1(e.target.value)} placeholder="e.g. +91 98765..." />
                </div>
                <div className="space-y-2">
                  <Label>Contact Name 2</Label>
                  <Input value={contactName2} onChange={(e) => setContactName2(e.target.value)} placeholder="e.g. Jane Doe" />
                </div>
                <div className="space-y-2">
                  <Label>Contact Phone 2</Label>
                  <Input value={contactPhone2} onChange={(e) => setContactPhone2(e.target.value)} placeholder="e.g. +91 98765..." />
                </div>
              </div>
              <div className="space-y-2 mt-3">
                <Label>Google Maps Link</Label>
                <Input value={googleMapsUrl} onChange={(e) => setGoogleMapsUrl(e.target.value)} placeholder="Paste Google Maps share link" />
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Setting up..." : "Create My Catalog"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default Register;
