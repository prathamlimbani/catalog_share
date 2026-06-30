import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Store, Sparkles, ArrowLeft } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";

const Pricing = () => {
  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <header className="border-b bg-card/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          <Link to="/" className="flex items-center gap-2">
            <img src="/logo.png" alt="CatalogShare Logo" className="h-10 sm:h-12 w-auto object-contain flex-shrink-0" />
          </Link>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Button variant="ghost" asChild>
              <Link to="/">
                <ArrowLeft className="h-4 w-4 mr-1" /> Home
              </Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Our Plans Section */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-10">
          <h1 className="text-3xl sm:text-4xl font-bold mb-4">Subscription Models</h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Choose a plan that fits your business. Start free, upgrade when you grow.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          {/* Free Plan */}
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm relative overflow-hidden">
            <CardContent className="p-6 text-center">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
                <Store className="h-6 w-6 text-emerald-500" />
              </div>
              <h3 className="font-bold text-lg mb-1">Free Plan</h3>
              <p className="text-2xl font-extrabold text-emerald-600 mb-4">FREE</p>
              <ul className="text-sm text-muted-foreground space-y-2 text-left">
                <li className="flex items-center gap-2"><Sparkles className="h-3.5 w-3.5 text-emerald-500 shrink-0" /> Up to 40 Products</li>
                <li className="flex items-center gap-2"><Sparkles className="h-3.5 w-3.5 text-emerald-500 shrink-0" /> Basic Listing</li>
                <li className="flex items-center gap-2"><Sparkles className="h-3.5 w-3.5 text-emerald-500 shrink-0" /> Standard Support</li>
              </ul>
            </CardContent>
          </Card>

          {/* Growth Plan */}
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm relative overflow-hidden">
            <CardContent className="p-6 text-center">
              <div className="w-12 h-12 rounded-xl bg-blue-500/10 flex items-center justify-center mx-auto mb-4">
                <Store className="h-6 w-6 text-blue-500" />
              </div>
              <h3 className="font-bold text-lg mb-1">Growth Plan</h3>
              <p className="text-2xl font-extrabold mb-4">₹199<span className="text-sm font-normal text-muted-foreground">/month</span></p>
              <ul className="text-sm text-muted-foreground space-y-2 text-left">
                <li className="flex items-center gap-2"><Sparkles className="h-3.5 w-3.5 text-blue-500 shrink-0" /> Up to 300 Products</li>
                <li className="flex items-center gap-2"><Sparkles className="h-3.5 w-3.5 text-blue-500 shrink-0" /> Better Visibility</li>
                <li className="flex items-center gap-2"><Sparkles className="h-3.5 w-3.5 text-blue-500 shrink-0" /> Premium Themes</li>
                <li className="flex items-center gap-2"><Sparkles className="h-3.5 w-3.5 text-blue-500 shrink-0" /> Standard Support</li>
              </ul>
            </CardContent>
          </Card>

          {/* Pro Plan */}
          <Card className="border-primary/30 bg-card/50 backdrop-blur-sm relative overflow-hidden ring-1 ring-purple-500/20">
            <div className="absolute top-0 right-0 bg-purple-600 text-white text-[10px] font-bold px-2.5 py-1 rounded-bl-lg">
              POPULAR
            </div>
            <CardContent className="p-6 text-center">
              <div className="w-12 h-12 rounded-xl bg-purple-500/10 flex items-center justify-center mx-auto mb-4">
                <Store className="h-6 w-6 text-purple-500" />
              </div>
              <h3 className="font-bold text-lg mb-1">Pro Plan</h3>
              <p className="text-2xl font-extrabold mb-4">₹349<span className="text-sm font-normal text-muted-foreground">/month</span></p>
              <ul className="text-sm text-muted-foreground space-y-2 text-left">
                <li className="flex items-center gap-2"><Sparkles className="h-3.5 w-3.5 text-purple-500 shrink-0" /> 500+ Products</li>
                <li className="flex items-center gap-2"><Sparkles className="h-3.5 w-3.5 text-purple-500 shrink-0" /> Custom Branding with Logo & Domain</li>
                <li className="flex items-center gap-2"><Sparkles className="h-3.5 w-3.5 text-purple-500 shrink-0" /> Premium Themes</li>
                <li className="flex items-center gap-2"><Sparkles className="h-3.5 w-3.5 text-purple-500 shrink-0" /> Priority & Call Support</li>
                <li className="flex items-center gap-2"><Sparkles className="h-3.5 w-3.5 text-purple-500 shrink-0" /> Featured Listing</li>
              </ul>
            </CardContent>
          </Card>
        </div>
        
        <div className="text-center mt-12">
           <Button asChild size="lg" className="px-8">
             <Link to="/register">Get Started Now</Link>
           </Button>
        </div>
        
        <p className="text-center text-xs text-muted-foreground mt-6">
          🔒 All payments are secure via Razorpay · GPay · Visa · Mastercard
        </p>
      </section>
    </div>
  );
};

export default Pricing;
