import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { beginUserSignOut } from "@/native/bootstrap";
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
import { Plus, Trash2, Package, Edit, X, Upload, Pencil, Check, Link as LinkIcon, Copy, ExternalLink, Store, Filter, SlidersHorizontal, ArrowUpDown, Crown, Coins } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tables } from "@/integrations/supabase/types";
import { AdminLayout } from "@/components/AdminLayout";
import { exportDataToExcel } from "@/lib/exportUtils";
import { AnalyticsDialog } from "@/components/AnalyticsDialog";
import { SubscriptionDialog } from "@/components/SubscriptionDialog";
import ProductImage from "@/components/ProductImage";
import { useEntitlement } from "@/hooks/useEntitlement";
import { getPlanName } from "@/lib/plans";
import { storeUrl as buildStoreUrl } from "@/lib/appInfo";
import {
  asNumber,
  asText,
  formatDate,
  parseFeatureSizes,
  productFeatures,
  productImages,
  productName,
  SIZE_PRICES_KEY,
  splitList,
  textList,
  timestampOf,
} from "@/lib/productData";

type Product = Tables<"products">;

/** Marks the error thrown when a create is refused by the plan's product cap. */
const PRODUCT_LIMIT_ERROR = "product_limit";

/** Photos a row actually has: `images` can hold nulls, and the cover may not be in it. */
const photoCount = (product: Product): number => productImages(product).length;

const AdminDashboard = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: company, isLoading: companyLoading } = useCurrentCompany();
  const { entitlement } = useEntitlement();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [limitPromptOpen, setLimitPromptOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [newCategory, setNewCategory] = useState("");
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [renamingCategory, setRenamingCategory] = useState<string | null>(null);
  const [renameCategoryValue, setRenameCategoryValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // New States for Sorting & Filtering
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<string>("newest"); // newest, oldest, a-z, z-a
  const [sizePrices, setSizePrices] = useState<{size: string, price: number}[]>([]);
  const [stockFilter, setStockFilter] = useState<string>("all"); // all, in-stock, out-of-stock
  const [uploading, setUploading] = useState(false);

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
    allow_custom_quantity: false,
    quantity_unit: "",
  });

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate("/login"); return; }
    };
    checkAuth();
  }, [navigate]);

  // A company row saved before slugs were mandatory has no store address yet.
  const storeSlug = asText(company?.slug).trim();
  const storeUrl = storeSlug ? buildStoreUrl(encodeURIComponent(storeSlug)) : "";

  const copyLink = async () => {
    // The clipboard API rejects outright in a WebView served over plain http,
    // which used to fail silently and look like a dead button.
    try {
      await navigator.clipboard.writeText(storeUrl);
      toast.success("Store link copied to clipboard!");
    } catch {
      toast.error("Couldn't copy the link. Long-press it to copy manually.");
    }
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

  // Values are kept exactly as stored, not trimmed: rename and remove match the
  // category by equality against the database.
  const existingCategories = useMemo(
    () => Array.from(new Set((products ?? []).map((p) => asText(p.category)).filter((c) => c.trim() !== ""))).sort(),
    [products]
  );

  const filteredProducts = useMemo(() => {
    if (!products) return [];
    let result = products;

    // Filter by Category Pill
    if (selectedCategory) {
      result = result.filter(p => asText(p.category) === selectedCategory);
    }

    // Filter by Stock Status
    if (stockFilter === "in-stock") {
      result = result.filter(p => p.in_stock);
    } else if (stockFilter === "out-of-stock") {
      result = result.filter(p => !p.in_stock);
    }

    // Filter by Search text. Every column read here is nullable on rows that
    // predate the constraints, so none of them is touched directly.
    if (searchQuery.trim()) {
      const lowerQuery = searchQuery.trim().toLowerCase();
      result = result.filter((p) =>
        [p.name, p.category, p.description].some((field) => asText(field).toLowerCase().includes(lowerQuery))
      );
    }

    // Sort products
    result = [...result].sort((a, b) => {
      if (sortOrder === "newest") return timestampOf(b.created_at) - timestampOf(a.created_at);
      if (sortOrder === "oldest") return timestampOf(a.created_at) - timestampOf(b.created_at);
      if (sortOrder === "a-z") return asText(a.name).localeCompare(asText(b.name));
      if (sortOrder === "z-a") return asText(b.name).localeCompare(asText(a.name));
      return 0;
    });

    return result;
  }, [products, searchQuery, selectedCategory, sortOrder, stockFilter]);

  /**
   * The product cap.
   *
   * It lives here and nowhere else. It used to be enforced by refusing to open
   * the Radix dialog, which the empty-state "Add Your First Product" button
   * bypassed entirely — a free account could walk straight past the 40-product
   * limit. The limit itself comes from the entitlement engine, not from a local
   * `plan === "pro"` guess, so an expired subscription is capped correctly.
   */
  const productCount = products?.length || 0;
  const productLimit = entitlement.productLimit;
  const atProductLimit = productCount >= productLimit;
  const planLabel = entitlement.isPaid ? entitlement.planName : getPlanName("free");
  /**
   * Slots bought with points are named separately from the plan's own.
   *
   * "the Free Plan limit of 45 products" is a sentence a merchant cannot check
   * against anything — the plan says 40 — and it reads as a bug in the number
   * they are being held to.
   */
  const bonusSlots = entitlement.bonusProductLimit;
  const limitMessage = bonusSlots > 0
    ? `You've reached your limit of ${productLimit} products (${productLimit - bonusSlots} on ${planLabel}, plus ${bonusSlots} you redeemed).`
    : `You've reached the ${planLabel} limit of ${productLimit} products. Upgrade to add more.`;

  const sortLabel = sortOrder === "newest" ? "New to Old"
    : sortOrder === "oldest" ? "Old to New"
      : sortOrder === "a-z" ? "A to Z" : "Z to A";
  const stockLabel = stockFilter === "in-stock" ? "In Stock"
    : stockFilter === "out-of-stock" ? "Out of Stock" : "All";
  /** Whether the empty list is "no catalogue" or "nothing matched" — different copy. */
  const isFiltered = !!searchQuery.trim() || !!selectedCategory || stockFilter !== "all";

  /** The single entry point for creating a product — every button routes through it. */
  const requestAddProduct = () => {
    if (atProductLimit) {
      setLimitPromptOpen(true);
      toast.error(limitMessage);
      return;
    }
    resetForm();
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      // Re-checked at write time: the cap must hold even if the dialog was
      // already open when the last slot was used up on another device.
      if (!editing && productCount >= productLimit) {
        throw Object.assign(new Error(limitMessage), { code: PRODUCT_LIMIT_ERROR });
      }

      const allImages = textList(data.images);
      const featuresList = splitList(data.features);
      const featureSizesJson: Record<string, any> = {};
      featuresList.forEach((f) => {
        featureSizesJson[f] = splitList(data.feature_sizes[f]);
      });
      // Written back through the same validation the reader applies, so a bad
      // row can never be saved a second time.
      const cleanSizePrices = sizePrices
        .map((sp) => ({ size: asText(sp.size).trim(), price: asNumber(sp.price) }))
        .filter((sp) => sp.size !== "");
      if (cleanSizePrices.length > 0) {
        featureSizesJson[SIZE_PRICES_KEY] = cleanSizePrices;
      }
      const payload = {
        name: asText(data.name).trim(),
        description: asText(data.description).trim() || null,
        size: asText(data.size).trim() || null,
        features: featuresList.length > 0 ? featuresList : null,
        price: data.price ? asNumber(data.price) : 0,
        category: asText(data.category).trim() || null,
        is_trending: !!data.is_trending,
        in_stock: !!data.in_stock,
        allow_custom_quantity: !!data.allow_custom_quantity,
        quantity_unit: asText(data.quantity_unit).trim() || null,
        image_url: allImages[0] || asText(data.image_url).trim() || null,
        images: allImages,
        feature_sizes: (featuresList.length > 0 || cleanSizePrices.length > 0) ? featureSizesJson : {},
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
    onError: (err: any) => {
      if (err?.code === PRODUCT_LIMIT_ERROR) {
        setDialogOpen(false);
        setLimitPromptOpen(true);
      }
      toast.error(err.message);
    },
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
    setForm({ name: "", description: "", size: "", features: "", price: "", category: "", is_trending: false, in_stock: true, allow_custom_quantity: false, quantity_unit: "", image_url: "", images: [], feature_sizes: {} });
    setSizePrices([]);
    setEditing(null);
    setShowNewCategory(false);
    setNewCategory("");
  };

  /**
   * The one place database rows become form state.
   *
   * Every field is coerced here rather than at the input, because a null
   * reaching `value=` flips a controlled input to uncontrolled and a null
   * reaching `.trim()` on submit throws mid-render.
   */
  const startEdit = (p: Product) => {
    setEditing(p);
    const { byFeature, sizePrices: storedSizePrices } = parseFeatureSizes(p.feature_sizes);
    const fsForm: Record<string, string> = {};
    Object.entries(byFeature).forEach(([feature, featureSizes]) => {
      fsForm[feature] = featureSizes.join(", ");
    });
    setSizePrices(storedSizePrices);
    setForm({
      name: asText(p.name),
      description: asText(p.description),
      size: asText(p.size),
      features: productFeatures(p).join(", "),
      price: p.price == null ? "" : String(asNumber(p.price)),
      category: asText(p.category),
      is_trending: !!p.is_trending,
      in_stock: !!p.in_stock,
      allow_custom_quantity: !!p.allow_custom_quantity,
      quantity_unit: asText(p.quantity_unit),
      image_url: asText(p.image_url),
      images: textList(p.images),
      feature_sizes: fsForm,
    });
    setDialogOpen(true);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const files = input.files;
    if (!files || files.length === 0) return;
    const uploadedUrls: string[] = [];
    setUploading(true);

    // Compress images > 3MB
    const compressImage = async (file: File): Promise<File> => {
      if (file.size <= 3 * 1024 * 1024) return file;
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
          const img = new Image();
          img.src = event.target?.result as string;
          img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;
            if (width > 2048 || height > 2048) {
              const ratio = Math.min(2048 / width, 2048 / height);
              width *= ratio;
              height *= ratio;
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(img, 0, 0, width, height);
            canvas.toBlob((blob) => {
              if (blob) {
                resolve(new File([blob], file.name, { type: 'image/jpeg' }));
              } else {
                resolve(file); // fallback
              }
            }, 'image/jpeg', 0.8);
          };
          img.onerror = () => resolve(file);
        };
        reader.onerror = () => resolve(file);
      });
    };

    let failures = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        toast.info(`Processing image ${i + 1} of ${files.length}...`);
        const file = await compressImage(files[i]);
        // A file dropped in without an extension used to build a path ending in
        // the whole filename.
        const ext = (file.name.split(".").pop() || "").trim() || "jpg";
        const path = `${company?.id}/${Date.now()}-${i}.${ext}`;
        const { error } = await supabase.storage.from("product-images").upload(path, file);
        if (error) { failures += 1; toast.error(`Upload failed for ${file.name}: ${error.message}`); continue; }
        const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(path);
        uploadedUrls.push(urlData.publicUrl);
      }
    } finally {
      setUploading(false);
      // Without this, re-picking the same file fires no change event at all.
      input.value = "";
    }
    if (uploadedUrls.length > 0) {
      setForm((prev) => ({
        ...prev,
        images: [...prev.images, ...uploadedUrls],
        image_url: prev.image_url || uploadedUrls[0],
      }));
      toast.success(`${uploadedUrls.length} image(s) uploaded!`);
    } else if (failures > 0) {
      toast.error("No images were uploaded. Check your connection and try again.");
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
    beginUserSignOut();
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

        {/* Subscription Banner */}
        {company && (() => {
          const currentPlan = asText((company as any).subscription_plan) || "free";
          // An unlimited plan reports a huge cap; a broken one could report 0,
          // which used to make the width NaN and the bar disappear.
          const usagePercent = productLimit > 0
            ? Math.min(100, Math.round((productCount / productLimit) * 100))
            : 100;
          const isNearLimit = usagePercent >= 80;
          const isAtLimit = atProductLimit;
          const expiresOn = formatDate((company as any).subscription_expires_at);

          return (
            <Card className={`border-0 shadow-sm overflow-hidden ${isAtLimit ? "bg-destructive/5 ring-1 ring-destructive/20" : isNearLimit ? "bg-amber-500/5 ring-1 ring-amber-500/20" : "bg-gradient-to-r from-primary/5 to-primary/10"}`}>
              <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className={`p-2.5 rounded-xl shrink-0 ${isAtLimit ? 'bg-destructive/10' : 'bg-primary/10'}`}>
                    <Crown className={`h-5 w-5 ${isAtLimit ? 'text-destructive' : 'text-primary'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 mb-1">
                      <span className="font-bold text-sm">{planLabel}</span>
                      {expiresOn && currentPlan !== 'free' && (
                        <span className="text-xs text-muted-foreground">· Expires {expiresOn}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-2 bg-muted rounded-full max-w-[200px] overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${isAtLimit ? 'bg-destructive' : isNearLimit ? 'bg-amber-500' : 'bg-primary'}`}
                          style={{ width: `${usagePercent}%` }}
                        />
                      </div>
                      <span className={`text-xs font-semibold whitespace-nowrap ${isAtLimit ? 'text-destructive' : isNearLimit ? 'text-amber-500' : 'text-muted-foreground'}`}>
                        {productCount}/{productLimit >= 9999 ? '∞' : productLimit} products
                      </span>
                    </div>
                  </div>
                </div>
                {currentPlan !== 'pro' && (
                  <SubscriptionDialog
                    companyId={company.id}
                    companyName={asText(company.name)}
                    companyEmail={asText(company.email)}
                    currentPlan={currentPlan}
                  >
                    <Button className="h-11 w-full shrink-0 rounded-lg bg-gradient-to-r from-primary to-primary/70 font-bold text-primary-foreground shadow-sm hover:from-primary/90 hover:to-primary/60 sm:w-auto">
                      <Crown className="h-4 w-4 mr-1.5" /> Upgrade Plan
                    </Button>
                  </SubscriptionDialog>
                )}
              </CardContent>
            </Card>
          );
        })()}

        {/* Upgrade prompt — shown the moment a create is refused by the cap. */}
        {limitPromptOpen && (
          <Card className="border-destructive/30 bg-destructive/5 shadow-sm">
            <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="p-2.5 rounded-xl bg-destructive/10 shrink-0">
                <Crown className="h-5 w-5 text-destructive" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm mb-0.5">Product limit reached</p>
                <p className="text-sm text-muted-foreground">
                  {bonusSlots > 0
                    ? `You can list ${productLimit} products — ${productLimit - bonusSlots} on ${planLabel} plus ${bonusSlots} you redeemed — and you have ${productCount}.`
                    : `Your ${planLabel} allows ${productLimit} products and you have ${productCount}.`}{" "}
                  Upgrade, redeem more slots with your points, or delete a product to free one up.
                </p>
              </div>
              <div className="flex w-full shrink-0 flex-wrap gap-2 sm:w-auto">
                <SubscriptionDialog
                  companyId={company.id}
                  companyName={asText(company.name)}
                  companyEmail={asText(company.email)}
                  currentPlan={entitlement.plan}
                >
                  <Button className="h-11 flex-1 rounded-lg bg-gradient-to-r from-primary to-primary/70 font-bold text-primary-foreground hover:from-primary/90 hover:to-primary/60 sm:flex-none">
                    <Crown className="h-4 w-4 mr-1.5" /> Upgrade Plan
                  </Button>
                </SubscriptionDialog>
                {/* The other way out, and the cheaper one: points buy permanent
                    slots. Without this the merchant has to already know the Earn
                    screen sells them. */}
                <Button className="h-11" variant="outline" onClick={() => navigate("/earn")}>
                  <Coins className="h-4 w-4 mr-1.5" /> Use points
                </Button>
                <Button className="h-11" variant="ghost" onClick={() => setLimitPromptOpen(false)}>
                  Dismiss
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Shareable Link & Quick Actions */}
        <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center">
          <Card className="flex-1 bg-secondary/30 border-0 shadow-sm relative overflow-hidden">
            <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="p-3 bg-primary/10 rounded-xl shrink-0">
                <LinkIcon className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-muted-foreground uppercase tracking-wider font-semibold mb-1">Your Store Link</p>
                <p className="break-anywhere rounded-md border border-border/50 bg-background/50 px-3 py-1.5 text-sm font-medium">
                  {storeUrl || <span className="text-muted-foreground">Not ready yet — save your company details to get a store address.</span>}
                </p>
              </div>
              <div className="flex w-full shrink-0 gap-2 sm:w-auto">
                <Button variant="outline" className="h-11 flex-1 bg-background sm:flex-none" onClick={copyLink} disabled={!storeUrl}>
                  <Copy className="h-4 w-4 mr-1.5" /> Copy
                </Button>
                {storeUrl ? (
                  <Button variant="outline" className="h-11 flex-1 bg-background sm:flex-none" asChild>
                    <a href={storeUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4 mr-1.5" /> Open
                    </a>
                  </Button>
                ) : (
                  /* An empty href would reload the dashboard instead of opening a store. */
                  <Button variant="outline" className="h-11 flex-1 bg-background sm:flex-none" disabled>
                    <ExternalLink className="h-4 w-4 mr-1.5" /> Open
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col sm:flex-row gap-3 shrink-0">
            {/* Analytics Dialog */}
            {company?.id && <AnalyticsDialog companyId={company.id} />}

            {/* Product add/edit dialog. The button is NOT a DialogTrigger: opening
                goes through requestAddProduct so the cap cannot be side-stepped. */}
            <Button
              onClick={requestAddProduct}
              className={`h-full py-4 px-6 shadow-sm w-full sm:w-auto font-medium text-base rounded-xl transition-all ${atProductLimit ? 'bg-muted text-muted-foreground hover:bg-muted' : 'bg-primary hover:bg-primary/90 text-primary-foreground'}`}
            >
              <Plus className="h-5 w-5 mr-2" /> {atProductLimit ? 'Limit Reached' : 'Add Product'}
            </Button>

            <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
                  <DialogContent className="w-[calc(100vw-2rem)] max-w-lg max-h-[85dvh] overflow-y-auto p-4 sm:p-6">
                    <DialogHeader className="text-left">
                      <DialogTitle>{editing ? "Edit Product" : "Add New Product"}</DialogTitle>
                      <DialogDescription>
                        Only the name is required — everything else can be filled in later.
                      </DialogDescription>
                    </DialogHeader>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!asText(form.name).trim()) return toast.error("Product name is required.");
                        const finalForm = showNewCategory ? { ...form, category: newCategory } : form;
                        saveMutation.mutate(finalForm);
                      }}
                      className="space-y-4"
                    >
                      <div className="space-y-2">
                        <Label htmlFor="product-name">Name *</Label>
                        <Input id="product-name" className="h-11" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="product-description">Description</Label>
                        <Textarea id="product-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="product-price">Price (optional)</Label>
                        <Input id="product-price" className="h-11" type="number" step="0.01" min="0" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="Leave empty if not applicable" />
                      </div>

                      <div className="space-y-2">
                        <Label>Category</Label>
                        <Select value={showNewCategory ? "__new__" : (form.category || undefined)} onValueChange={handleCategorySelect}>
                          <SelectTrigger className="h-11"><SelectValue placeholder="Select category" /></SelectTrigger>
                          <SelectContent className="bg-card z-50">
                            {existingCategories.map((cat) => <SelectItem key={cat} value={cat} className="py-2.5">{cat}</SelectItem>)}
                            <SelectItem value="__new__" className="py-2.5">+ Add New Category</SelectItem>
                          </SelectContent>
                        </Select>
                        {showNewCategory && <Input className="h-11" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="Enter new category name" aria-label="New category name" autoFocus />}
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="product-features">Options / Variants (comma-separated)</Label>
                        <Input id="product-features" className="h-11" value={form.features} onChange={(e) => setForm({ ...form, features: e.target.value })} placeholder="Red, Blue, Green" />
                      </div>

                      {(() => {
                        const featuresList = splitList(form.features);
                        if (featuresList.length === 0) return null;
                        return (
                          <div className="space-y-2 border rounded-lg p-3 bg-muted/30">
                            <Label className="text-sm font-medium">Sizes per Variant</Label>
                            <p className="text-xs text-muted-foreground">Enter available sizes for each variant, separated by commas</p>
                            {featuresList.map((feat) => (
                              <div key={feat} className="flex items-center gap-2">
                                <Badge variant="secondary" className="min-w-[60px] max-w-[35%] shrink-0 justify-center break-anywhere text-xs">{feat}</Badge>
                                <Input
                                  value={asText(form.feature_sizes[feat])}
                                  onChange={(e) => setForm({ ...form, feature_sizes: { ...form.feature_sizes, [feat]: e.target.value } })}
                                  placeholder={`Sizes for ${feat}`}
                                  aria-label={`Sizes for ${feat}`}
                                  className="h-11 min-w-0 flex-1"
                                />
                              </div>
                            ))}
                          </div>
                        );
                      })()}

                      <div className="space-y-2 border rounded-lg p-3 bg-muted/30">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <Label className="text-sm font-medium">Sizes with Specific Prices</Label>
                            <p className="text-xs text-muted-foreground">E.g. 81x32 = ₹7500</p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setSizePrices([...sizePrices, { size: "", price: 0 }])}
                            className="h-11 shrink-0"
                          >
                            <Plus className="h-4 w-4 mr-1" /> Add Size
                          </Button>
                        </div>
                        {sizePrices.length > 0 && (
                          <div className="space-y-2 mt-3">
                            {sizePrices.map((sp, idx) => (
                              <div key={idx} className="flex items-center gap-2">
                                <Input
                                  placeholder="Size (e.g. 81x32)"
                                  aria-label={`Size ${idx + 1}`}
                                  value={asText(sp.size)}
                                  onChange={(e) => {
                                    // Replace the row rather than mutating it in
                                    // place, so React sees a new array every time.
                                    setSizePrices(sizePrices.map((row, i) => i === idx ? { ...row, size: e.target.value } : row));
                                  }}
                                  className="h-11 min-w-0 flex-1"
                                />
                                <Input
                                  type="number"
                                  min="0"
                                  inputMode="decimal"
                                  placeholder="Price"
                                  aria-label={`Price for size ${idx + 1}`}
                                  value={sp.price === 0 && asText(sp.size) === "" ? "" : asNumber(sp.price)}
                                  onChange={(e) => {
                                    setSizePrices(sizePrices.map((row, i) => i === idx ? { ...row, price: asNumber(e.target.value) } : row));
                                  }}
                                  className="h-11 w-24 shrink-0"
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Remove size ${idx + 1}`}
                                  onClick={() => setSizePrices(sizePrices.filter((_, i) => i !== idx))}
                                  className="h-11 w-11 shrink-0 text-destructive"
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label>Product Images</Label>
                        <div className="flex items-center gap-2">
                          <label className={`flex h-11 items-center gap-2 rounded-md border border-input px-4 text-sm ${uploading ? "pointer-events-none opacity-60" : "cursor-pointer hover:bg-accent"}`}>
                            {uploading ? (
                              <>
                                <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                                Uploading...
                              </>
                            ) : (
                              <>
                                <Upload className="h-4 w-4" /> Upload Images
                              </>
                            )}
                            <input type="file" accept="image/*" multiple disabled={uploading} onChange={handleImageUpload} className="hidden" />
                          </label>
                        </div>
                        {form.images.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-3">
                            {form.images.map((url, i) => (
                              <div key={url} className="relative">
                                <ProductImage
                                  src={url}
                                  alt={`Product photo ${i + 1}`}
                                  className="h-20 w-20 rounded-lg border border-border"
                                  iconClassName="h-6 w-6"
                                />
                                {/* A 44px hit area around a 32px badge: the old
                                    hover-only X could not be tapped at all. */}
                                <button
                                  type="button"
                                  aria-label={`Remove photo ${i + 1}`}
                                  onClick={() => removeImage(url)}
                                  className="absolute -right-3 -top-3 flex h-11 w-11 items-center justify-center"
                                >
                                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-md">
                                    <X className="h-4 w-4" />
                                  </span>
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label>Quantity Settings</Label>
                        <div className="flex flex-col gap-3 p-3 border rounded-lg bg-muted/30">
                          {/* Labels are wired to their switch so the text is part
                              of the tap target, not just the 20px thumb. */}
                          <div className="flex items-center gap-3">
                            <Switch id="allow-custom-quantity" className="shrink-0" checked={form.allow_custom_quantity} onCheckedChange={(v) => setForm({ ...form, allow_custom_quantity: v })} />
                            <Label htmlFor="allow-custom-quantity" className="cursor-pointer leading-snug">Allow manual text input for quantity (e.g. typing 100 instead of clicking +)</Label>
                          </div>
                          {form.allow_custom_quantity && (
                            <div className="space-y-1.5 pt-1 sm:pl-11">
                              <Label className="text-xs text-muted-foreground">Quantity Unit Label (optional)</Label>
                              <Input value={form.quantity_unit} onChange={(e) => setForm({ ...form, quantity_unit: e.target.value })} placeholder="e.g. kg, box, pc" className="h-11 max-w-[200px]" />
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                        <div className="flex min-h-[44px] items-center gap-3">
                          <Switch id="product-trending" checked={form.is_trending} onCheckedChange={(v) => setForm({ ...form, is_trending: v })} />
                          <Label htmlFor="product-trending" className="cursor-pointer">Trending</Label>
                        </div>
                        <div className="flex min-h-[44px] items-center gap-3">
                          <Switch id="product-in-stock" checked={form.in_stock} onCheckedChange={(v) => setForm({ ...form, in_stock: v })} />
                          <Label htmlFor="product-in-stock" className="cursor-pointer">In Stock</Label>
                        </div>
                      </div>

                      <Button type="submit" className="h-11 w-full" disabled={saveMutation.isPending || uploading}>
                        {saveMutation.isPending ? "Saving..." : editing ? "Update Product" : "Add Product"}
                      </Button>
                    </form>
                  </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Category Management */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Categories</h2>
          </div>
          {existingCategories.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border bg-secondary/20 p-4 text-sm text-muted-foreground">
              No categories yet. Give a product a category while adding or editing it and it will show up here.
            </p>
          ) : (
          <div className="-mx-1 flex snap-x gap-2.5 overflow-x-auto px-1 pb-2 scrollbar-hide">
            <Button
              variant={selectedCategory === null ? "default" : "outline"}
              className={`h-11 shrink-0 snap-start whitespace-nowrap rounded-full px-4 text-sm font-medium transition-all ${selectedCategory === null ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-background hover:bg-muted'}`}
              onClick={() => setSelectedCategory(null)}
            >
              All Products
            </Button>
            {existingCategories.map((cat) => (
              <div
                key={cat}
                className={`group flex min-h-[44px] shrink-0 snap-start cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-3 shadow-sm transition-all hover:shadow-md ${selectedCategory === cat ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border/60"
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
                    <Input autoFocus aria-label={`Rename category ${cat}`} value={renameCategoryValue} onChange={(e) => setRenameCategoryValue(e.target.value)} onClick={(e) => e.stopPropagation()} className={`h-9 w-32 px-2 py-0 text-sm focus-visible:ring-1 ${selectedCategory === cat ? "text-foreground bg-background border-foreground" : "border-primary"}`} />
                    <Button type="submit" size="icon" variant="ghost" aria-label="Save category name" className="h-10 w-10"><Check className="h-4 w-4" /></Button>
                    <Button type="button" size="icon" variant="ghost" aria-label="Cancel rename" className="h-10 w-10" onClick={(e) => { e.stopPropagation(); setRenamingCategory(null); }}><X className="h-4 w-4" /></Button>
                  </form>
                ) : (
                  <>
                    <span className="text-sm font-medium tracking-wide">{cat}</span>
                    {/* Always visible on touch: hover-only controls left rename
                        and delete unreachable on a phone. */}
                    <div className="ml-1 flex items-center transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                      <Button size="icon" variant="ghost" aria-label={`Rename ${cat}`} className={`h-10 w-10 p-0 ${selectedCategory === cat ? 'text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary-foreground/20' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`} onClick={(e) => { e.stopPropagation(); setRenamingCategory(cat); setRenameCategoryValue(cat); }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" aria-label={`Remove ${cat}`} className={`h-10 w-10 p-0 ${selectedCategory === cat ? 'text-primary-foreground/80 hover:text-primary-foreground hover:bg-destructive' : 'text-destructive/70 hover:text-destructive hover:bg-destructive/10'}`} onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Remove category "${cat}"?`)) removeCategoryMutation.mutate(cat);
                      }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
          )}
        </div>

        {/* Products List section */}
        <div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold">Products ({filteredProducts.length})</h2>
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  {/* The label used to disappear below sm:, leaving two identical
                      icon buttons with no way to tell what was applied. */}
                  <Button variant="outline" className="h-11 gap-2 text-muted-foreground">
                    <ArrowUpDown className="h-4 w-4" />
                    <span className="sm:hidden">{sortLabel}</span>
                    <span className="hidden sm:inline">Sort: {sortLabel}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44 bg-card z-50">
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
                  <Button variant="outline" className="h-11 gap-2 text-muted-foreground">
                    <Filter className="h-4 w-4" />
                    <span className="sm:hidden">{stockLabel}</span>
                    <span className="hidden sm:inline">Filter: {stockLabel}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44 bg-card z-50">
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
                  <CardContent onClick={() => startEdit(p)} className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4 w-full cursor-pointer hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0 w-full">
                      <ProductImage
                        src={p.image_url}
                        alt={productName(p)}
                        className="h-16 w-16 shrink-0 rounded-xl border shadow-sm sm:h-20 sm:w-20"
                        iconClassName="h-8 w-8"
                      />
                      <div className="flex-1 min-w-0 flex flex-col justify-center">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h3 className="min-w-0 truncate text-base font-bold tracking-tight sm:text-lg">{productName(p)}</h3>
                          {p.is_trending && <Badge className="bg-primary hover:bg-primary text-primary-foreground text-[10px] uppercase font-bold tracking-wider px-2 py-0.5">Trending</Badge>}
                        </div>
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 break-anywhere text-sm font-medium text-muted-foreground">
                          {asText(p.category).trim()
                            ? <Badge variant="secondary" className="bg-secondary/50 font-semibold">{asText(p.category)}</Badge>
                            : <span className="italic text-muted-foreground/50">No Category</span>}
                          <span className="text-muted-foreground/40">•</span>
                          <span>{asText(p.size).trim() || <span className="text-primary">Tap to add details</span>}</span>
                          <span className="text-muted-foreground/40">•</span>
                          <span>{photoCount(p)} photo{photoCount(p) === 1 ? "" : "s"}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 sm:gap-6 justify-between sm:justify-end mt-2 sm:mt-0 pt-3 sm:pt-0 border-t sm:border-0 border-border/50 w-full sm:w-auto shrink-0">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={!!p.in_stock}
                          aria-label={`${productName(p)} in stock`}
                          onCheckedChange={(v) => toggleStockMutation.mutate({ id: p.id, in_stock: v })}
                          onClick={(e) => e.stopPropagation()}
                          className="data-[state=checked]:bg-primary"
                        />
                        <span className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">{p.in_stock ? "In Stock" : "Out"}</span>
                      </div>
                      <div className="flex items-center gap-1 bg-secondary/50 p-1 rounded-lg">
                        <Button size="icon" variant="ghost" aria-label={`Edit ${productName(p)}`} className="h-11 w-11 hover:bg-background shadow-sm hover:text-foreground text-muted-foreground transition-colors" onClick={(e) => { e.stopPropagation(); startEdit(p); }}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" aria-label={`Delete ${productName(p)}`} className="h-11 w-11 hover:bg-destructive/10 text-destructive/70 hover:text-destructive transition-colors" onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${productName(p)}"? This cannot be undone.`)) deleteMutation.mutate(p.id); }}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-border bg-secondary/20 px-4 py-16 text-center">
              <Package className="h-12 w-12 mx-auto mb-4 text-muted-foreground/30" />
              <h3 className="text-lg font-bold mb-1">{isFiltered ? "No products match this view" : "No products yet"}</h3>
              <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
                {isFiltered
                  ? "Nothing matches the current search, category or stock filter. Clear them to see your whole catalogue."
                  : "Add your first product and it shows up on your store link straight away."}
              </p>
              {isFiltered ? (
                <Button
                  variant="outline"
                  className="h-11"
                  onClick={() => { setSearchQuery(""); setSelectedCategory(null); setStockFilter("all"); }}
                >
                  <X className="h-4 w-4 mr-2" /> Clear filters
                </Button>
              ) : (
                <Button onClick={requestAddProduct} className="h-11 bg-primary hover:bg-primary/90">
                  <Plus className="h-4 w-4 mr-2" /> Add Your First Product
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </AdminLayout >
  );
};

export default AdminDashboard;
