import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Store, Heart, Linkedin, Globe, Send, AlertTriangle, Sparkles, Code2, ArrowLeft, Mail } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";

const About = () => {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const handleSuggestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !message.trim()) {
      toast.error("Please fill in both fields.");
      return;
    }
    setSending(true);
    try {
      const { error } = await supabase.from("suggestions").insert({
        name: name.trim(),
        message: message.trim(),
      });
      if (error) throw error;
      toast.success("Thank you for your suggestion! 💜");
      setName("");
      setMessage("");
    } catch (err: any) {
      toast.error(err.message || "Failed to submit suggestion.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen">
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

      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-to-br from-primary/10 via-background to-accent">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(var(--primary),0.08),transparent_50%)]" />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24 text-center relative z-10">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 border border-primary/20 text-sm text-primary mb-6">
            <Sparkles className="h-4 w-4" />
            Built with passion
          </div>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight mb-6">
            About <span className="text-primary">CatalogShare</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            CatalogShare is a modern platform that empowers wholesalers and businesses to create
            beautiful, shareable product catalogs in minutes. One link, infinite possibilities.
          </p>
        </div>
      </section>

      {/* Development Notice */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 -mt-4 relative z-20">
        <div className="flex items-start gap-3 p-4 rounded-xl border border-yellow-500/30 bg-yellow-500/5 backdrop-blur-sm">
          <AlertTriangle className="h-5 w-5 text-yellow-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold text-sm text-yellow-500">Platform in Development</p>
            <p className="text-sm text-muted-foreground mt-0.5">
              CatalogShare is currently in its development phase. You might encounter minor bugs or
              unfinished features. We're working hard to make it perfect — thank you for being with
              us on this journey! 🚀
            </p>
          </div>
        </div>
      </section>

      {/* Our Plans Section */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold mb-3">Our Plans</h2>
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
                <li className="flex items-center gap-2"><Sparkles className="h-3.5 w-3.5 text-purple-500 shrink-0" /> Priority Support</li>
                <li className="flex items-center gap-2"><Sparkles className="h-3.5 w-3.5 text-purple-500 shrink-0" /> Featured Listing</li>
              </ul>
            </CardContent>
          </Card>
        </div>
        <p className="text-center text-xs text-muted-foreground mt-6">
          🔒 All payments are secure via Razorpay · GPay · Visa · Mastercard
        </p>
      </section>

      {/* Vision & Story */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid md:grid-cols-2 gap-8">
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardContent className="p-6 sm:p-8">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                <Heart className="h-6 w-6 text-primary" />
              </div>
              <h2 className="text-xl font-bold mb-3">Our Vision</h2>
              <p className="text-muted-foreground leading-relaxed">
                We believe every business, no matter how small, deserves a digital presence that's
                elegant and effortless. CatalogShare bridges the gap between traditional wholesale
                and modern technology — making it simple for businesses to showcase their products
                and connect with customers through a single, beautiful link.
              </p>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardContent className="p-6 sm:p-8">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                <Code2 className="h-6 w-6 text-primary" />
              </div>
              <h2 className="text-xl font-bold mb-3">Why CatalogShare?</h2>
              <p className="text-muted-foreground leading-relaxed">
                No more PDFs, no more printed catalogs that go out of date. With CatalogShare, your
                catalog is always live, always updated, and always just one tap away. Your customers
                browse, pick what they need, and send orders directly to your WhatsApp — it's that
                simple and that powerful.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Founder Section */}
      <section className="bg-card/50 border-y">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold mb-8">Meet the Founder</h2>
          <div className="max-w-md mx-auto">
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center mx-auto mb-5 shadow-lg shadow-primary/20">
              <span className="text-3xl font-bold text-primary-foreground">PL</span>
            </div>
            <h3 className="text-xl font-bold mb-1">Pratham Limbani</h3>
            <p className="text-primary font-medium text-sm mb-4">Founder & Developer</p>
            <p className="text-muted-foreground leading-relaxed mb-6">
              Pratham envisioned CatalogShare as a tool that brings businesses into the digital age
              without the complexity. With a passion for clean design and practical solutions, he
              built CatalogShare to help wholesalers focus on what they do best — while their catalog
              works for them around the clock.
            </p>
            <Button asChild variant="outline" className="gap-2">
              <a
                href="https://www.linkedin.com/in/prathamlimbani/"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Linkedin className="h-4 w-4" />
                Connect on LinkedIn
              </a>
            </Button>
          </div>
        </div>
      </section>

      {/* Maintained By */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 text-center">
        <p className="text-sm text-muted-foreground mb-2">Maintained & Hosted by</p>
        <a
          href="https://hostingsignal.in"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-primary font-semibold text-lg hover:underline transition-colors"
        >
          <Globe className="h-5 w-5" />
          hostingsignal.in
        </a>
      </section>

      {/* Customer Care Section */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 text-center">
        <div className="bg-primary/5 rounded-2xl p-8 sm:p-12 border border-primary/10">
          <h2 className="text-2xl sm:text-3xl font-bold mb-4">Customer Care Support</h2>
          <p className="text-muted-foreground mb-6 max-w-xl mx-auto">
            Need assistance or have any queries? Our dedicated support team is here to help you out. Click below to reach out directly to us!
          </p>
          <Button asChild size="lg" className="rounded-full gap-2 px-8">
            <a href="mailto:catalogshare123@gmail.com?subject=custome%20care%20support">
              <Mail className="h-5 w-5" />
              Contact Customer Care
            </a>
          </Button>
          <div className="mt-4 inline-flex items-center justify-center gap-2 text-sm text-muted-foreground bg-background rounded-full px-4 py-2 shadow-sm border">
            <span>Direct Email:</span>
            <span className="font-semibold text-foreground">catalogshare123@gmail.com</span>
          </div>
        </div>
      </section>

      {/* Suggestion Box */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">
        <Card className="border-border/50 bg-gradient-to-br from-card to-card/80">
          <CardContent className="p-6 sm:p-8">
            <div className="text-center mb-6">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                <Send className="h-6 w-6 text-primary" />
              </div>
              <h2 className="text-xl font-bold">Suggestion Box</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Got ideas? We'd love to hear from you! Help us make CatalogShare better.
              </p>
            </div>
            <form onSubmit={handleSuggestion} className="space-y-4 max-w-md mx-auto">
              <div className="space-y-2">
                <Label htmlFor="suggestion-name">Your Name</Label>
                <Input
                  id="suggestion-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter your name"
                  required
                  maxLength={100}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="suggestion-message">Your Suggestion</Label>
                <Textarea
                  id="suggestion-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Share your thoughts, ideas, or feedback..."
                  required
                  rows={4}
                  maxLength={1000}
                />
              </div>
              <Button type="submit" className="w-full" disabled={sending}>
                {sending ? "Sending..." : "Submit Suggestion"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>

      {/* Footer */}
      <footer className="border-t bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <img src="/logo.png" alt="CatalogShare Logo" className="h-8 sm:h-10 w-auto object-contain" />
            </div>
            <p className="text-xs text-muted-foreground">
              © {new Date().getFullYear()} CatalogShare · Built by Pratham Limbani ·{" "}
              <a
                href="https://hostingsignal.in"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                hostingsignal.in
              </a>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default About;
