import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Settings, Upload } from "lucide-react";
import { Tables } from "@/integrations/supabase/types";

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
  });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(company.logo_url);

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setLogoFile(file);
      setLogoPreview(URL.createObjectURL(file));
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

      const { error } = await supabase
        .from("companies")
        .update({
          name: form.name.trim(),
          phone: form.phone.trim(),
          email: form.email.trim(),
          address: form.address.trim() || null,
          gst_number: form.gst_number.trim() || null,
          logo_url: logoUrl,
        })
        .eq("id", company.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["current-company"] });
      toast.success("Company details updated!");
      setOpen(false);
      setLogoFile(null);
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
        });
        setLogoPreview(company.logo_url);
        setLogoFile(null);
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
          <Button type="submit" className="w-full" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CompanyEditDialog;
