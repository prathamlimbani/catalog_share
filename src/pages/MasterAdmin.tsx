import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { LogOut, Store, Phone, Mail, MapPin, FileText, ExternalLink, Trash2 } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";

const MasterAdmin = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    const checkAdmin = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate("/master-login"); return; }
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin");
      if (!roles || roles.length === 0) {
        toast.error("Access denied. Master admin privileges required.");
        navigate("/");
      }
    };
    checkAdmin();
  }, [navigate]);

  const { data: companies, isLoading } = useQuery({
    queryKey: ["all-companies"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (companyId: string) => {
      // Delete products first, then company
      const { error: prodErr } = await supabase.from("products").delete().eq("company_id", companyId);
      if (prodErr) throw prodErr;
      const { error } = await supabase.from("companies").delete().eq("id", companyId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-companies"] });
      toast.success("Company and all its products deleted.");
      setDeleteTarget(null);
      setConfirmText("");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Master Admin Panel</h1>
          <p className="text-muted-foreground">All registered companies</p>
        </div>
        <div className="flex gap-2">
          <ThemeToggle />
          <Button variant="outline" onClick={handleLogout}>
            <LogOut className="h-4 w-4 mr-2" /> Logout
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading companies...</p>
      ) : companies && companies.length > 0 ? (
        <div className="grid gap-4">
          {companies.map((company) => (
            <Card key={company.id}>
              <CardContent className="p-5">
                <div className="flex items-start gap-4">
                  {company.logo_url ? (
                    <img src={company.logo_url} alt={company.name} className="w-14 h-14 rounded-lg object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-14 h-14 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Store className="h-6 w-6 text-primary" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="font-bold text-lg">{company.name}</h3>
                      <Badge variant="outline" className="text-xs">{company.slug}</Badge>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-2 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Phone className="h-3.5 w-3.5" />
                        <span>{company.phone}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Mail className="h-3.5 w-3.5" />
                        <span>{company.email}</span>
                      </div>
                      {company.address && (
                        <div className="flex items-center gap-2">
                          <MapPin className="h-3.5 w-3.5" />
                          <span>{company.address}</span>
                        </div>
                      )}
                      {company.gst_number && (
                        <div className="flex items-center gap-2">
                          <FileText className="h-3.5 w-3.5" />
                          <span>GST: {company.gst_number}</span>
                        </div>
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <a
                        href={`/store/${company.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                      >
                        <ExternalLink className="h-3 w-3" /> View Store
                      </a>
                      <button
                        onClick={() => setDeleteTarget({ id: company.id, name: company.name })}
                        className="text-xs text-destructive hover:underline inline-flex items-center gap-1"
                      >
                        <Trash2 className="h-3 w-3" /> Delete
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Registered: {new Date(company.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center py-20 text-muted-foreground">
          <Store className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>No companies registered yet.</p>
        </div>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setConfirmText(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Company</DialogTitle>
            <DialogDescription>
              This will permanently delete <strong>{deleteTarget?.name}</strong> and all its products. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Type <strong className="text-foreground">DELETE</strong> to confirm:
            </p>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type DELETE"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteTarget(null); setConfirmText(""); }}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={confirmText !== "DELETE" || deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete Company"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MasterAdmin;
