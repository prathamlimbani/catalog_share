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
import { ArrowRight, TrendingUp, Package, Store, ShoppingCart, Star, MessageSquare, Menu, X } from "lucide-react";
import { useCart } from "@/contexts/CartContext";
import ThemeToggle from "@/components/ThemeToggle";
import useStoreTheme from "@/hooks/useStoreTheme";
import { useState } from "react";
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

  const { data: trending, isLoading: trendingLoading } = useQuery({
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

  const { data: latest, isLoading: latestLoading } = useQuery({
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
    <div className="min-h-screen">
      {/* Store Navbar */}
      <nav className="sticky top-0 z-50 bg-card/80 backdrop-blur-md border-b overflow-x-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 min-w-0">
            <Link to={`/store/${slug}`} className="flex items-center gap-2 min-w-0 flex-shrink-0">
              {company.logo_url ? (
                <img src={company.logo_url} alt={company.name} className="h-10 w-auto flex-shrink-0" />
              ) : (
                <Store className="h-6 w-6 text-primary flex-shrink-0" />
              )}
              <span className="font-bold text-lg hidden sm:block truncate">{company.name}</span>
            </Link>
            <div className="flex items-center gap-1 sm:gap-3 flex-shrink-0">
              <Link to={`/store/${slug}/products`} className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors hidden sm:block">Products</Link>
              <Link to={`/store/${slug}/about`} className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors hidden sm:block">About</Link>
              <ThemeToggle />
              <Link to={`/store/${slug}/cart`} className="relative">
                <Button variant="outline" size="icon">
                  <ShoppingCart className="h-5 w-5" />
                </Button>
                {totalItems > 0 && (
                  <span className="absolute -top-2 -right-2 bg-primary text-primary-foreground text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">
                    {totalItems}
                  </span>
                )}
              </Link>
              <Button variant="ghost" size="icon" className="sm:hidden" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            </div>
          </div>
        </div>
        {mobileMenuOpen && (
          <div className="sm:hidden border-t bg-card p-4 space-y-2 animate-fade-in">
            <Link to={`/store/${slug}`} onClick={() => setMobileMenuOpen(false)} className="block py-2 text-sm font-medium">Home</Link>
            <Link to={`/store/${slug}/products`} onClick={() => setMobileMenuOpen(false)} className="block py-2 text-sm font-medium">Products</Link>
            <Link to={`/store/${slug}/about`} onClick={() => setMobileMenuOpen(false)} className="block py-2 text-sm font-medium">About</Link>
          </div>
        )}
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary/10 via-background to-accent">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,hsl(var(--primary)/0.08),transparent_60%)]" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-32 relative z-10">
          <div className="flex flex-col items-center text-center">
            {company.logo_url && (
              <img src={company.logo_url} alt={company.name} className="h-28 sm:h-36 w-auto mb-6" />
            )}
            <h1 className="text-2xl sm:text-4xl lg:text-6xl font-bold tracking-tight mb-6 animate-fade-in-up">
              {company.name}
            </h1>
            <p className="text-lg text-muted-foreground mb-8 max-w-lg animate-fade-in-up delay-100">
              Browse our catalog, add items to your list, and send your order directly via WhatsApp.
            </p>
            <div className="flex flex-wrap gap-3 justify-center animate-fade-in-up delay-200">
              <Button size="lg" asChild>
                <Link to={`/store/${slug}/products`}>
                  Browse Products <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link to={`/store/${slug}/cart`}>View Cart</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Trending */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <TrendingUp className="h-6 w-6 text-primary" />
            <h2 className="text-2xl sm:text-3xl font-bold">Trending Now</h2>
          </div>
          <Button variant="ghost" asChild>
            <Link to={`/store/${slug}/products`}>View All <ArrowRight className="ml-1 h-4 w-4" /></Link>
          </Button>
        </div>
        {trendingLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="aspect-square rounded-xl" />)}
          </div>
        ) : trending && trending.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {trending.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <TrendingUp className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>No trending products yet.</p>
          </div>
        )}
      </section>

      {/* Latest */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <Package className="h-6 w-6 text-primary" />
            <h2 className="text-2xl sm:text-3xl font-bold">Latest Products</h2>
          </div>
          <Button variant="ghost" asChild>
            <Link to={`/store/${slug}/products`}>View All <ArrowRight className="ml-1 h-4 w-4" /></Link>
          </Button>
        </div>
        {latestLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="aspect-square rounded-xl" />)}
          </div>
        ) : latest && latest.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {latest.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <Package className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>No products yet. Check back soon!</p>
          </div>
        )}
      </section>

      {/* Survey Section */}
      <section className="bg-card/50 border-y">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="text-center mb-8">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
              <MessageSquare className="h-6 w-6 text-primary" />
            </div>
            <h2 className="text-2xl font-bold">How was your experience?</h2>
            <p className="text-sm text-muted-foreground mt-2">We'd love to hear your feedback about our catalog!</p>
          </div>

          {surveyDone ? (
            <Card className="border-green-500/30 bg-green-500/5">
              <CardContent className="p-8 text-center">
                <Star className="h-12 w-12 text-yellow-500 mx-auto mb-3 fill-yellow-500" />
                <h3 className="font-bold text-lg mb-1">Thank you!</h3>
                <p className="text-muted-foreground">Your feedback helps us improve. We appreciate you taking the time!</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-6">
                <form onSubmit={handleSurveySubmit} className="space-y-5">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="survey-name">Your Name *</Label>
                      <Input
                        id="survey-name"
                        value={surveyName}
                        onChange={(e) => setSurveyName(e.target.value)}
                        placeholder="Enter your name"
                        required
                        maxLength={100}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>I am a... *</Label>
                      <Select value={surveyRole} onValueChange={setSurveyRole}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select your role" />
                        </SelectTrigger>
                        <SelectContent className="bg-card z-50">
                          <SelectItem value="customer">Customer</SelectItem>
                          <SelectItem value="user">User / Browser</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Rate your experience *</Label>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          className="p-1 transition-transform hover:scale-110"
                          onMouseEnter={() => setSurveyHoveredStar(star)}
                          onMouseLeave={() => setSurveyHoveredStar(0)}
                          onClick={() => setSurveyRating(star)}
                        >
                          <Star
                            className={`h-8 w-8 transition-colors ${star <= (surveyHoveredStar || surveyRating)
                              ? "text-yellow-500 fill-yellow-500"
                              : "text-muted-foreground/30"
                              }`}
                          />
                        </button>
                      ))}
                      {surveyRating > 0 && (
                        <span className="text-sm text-muted-foreground self-center ml-2">
                          {surveyRating === 1 ? "Poor" : surveyRating === 2 ? "Fair" : surveyRating === 3 ? "Good" : surveyRating === 4 ? "Very Good" : "Excellent"}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="survey-suggestion">Any suggestions? (optional)</Label>
                    <Textarea
                      id="survey-suggestion"
                      value={surveySuggestion}
                      onChange={(e) => setSurveySuggestion(e.target.value)}
                      placeholder="Tell us how we can improve..."
                      rows={3}
                      maxLength={500}
                    />
                  </div>

                  <Button type="submit" className="w-full" disabled={surveySending}>
                    {surveySending ? "Submitting..." : "Submit Feedback"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {company.logo_url ? (
                <img src={company.logo_url} alt={company.name} className="h-10 w-auto" />
              ) : (
                <Store className="h-5 w-5 text-primary" />
              )}
              <div className="text-center sm:text-left">
                <p className="font-bold">{company.name}</p>
                {company.phone && <p className="text-sm text-muted-foreground">WhatsApp: {company.phone}</p>}
              </div>
            </div>
            <div className="flex flex-col items-center sm:items-end gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link to={`/store/${slug}/about`}>About Us</Link>
              </Button>
              <p className="text-xs text-muted-foreground">
                Powered by <Link to="/" className="text-primary hover:underline">CatalogShare</Link>
              </p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default StoreFront;
