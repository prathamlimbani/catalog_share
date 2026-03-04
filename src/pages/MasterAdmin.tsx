import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { LogOut, Store, Phone, Mail, MapPin, FileText, ExternalLink, Trash2, MessageSquare, Star, ClipboardList, BarChart3, Download, Crown } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { exportMasterDataToExcel } from "@/lib/exportUtils";
import { downloadInvoice } from "@/pages/Billing";
import { getPlanName } from "@/components/SubscriptionDialog";

const MasterAdmin = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [activeTab, setActiveTab] = useState<"companies" | "suggestions" | "surveys" | "analytics" | "subscriptions">("companies");
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | "all">("all");

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

  const { data: analyticsEvents, isLoading: analyticsLoading } = useQuery({
    queryKey: ["all-analytics", selectedCompanyId],
    queryFn: async () => {
      let query = supabase
        .from("analytics_events")
        .select("*, companies(name)")
        .order("created_at", { ascending: true }); // Important for time series

      if (selectedCompanyId !== "all") {
        query = query.eq("company_id", selectedCompanyId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const generatePDF = async (companyName: string) => {
    try {
      toast.info("Generating Report PDF...");
      // @ts-ignore - html2pdf is dynamically loaded or available globally
      const html2pdf = (await import('html2pdf.js')).default;
      const element = document.getElementById('analytics-report-content');

      const opt = {
        margin: 0.5,
        filename: `${companyName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_analytics_report.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'landscape' }
      };

      await html2pdf().set(opt).from(element).save();
      toast.success("PDF Downloaded successfully!");
    } catch (e) {
      console.error(e);
      toast.error("Failed to generate PDF");
    }
  };

  // Group events by day for charts
  const getChartData = () => {
    if (!analyticsEvents) return [];

    // Group by Date -> Event Type Count
    const groups: Record<string, any> = {};

    analyticsEvents.forEach((event: any) => {
      const date = new Date(event.created_at).toLocaleDateString();
      if (!groups[date]) {
        groups[date] = { date, page_view: 0, product_click: 0, whatsapp_click: 0 };
      }
      groups[date][event.event_type] = (groups[date][event.event_type] || 0) + 1;
    });

    return Object.values(groups).sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());
  };

  const chartData = getChartData();

  // Aggregate stats
  const aggregateStats = {
    views: analyticsEvents?.filter((e: any) => e.event_type === "page_view").length || 0,
    clicks: analyticsEvents?.filter((e: any) => e.event_type === "product_click").length || 0,
    whatsapp: analyticsEvents?.filter((e: any) => e.event_type === "whatsapp_click").length || 0,
  };

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
    { key: "analytics" as const, label: "Analytics", icon: BarChart3, count: 0 },
    { key: "subscriptions" as const, label: "Subscriptions", icon: Crown, count: companies?.length || 0 },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-bold">Master Admin Panel</h1>
          <p className="text-muted-foreground">Manage companies, suggestions & surveys</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200"
            onClick={async () => {
              try {
                toast.loading("Gathering platform data...", { id: "master-export-toast" });
                await exportMasterDataToExcel();
                toast.success("Master Excel file downloaded successfully!", { id: "master-export-toast" });
              } catch (err) {
                toast.error("Failed to export master data.", { id: "master-export-toast" });
              }
            }}
          >
            <Download className="h-4 w-4 mr-2" /> Export All Data
          </Button>
          <ThemeToggle />
          <Button variant="outline" onClick={handleLogout}>
            <LogOut className="h-4 w-4 mr-2" /> Logout
          </Button>
        </div>
      </div>

      {/* Responsive Tabs Navigation */}
      <div className="mb-6">
        {/* Mobile Dropdown (visible only on small screens) */}
        <div className="block sm:hidden">
          <Select
            value={activeTab}
            onValueChange={(value: any) => setActiveTab(value)}
          >
            <SelectTrigger className="w-full bg-card">
              <SelectValue>
                {tabs.find(t => t.key === activeTab)?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {tabs.map((tab) => (
                <SelectItem key={tab.key} value={tab.key}>
                  <div className="flex items-center gap-2">
                    <tab.icon className="h-4 w-4" />
                    <span>{tab.label}</span>
                    {tab.count > 0 && (
                      <Badge variant="secondary" className="ml-2 text-xs">
                        {tab.count}
                      </Badge>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Desktop Tabs (visible only on sm screens and up) */}
        <div className="hidden sm:flex gap-1 p-1 bg-muted/50 rounded-xl w-fit">
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

      {/* Analytics Tab */}
      {activeTab === "analytics" && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <h2 className="text-xl font-bold">Performance Analytics</h2>

            <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
                <SelectTrigger className="w-full sm:w-[250px]">
                  <SelectValue placeholder="Select a company" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Companies (Aggregate)</SelectItem>
                  {companies?.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {selectedCompanyId !== "all" && (
                <Button
                  onClick={() => generatePDF(companies?.find(c => c.id === selectedCompanyId)?.name || "Company")}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  <Download className="mr-2 h-4 w-4" /> Export PDF
                </Button>
              )}
            </div>
          </div>

          {analyticsLoading ? (
            <div className="py-20 text-center text-muted-foreground w-full">Loading analytics data...</div>
          ) : (
            <div id="analytics-report-content" className="space-y-6 bg-background rounded-xl">
              {/* Header for PDF (mostly hidden in web view, shows in print/PDF) */}
              <div className="hidden print:block mb-8 text-center border-b pb-6">
                <h1 className="text-3xl font-bold mb-2">
                  {selectedCompanyId === "all" ? "Aggregate System Analytics" : `${companies?.find(c => c.id === selectedCompanyId)?.name} - Performance Report`}
                </h1>
                <p className="text-muted-foreground">Generated on {new Date().toLocaleDateString()}</p>
              </div>

              {/* Stats Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center">
                        <BarChart3 className="h-6 w-6 text-blue-500" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Total Views</p>
                        <h3 className="text-3xl font-bold">{aggregateStats.views}</h3>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-indigo-500/10 flex items-center justify-center">
                        <Store className="h-6 w-6 text-indigo-500" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">Product Clicks</p>
                        <h3 className="text-3xl font-bold">{aggregateStats.clicks}</h3>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center border-green-500/20 border">
                        <MessageSquare className="h-6 w-6 text-green-600" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-muted-foreground text-green-700/80 dark:text-green-400">WhatsApp Orders</p>
                        <h3 className="text-3xl font-bold text-green-700 dark:text-green-400">{aggregateStats.whatsapp}</h3>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Charts */}
              {chartData.length > 0 ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-12">
                  <Card>
                    <CardHeader className="p-6 pb-2">
                      <h3 className="font-bold text-lg">Engagement over Time (Line)</h3>
                    </CardHeader>
                    <CardContent className="p-6 pt-0">
                      <div className="h-[300px] w-full mt-4">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                            <XAxis dataKey="date" fontSize={12} tickMargin={10} />
                            <YAxis fontSize={12} />
                            <RechartsTooltip
                              contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: 'none', borderRadius: '8px', color: '#fff' }}
                            />
                            <Legend />
                            <Line type="monotone" dataKey="page_view" name="Store Views" stroke="#3b82f6" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                            <Line type="monotone" dataKey="product_click" name="Product Clicks" stroke="#8b5cf6" strokeWidth={3} dot={{ r: 4 }} />
                            <Line type="monotone" dataKey="whatsapp_click" name="WhatsApp Hits" stroke="#10b981" strokeWidth={3} dot={{ r: 4 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="p-6 pb-2">
                      <h3 className="font-bold text-lg">Event Breakdown (Bar)</h3>
                    </CardHeader>
                    <CardContent className="p-6 pt-0">
                      <div className="h-[300px] w-full mt-4">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                            <XAxis dataKey="date" fontSize={12} tickMargin={10} />
                            <YAxis fontSize={12} />
                            <RechartsTooltip
                              cursor={{ fill: 'rgba(0,0,0,0.05)' }}
                              contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: 'none', borderRadius: '8px', color: '#fff' }}
                            />
                            <Legend />
                            <Bar dataKey="page_view" name="Store Views" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="product_click" name="Product Clicks" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="whatsapp_click" name="WhatsApp Hits" fill="#10b981" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              ) : (
                <div className="py-20 text-center border rounded-xl bg-card border-dashed">
                  <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-20 text-muted-foreground" />
                  <p className="text-muted-foreground font-medium">No analytics data available yet.</p>
                  <p className="text-sm text-muted-foreground mt-1">Events will appear here as users interact with the stores.</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Subscriptions Tab */}
      {activeTab === "subscriptions" && (
        <>
          {isLoading ? (
            <p className="text-muted-foreground">Loading subscription data...</p>
          ) : companies && companies.length > 0 ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4 mb-6">
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-sm text-muted-foreground">Free</p>
                    <p className="text-2xl font-bold">{companies.filter((c: any) => !c.subscription_plan || c.subscription_plan === 'free').length}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-sm text-blue-500 font-medium">Growth</p>
                    <p className="text-2xl font-bold text-blue-500">{companies.filter((c: any) => c.subscription_plan === 'growth').length}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-sm text-purple-500 font-medium">Pro</p>
                    <p className="text-2xl font-bold text-purple-500">{companies.filter((c: any) => c.subscription_plan === 'pro').length}</p>
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-3">
                {companies.map((company: any) => {
                  const plan = company.subscription_plan || 'free';
                  const expiresAt = company.subscription_expires_at;
                  const isExpired = expiresAt && new Date(expiresAt) < new Date();

                  return (
                    <Card key={company.id}>
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <div className="flex items-center gap-3 min-w-0">
                            {company.logo_url ? (
                              <img src={company.logo_url} alt={company.name} className="w-10 h-10 rounded-lg object-cover shrink-0" />
                            ) : (
                              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                                <Store className="h-4 w-4 text-primary" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <h3 className="font-bold text-sm truncate">{company.name}</h3>
                              <p className="text-xs text-muted-foreground">{company.email}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <Badge
                              className={`text-xs font-bold ${plan === 'pro'
                                ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                                : plan === 'growth'
                                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                                  : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                                }`}
                            >
                              {plan.toUpperCase()}
                            </Badge>
                            {expiresAt && plan !== 'free' && (
                              <span className={`text-xs ${isExpired ? 'text-red-500 font-bold' : 'text-muted-foreground'}`}>
                                {isExpired ? 'EXPIRED' : `Expires ${new Date(expiresAt).toLocaleDateString()}`}
                              </span>
                            )}
                            {plan !== 'free' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-xs text-destructive hover:text-destructive hover:bg-destructive/10 h-7 px-2"
                                onClick={async () => {
                                  if (!confirm(`Reset ${company.name} to Free plan?`)) return;
                                  try {
                                    const { error } = await supabase.rpc("admin_reset_subscription", { target_company_id: company.id });
                                    if (error) throw error;
                                    queryClient.invalidateQueries({ queryKey: ["all-companies"] });
                                    toast.success(`${company.name} reset to Free plan`);
                                  } catch (err: any) {
                                    toast.error(err.message || "Failed to reset subscription");
                                  }
                                }}
                              >
                                <Trash2 className="h-3 w-3 mr-1" /> Reset
                              </Button>
                            )}
                            {plan !== 'free' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-xs text-primary hover:text-primary hover:bg-primary/10 h-7 px-2"
                                onClick={async () => {
                                  try {
                                    const { data, error } = await (supabase as any)
                                      .from("subscriptions")
                                      .select("*")
                                      .eq("company_id", company.id)
                                      .order("created_at", { ascending: false })
                                      .limit(1);
                                    if (error) throw error;
                                    if (!data || data.length === 0) {
                                      toast.error("No payment found for this company.");
                                      return;
                                    }
                                    downloadInvoice(data[0], company);
                                  } catch (err: any) {
                                    toast.error(err.message);
                                  }
                                }}
                              >
                                <Download className="h-3 w-3 mr-1" /> Invoice
                              </Button>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-center py-20 text-muted-foreground">
              <Crown className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No companies registered yet.</p>
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
