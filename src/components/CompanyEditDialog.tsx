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

type Company = Tables<"companies">;

interface CompanyEditDialogProps {
  company: Company;
  children?: React.ReactNode;
  externalOpen?: boolean;
  onExternalOpenChange?: (open: boolean) => void;
}

/** The default a blank contact phone starts from, and the value that counts as "empty". */
const PHONE_PREFIX = "+91";

/**
 * Every column below is nullable in the database.
 *
 * A null reaching `value=` turns a controlled input uncontrolled — React warns
 * and the field stops tracking state — and the same null reaching `.trim()` on
 * save throws. Both are avoided by coercing once, here.
 */
const formFromCompany = (company: Company) => ({
  name: asText(company.name),
  phone: asText(company.phone),
  email: asText(company.email),
  address: asText(company.address),
  gst_number: asText(company.gst_number),
  theme_primary: asText(company.theme_primary) || "25 95% 53%",
  theme_accent: asText(company.theme_accent) || "25 95% 95%",
  contact_name_1: asText(company.contact_name_1),
  contact_phone_1: asText(company.contact_phone_1) || PHONE_PREFIX,
  contact_name_2: asText(company.contact_name_2),
  contact_phone_2: asText(company.contact_phone_2) || PHONE_PREFIX,
  google_maps_url: asText(company.google_maps_url),
  upi_id: asText(company.upi_id),
});

/** Strips spaces, and treats a bare dialling code as "no number given". */
const normalisePhone = (value: string): string | null => {
  const digits = asText(value).replace(/\s+/g, "");
  return digits === PHONE_PREFIX || digits === "" ? null : digits;
};

const CompanyEditDialog = ({ company, children, externalOpen, onExternalOpenChange }: CompanyEditDialogProps) => {
  const queryClient = useQueryClient();
  const [internalOpen, setInternalOpen] = useState(false);

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
          phone: form.phone.replace(/\s+/g, ''),
          email: form.email.trim(),
          address: form.address.trim() || null,
          gst_number: form.gst_number.trim() || null,
          logo_url: logoUrl,
          theme_primary: form.theme_primary,
          theme_accent: form.theme_accent,
          contact_name_1: form.contact_name_1.trim() || null,
          contact_phone_1: normalisePhone(form.contact_phone_1),
          contact_name_2: form.contact_name_2.trim() || null,
          contact_phone_2: normalisePhone(form.contact_phone_2),
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
          onSubmit={(e) => { e.preventDefault(); updateMutation.mutate(); }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="company-name">Company Name *</Label>
            <Input id="company-name" className="h-11" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="company-phone">WhatsApp Number *</Label>
            <Input id="company-phone" className="h-11" type="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required />
          </div>
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
                <Label htmlFor="contact-phone-1">Contact Phone 1</Label>
                <Input id="contact-phone-1" className="h-11" type="tel" inputMode="tel" value={form.contact_phone_1} onChange={(e) => setForm({ ...form, contact_phone_1: e.target.value })} placeholder="e.g. +9198765..." />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact-name-2">Contact Name 2</Label>
                <Input id="contact-name-2" className="h-11" value={form.contact_name_2} onChange={(e) => setForm({ ...form, contact_name_2: e.target.value })} placeholder="e.g. Jane Doe" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact-phone-2">Contact Phone 2</Label>
                <Input id="contact-phone-2" className="h-11" type="tel" inputMode="tel" value={form.contact_phone_2} onChange={(e) => setForm({ ...form, contact_phone_2: e.target.value })} placeholder="e.g. +9198765..." />
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
