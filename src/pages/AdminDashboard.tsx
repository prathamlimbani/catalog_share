import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2, LogOut, Package, Edit, X, Upload, Pencil, Check } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tables } from "@/integrations/supabase/types";

type Product = Tables<"products">;

const AdminDashboard = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [newCategory, setNewCategory] = useState("");
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [renamingCategory, setRenamingCategory] = useState<string | null>(null);
  const [renameCategoryValue, setRenameCategoryValue] = useState("");

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
    const checkAdmin = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate("/admin"); return; }
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin");
      if (!roles || roles.length === 0) { navigate("/admin"); }
    };
    checkAdmin();
  }, [navigate]);

  const { data: products, isLoading } = useQuery({
    queryKey: ["admin-products"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Get existing categories for the selector
  const existingCategories = Array.from(
    new Set(products?.map((p) => p.category).filter(Boolean) as string[])
  ).sort();

  const saveMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const allImages = [...data.images];
      const featuresList = data.features ? data.features.split(",").map((f) => f.trim()).filter(Boolean) : [];
      // Build feature_sizes JSONB: convert comma-separated size strings to arrays
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
        price: parseFloat(data.price) || 0,
        category: data.category.trim() || null,
        is_trending: data.is_trending,
        in_stock: data.in_stock,
        image_url: allImages[0] || data.image_url.trim() || null,
        images: allImages,
        feature_sizes: featuresList.length > 0 ? featureSizesJson : {},
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
      queryClient.invalidateQueries({ queryKey: ["admin-products"] });
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
      queryClient.invalidateQueries({ queryKey: ["admin-products"] });
      toast.success("Product deleted!");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const renameCategoryMutation = useMutation({
    mutationFn: async ({ oldName, newName }: { oldName: string; newName: string }) => {
      const { error } = await supabase
        .from("products")
        .update({ category: newName })
        .eq("category", oldName);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-products"] });
      toast.success("Category renamed!");
      setRenamingCategory(null);
      setRenameCategoryValue("");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const removeCategoryMutation = useMutation({
    mutationFn: async (categoryName: string) => {
      const { error } = await supabase
        .from("products")
        .update({ category: null })
        .eq("category", categoryName);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-products"] });
      toast.success("Category removed from all products!");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const toggleStockMutation = useMutation({
    mutationFn: async ({ id, in_stock }: { id: string; in_stock: boolean }) => {
      const { error } = await supabase.from("products").update({ in_stock }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-products"] });
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
    // Convert feature_sizes from {feat: ["S","M"]} to {feat: "S, M"} for form
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
      const path = `${Date.now()}-${i}.${ext}`;
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
      return {
        ...prev,
        images: newImages,
        image_url: prev.image_url === url ? (newImages[0] || "") : prev.image_url,
      };
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

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Admin Dashboard</h1>
          <p className="text-muted-foreground">Manage your products</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" /> Add Product</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editing ? "Edit Product" : "Add New Product"}</DialogTitle>
              </DialogHeader>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
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
                  <Label>Sizes (comma-separated)</Label>
                  <Input value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} placeholder="e.g. S, M, L, XL or 250g, 500g, 1kg" />
                </div>

                {/* Category selector */}
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select
                    value={showNewCategory ? "__new__" : (form.category || undefined)}
                    onValueChange={handleCategorySelect}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent className="bg-card z-50">
                      {existingCategories.map((cat) => (
                        <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                      ))}
                      <SelectItem value="__new__">+ Add New Category</SelectItem>
                    </SelectContent>
                  </Select>
                  {showNewCategory && (
                    <Input
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                      placeholder="Enter new category name"
                      autoFocus
                    />
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Options / Variants (comma-separated, e.g. colors, textures)</Label>
                  <Input value={form.features} onChange={(e) => setForm({ ...form, features: e.target.value })} placeholder="Red, Blue, Green or Glossy, Matte" />
                </div>

                {/* Per-feature size inputs */}
                {(() => {
                  const featuresList = form.features ? form.features.split(",").map((f) => f.trim()).filter(Boolean) : [];
                  if (featuresList.length === 0) return null;
                  return (
                    <div className="space-y-2 border rounded-lg p-3 bg-muted/30">
                      <Label className="text-sm font-medium">Sizes per Variant</Label>
                      <p className="text-xs text-muted-foreground">Enter available sizes for each variant (comma-separated)</p>
                      {featuresList.map((feat) => (
                        <div key={feat} className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-xs min-w-[60px] justify-center">{feat}</Badge>
                          <Input
                            value={form.feature_sizes[feat] || ""}
                            onChange={(e) => setForm({
                              ...form,
                              feature_sizes: { ...form.feature_sizes, [feat]: e.target.value }
                            })}
                            placeholder={`Sizes for ${feat}, e.g. S, M, L`}
                            className="h-8 text-xs"
                          />
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Multi-image upload */}
                <div className="space-y-2">
                  <Label>Product Images</Label>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 px-4 py-2 border border-input rounded-md cursor-pointer hover:bg-accent text-sm">
                      <Upload className="h-4 w-4" />
                      Upload Images
                      <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
                    </label>
                  </div>
                  {form.images.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {form.images.map((url, i) => (
                        <div key={i} className="relative group">
                          <img src={url} alt={`Product ${i + 1}`} className="w-16 h-16 rounded-lg object-cover" />
                          <button
                            type="button"
                            onClick={() => removeImage(url)}
                            className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                          >
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
          <Button variant="outline" onClick={handleLogout}>
            <LogOut className="h-4 w-4 mr-2" /> Logout
          </Button>
        </div>
      </div>

      {/* Category Management */}
      {existingCategories.length > 0 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-3">Categories</h2>
          <div className="flex flex-wrap gap-2">
            {existingCategories.map((cat) => (
              <div key={cat} className="flex items-center gap-1 border rounded-lg px-3 py-1.5 bg-card">
                {renamingCategory === cat ? (
                  <form
                    className="flex items-center gap-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (renameCategoryValue.trim() && renameCategoryValue.trim() !== cat) {
                        renameCategoryMutation.mutate({ oldName: cat, newName: renameCategoryValue.trim() });
                      } else {
                        setRenamingCategory(null);
                      }
                    }}
                  >
                    <Input
                      value={renameCategoryValue}
                      onChange={(e) => setRenameCategoryValue(e.target.value)}
                      className="h-6 text-xs w-24 px-1"
                      autoFocus
                    />
                    <Button type="submit" size="icon" variant="ghost" className="h-6 w-6">
                      <Check className="h-3 w-3" />
                    </Button>
                    <Button type="button" size="icon" variant="ghost" className="h-6 w-6" onClick={() => setRenamingCategory(null)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </form>
                ) : (
                  <>
                    <span className="text-sm">{cat}</span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={() => { setRenamingCategory(cat); setRenameCategoryValue(cat); }}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-destructive"
                      onClick={() => {
                        if (confirm(`Remove category "${cat}" from all products?`)) {
                          removeCategoryMutation.mutate(cat);
                        }
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-muted-foreground">Loading products...</p>
      ) : products && products.length > 0 ? (
        <div className="grid gap-3">
          {products.map((p) => (
            <Card key={p.id} className={!p.in_stock ? "opacity-60" : ""}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-14 h-14 rounded-lg overflow-hidden bg-muted flex-shrink-0">
                  {p.image_url ? (
                    <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center"><Package className="h-6 w-6 opacity-20" /></div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold truncate">{p.name}</h3>
                    {p.is_trending && <Badge className="bg-primary text-primary-foreground text-xs">Trending</Badge>}
                    {!p.in_stock && <Badge variant="destructive" className="text-xs">Out of Stock</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">{p.category || "No category"} · {p.size || "No size"} · {(p.images?.length || 0)} photos</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <Switch
                      checked={p.in_stock}
                      onCheckedChange={(v) => toggleStockMutation.mutate({ id: p.id, in_stock: v })}
                    />
                    <span className="text-xs text-muted-foreground hidden sm:inline">
                      {p.in_stock ? "In Stock" : "Out"}
                    </span>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => startEdit(p)}>
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="text-destructive" onClick={() => deleteMutation.mutate(p.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center py-20 text-muted-foreground">
          <Package className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>No products yet. Click "Add Product" to get started.</p>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
