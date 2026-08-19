import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompanyBySlug } from "@/hooks/useCompany";
import ProductCard from "@/components/ProductCard";
import StoreLogo from "@/components/StoreLogo";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowRight,
  TrendingUp,
  Package,
  Store,
  ShoppingCart,
  Star,
  MessageSquare,
  Menu,
  X,
  Search,
  AlertTriangle,
} from "lucide-react";
import { useCart } from "@/contexts/CartContext";
import ThemeToggle from "@/components/ThemeToggle";
import useStoreTheme from "@/hooks/useStoreTheme";
import { useNetwork } from "@/hooks/useNetwork";
import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errorMessages";
import { asText } from "@/lib/productData";
import { productMatchesQuery, storeName } from "@/lib/storefront";

/**
 * A "visit" for view-counting purposes. The packaged app cold-starts often
 * (task switch, low memory), and each restart used to log a fresh page_view,
 * inflating the merchant's analytics for a single browsing session.
 */
const VIEW_DEDUPE_MS = 30 * 60 * 1000;

/** Stores counted in this JS session — the fast path before touching storage. */
const countedThisSession = new Set<string>();

const shouldCountView = (companyId: string): boolean => {
  if (countedThisSession.has(companyId)) return false;
  countedThisSession.add(companyId);
  try {
    const key = `catalogshare.storeview.${companyId}`;
    const last = Number(localStorage.getItem(key));
    if (Number.isFinite(last) && last > 0 && Date.now() - last < VIEW_DEDUPE_MS) return false;
    localStorage.setItem(key, String(Date.now()));
  } catch {
    /* privacy mode blocks storage — the in-memory guard above still applies */
  }
  return true;
};

const StoreFront = () => {
  const { slug } = useParams<{ slug: string }>();
  const { data: company, isLoading: companyLoading } = useCompanyBySlug(slug || "");
  const { totalItems } = useCart(slug);
  const { offline } = useNetwork();

  // Apply company color theme
  useStoreTheme(company?.theme_primary || null, company?.theme_accent || null);

  // Survey state
  const [surveyName, setSurveyName] = useState("");
  const [surveyRole, setSurveyRole] = useState("");
  const [surveyRating, setSurveyRating] = useState(0);
  const [surveySuggestion, setSurveySuggestion] = useState("");
  const [surveyHoveredStar, setSurveyHoveredStar] = useState(0);
  const [surveySending, setSurveySending] = useState(false);
  const [surveyDone, setSurveyDone] = useState(false);
  const [surveyErrors, setSurveyErrors] = useState<{ name?: string; role?: string; rating?: string }>({});
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Search State
  const [searchQuery, setSearchQuery] = useState("");

  // Analytics tracking for Store Front. Offline it is skipped entirely rather
  // than queued: the insert can only fail, and its rejection surfaced as an
  // unhandled promise on every visit. Re-runs when connectivity returns.
  useEffect(() => {
    if (!company?.id || offline) return;
    if (!shouldCountView(company.id)) return;
    void Promise.resolve(
      supabase.from("analytics_events").insert({
        event_type: "page_view",
        page_url: `/store/${slug}`,
        company_id: company.id,
      })
    ).catch((err) => console.warn("Failed to track store view", err));
  }, [company?.id, slug, offline]);

  const {
    data: trendingRaw,
    isLoading: trendingLoading,
    isError: trendingFailed,
    refetch: refetchTrending,
  } = useQuery({
    queryKey: ["store-trending", company?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("company_id", company!.id)
        .eq("is_trending", true)
        .eq("in_stock", true)
        .limit(8);
      if (error) throw error;
      return data;
    },
    enabled: !!company,
    staleTime: 2 * 60 * 1000, // 2 min cache
  });

  const {
    data: latestRaw,
    isLoading: latestLoading,
    isError: latestFailed,
    refetch: refetchLatest,
  } = useQuery({
    queryKey: ["store-latest", company?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("company_id", company!.id)
        .eq("in_stock", true)
        .order("created_at", { ascending: false })
        .limit(8);
      if (error) throw error;
      return data;
    },
    enabled: !!company,
    staleTime: 2 * 60 * 1000, // 2 min cache
  });

  // productMatchesQuery reads every field through a null-safe accessor. A row
  // saved before `name` became NOT NULL threw on `.toLowerCase()` right here,
  // and a render-time throw unmounts the tree — a blank shop, mid-keystroke.
  const trending = useMemo(
    () => (trendingRaw ?? []).filter((p) => productMatchesQuery(p, searchQuery)),
    [trendingRaw, searchQuery]
  );

  const latest = useMemo(
    () => (latestRaw ?? []).filter((p) => productMatchesQuery(p, searchQuery)),
    [latestRaw, searchQuery]
  );

  const catalogFailed = trendingFailed || latestFailed;
  const catalogLoading = trendingLoading || latestLoading;
  const catalogEmpty =
    !catalogLoading && !catalogFailed && (trendingRaw?.length ?? 0) === 0 && (latestRaw?.length ?? 0) === 0;

  const handleSurveySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors: { name?: string; role?: string; rating?: string } = {};
    if (!surveyName.trim()) errors.name = "Tell us what to call you.";
    if (!surveyRole) errors.role = "Pick the option that fits you best.";
    if (surveyRating === 0) errors.rating = "Tap a star to rate your visit.";
    setSurveyErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSurveySending(true);
    try {
      const { error } = await supabase.from("surveys").insert({
        store_slug: slug || null,
        name: surveyName.trim(),
        role: surveyRole,
        rating: surveyRating,
        suggestion: surveySuggestion.trim() || null,
      });
      if (error) throw error;
      toast.success("Thank you for your feedback!");
      setSurveyDone(true);
    } catch (err) {
      // errorMessage tolerates a non-Error rejection; reading `.message` off a
      // string rejection threw a second time inside the catch block.
      toast.error(errorMessage(err, "Couldn't send your feedback. Please try again."));
    } finally {
      setSurveySending(false);
    }
  };

  if (companyLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <p className="text-muted-foreground">Loading store...</p>
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
  const phone = asText(company.phone).trim();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Store Navbar */}
      <nav className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur-md transition-colors">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 min-w-0 items-center justify-between gap-3 sm:gap-4">
            {/* min-w-0 and no flex-shrink-0: a long store name has to be allowed
                to shrink, or it widens the bar past the edge of the phone. */}
            <Link to={`/store/${slug}`} className="flex min-w-0 items-center gap-2">
              <StoreLogo url={company.logo_url} name={name} className="h-9 sm:h-10" />
              <span className="hidden truncate text-lg font-bold text-foreground sm:block">{name}</span>
            </Link>

            {/* Nav Search Center */}
            <div className="hidden max-w-lg flex-1 md:block">
              <div className="group relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
                <Input
                  type="search"
                  aria-label="Search products"
                  placeholder="Search products, categories..."
                  className="h-11 w-full rounded-full border-transparent bg-muted/50 pl-9 transition-all focus-visible:border-primary focus-visible:bg-background focus-visible:ring-1 focus-visible:ring-primary"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-shrink-0 items-center gap-1 sm:gap-3">
              <Link
                to={`/store/${slug}/products`}
                className="hidden text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground sm:block"
              >
                Products
              </Link>
              <Link
                to={`/store/${slug}/about`}
                className="hidden text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground sm:block"
              >
                About
              </Link>
              <div className="hidden sm:block">
                <ThemeToggle />
              </div>
              <Link to={`/store/${slug}/cart`} className="relative" aria-label={`Cart, ${totalItems} items`}>
                <Button variant="outline" size="icon" className="h-11 w-11 border-border text-foreground hover:bg-muted">
                  <ShoppingCart className="h-5 w-5" />
                </Button>
                {totalItems > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground shadow-sm">
                    {totalItems}
                  </span>
                )}
              </Link>
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11 text-foreground sm:hidden"
                aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
                aria-expanded={mobileMenuOpen}
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              >
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            </div>
          </div>
        </div>

        {/* Mobile menu dropdown */}
        {mobileMenuOpen && (
          <div className="absolute left-0 top-full w-full animate-fade-in space-y-4 border-t bg-card p-4 shadow-lg sm:hidden">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                aria-label="Search products"
                placeholder="Search products..."
                className="h-11 w-full rounded-full border-transparent bg-muted/50 pl-9 focus:bg-background focus:ring-1 focus:ring-primary"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between border-b pb-4">
              <span className="text-sm font-semibold text-foreground">Toggle theme</span>
              <ThemeToggle />
            </div>
            <Link
              to={`/store/${slug}`}
              onClick={() => setMobileMenuOpen(false)}
              className="flex min-h-11 items-center text-[15px] font-semibold text-foreground transition-colors hover:text-primary"
            >
              Home
            </Link>
            <Link
              to={`/store/${slug}/products`}
              onClick={() => setMobileMenuOpen(false)}
              className="flex min-h-11 items-center text-[15px] font-semibold text-foreground transition-colors hover:text-primary"
            >
              Products
            </Link>
            <Link
              to={`/store/${slug}/about`}
              onClick={() => setMobileMenuOpen(false)}
              className="flex min-h-11 items-center text-[15px] font-semibold text-foreground transition-colors hover:text-primary"
            >
              About
            </Link>
          </div>
        )}
      </nav>

      {/* Hero */}
      {!searchQuery && (
        <section className="relative overflow-hidden bg-gradient-to-br from-primary/10 via-background to-accent">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,hsl(var(--primary)/0.08),transparent_60%)]" />
          <div className="relative z-10 mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-24 lg:px-8">
            <div className="flex flex-col items-center text-center">
              {company.logo_url && (
                <StoreLogo
                  url={company.logo_url}
                  name={name}
                  className="mb-6 h-20 drop-shadow-sm sm:h-32"
                  fallbackClassName="mb-6 h-16 w-16"
                />
              )}
              {/* break-anywhere: one long unbroken word in the store name would
                  otherwise push the page wider than a 360px screen. */}
              <h1 className="mb-6 max-w-full animate-fade-in-up break-anywhere text-3xl font-extrabold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                {name}
              </h1>
              <p className="delay-100 mb-8 max-w-2xl animate-fade-in-up text-base font-medium text-muted-foreground sm:text-xl">
                Browse our catalog, add items to your list, and send your order directly via WhatsApp.
              </p>
              <div className="delay-200 flex w-full animate-fade-in-up flex-col justify-center gap-3 sm:w-auto sm:flex-row sm:gap-4">
                <Button
                  size="lg"
                  className="h-12 px-8 text-base font-bold shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl"
                  asChild
                >
                  <Link to={`/store/${slug}/products`}>
                    Browse entire catalog <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="h-12 border-2 bg-background/50 px-8 text-base font-bold backdrop-blur-sm hover:bg-background"
                  asChild
                >
                  <Link to={`/store/${slug}/cart`}>View current cart</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Search Results Header */}
      {searchQuery && (
        <div className="mx-auto max-w-7xl animate-fade-in px-4 py-8 sm:px-6 lg:px-8">
          <h2 className="inline-block break-anywhere rounded-xl border border-border bg-muted/50 p-4 text-lg font-bold sm:text-2xl">
            Search results for <span className="italic text-primary">"{searchQuery}"</span>
          </h2>
        </div>
      )}

      {/* The catalog queries used to fail silently: both sections simply never
          appeared, so a server error looked exactly like an empty shop. */}
      {catalogFailed && (
        <section role="alert" className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6 lg:px-8">
          <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <AlertTriangle className="h-7 w-7" />
          </span>
          <h2 className="mb-2 text-xl font-bold">Couldn't load the catalog</h2>
          <p className="mb-6 text-muted-foreground">
            The products didn't come through. That is usually a dropped connection rather than anything
            you did.
          </p>
          <Button
            className="h-11"
            onClick={() => {
              void refetchTrending();
              void refetchLatest();
            }}
          >
            Try again
          </Button>
        </section>
      )}

      {/* Trending */}
      {!catalogFailed && (trending.length > 0 || trendingLoading) && (
        <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-16 lg:px-8">
          <div className="mb-8 flex items-center justify-between gap-3 border-b border-border/50 pb-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2">
                <TrendingUp className="h-6 w-6 text-primary" />
              </div>
              <h2 className="truncate text-2xl font-extrabold tracking-tight sm:text-3xl">Trending now</h2>
            </div>
            {!searchQuery && (
              <Button variant="ghost" className="hidden font-semibold hover:bg-muted sm:flex" asChild>
                <Link to={`/store/${slug}/products`}>
                  View all <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6 lg:grid-cols-4 xl:grid-cols-5">
            {trendingLoading
              ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="aspect-[3/4] rounded-2xl" />)
              : trending.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        </section>
      )}

      {/* Latest */}
      {!catalogFailed && (latest.length > 0 || latestLoading) && (
        <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-16 lg:px-8">
          <div className="mb-8 flex items-center justify-between gap-3 border-b border-border/50 pb-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2">
                <Package className="h-6 w-6 text-primary" />
              </div>
              <h2 className="truncate text-2xl font-extrabold tracking-tight sm:text-3xl">Latest arrivals</h2>
            </div>
            {!searchQuery && (
              <Button variant="ghost" className="hidden font-semibold hover:bg-muted sm:flex" asChild>
                <Link to={`/store/${slug}/products`}>
                  View all <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6 lg:grid-cols-4 xl:grid-cols-5">
            {latestLoading
              ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="aspect-[3/4] rounded-2xl" />)
              : latest.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        </section>
      )}

      {/* A shop with nothing in stock rendered as hero-then-survey, which reads
          as a broken page rather than a catalog that is still being filled. */}
      {catalogEmpty && !searchQuery && (
        <section className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6 lg:px-8">
          <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <Package className="h-7 w-7" />
          </span>
          <h2 className="mb-2 text-xl font-bold">No products listed yet</h2>
          <p className="mb-6 break-anywhere text-muted-foreground">
            {name} hasn't added anything to this catalog so far. Get in touch to ask what is available.
          </p>
          <Button variant="outline" className="h-11" asChild>
            <Link to={`/store/${slug}/about`}>Contact the store</Link>
          </Button>
        </section>
      )}

      {searchQuery && !catalogFailed && !catalogLoading && trending.length === 0 && latest.length === 0 && (
        <div className="px-4 py-20 text-center">
          <Search className="mx-auto mb-4 h-16 w-16 text-muted-foreground/30" />
          <h3 className="mb-2 text-2xl font-bold">No matching products</h3>
          <p className="mx-auto max-w-md break-anywhere text-muted-foreground">
            We couldn't find anything matching "{searchQuery}". Try a different spelling, or a broader
            keyword.
          </p>
          <Button className="mt-6 h-11" variant="outline" onClick={() => setSearchQuery("")}>
            Clear search
          </Button>
        </div>
      )}

      {/* Survey Section */}
      {!searchQuery && (
        <section className="border-y bg-secondary/20 py-14 sm:py-24">
          <div className="mx-auto max-w-2xl px-4 sm:px-6 lg:px-8">
            <div className="mb-10 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 scale-110 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 shadow-sm">
                <MessageSquare className="h-8 w-8 text-primary" />
              </div>
              <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">How was your experience?</h2>
              <p className="mt-3 text-base font-medium text-muted-foreground">
                We'd love to hear your feedback about our catalog.
              </p>
            </div>

            {surveyDone ? (
              <Card className="animate-in fade-in zoom-in border-primary/30 bg-primary/5 shadow-sm transition-all duration-500">
                <CardContent className="p-8 text-center sm:p-10">
                  <Star className="mx-auto mb-4 h-16 w-16 fill-yellow-500 text-yellow-500 drop-shadow-sm" />
                  <h3 className="mb-2 text-2xl font-extrabold text-foreground">Thank you!</h3>
                  <p className="text-base font-medium text-muted-foreground sm:text-lg">
                    Your feedback helps us improve. We appreciate you taking the time.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card className="border-border/50 shadow-lg">
                <CardContent className="p-5 sm:p-8">
                  <form onSubmit={handleSurveySubmit} noValidate className="space-y-6">
                    <div className="grid gap-6 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="survey-name" className="text-sm font-bold">
                          Your name <span className="text-primary">*</span>
                        </Label>
                        <Input
                          id="survey-name"
                          value={surveyName}
                          onChange={(e) => {
                            setSurveyName(e.target.value);
                            if (surveyErrors.name) setSurveyErrors((prev) => ({ ...prev, name: undefined }));
                          }}
                          placeholder="What should we call you?"
                          maxLength={100}
                          aria-invalid={!!surveyErrors.name}
                          aria-describedby={surveyErrors.name ? "survey-name-error" : undefined}
                          className="h-11 bg-background"
                        />
                        {surveyErrors.name && (
                          <p id="survey-name-error" className="text-sm font-medium text-destructive">
                            {surveyErrors.name}
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm font-bold">
                          I am a... <span className="text-primary">*</span>
                        </Label>
                        <Select
                          value={surveyRole}
                          onValueChange={(value) => {
                            setSurveyRole(value);
                            setSurveyErrors((prev) => ({ ...prev, role: undefined }));
                          }}
                        >
                          <SelectTrigger className="h-11 bg-background text-foreground">
                            <SelectValue placeholder="Select your role" />
                          </SelectTrigger>
                          <SelectContent className="border-border bg-popover">
                            <SelectItem value="customer" className="cursor-pointer font-medium">
                              Customer
                            </SelectItem>
                            <SelectItem value="user" className="cursor-pointer font-medium">
                              User / Browser
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        {surveyErrors.role && (
                          <p className="text-sm font-medium text-destructive">{surveyErrors.role}</p>
                        )}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <Label className="text-sm font-bold">
                        Rate your experience <span className="text-primary">*</span>
                      </Label>
                      <div className="flex flex-wrap items-center justify-center gap-1 rounded-xl border bg-background p-3 sm:justify-start sm:gap-2 sm:p-4">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            type="button"
                            aria-label={`Rate ${star} out of 5`}
                            aria-pressed={surveyRating === star}
                            className="flex h-11 w-11 items-center justify-center rounded-lg transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            onMouseEnter={() => setSurveyHoveredStar(star)}
                            onMouseLeave={() => setSurveyHoveredStar(0)}
                            onClick={() => {
                              setSurveyRating(star);
                              setSurveyErrors((prev) => ({ ...prev, rating: undefined }));
                            }}
                          >
                            <Star
                              className={`h-8 w-8 transition-colors ${
                                star <= (surveyHoveredStar || surveyRating)
                                  ? "fill-yellow-400 text-yellow-400 drop-shadow-sm"
                                  : "text-muted-foreground/30"
                              }`}
                            />
                          </button>
                        ))}
                        {surveyRating > 0 && (
                          <span className="ml-1 self-center rounded-full border bg-muted px-3 py-1.5 text-sm font-bold text-foreground sm:ml-4 sm:text-base">
                            {surveyRating === 1
                              ? "Poor"
                              : surveyRating === 2
                                ? "Fair"
                                : surveyRating === 3
                                  ? "Good"
                                  : surveyRating === 4
                                    ? "Very good"
                                    : "Excellent!"}
                          </span>
                        )}
                      </div>
                      {surveyErrors.rating && (
                        <p className="text-sm font-medium text-destructive">{surveyErrors.rating}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="survey-suggestion" className="text-sm font-bold">
                        Any suggestions? <span className="font-normal text-muted-foreground">(optional)</span>
                      </Label>
                      <Textarea
                        id="survey-suggestion"
                        value={surveySuggestion}
                        onChange={(e) => setSurveySuggestion(e.target.value)}
                        placeholder="Tell us how we can improve your catalog browsing experience..."
                        rows={4}
                        maxLength={500}
                        className="resize-none bg-background p-4 text-base"
                      />
                    </div>

                    <Button
                      type="submit"
                      className="h-12 w-full text-base font-bold shadow-sm transition-all hover:shadow-md"
                      disabled={surveySending}
                    >
                      {surveySending ? "Submitting..." : "Submit feedback"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="mt-auto border-t bg-card transition-colors">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
            <div className="flex min-w-0 flex-col items-center gap-4 text-center md:items-start md:text-left">
              <StoreLogo
                url={company.logo_url}
                name={name}
                className="h-12 opacity-80 grayscale transition-all hover:opacity-100 hover:grayscale-0"
                fallbackClassName="h-8 w-8"
              />
              <div className="min-w-0">
                <p className="break-anywhere text-lg font-bold text-foreground">{name}</p>
                {phone && (
                  <p className="mt-1 break-anywhere text-sm font-medium text-muted-foreground">
                    WhatsApp: {phone}
                  </p>
                )}
              </div>
            </div>
            <div className="flex w-full flex-col items-center gap-4 border-t pt-6 md:w-auto md:items-end md:border-t-0 md:pt-0">
              <Button variant="outline" className="h-11 font-semibold" asChild>
                <Link to={`/store/${slug}/about`}>About us</Link>
              </Button>
              <p className="text-sm font-medium text-muted-foreground">
                Powered by{" "}
                <Link to="/" className="font-bold text-primary hover:underline">
                  CatalogShare
                </Link>
              </p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default StoreFront;
