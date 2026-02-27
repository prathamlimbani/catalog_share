import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentCompany } from "@/hooks/useCompany";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { Plus, Trash2, Package, Edit, X, Upload, Pencil, Check, Link as LinkIcon, Copy, ExternalLink, Store, Filter, SlidersHorizontal, ArrowUpDown } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tables } from "@/integrations/supabase/types";
import { AdminLayout } from "@/components/AdminLayout";
import { exportDataToExcel } from "@/lib/exportUtils";

type Product = Tables<"products">;

const AdminDashboard = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: company, isLoading: companyLoading } = useCurrentCompany();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [newCategory, setNewCategory] = useState("");
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [renamingCategory, setRenamingCategory] = useState<string | null>(null);
  const [renameCategoryValue, setRenameCategoryValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // New States for Sorting & Filtering
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<string>("newest"); // newest, oldest, a-z, z-a
  const [stockFilter, setStockFilter] = useState<string>("all"); // all, in-stock, out-of-stock

  const [form, setForm] = useState({
    name: "",
    description: "",
    size: "",
    features: "",
    price: "",
    category: "",
    is_trending: false,
    in_stock: true,
    image_url: "",
    images: [] as string[],
    feature_sizes: {} as Record<string, string>,
  });

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate("/login"); return; }
    };
    checkAuth();
  }, [navigate]);

  const storeUrl = company ? `https://catalogshare.online/store/${company.slug}` : "";

  const copyLink = () => {
    navigator.clipboard.writeText(storeUrl);
    toast.success("Store link copied to clipboard!");
  };

  const { data: products, isLoading } = useQuery({
    queryKey: ["admin-products", company?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("company_id", company!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!company,
  });

  const existingCategories = Array.from(
    new Set(products?.map((p) => p.category).filter(Boolean) as string[])
  ).sort();

  const filteredProducts = useMemo(() => {
    if (!products) return [];
    let result = products;

    // Filter by Category Pill
    if (selectedCategory) {
      result = result.filter(p => p.category === selectedCategory);
    }

    // Filter by Stock Status
    if (stockFilter === "in-stock") {
      result = result.filter(p => p.in_stock);
    } else if (stockFilter === "out-of-stock") {
      result = result.filter(p => !p.in_stock);
    }

    // Filter by Search text
    if (searchQuery.trim()) {
      const lowerQuery = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(lowerQuery) ||
          (p.category && p.category.toLowerCase().includes(lowerQuery)) ||
          (p.description && p.description.toLowerCase().includes(lowerQuery))
      );
    }

    // Sort products
    result = [...result].sort((a, b) => {
      if (sortOrder === "newest") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (sortOrder === "oldest") return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (sortOrder === "a-z") return a.name.localeCompare(b.name);
      if (sortOrder === "z-a") return b.name.localeCompare(a.name);
      return 0;
    });

    return result;
  }, [products, searchQuery, selectedCategory, sortOrder, stockFilter]);

  const saveMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const allImages = [...data.images];
      const featuresList = data.features ? data.features.split(",").map((f) => f.trim()).filter(Boolean) : [];
      const featureSizesJson: Record<string, string[]> = {};
      featuresList.forEach((f) => {
        const sizesStr = data.feature_sizes[f] || "";
        featureSizesJson[f] = sizesStr.split(",").map((s) => s.trim()).filter(Boolean);
      });
      const payload = {
        name: data.name.trim(),
        description: data.description.trim() || null,
        size: data.size.trim() || null,
        features: featuresList.length > 0 ? featuresList : null,
        price: data.price ? parseFloat(data.price) : 0,
        category: data.category.trim() || null,
        is_trending: data.is_trending,
        in_stock: data.in_stock,
        image_url: allImages[0] || data.image_url.trim() || null,
        images: allImages,
        feature_sizes: featuresList.length > 0 ? featureSizesJson : {},
        company_id: company!.id,
      };
      if (editing) {
        const { error } = await supabase.from("products").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("products").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-products", company?.id] });
      toast.success(editing ? "Product updated!" : "Product added!");
      resetForm();
      setDialogOpen(false);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-products", company?.id] });
      toast.success("Product deleted!");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const renameCategoryMutation = useMutation({
    mutationFn: async ({ oldName, newName }: { oldName: string; newName: string }) => {
      const { error } = await supabase.from("products").update({ category: newName }).eq("category", oldName).eq("company_id", company!.id);
      if (error) throw error;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin-products", company?.id] });
      toast.success("Category renamed!");
      setRenamingCategory(null);
      setRenameCategoryValue("");
      if (selectedCategory === variables.oldName) setSelectedCategory(variables.newName);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const removeCategoryMutation = useMutation({
    mutationFn: async (categoryName: string) => {
      const { error } = await supabase.from("products").update({ category: null }).eq("category", categoryName).eq("company_id", company!.id);
      if (error) throw error;
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["admin-products", company?.id] });
      toast.success("Category removed from all products!");
      if (selectedCategory === variables) setSelectedCategory(null);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const toggleStockMutation = useMutation({
    mutationFn: async ({ id, in_stock }: { id: string; in_stock: boolean }) => {
      const { error } = await supabase.from("products").update({ in_stock }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-products", company?.id] });
      toast.success("Stock status updated");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const resetForm = () => {
    setForm({ name: "", description: "", size: "", features: "", price: "", category: "", is_trending: false, in_stock: true, image_url: "", images: [], feature_sizes: {} });
    setEditing(null);
    setShowNewCategory(false);
    setNewCategory("");
  };

  const startEdit = (p: Product) => {
    setEditing(p);
    const fsRaw = (p as any).feature_sizes as Record<string, string[]> | null;
    const fsForm: Record<string, string> = {};
    if (fsRaw) {
      Object.entries(fsRaw).forEach(([k, v]) => {
        fsForm[k] = Array.isArray(v) ? v.join(", ") : "";
      });
    }
    setForm({
      name: p.name,
      description: p.description || "",
      size: p.size || "",
      features: p.features?.join(", ") || "",
      price: String(p.price),
      category: p.category || "",
      is_trending: p.is_trending,
      in_stock: p.in_stock,
      image_url: p.image_url || "",
      images: p.images || [],
      feature_sizes: fsForm,
    });
    setDialogOpen(true);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const uploadedUrls: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = file.name.split(".").pop();
      const path = `${company?.id}/${Date.now()}-${i}.${ext}`;
      const { error } = await supabase.storage.from("product-images").upload(path, file);
      if (error) { toast.error(`Upload failed for ${file.name}`); continue; }
      const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(path);
      uploadedUrls.push(urlData.publicUrl);
    }
    if (uploadedUrls.length > 0) {
      setForm((prev) => ({
        ...prev,
        images: [...prev.images, ...uploadedUrls],
        image_url: prev.image_url || uploadedUrls[0],
      }));
      toast.success(`${uploadedUrls.length} image(s) uploaded!`);
    }
  };

  const removeImage = (url: string) => {
    setForm((prev) => {
      const newImages = prev.images.filter((img) => img !== url);
      return { ...prev, images: newImages, image_url: prev.image_url === url ? (newImages[0] || "") : prev.image_url };
    });
  };

  const handleCategorySelect = (value: string) => {
    if (value === "__new__") {
      setShowNewCategory(true);
      setForm({ ...form, category: "" });
    } else {
      setShowNewCategory(false);
      setNewCategory("");
      setForm({ ...form, category: value });
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  if (companyLoading) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-muted-foreground">Loading dashboard...</p></div>;
  }

  if (!company) {
    return (
      <div className="min-h-screen flex items-center justify-center text-center px-4">
        <div>
          <Store className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-30" />
          <h1 className="text-2xl font-bold mb-2">No Company Found</h1>
          <p className="text-muted-foreground mb-6">You haven't set up your company yet.</p>
          <Button onClick={() => navigate("/register")}>Set Up Company</Button>
        </div>
      </div>
    );
  }

  return (
    <AdminLayout
      company={company}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      onLogout={handleLogout}
    >
      <div className="max-w-5xl mx-auto space-y-8">

        {/* Shareable Link & Quick Actions */}
        <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center">
          <Card className="flex-1 bg-secondary/30 border-0 shadow-sm relative overflow-hidden">
            <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="p-3 bg-primary/10 rounded-xl shrink-0">
                <LinkIcon className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-muted-foreground uppercase tracking-wider font-semibold mb-1">Your Store Link</p>
                <p className="text-sm font-medium truncate bg-background/50 px-3 py-1.5 rounded-md border border-border/50">{storeUrl}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button size="sm" variant="outline" className="bg-background" onClick={copyLink}>
                  <Copy className="h-4 w-4 mr-1.5" /> Copy
                </Button>
                <Button size="sm" variant="outline" className="bg-background" asChild>
                  <a href={storeUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-1.5" /> Open
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col sm:flex-row gap-2 shrink-0">
            {/* The old Product Adding dialog */}
            <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
              <DialogTrigger asChild>
                <Button className="h-full py-4 px-6 bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm w-full sm:w-auto font-medium text-base rounded-xl transition-all">
                  <Plus className="h-5 w-5 mr-2" /> Add Product
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{editing ? "Edit Product" : "Add New Product"}</DialogTitle>
                </DialogHeader>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!form.name.trim()) return toast.error("Product name is required.");
                    const finalForm = showNewCategory ? { ...form, category: newCategory } : form;
                    saveMutation.mutate(finalForm);
                  }}
                  className="space-y-4"
                >
                  <div className="space-y-2">
                    <Label>Name *</Label>
                    <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                  </div>
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Price (optional)</Label>
                    <Input type="number" step="0.01" min="0" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="Leave empty if not applicable" />
                  </div>

                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select value={showNewCategory ? "__new__" : (form.category || undefined)} onValueChange={handleCategorySelect}>
                      <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                      <SelectContent className="bg-card z-50">
                        {existingCategories.map((cat) => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}
                        <SelectItem value="__new__">+ Add New Category</SelectItem>
                      </SelectContent>
                    </Select>
                    {showNewCategory && <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="Enter new category name" autoFocus />}
                  </div>

                  <div className="space-y-2">
                    <Label>Options / Variants (comma-separated)</Label>
                    <Input value={form.features} onChange={(e) => setForm({ ...form, features: e.target.value })} placeholder="Red, Blue, Green" />
                  </div>

                  {(() => {
                    const featuresList = typeof form.features === "string" ? form.features.split(",").map((f) => f.trim()).filter(Boolean) : (form.features as string[]);
                    if (featuresList.length === 0) return null;
                    return (
                      <div className="space-y-2 border rounded-lg p-3 bg-muted/30">
                        <Label className="text-sm font-medium">Sizes per Variant</Label>
                        <p className="text-xs text-muted-foreground">Enter available sizes for each variant</p>
                        {featuresList.map((feat) => (
                          <div key={feat} className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-xs min-w-[60px] justify-center">{feat}</Badge>
                            <Input
                              value={form.feature_sizes[feat] || ""}
                              onChange={(e) => setForm({ ...form, feature_sizes: { ...form.feature_sizes, [feat]: e.target.value } })}
                              placeholder={`Sizes for ${feat}`}
                              className="h-8 text-xs"
                            />
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  <div className="space-y-2">
                    <Label>Product Images</Label>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-2 px-4 py-2 border border-input rounded-md cursor-pointer hover:bg-accent text-sm">
                        <Upload className="h-4 w-4" /> Upload Images
                        <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
                      </label>
                    </div>
                    {form.images.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {form.images.map((url, i) => (
                          <div key={i} className="relative group">
                            <img src={url} alt={`Product ${i + 1}`} className="w-16 h-16 rounded-lg object-cover" />
                            <button type="button" onClick={() => removeImage(url)} className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-3">
                      <Switch checked={form.is_trending} onCheckedChange={(v) => setForm({ ...form, is_trending: v })} />
                      <Label>Trending</Label>
                    </div>
                    <div className="flex items-center gap-3">
                      <Switch checked={form.in_stock} onCheckedChange={(v) => setForm({ ...form, in_stock: v })} />
                      <Label>In Stock</Label>
                    </div>
                  </div>

                  <Button type="submit" className="w-full" disabled={saveMutation.isPending}>
                    {saveMutation.isPending ? "Saving..." : editing ? "Update Product" : "Add Product"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
            {/* End of Reverted Add Product Dialog */}
          </div>
        </div>

        {/* Category Management */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Categories</h2>
          </div>
          <div className="flex overflow-x-auto pb-2 gap-2.5 scrollbar-hide snap-x">
            <Button
              variant={selectedCategory === null ? "default" : "outline"}
              size="sm"
              className={`rounded-full h-auto px-4 py-1.5 transition-all text-sm font-medium whitespace-nowrap shrink-0 snap-start ${selectedCategory === null ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-background hover:bg-muted'}`}
              onClick={() => setSelectedCategory(null)}
            >
              All Products
            </Button>
            {existingCategories.map((cat) => (
              <div
                key={cat}
                className={`group flex items-center gap-1.5 border rounded-full px-4 py-1.5 shadow-sm hover:shadow-md transition-all cursor-pointer whitespace-nowrap shrink-0 snap-start ${selectedCategory === cat ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border/60"
                  }`}
                onClick={() => setSelectedCategory(cat === selectedCategory ? null : cat)}
              >
                {renamingCategory === cat ? (
                  <form className="flex items-center gap-1.5" onSubmit={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (renameCategoryValue.trim() && renameCategoryValue.trim() !== cat) {
                      renameCategoryMutation.mutate({ oldName: cat, newName: renameCategoryValue.trim() });
                    } else { setRenamingCategory(null); }
                  }}>
                    <Input autoFocus value={renameCategoryValue} onChange={(e) => setRenameCategoryValue(e.target.value)} onClick={(e) => e.stopPropagation()} className={`h-7 text-sm w-32 px-2 py-0 focus-visible:ring-1 ${selectedCategory === cat ? "text-foreground bg-background border-foreground" : "border-primary"}`} />
                    <Button type="submit" size="icon" variant="ghost" className="h-6 w-6"><Check className="h-3.5 w-3.5" /></Button>
                    <Button type="button" size="icon" variant="ghost" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); setRenamingCategory(null); }}><X className="h-3.5 w-3.5" /></Button>
                  </form>
                ) : (
                  <>
                    <span className="text-sm font-medium tracking-wide">{cat}</span>
                    <div className="opacity-0 group-hover:opacity-100 flex items-center transition-opacity ml-1">
                      <Button size="icon" variant="ghost" className={`h-6 w-6 p-0 ${selectedCategory === cat ? 'text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary-foreground/20' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`} onClick={(e) => { e.stopPropagation(); setRenamingCategory(cat); setRenameCategoryValue(cat); }}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button size="icon" variant="ghost" className={`h-6 w-6 p-0 ${selectedCategory === cat ? 'text-primary-foreground/80 hover:text-primary-foreground hover:bg-red-500' : 'text-destructive/70 hover:text-destructive hover:bg-destructive/10'}`} onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Remove category "${cat}"?`)) removeCategoryMutation.mutate(cat);
                      }}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Products List section */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Products ({filteredProducts.length})</h2>
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2 h-9 text-muted-foreground">
                    <ArrowUpDown className="h-4 w-4" />
                    <span className="hidden sm:inline">Sort: {
                      sortOrder === "newest" ? "New to Old" :
                        sortOrder === "oldest" ? "Old to New" :
                          sortOrder === "a-z" ? "A to Z" : "Z to A"
                    }</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40 bg-card z-50">
                  <DropdownMenuLabel>Sort By</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setSortOrder("newest")} className={sortOrder === "newest" ? "bg-muted" : ""}>New to Old</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSortOrder("oldest")} className={sortOrder === "oldest" ? "bg-muted" : ""}>Old to New</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSortOrder("a-z")} className={sortOrder === "a-z" ? "bg-muted" : ""}>A to Z</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSortOrder("z-a")} className={sortOrder === "z-a" ? "bg-muted" : ""}>Z to A</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2 h-9 text-muted-foreground">
                    <Filter className="h-4 w-4" />
                    <span className="hidden sm:inline">Filter: {
                      stockFilter === "all" ? "All" :
                        stockFilter === "in-stock" ? "In Stock" : "Out of Stock"
                    }</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40 bg-card z-50">
                  <DropdownMenuLabel>Stock</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setStockFilter("all")} className={stockFilter === "all" ? "bg-muted" : ""}>All</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setStockFilter("in-stock")} className={stockFilter === "in-stock" ? "bg-muted" : ""}>In Stock</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setStockFilter("out-of-stock")} className={stockFilter === "out-of-stock" ? "bg-muted" : ""}>Out of Stock</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {isLoading ? (
            <div className="flex flex-col gap-3 py-8 items-center justify-center text-muted-foreground">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-2" />
              <p>Loading products...</p>
            </div>
          ) : filteredProducts && filteredProducts.length > 0 ? (
            <div className="grid gap-4">
              {filteredProducts.map((p) => (
                <Card key={p.id} className={`overflow-hidden border-border transition-all hover:shadow-md bg-card ${!p.in_stock ? "opacity-60 grayscale-[0.2]" : ""}`}>
                  <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4 w-full">
                    <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0 w-full">
                      <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl overflow-hidden bg-muted flex-shrink-0 border shadow-sm">
                        {p.image_url ? (
                          <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center"><Package className="h-8 w-8 text-muted-foreground/30" /></div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col justify-center">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h3 className="font-bold text-base sm:text-lg truncate tracking-tight">{p.name}</h3>
                          {p.is_trending && <Badge className="bg-primary hover:bg-primary text-primary-foreground text-[10px] uppercase font-bold tracking-wider px-2 py-0.5">Trending</Badge>}
                        </div>
                        <div className="flex items-center text-sm text-muted-foreground flex-wrap gap-x-2 gap-y-1 font-medium">
                          {p.category ? <Badge variant="secondary" className="bg-secondary/50 font-semibold">{p.category}</Badge> : <span className="italic text-muted-foreground/50">No Category</span>}
                          <span className="text-muted-foreground/40">•</span>
                          <span>{p.size || "No size"}</span>
                          <span className="text-muted-foreground/40">•</span>
                          <span>{(p.images?.length || 0)} photo{p.images?.length !== 1 && 's'}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 sm:gap-6 justify-between sm:justify-end mt-2 sm:mt-0 pt-3 sm:pt-0 border-t sm:border-0 border-border/50 w-full sm:w-auto shrink-0">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={p.in_stock}
                          onCheckedChange={(v) => toggleStockMutation.mutate({ id: p.id, in_stock: v })}
                          className="data-[state=checked]:bg-primary"
                        />
                        <span className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">{p.in_stock ? "In Stock" : "Out"}</span>
                      </div>
                      <div className="flex items-center gap-1 bg-secondary/50 p-1 rounded-lg">
                        <Button size="icon" variant="ghost" className="h-8 w-8 hover:bg-background shadow-sm hover:text-foreground text-muted-foreground transition-colors" onClick={() => startEdit(p)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 hover:bg-destructive/10 text-destructive/70 hover:text-destructive transition-colors" onClick={() => { if (confirm("Are you sure you want to delete this product?")) deleteMutation.mutate(p.id); }}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-center py-20 bg-secondary/20 rounded-2xl border border-dashed border-border mt-4">
              <Package className="h-12 w-12 mx-auto mb-4 text-muted-foreground/30" />
              <h3 className="text-lg font-bold mb-1">No products found</h3>
              <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
                {searchQuery || selectedCategory || stockFilter !== 'all' ? "Try adjusting your filters or search query." : "You haven't added any products yet. Click the Add Product button to get started."}
              </p>
              {!searchQuery && !selectedCategory && stockFilter === 'all' && (
                <Button onClick={() => setDialogOpen(true)} className="bg-primary hover:bg-primary/90">
                  <Plus className="h-4 w-4 mr-2" /> Add Your First Product
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
};

export default AdminDashboard;
