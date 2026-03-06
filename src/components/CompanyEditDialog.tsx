import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Settings, Upload, QrCode } from "lucide-react";
import { Tables } from "@/integrations/supabase/types";
import ColorThemePicker from "@/components/ColorThemePicker";

type Company = Tables<"companies">;

const CompanyEditDialog = ({ company }: { company: Company }) => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: company.name,
    phone: company.phone,
    email: company.email,
    address: company.address || "",
    gst_number: company.gst_number || "",
    theme_primary: company.theme_primary || "25 95% 53%",
    theme_accent: company.theme_accent || "25 95% 95%",
    contact_name_1: company.contact_name_1 || "",
    contact_phone_1: company.contact_phone_1 || "+91",
    contact_name_2: company.contact_name_2 || "",
    contact_phone_2: company.contact_phone_2 || "+91",
    google_maps_url: company.google_maps_url || "",
    upi_id: company.upi_id || "",
  });
  const [qrFile, setQrFile] = useState<File | null>(null);
  const [qrPreview, setQrPreview] = useState<string | null>(company.upi_qr_url || null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(company.logo_url);

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setLogoFile(file);
      setLogoPreview(URL.createObjectURL(file));
    }
  };

  const handleQrSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setQrFile(file);
      setQrPreview(URL.createObjectURL(file));
    }
  };

  const updateMutation = useMutation({
    mutationFn: async () => {
      let logoUrl = company.logo_url;
      if (logoFile) {
        const ext = logoFile.name.split(".").pop();
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
        const ext = qrFile.name.split(".").pop();
        const path = `qr/${company.owner_id}.${ext}`;
        const { error: qrUploadError } = await supabase.storage
          .from("product-images")
          .upload(path, qrFile, { upsert: true });
        if (qrUploadError) throw qrUploadError;
        const { data: qrUrlData } = supabase.storage.from("product-images").getPublicUrl(path);
        qrUrl = qrUrlData.publicUrl;
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
          contact_phone_1: form.contact_phone_1.replace(/\s+/g, '') === '+91' ? null : form.contact_phone_1.replace(/\s+/g, '') || null,
          contact_name_2: form.contact_name_2.trim() || null,
          contact_phone_2: form.contact_phone_2.replace(/\s+/g, '') === '+91' ? null : form.contact_phone_2.replace(/\s+/g, '') || null,
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
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => {
      setOpen(v);
      if (v) {
        setForm({
          name: company.name,
          phone: company.phone,
          email: company.email,
          address: company.address || "",
          gst_number: company.gst_number || "",
          theme_primary: company.theme_primary || "25 95% 53%",
          theme_accent: company.theme_accent || "25 95% 95%",
          contact_name_1: company.contact_name_1 || "",
          contact_phone_1: company.contact_phone_1 || "+91",
          contact_name_2: company.contact_name_2 || "",
          contact_phone_2: company.contact_phone_2 || "+91",
          google_maps_url: company.google_maps_url || "",
          upi_id: company.upi_id || "",
        });
        setLogoPreview(company.logo_url);
        setLogoFile(null);
        setQrPreview(company.upi_qr_url || null);
        setQrFile(null);
      }
    }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings className="h-4 w-4 mr-2" /> Edit Company
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Company Details</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => { e.preventDefault(); updateMutation.mutate(); }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label>Company Name *</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="space-y-2">
            <Label>WhatsApp Number *</Label>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required />
          </div>
          <div className="space-y-2">
            <Label>Email *</Label>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </div>
          <div className="space-y-2">
            <Label>Address</Label>
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>GST Number</Label>
            <Input value={form.gst_number} onChange={(e) => setForm({ ...form, gst_number: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Company Logo</Label>
            <div className="flex items-center gap-3">
              {logoPreview && (
                <img src={logoPreview} alt="Logo" className="w-12 h-12 rounded-lg object-cover" />
              )}
              <label className="flex items-center gap-2 px-4 py-2 border border-input rounded-md cursor-pointer hover:bg-accent text-sm">
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Contact Name 1</Label>
                <Input value={form.contact_name_1} onChange={(e) => setForm({ ...form, contact_name_1: e.target.value })} placeholder="e.g. John Doe" />
              </div>
              <div className="space-y-2">
                <Label>Contact Phone 1</Label>
                <Input value={form.contact_phone_1} onChange={(e) => setForm({ ...form, contact_phone_1: e.target.value })} placeholder="e.g. +9198765..." />
              </div>
              <div className="space-y-2">
                <Label>Contact Name 2</Label>
                <Input value={form.contact_name_2} onChange={(e) => setForm({ ...form, contact_name_2: e.target.value })} placeholder="e.g. Jane Doe" />
              </div>
              <div className="space-y-2">
                <Label>Contact Phone 2</Label>
                <Input value={form.contact_phone_2} onChange={(e) => setForm({ ...form, contact_phone_2: e.target.value })} placeholder="e.g. +9198765..." />
              </div>
            </div>
            <div className="space-y-2 mt-3">
              <Label>Google Maps Link</Label>
              <Input value={form.google_maps_url} onChange={(e) => setForm({ ...form, google_maps_url: e.target.value })} placeholder="Paste your Google Maps share link" />
            </div>
            <div className="space-y-2 mt-3">
              <Label>UPI ID <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input value={form.upi_id} onChange={(e) => setForm({ ...form, upi_id: e.target.value })} placeholder="e.g. yourname@upi" />
            </div>
            <div className="space-y-2 mt-3">
              <Label>UPI QR Code <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <div className="flex items-center gap-3">
                {qrPreview && (
                  <img src={qrPreview} alt="QR Code" className="w-16 h-16 rounded-lg object-contain border" />
                )}
                <label className="flex items-center gap-2 px-4 py-2 border border-input rounded-md cursor-pointer hover:bg-accent text-sm">
                  <QrCode className="h-4 w-4" />
                  {qrFile ? "Change QR" : "Upload QR"}
                  <input type="file" accept="image/*" onChange={handleQrSelect} className="hidden" />
                </label>
              </div>
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CompanyEditDialog;
