import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Upload, QrCode, Trash2 } from "lucide-react";
import { Tables } from "@/integrations/supabase/types";
import ColorThemePicker from "@/components/ColorThemePicker";
import { asText } from "@/lib/productData";
import { authConfig, loadAuthConfig } from "@/lib/authConfig";
import { fetchSecurityState } from "@/lib/otp";
import { INDIA, findCountry, fromE164, localNumberError, toE164, toIndianMobile } from "@/lib/phone";
import PhoneField from "@/components/auth/PhoneField";
import OtpChallenge from "@/components/auth/OtpChallenge";

type Company = Tables<"companies">;

interface CompanyEditDialogProps {
  company: Company;
  children?: React.ReactNode;
  externalOpen?: boolean;
  onExternalOpenChange?: (open: boolean) => void;
}

/**
 * Every column below is nullable in the database.
 *
 * A null reaching `value=` turns a controlled input uncontrolled — React warns
 * and the field stops tracking state — and the same null reaching `.trim()` on
 * save throws. Both are avoided by coercing once, here.
 */
const formFromCompany = (company: Company) => {
  // Stored numbers are E.164. The form edits them as a country plus a local
  // part, because that is the only shape in which "exactly ten digits" is a
  // question that can be answered — see src/lib/phone.ts.
  const main = fromE164(company.phone);
  const c1 = fromE164(company.contact_phone_1);
  const c2 = fromE164(company.contact_phone_2);

  return {
    name: asText(company.name),
    phone: main.local,
    phone_country: main.country.code,
    email: asText(company.email),
    address: asText(company.address),
    gst_number: asText(company.gst_number),
    theme_primary: asText(company.theme_primary) || "25 95% 53%",
    theme_accent: asText(company.theme_accent) || "25 95% 95%",
    contact_name_1: asText(company.contact_name_1),
    contact_phone_1: c1.local,
    contact_country_1: c1.country.code,
    contact_name_2: asText(company.contact_name_2),
    contact_phone_2: c2.local,
    contact_country_2: c2.country.code,
    google_maps_url: asText(company.google_maps_url),
    upi_id: asText(company.upi_id),
  };
};

/** An untouched contact field is empty, so "nothing given" is simply "". */
const normalisePhone = (local: string, countryCode: string): string | null =>
  asText(local).trim() ? toE164(local, findCountry(countryCode)) : null;

const CompanyEditDialog = ({ company, children, externalOpen, onExternalOpenChange }: CompanyEditDialogProps) => {
  const queryClient = useQueryClient();
  const [internalOpen, setInternalOpen] = useState(false);
  /** Set while the new WhatsApp number is being proved by OTP. */
  const [verifying, setVerifying] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  // Determine if we're in externally controlled mode
  const isExternallyControlled = externalOpen !== undefined;
  const open = isExternallyControlled ? externalOpen : internalOpen;
  const setOpen = isExternallyControlled
    ? (v: boolean) => onExternalOpenChange?.(v)
    : setInternalOpen;

  const [form, setForm] = useState(() => formFromCompany(company));
  const [qrFile, setQrFile] = useState<File | null>(null);
  const [qrPreview, setQrPreview] = useState<string | null>(asText(company.upi_qr_url) || null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(asText(company.logo_url) || null);

  // Sync form when dialog opens
  useEffect(() => {
    if (open) {
      setForm(formFromCompany(company));
      setLogoPreview(asText(company.logo_url) || null);
      setLogoFile(null);
      setQrPreview(asText(company.upi_qr_url) || null);
      setQrFile(null);
    }
  }, [open, company]);

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setLogoFile(file);
      // The previous preview was an object URL owned by this component.
      setLogoPreview((previous) => {
        if (previous?.startsWith("blob:")) URL.revokeObjectURL(previous);
        return URL.createObjectURL(file);
      });
    }
  };

  const handleQrSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setQrFile(file);
      setQrPreview((previous) => {
        if (previous?.startsWith("blob:")) URL.revokeObjectURL(previous);
        return URL.createObjectURL(file);
      });
    }
  };

  const updateMutation = useMutation({
    mutationFn: async () => {
      let logoUrl = company.logo_url;
      if (logoFile) {
        const ext = (logoFile.name.split(".").pop() || "").trim() || "png";
        const path = `logos/${company.owner_id}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("product-images")
          .upload(path, logoFile, { upsert: true });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(path);
        logoUrl = urlData.publicUrl;
      }

      let qrUrl = company.upi_qr_url;
      if (qrFile) {
        const ext = (qrFile.name.split(".").pop() || "").trim() || "png";
        const path = `qr/${company.owner_id}.${ext}`;
        const { error: qrUploadError } = await supabase.storage
          .from("product-images")
          .upload(path, qrFile, { upsert: true });
        if (qrUploadError) throw qrUploadError;
        const { data: qrUrlData } = supabase.storage.from("product-images").getPublicUrl(path);
        qrUrl = qrUrlData.publicUrl;
      } else if (!qrPreview) {
        qrUrl = null;
      }

      const { error } = await supabase
        .from("companies")
        .update({
          name: form.name.trim(),
          phone: toE164(form.phone, findCountry(form.phone_country)),
          email: form.email.trim(),
          address: form.address.trim() || null,
          gst_number: form.gst_number.trim() || null,
          logo_url: logoUrl,
          theme_primary: form.theme_primary,
          theme_accent: form.theme_accent,
          contact_name_1: form.contact_name_1.trim() || null,
          contact_phone_1: normalisePhone(form.contact_phone_1, form.contact_country_1),
          contact_name_2: form.contact_name_2.trim() || null,
          contact_phone_2: normalisePhone(form.contact_phone_2, form.contact_country_2),
          google_maps_url: form.google_maps_url.trim() || null,
          upi_id: form.upi_id.trim() || null,
          upi_qr_url: qrUrl,
        })
        .eq("id", company.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["current-company"] });
      toast.success("Company details updated!");
      setOpen(false);
      setLogoFile(null);
      setQrFile(null);
    },
    onError: (err: any) => toast.error(err?.message || "Couldn't save your company details. Please try again."),
  });

  /**
   * Save, but prove the WhatsApp number first if it has changed.
   *
   * Re-verifying on change is the half people forget: verifying at signup and
   * then letting the number be edited freely means the verified flag says
   * nothing about the number actually stored. Every message the platform sends
   * — receipts, reminders, the reset code — goes to whatever is in this field,
   * so pointing it somewhere unproven is pointing the account's recovery there.
   *
   * Only the number itself is gated. Everything else on this form saves the
   * moment the code is accepted, in one mutation, so a merchant editing their
   * address and their number together does not lose the address.
   */
  const handleSubmit = async () => {
    const country = findCountry(form.phone_country);
    const error = localNumberError(form.phone, country);
    if (error) {
      setPhoneError(error);
      return;
    }
    setPhoneError(null);

    const config = await loadAuthConfig();
    const changed = toE164(form.phone, country) !== asText(company.phone);

    // Nothing to prove: the number is untouched, verification is off, or it is
    // not a number a code can reach anyway (only Indian numbers can today).
    if (!changed || !config.whatsappVerificationEnabled || country.code !== INDIA.code) {
      updateMutation.mutate();
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    const security = await fetchSecurityState(user?.id);
    if (security?.phoneVerified === true && security.phone === toIndianMobile(form.phone)) {
      // Already verified on this account — re-proving it would be theatre.
      updateMutation.mutate();
      return;
    }

    setVerifying(true);
  };

  if (verifying) {
    return (
      <Dialog open={open} onOpenChange={(next) => { if (!next) setVerifying(false); setOpen(next); }}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md p-4 sm:p-6">
          <DialogHeader className="text-left">
            <DialogTitle>Confirm your new number</DialogTitle>
            <DialogDescription>
              Your other changes are saved as soon as this number is confirmed.
            </DialogDescription>
          </DialogHeader>
          <OtpChallenge
            purpose="change_number"
            phone={toE164(form.phone, findCountry(form.phone_country))}
            onVerified={() => {
              setVerifying(false);
              updateMutation.mutate();
            }}
            onCancel={() => setVerifying(false)}
            cancelLabel="Go back and edit"
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && (
        <DialogTrigger asChild>
          {children}
        </DialogTrigger>
      )}
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md max-h-[85dvh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="text-left">
          <DialogTitle>Edit Company Details</DialogTitle>
          <DialogDescription>
            These details appear on your store page, your estimates and your receipts.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="company-name">Company Name *</Label>
            <Input id="company-name" className="h-11" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <PhoneField
            id="company-phone"
            label="WhatsApp Number"
            required
            countryCode={form.phone_country}
            onCountryChange={(code) => { setForm({ ...form, phone_country: code }); setPhoneError(null); }}
            value={form.phone}
            onValueChange={(local) => { setForm({ ...form, phone: local }); setPhoneError(null); }}
            error={phoneError}
            hint={
              authConfig().whatsappVerificationEnabled
                ? "Changing this asks for a code on the new number."
                : undefined
            }
          />
          <div className="space-y-2">
            <Label htmlFor="company-email">Email *</Label>
            <Input id="company-email" className="h-11 break-anywhere" type="email" inputMode="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="company-address">Address</Label>
            <Input id="company-address" className="h-11" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="company-gst">GST Number</Label>
            <Input id="company-gst" className="h-11" value={form.gst_number} onChange={(e) => setForm({ ...form, gst_number: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Company Logo</Label>
            <div className="flex flex-wrap items-center gap-3">
              {logoPreview && (
                <img
                  src={logoPreview}
                  alt="Current company logo"
                  loading="lazy"
                  onError={() => setLogoPreview(null)}
                  className="h-12 w-12 shrink-0 rounded-lg border border-border object-contain bg-muted"
                />
              )}
              <label className="flex h-11 cursor-pointer items-center gap-2 rounded-md border border-input px-4 text-sm hover:bg-accent">
                <Upload className="h-4 w-4" />
                {logoFile ? "Change Logo" : "Upload Logo"}
                <input type="file" accept="image/*" onChange={handleLogoSelect} className="hidden" />
              </label>
            </div>
          </div>
          <ColorThemePicker
            selectedPrimary={form.theme_primary}
            onSelect={(primary, accent) => setForm({ ...form, theme_primary: primary, theme_accent: accent })}
          />
          <div className="border-t pt-4 mt-2">
            <h3 className="font-semibold text-sm mb-3">About / Contact Page</h3>
            {/* Two columns only once there is room: at 360px each field was
                barely wide enough for a name. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="contact-name-1">Contact Name 1</Label>
                <Input id="contact-name-1" className="h-11" value={form.contact_name_1} onChange={(e) => setForm({ ...form, contact_name_1: e.target.value })} placeholder="e.g. John Doe" />
              </div>
              <div className="space-y-2">
                <PhoneField
                  id="contact-phone-1"
                  label="Contact Phone 1"
                  countryCode={form.contact_country_1}
                  onCountryChange={(code) => setForm({ ...form, contact_country_1: code })}
                  value={form.contact_phone_1}
                  onValueChange={(local) => setForm({ ...form, contact_phone_1: local })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact-name-2">Contact Name 2</Label>
                <Input id="contact-name-2" className="h-11" value={form.contact_name_2} onChange={(e) => setForm({ ...form, contact_name_2: e.target.value })} placeholder="e.g. Jane Doe" />
              </div>
              <div className="space-y-2">
                <PhoneField
                  id="contact-phone-2"
                  label="Contact Phone 2"
                  countryCode={form.contact_country_2}
                  onCountryChange={(code) => setForm({ ...form, contact_country_2: code })}
                  value={form.contact_phone_2}
                  onValueChange={(local) => setForm({ ...form, contact_phone_2: local })}
                />
              </div>
            </div>
            <div className="space-y-2 mt-3">
              <Label htmlFor="company-maps">Google Maps Link</Label>
              <Input id="company-maps" className="h-11 break-anywhere" type="url" inputMode="url" value={form.google_maps_url} onChange={(e) => setForm({ ...form, google_maps_url: e.target.value })} placeholder="Paste your Google Maps share link" />
            </div>
            <div className="space-y-2 mt-3">
              <Label htmlFor="company-upi">UPI ID <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input id="company-upi" className="h-11 break-anywhere" value={form.upi_id} onChange={(e) => setForm({ ...form, upi_id: e.target.value })} placeholder="e.g. yourname@upi" />
            </div>
            <div className="space-y-2 mt-3">
              <Label>UPI QR Code <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <div className="flex flex-wrap items-center gap-3">
                {qrPreview && (
                  <img
                    src={qrPreview}
                    alt="Current UPI QR code"
                    loading="lazy"
                    onError={() => setQrPreview(null)}
                    className="h-16 w-16 shrink-0 rounded-lg border border-border object-contain bg-muted"
                  />
                )}
                <label className="flex h-11 cursor-pointer items-center gap-2 rounded-md border border-input px-4 text-sm hover:bg-accent">
                  <QrCode className="h-4 w-4" />
                  {qrFile || qrPreview ? "Change QR" : "Upload QR"}
                  <input type="file" accept="image/*" onChange={handleQrSelect} className="hidden" />
                </label>
                {(qrPreview || qrFile) && (
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="h-11 w-11 shrink-0"
                    onClick={() => {
                      if (qrPreview?.startsWith("blob:")) URL.revokeObjectURL(qrPreview);
                      setQrPreview(null);
                      setQrFile(null);
                    }}
                    title="Remove QR Code"
                    aria-label="Remove QR code"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
          <Button type="submit" className="h-11 w-full" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CompanyEditDialog;
