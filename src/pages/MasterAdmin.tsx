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
import { LogOut, Store, Phone, Mail, MapPin, FileText, ExternalLink, Trash2, MessageSquare, Star, ClipboardList } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";

const MasterAdmin = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [activeTab, setActiveTab] = useState<"companies" | "suggestions" | "surveys">("companies");

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

  const { data: suggestions, isLoading: suggestionsLoading } = useQuery({
    queryKey: ["all-suggestions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suggestions")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: surveys, isLoading: surveysLoading } = useQuery({
    queryKey: ["all-surveys"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("surveys")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (companyId: string) => {
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

  const deleteSuggestionMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("suggestions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-suggestions"] });
      toast.success("Suggestion deleted.");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteSurveyMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("surveys").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-surveys"] });
      toast.success("Survey deleted.");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  const tabs = [
    { key: "companies" as const, label: "Companies", icon: Store, count: companies?.length || 0 },
    { key: "suggestions" as const, label: "Suggestions", icon: MessageSquare, count: suggestions?.length || 0 },
    { key: "surveys" as const, label: "Surveys", icon: ClipboardList, count: surveys?.length || 0 },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Master Admin Panel</h1>
          <p className="text-muted-foreground">Manage companies, suggestions & surveys</p>
        </div>
        <div className="flex gap-2">
          <ThemeToggle />
          <Button variant="outline" onClick={handleLogout}>
            <LogOut className="h-4 w-4 mr-2" /> Logout
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 p-1 bg-muted/50 rounded-xl w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === tab.key
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
              }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
            {tab.count > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === tab.key ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Companies Tab */}
      {activeTab === "companies" && (
        <>
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
        </>
      )}

      {/* Suggestions Tab */}
      {activeTab === "suggestions" && (
        <>
          {suggestionsLoading ? (
            <p className="text-muted-foreground">Loading suggestions...</p>
          ) : suggestions && suggestions.length > 0 ? (
            <div className="grid gap-3">
              {suggestions.map((s) => (
                <Card key={s.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <MessageSquare className="h-4 w-4 text-primary flex-shrink-0" />
                          <h3 className="font-semibold text-sm">{s.name}</h3>
                        </div>
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{s.message}</p>
                        <p className="text-xs text-muted-foreground mt-2">
                          {new Date(s.created_at).toLocaleDateString()} at {new Date(s.created_at).toLocaleTimeString()}
                        </p>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive flex-shrink-0"
                        onClick={() => deleteSuggestionMutation.mutate(s.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-center py-20 text-muted-foreground">
              <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No suggestions received yet.</p>
            </div>
          )}
        </>
      )}

      {/* Surveys Tab */}
      {activeTab === "surveys" && (
        <>
          {surveysLoading ? (
            <p className="text-muted-foreground">Loading surveys...</p>
          ) : surveys && surveys.length > 0 ? (
            <div className="grid gap-3">
              {surveys.map((s) => (
                <Card key={s.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h3 className="font-semibold text-sm">{s.name}</h3>
                          <Badge variant="outline" className="text-xs capitalize">{s.role}</Badge>
                          {s.store_slug && (
                            <Badge variant="secondary" className="text-xs">{s.store_slug}</Badge>
                          )}
                        </div>
                        <div className="flex gap-0.5 my-1">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <Star
                              key={star}
                              className={`h-4 w-4 ${star <= s.rating ? "text-yellow-500 fill-yellow-500" : "text-muted-foreground/20"
                                }`}
                            />
                          ))}
                          <span className="text-xs text-muted-foreground ml-1">{s.rating}/5</span>
                        </div>
                        {s.suggestion && (
                          <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{s.suggestion}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-2">
                          {new Date(s.created_at).toLocaleDateString()} at {new Date(s.created_at).toLocaleTimeString()}
                        </p>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive flex-shrink-0"
                        onClick={() => deleteSurveyMutation.mutate(s.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-center py-20 text-muted-foreground">
              <ClipboardList className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No survey responses yet.</p>
            </div>
          )}
        </>
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
