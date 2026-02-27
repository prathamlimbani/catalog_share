import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompanyBySlug } from "@/hooks/useCompany";
import ProductCard from "@/components/ProductCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowRight, TrendingUp, Package, Store, ShoppingCart, Star, MessageSquare, Menu, X, Search } from "lucide-react";
import { useCart } from "@/contexts/CartContext";
import ThemeToggle from "@/components/ThemeToggle";
import useStoreTheme from "@/hooks/useStoreTheme";
import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";

const StoreFront = () => {
  const { slug } = useParams<{ slug: string }>();
  const { data: company, isLoading: companyLoading } = useCompanyBySlug(slug || "");
  const { totalItems } = useCart();

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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Search State
  const [searchQuery, setSearchQuery] = useState("");

  // Analytics tracking for Store Front
  useEffect(() => {
    if (company?.id) {
      const trackView = async () => {
        try {
          await supabase.from("analytics_events").insert({
            event_type: "page_view",
            page_url: `/store/${slug}`,
            company_id: company.id,
          });
        } catch (err) {
          console.error("Failed to track store view", err);
        }
      };
      trackView();
    }
  }, [company?.id, slug]);

  const { data: trendingRaw, isLoading: trendingLoading } = useQuery({
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
  });

  const { data: latestRaw, isLoading: latestLoading } = useQuery({
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
  });

  const trending = useMemo(() => {
    if (!trendingRaw) return [];
    if (!searchQuery.trim()) return trendingRaw;
    const lowerQuery = searchQuery.toLowerCase();
    return trendingRaw.filter(
      (p) =>
        p.name.toLowerCase().includes(lowerQuery) ||
        (p.category && p.category.toLowerCase().includes(lowerQuery)) ||
        (p.description && p.description.toLowerCase().includes(lowerQuery))
    );
  }, [trendingRaw, searchQuery]);

  const latest = useMemo(() => {
    if (!latestRaw) return [];
    if (!searchQuery.trim()) return latestRaw;
    const lowerQuery = searchQuery.toLowerCase();
    return latestRaw.filter(
      (p) =>
        p.name.toLowerCase().includes(lowerQuery) ||
        (p.category && p.category.toLowerCase().includes(lowerQuery)) ||
        (p.description && p.description.toLowerCase().includes(lowerQuery))
    );
  }, [latestRaw, searchQuery]);

  const handleSurveySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!surveyName.trim() || !surveyRole || surveyRating === 0) {
      toast.error("Please fill in your name, role, and rating.");
      return;
    }
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
      toast.success("Thank you for your feedback! ⭐");
      setSurveyDone(true);
    } catch (err: any) {
      toast.error(err.message || "Failed to submit survey.");
    } finally {
      setSurveySending(false);
    }
  };

  if (companyLoading) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-muted-foreground">Loading store...</p></div>;
  }

  if (!company) {
    return (
      <div className="min-h-screen flex items-center justify-center text-center px-4">
        <div>
          <Store className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-30" />
          <h1 className="text-2xl font-bold mb-2">Store Not Found</h1>
          <p className="text-muted-foreground mb-6">This catalog doesn't exist or has been removed.</p>
          <Button asChild><Link to="/">Go Home</Link></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Store Navbar */}
      <nav className="sticky top-0 z-50 bg-background/95 backdrop-blur-md border-b overflow-x-hidden transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 min-w-0 gap-4">
            <Link to={`/store/${slug}`} className="flex items-center gap-2 min-w-0 flex-shrink-0">
              {company.logo_url ? (
                <img src={company.logo_url} alt={company.name} className="h-10 w-auto flex-shrink-0" />
              ) : (
                <Store className="h-6 w-6 text-primary flex-shrink-0" />
              )}
              <span className="font-bold text-lg hidden sm:block truncate text-foreground">{company.name}</span>
            </Link>

            {/* Nav Search Center */}
            <div className="flex-1 max-w-lg hidden md:block">
              <div className="relative group">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                <Input
                  type="search"
                  placeholder="Search products, categories..."
                  className="w-full pl-9 bg-muted/50 border-transparent focus-visible:bg-background focus-visible:ring-1 focus-visible:ring-primary focus-visible:border-primary transition-all rounded-full h-10"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center gap-1 sm:gap-3 flex-shrink-0">
              <Link to={`/store/${slug}/products`} className="text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors hidden sm:block">Products</Link>
              <Link to={`/store/${slug}/about`} className="text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors hidden sm:block">About</Link>
              <div className="hidden sm:block">
                <ThemeToggle />
              </div>
              <Link to={`/store/${slug}/cart`} className="relative">
                <Button variant="outline" size="icon" className="border-border hover:bg-muted text-foreground">
                  <ShoppingCart className="h-5 w-5" />
                </Button>
                {totalItems > 0 && (
                  <span className="absolute -top-2 -right-2 bg-primary text-primary-foreground text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-bold shadow-sm">
                    {totalItems}
                  </span>
                )}
              </Link>
              <Button variant="ghost" size="icon" className="sm:hidden text-foreground" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            </div>
          </div>
        </div>

        {/* Mobile menu dropdown */}
        {mobileMenuOpen && (
          <div className="sm:hidden border-t bg-card p-4 space-y-4 animate-fade-in shadow-lg absolute w-full left-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search products..."
                className="w-full pl-9 bg-secondary/50 rounded-full h-10 border-transparent focus:bg-background focus:ring-1 focus:ring-primary"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between border-b pb-4">
              <span className="text-sm font-semibold text-foreground">Toggle Theme</span>
              <ThemeToggle />
            </div>
            <Link to={`/store/${slug}`} onClick={() => setMobileMenuOpen(false)} className="block py-2 text-[15px] font-semibold text-foreground hover:text-primary transition-colors">Home</Link>
            <Link to={`/store/${slug}/products`} onClick={() => setMobileMenuOpen(false)} className="block py-2 text-[15px] font-semibold text-foreground hover:text-primary transition-colors">Products</Link>
            <Link to={`/store/${slug}/about`} onClick={() => setMobileMenuOpen(false)} className="block py-2 text-[15px] font-semibold text-foreground hover:text-primary transition-colors">About</Link>
          </div>
        )}
      </nav>

      {/* Hero */}
      {!searchQuery && (
        <section className="relative overflow-hidden bg-gradient-to-br from-primary/10 via-background to-accent">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,hsl(var(--primary)/0.08),transparent_60%)]" />
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24 relative z-10">
            <div className="flex flex-col items-center text-center">
              {company.logo_url && (
                <img src={company.logo_url} alt={company.name} className="h-24 sm:h-32 w-auto mb-6 drop-shadow-sm" />
              )}
              <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight mb-6 animate-fade-in-up text-foreground">
                {company.name}
              </h1>
              <p className="text-lg sm:text-xl text-muted-foreground mb-8 max-w-2xl font-medium animate-fade-in-up delay-100">
                Browse our catalog, add items to your list, and send your order directly via WhatsApp.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center animate-fade-in-up delay-200">
                <Button size="lg" className="h-12 px-8 font-bold text-base shadow-lg hover:shadow-xl transition-all hover:-translate-y-0.5" asChild>
                  <Link to={`/store/${slug}/products`}>
                    Browse Entire Catalog <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="h-12 px-8 font-bold text-base bg-background/50 backdrop-blur-sm border-2 hover:bg-background" asChild>
                  <Link to={`/store/${slug}/cart`}>View Current Cart</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Search Results Header */}
      {searchQuery && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
          <h2 className="text-xl sm:text-2xl font-bold bg-muted/50 p-4 rounded-xl border border-border inline-block">
            Search results for <span className="text-primary italic">"{searchQuery}"</span>
          </h2>
        </div>
      )}

      {/* Trending */}
      {(trending.length > 0 || trendingLoading) && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
          <div className="flex items-center justify-between mb-8 pb-4 border-b border-border/50">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 p-2 rounded-lg">
                <TrendingUp className="h-6 w-6 text-primary" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Trending Now</h2>
            </div>
            {!searchQuery && (
              <Button variant="ghost" className="hidden sm:flex font-semibold hover:bg-muted" asChild>
                <Link to={`/store/${slug}/products`}>View All <ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
            )}
          </div>
          {trendingLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-6">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="aspect-[3/4] rounded-2xl" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-6">
              {trending.map((p) => <ProductCard key={p.id} product={p} />)}
            </div>
          )}
        </section>
      )}

      {/* Latest */}
      {(latest.length > 0 || latestLoading) && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
          <div className="flex items-center justify-between mb-8 pb-4 border-b border-border/50">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 p-2 rounded-lg">
                <Package className="h-6 w-6 text-primary" />
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">Latest Arrivals</h2>
            </div>
            {!searchQuery && (
              <Button variant="ghost" className="hidden sm:flex font-semibold hover:bg-muted" asChild>
                <Link to={`/store/${slug}/products`}>View All <ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
            )}
          </div>
          {latestLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-6">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="aspect-[3/4] rounded-2xl" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-6">
              {latest.map((p) => <ProductCard key={p.id} product={p} />)}
            </div>
          )}
        </section>
      )}

      {searchQuery && trending.length === 0 && latest.length === 0 && (
        <div className="text-center py-20 px-4">
          <Search className="h-16 w-16 mx-auto mb-4 text-muted-foreground/30" />
          <h3 className="text-2xl font-bold mb-2">No matching products</h3>
          <p className="text-muted-foreground text-lg">We couldn't find anything matching "{searchQuery}".<br />Try double-checking your spelling or using different keywords.</p>
          <Button className="mt-6" variant="outline" onClick={() => setSearchQuery("")}>Clear Search</Button>
        </div>
      )}

      {/* Survey Section */}
      {!searchQuery && (
        <section className="bg-secondary/20 border-y py-16 sm:py-24">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-10">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4 scale-110 shadow-sm border border-primary/20">
                <MessageSquare className="h-8 w-8 text-primary" />
              </div>
              <h2 className="text-3xl font-extrabold tracking-tight">How was your experience?</h2>
              <p className="text-base text-muted-foreground mt-3 font-medium">We'd love to hear your feedback about our catalog!</p>
            </div>

            {surveyDone ? (
              <Card className="border-green-500/30 bg-green-500/5 shadow-sm transform transition-all duration-500 animate-in fade-in zoom-in">
                <CardContent className="p-10 text-center">
                  <Star className="h-16 w-16 text-yellow-500 mx-auto mb-4 fill-yellow-500 drop-shadow-sm" />
                  <h3 className="font-extrabold text-2xl mb-2 text-foreground">Thank you!</h3>
                  <p className="text-muted-foreground font-medium text-lg">Your feedback helps us improve. We appreciate you taking the time!</p>
                </CardContent>
              </Card>
            ) : (
              <Card className="shadow-lg border-border/50">
                <CardContent className="p-6 sm:p-8">
                  <form onSubmit={handleSurveySubmit} className="space-y-6">
                    <div className="grid md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <Label htmlFor="survey-name" className="text-sm font-bold">Your Name <span className="text-primary">*</span></Label>
                        <Input
                          id="survey-name"
                          value={surveyName}
                          onChange={(e) => setSurveyName(e.target.value)}
                          placeholder="What should we call you?"
                          required
                          maxLength={100}
                          className="bg-background h-11"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-sm font-bold">I am a... <span className="text-primary">*</span></Label>
                        <Select value={surveyRole} onValueChange={setSurveyRole}>
                          <SelectTrigger className="bg-background h-11 text-foreground">
                            <SelectValue placeholder="Select your role" />
                          </SelectTrigger>
                          <SelectContent className="bg-popover border-border">
                            <SelectItem value="customer" className="font-medium cursor-pointer">Customer</SelectItem>
                            <SelectItem value="user" className="font-medium cursor-pointer">User / Browser</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <Label className="text-sm font-bold">Rate your experience <span className="text-primary">*</span></Label>
                      <div className="flex gap-2 bg-background border rounded-xl p-4 justify-center sm:justify-start">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            type="button"
                            className="p-1.5 transition-transform hover:scale-125 focus:outline-none"
                            onMouseEnter={() => setSurveyHoveredStar(star)}
                            onMouseLeave={() => setSurveyHoveredStar(0)}
                            onClick={() => setSurveyRating(star)}
                          >
                            <Star
                              className={`h-10 w-10 transition-colors ${star <= (surveyHoveredStar || surveyRating)
                                ? "text-yellow-400 fill-yellow-400 drop-shadow-sm"
                                : "text-muted-foreground/20"
                                }`}
                            />
                          </button>
                        ))}
                        {surveyRating > 0 && (
                          <span className="text-base font-bold text-foreground self-center ml-4 bg-muted px-4 py-1.5 rounded-full border">
                            {surveyRating === 1 ? "Poor" : surveyRating === 2 ? "Fair" : surveyRating === 3 ? "Good" : surveyRating === 4 ? "Very Good" : "Excellent!"}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="survey-suggestion" className="text-sm font-bold">Any suggestions? <span className="text-muted-foreground font-normal">(optional)</span></Label>
                      <Textarea
                        id="survey-suggestion"
                        value={surveySuggestion}
                        onChange={(e) => setSurveySuggestion(e.target.value)}
                        placeholder="Tell us how we can improve your catalog browsing experience..."
                        rows={4}
                        maxLength={500}
                        className="bg-background resize-none text-base p-4"
                      />
                    </div>

                    <Button type="submit" className="w-full h-12 text-base font-bold shadow-sm hover:shadow-md transition-all" disabled={surveySending}>
                      {surveySending ? "Submitting securely..." : "Submit Feedback"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="border-t bg-card mt-auto transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex flex-col items-center md:items-start text-center md:text-left gap-4">
              {company.logo_url ? (
                <img src={company.logo_url} alt={company.name} className="h-12 w-auto grayscale opacity-80 hover:grayscale-0 hover:opacity-100 transition-all" />
              ) : (
                <Store className="h-8 w-8 text-primary/70" />
              )}
              <div>
                <p className="font-bold text-lg text-foreground">{company.name}</p>
                {company.phone && <p className="text-sm text-muted-foreground font-medium mt-1">WhatsApp: {company.phone}</p>}
              </div>
            </div>
            <div className="flex flex-col items-center md:items-end gap-4 border-t md:border-t-0 pt-6 md:pt-0 w-full md:w-auto">
              <Button variant="outline" className="font-semibold" asChild>
                <Link to={`/store/${slug}/about`}>About Us</Link>
              </Button>
              <p className="text-sm text-muted-foreground font-medium">
                Powered by <Link to="/" className="text-primary hover:underline font-bold">CatalogShare</Link>
              </p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default StoreFront;
