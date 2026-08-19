import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompanyBySlug } from "@/hooks/useCompany";
import ProductCard from "@/components/ProductCard";
import ProductListItem from "@/components/ProductListItem";
import StoreLogo from "@/components/StoreLogo";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useMemo, useState } from "react";
import { Search, X, LayoutGrid, List, Store, ShoppingCart, Menu, Package, AlertTriangle } from "lucide-react";
import { useCart } from "@/contexts/CartContext";
import ThemeToggle from "@/components/ThemeToggle";
import useStoreTheme from "@/hooks/useStoreTheme";
import { productCategories, productMatchesQuery, storeName } from "@/lib/storefront";

const StoreProducts = () => {
  const { slug } = useParams<{ slug: string }>();
  const { data: company, isLoading: companyLoading } = useCompanyBySlug(slug || "");
  // Bound to this store explicitly rather than sniffed off the URL, so the
  // badge can never show another shop's basket.
  const { totalItems } = useCart(slug);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Apply company color theme
  useStoreTheme(company?.theme_primary || null, company?.theme_accent || null);

  const {
    data: products,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["store-products", company?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("company_id", company!.id)
        .eq("in_stock", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!company,
    staleTime: 2 * 60 * 1000, // 2 min cache
  });

  // Blank and duplicate categories are dropped here rather than in the JSX, so
  // a row with category "   " cannot render an unlabelled, unclickable chip.
  const categories = useMemo(() => productCategories(products), [products]);

  // Every comparison goes through the null-safe matcher: `p.name` is NOT NULL
  // in the schema but rows written before that constraint still exist, and
  // `.toLowerCase()` on one of them throws during render — a blank page.
  const filtered = useMemo(
    () =>
      (products ?? []).filter(
        (p) => productMatchesQuery(p, search) && (!selectedCategory || p.category === selectedCategory)
      ),
    [products, search, selectedCategory]
  );

  if (companyLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 text-center text-foreground">
        <div>
          <Store className="mx-auto mb-4 h-16 w-16 text-muted-foreground opacity-30" />
          <h1 className="mb-2 text-2xl font-bold">Store not found</h1>
          <p className="mb-6 text-muted-foreground">This catalog doesn't exist or has been removed.</p>
          <Button asChild className="h-11">
            <Link to="/">Go home</Link>
          </Button>
        </div>
      </div>
    );
  }

  const name = storeName(company);
  const hasFilters = !!search.trim() || !!selectedCategory;

  const clearFilters = () => {
    setSearch("");
    setSelectedCategory(null);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 border-b bg-card/80 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 min-w-0 items-center justify-between gap-3">
            <Link to={`/store/${slug}`} className="flex min-w-0 items-center gap-2">
              <StoreLogo url={company.logo_url} name={name} className="h-9 sm:h-10" />
              <span className="hidden truncate text-lg font-bold sm:block">{name}</span>
            </Link>
            <div className="flex flex-shrink-0 items-center gap-1 sm:gap-3">
              <Link
                to={`/store/${slug}`}
                className="hidden text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:block"
              >
                Home
              </Link>
              <Link
                to={`/store/${slug}/about`}
                className="hidden text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:block"
              >
                About
              </Link>
              <ThemeToggle />
              <Link to={`/store/${slug}/cart`} className="relative" aria-label={`Cart, ${totalItems} items`}>
                <Button variant="outline" size="icon" className="h-11 w-11">
                  <ShoppingCart className="h-5 w-5" />
                </Button>
                {totalItems > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                    {totalItems}
                  </span>
                )}
              </Link>
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11 sm:hidden"
                aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
                aria-expanded={mobileMenuOpen}
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              >
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            </div>
          </div>
        </div>
        {mobileMenuOpen && (
          <div className="absolute left-0 top-full w-full animate-fade-in space-y-1 border-t bg-card p-4 shadow-lg sm:hidden">
            <Link
              to={`/store/${slug}`}
              onClick={() => setMobileMenuOpen(false)}
              className="flex min-h-11 items-center text-[15px] font-medium hover:text-primary"
            >
              Home
            </Link>
            <Link
              to={`/store/${slug}/products`}
              onClick={() => setMobileMenuOpen(false)}
              className="flex min-h-11 items-center text-[15px] font-medium hover:text-primary"
            >
              Products
            </Link>
            <Link
              to={`/store/${slug}/about`}
              onClick={() => setMobileMenuOpen(false)}
              className="flex min-h-11 items-center text-[15px] font-medium hover:text-primary"
            >
              About
            </Link>
          </div>
        )}
      </nav>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold sm:text-3xl">All products</h1>
            {!isLoading && !isError && (
              <p className="mt-1 text-sm text-muted-foreground">
                {filtered.length} {filtered.length === 1 ? "product" : "products"}
                {hasFilters && products ? ` of ${products.length}` : ""}
              </p>
            )}
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <div className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Search products"
                placeholder="Search products..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-11 pl-10"
              />
            </div>
            <div className="flex flex-shrink-0 rounded-md border">
              <Button
                variant={viewMode === "grid" ? "default" : "ghost"}
                size="icon"
                aria-label="Grid view"
                aria-pressed={viewMode === "grid"}
                className="h-11 w-11 rounded-r-none"
                onClick={() => setViewMode("grid")}
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "list" ? "default" : "ghost"}
                size="icon"
                aria-label="List view"
                aria-pressed={viewMode === "list"}
                className="h-11 w-11 rounded-l-none"
                onClick={() => setViewMode("list")}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {categories.length > 0 && (
          <div className="mb-6 flex flex-wrap gap-2">
            <Button
              variant={selectedCategory === null ? "default" : "outline"}
              size="sm"
              className="h-11 sm:h-9"
              onClick={() => setSelectedCategory(null)}
            >
              All
            </Button>
            {categories.map((cat) => (
              <Button
                key={cat}
                variant={selectedCategory === cat ? "default" : "outline"}
                size="sm"
                className="h-11 max-w-full sm:h-9"
                onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
              >
                <span className="truncate">{cat}</span>
                {selectedCategory === cat && <X className="ml-1 h-3 w-3 flex-shrink-0" />}
              </Button>
            ))}
          </div>
        )}

        {isError ? (
          <div role="alert" className="mx-auto max-w-md py-20 text-center">
            <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
              <AlertTriangle className="h-7 w-7" />
            </span>
            <h2 className="mb-2 text-xl font-bold">Couldn't load these products</h2>
            <p className="mb-6 text-muted-foreground">
              The catalog didn't come through. Check your connection and try again.
            </p>
            <Button className="h-11" onClick={() => void refetch()}>
              Try again
            </Button>
          </div>
        ) : isLoading ? (
          <div className={viewMode === "grid" ? "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" : "space-y-3"}>
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className={viewMode === "grid" ? "aspect-square rounded-xl" : "h-24 rounded-xl"} />
            ))}
          </div>
        ) : filtered.length > 0 ? (
          viewMode === "grid" ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {filtered.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((p) => (
                <ProductListItem key={p.id} product={p} />
              ))}
            </div>
          )
        ) : hasFilters ? (
          <div className="mx-auto max-w-md py-20 text-center">
            <Search className="mx-auto mb-4 h-14 w-14 text-muted-foreground/30" />
            <h2 className="mb-2 text-xl font-bold">Nothing matched that</h2>
            <p className="mb-6 break-anywhere text-muted-foreground">
              No product matches your search or the category you picked. Try a shorter keyword.
            </p>
            <Button variant="outline" className="h-11" onClick={clearFilters}>
              Clear filters
            </Button>
          </div>
        ) : (
          <div className="mx-auto max-w-md py-20 text-center">
            <Package className="mx-auto mb-4 h-14 w-14 text-muted-foreground/30" />
            <h2 className="mb-2 text-xl font-bold">No products listed yet</h2>
            <p className="mb-6 break-anywhere text-muted-foreground">
              {name} hasn't published anything to this catalog so far. Get in touch to ask what is
              available.
            </p>
            <Button variant="outline" className="h-11" asChild>
              <Link to={`/store/${slug}/about`}>Contact the store</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default StoreProducts;
