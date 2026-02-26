import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "react-router-dom";
import { ArrowRight, Store, Share2, MessageSquare, Shield, Zap, Users, Star, Send, CheckCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ThemeToggle from "@/components/ThemeToggle";

type SurveyQuestion =
  | { id: string; question: string; options: string[]; type?: undefined }
  | { id: string; question: string; type: "stars"; options?: undefined };

const SURVEY_QUESTIONS: SurveyQuestion[] = [
  {
    id: "role",
    question: "What best describes you?",
    options: ["Wholesaler / Distributor", "Retailer", "Customer / Buyer", "Just Exploring"],
  },
  {
    id: "discovery",
    question: "How did you hear about CatalogShare?",
    options: ["Google Search", "Social Media", "Friend / Colleague", "Other"],
  },
  {
    id: "feature",
    question: "What feature matters most to you?",
    options: ["Easy Catalog Creation", "WhatsApp Orders", "Custom Branding", "Product Management"],
  },
  {
    id: "rating",
    question: "How would you rate this platform?",
    type: "stars",
  },
];

/* ─── Animated Sky Background ─── */
const SkyBackground = () => {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    const check = () => setIsDark(document.documentElement.classList.contains("dark"));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none transition-colors duration-700">
      {isDark ? (
        /* ── Night Sky: Moving Stars + Moon ── */
        <>
          <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-indigo-950 to-purple-950" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(99,102,241,0.15),transparent_70%)]" />
          {/* Twinkling stars */}
          {Array.from({ length: 80 }).map((_, i) => (
            <div
              key={`star-${i}`}
              className="absolute rounded-full bg-white"
              style={{
                width: `${Math.random() * 2.5 + 0.5}px`,
                height: `${Math.random() * 2.5 + 0.5}px`,
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
                opacity: Math.random() * 0.7 + 0.2,
                animation: `twinkle ${Math.random() * 3 + 2}s ease-in-out infinite, drift ${Math.random() * 40 + 30}s linear infinite`,
                animationDelay: `${Math.random() * 5}s`,
              }}
            />
          ))}
          {/* Moon */}
          <div className="absolute top-12 right-[15%] w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gradient-to-br from-yellow-100 to-yellow-200 shadow-[0_0_40px_rgba(255,255,200,0.3)] animate-float" />
          <div className="absolute top-14 right-[16%] w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-gradient-to-br from-slate-950 to-indigo-950" />
        </>
      ) : (
        /* ── Day Sky: Sun + Clouds + Blue Sky ── */
        <>
          <div className="absolute inset-0 bg-gradient-to-b from-sky-400 via-sky-300 to-cyan-200" />
          {/* Sun with glow */}
          <div className="absolute top-10 right-[18%] animate-float">
            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-gradient-to-br from-yellow-300 to-orange-400 shadow-[0_0_60px_rgba(255,200,50,0.5),0_0_120px_rgba(255,200,50,0.2)]" />
            {/* Sun rays */}
            <div className="absolute inset-0 animate-spin" style={{ animationDuration: "20s" }}>
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={`ray-${i}`}
                  className="absolute w-0.5 h-6 bg-yellow-300/40 rounded-full"
                  style={{
                    top: "50%",
                    left: "50%",
                    transformOrigin: "0 0",
                    transform: `rotate(${i * 45}deg) translate(-50%, -140%)`,
                  }}
                />
              ))}
            </div>
          </div>
          {/* Floating clouds */}
          <Cloud className="top-[15%] -left-[5%] w-32 sm:w-48" dur="35s" delay="0s" />
          <Cloud className="top-[30%] left-[60%] w-24 sm:w-36" dur="45s" delay="5s" />
          <Cloud className="top-[10%] left-[30%] w-20 sm:w-28" dur="40s" delay="12s" />
          <Cloud className="top-[50%] left-[80%] w-28 sm:w-40" dur="50s" delay="8s" />
          <Cloud className="top-[40%] -left-[10%] w-36 sm:w-52" dur="55s" delay="20s" />
        </>
      )}
    </div>
  );
};

const Cloud = ({ className, dur, delay }: { className: string; dur: string; delay: string }) => (
  <div
    className={`absolute ${className} opacity-90`}
    style={{ animation: `cloudDrift ${dur} linear infinite`, animationDelay: delay }}
  >
    <svg viewBox="0 0 200 80" fill="white" className="drop-shadow-lg">
      <ellipse cx="70" cy="50" rx="50" ry="25" opacity="0.9" />
      <ellipse cx="100" cy="35" rx="40" ry="30" />
      <ellipse cx="130" cy="50" rx="45" ry="22" opacity="0.9" />
      <ellipse cx="90" cy="55" rx="60" ry="20" opacity="0.85" />
    </svg>
  </div>
);

const Landing = () => {
  const [surveyStep, setSurveyStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [surveyName, setSurveyName] = useState("");
  const [surveySubmitted, setSurveySubmitted] = useState(false);
  const [surveyLoading, setSurveyLoading] = useState(false);
  const [suggestion, setSuggestion] = useState("");

  const handleAnswer = (questionId: string, answer: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: answer }));
    if (surveyStep < SURVEY_QUESTIONS.length - 1) {
      setTimeout(() => setSurveyStep((s) => s + 1), 300);
    }
  };

  const handleSubmitSurvey = async () => {
    if (!surveyName.trim()) {
      toast.error("Please enter your name");
      return;
    }
    if (rating === 0) {
      toast.error("Please select a rating");
      return;
    }
    setSurveyLoading(true);
    try {
      const { error } = await supabase.from("surveys").insert({
        name: surveyName.trim(),
        role: answers.role || "unknown",
        rating,
        suggestion: [
          answers.discovery ? `Discovery: ${answers.discovery}` : "",
          answers.feature ? `Top Feature: ${answers.feature}` : "",
          suggestion ? `Feedback: ${suggestion}` : "",
        ].filter(Boolean).join(" | "),
      });
      if (error) throw error;
      setSurveySubmitted(true);
      toast.success("Thank you for your feedback!");
    } catch (err: any) {
      toast.error(err.message || "Failed to submit");
    } finally {
      setSurveyLoading(false);
    }
  };

  const currentQ = SURVEY_QUESTIONS[surveyStep];

  return (
    <div className="min-h-screen">
      {/* Header — Glassy */}
      <header className="border-b border-border/50 bg-background/60 backdrop-blur-xl backdrop-saturate-150 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          <Link to="/" className="flex items-center gap-2">
            <Store className="h-6 w-6 text-primary" />
            <span className="font-bold text-lg text-foreground">CatalogShare</span>
          </Link>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <Button variant="ghost" className="text-foreground" asChild>
              <Link to="/about">About</Link>
            </Button>
            <Button variant="ghost" className="text-foreground" asChild>
              <Link to="/login">Login</Link>
            </Button>
            <Button asChild>
              <Link to="/register">Get Started</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero with animated sky */}
      <section className="relative overflow-hidden min-h-[85vh] flex items-center">
        <SkyBackground />
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-24 sm:py-36 text-center relative z-10">
          <div className="inline-flex items-center gap-2 bg-white/20 dark:bg-white/10 backdrop-blur-sm border border-white/30 dark:border-white/20 rounded-full px-4 py-1.5 text-sm mb-6 animate-fade-in-up">
            <Zap className="h-3.5 w-3.5 text-yellow-500 dark:text-yellow-400" />
            <span className="text-slate-800 dark:text-white/80">Free for wholesalers</span>
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-7xl font-bold tracking-tight mb-6 animate-fade-in-up">
            <span className="text-white drop-shadow-lg dark:drop-shadow-none">Your Wholesale Catalog,</span>
            <span className="block mt-2 bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 dark:from-indigo-400 dark:via-purple-400 dark:to-pink-400 bg-clip-text text-transparent">
              One Link Away
            </span>
          </h1>
          <p className="text-lg sm:text-xl text-slate-700/80 dark:text-white/60 mb-10 max-w-2xl mx-auto animate-fade-in-up" style={{ animationDelay: "0.1s" }}>
            Create your online product catalog in minutes. Share a single link with customers.
            Receive orders directly on WhatsApp. Built for wholesalers.
          </p>
          <div className="flex flex-wrap gap-4 justify-center animate-fade-in-up" style={{ animationDelay: "0.2s" }}>
            <Button size="lg" className="bg-indigo-500 hover:bg-indigo-600 text-white shadow-lg shadow-indigo-500/25" asChild>
              <Link to="/register">
                Create Your Catalog <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="border-white/40 dark:border-white/20 text-slate-800 dark:text-white bg-white/30 dark:bg-transparent hover:bg-white/50 dark:hover:bg-white/10 backdrop-blur-sm" asChild>
              <Link to="/login">I already have an account</Link>
            </Button>
          </div>
        </div>
        {/* Gradient fade to next section */}
        <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-background to-transparent" />
      </section>

      {/* How It Works */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <h2 className="text-2xl sm:text-3xl font-bold text-center mb-4">How It Works</h2>
        <p className="text-center text-muted-foreground mb-12 max-w-lg mx-auto">Get your product catalog online in 3 simple steps</p>
        <div className="grid sm:grid-cols-3 gap-8">
          {[
            { icon: Store, title: "1. Register & Set Up", desc: "Create your company profile with name, logo, contact details, and custom branding.", color: "from-blue-500/20 to-indigo-500/20" },
            { icon: Share2, title: "2. Add Products & Share", desc: "Upload your product catalog and share a unique link with all your customers.", color: "from-purple-500/20 to-pink-500/20" },
            { icon: MessageSquare, title: "3. Receive Orders", desc: "Customers browse and send orders directly to your WhatsApp. Simple!", color: "from-emerald-500/20 to-teal-500/20" },
          ].map((f) => (
            <Card key={f.title} className="text-center border-border/50 card-hover group overflow-hidden relative">
              <div className={`absolute inset-0 bg-gradient-to-br ${f.color} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
              <CardContent className="pt-8 pb-6 px-6 relative z-10">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4 animate-float">
                  <f.icon className="h-7 w-7 text-primary" />
                </div>
                <h3 className="font-bold text-lg mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground">{f.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Benefits */}
      <section className="bg-card border-y">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-12">Why CatalogShare?</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: Zap, title: "Quick Setup", desc: "Get your catalog online in under 5 minutes." },
              { icon: Shield, title: "Admin Dashboard", desc: "Full control over your products, categories, and stock." },
              { icon: Users, title: "Customer Friendly", desc: "Customers browse and order without creating accounts." },
              { icon: Share2, title: "One Link", desc: "Share a single link for your entire catalog." },
              { icon: MessageSquare, title: "WhatsApp Orders", desc: "Orders come directly to your WhatsApp number." },
              { icon: Store, title: "Custom Branding", desc: "Your logo, your colors, your brand identity." },
            ].map((b) => (
              <div key={b.title} className="flex items-start gap-4 p-4 rounded-xl hover:bg-accent/50 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <b.icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold mb-1">{b.title}</h3>
                  <p className="text-sm text-muted-foreground">{b.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Survey Section — Theme Aware */}
      <section className="relative overflow-hidden">
        <SkyBackground />
        <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-20 relative z-10">
          <div className="text-center mb-8">
            <h2 className="text-2xl sm:text-3xl font-bold mb-3 text-white drop-shadow-lg">Quick Survey</h2>
            <p className="text-slate-200 dark:text-white/60">Help us improve — takes less than 30 seconds!</p>
          </div>

          {surveySubmitted ? (
            <Card className="bg-white/20 dark:bg-white/10 backdrop-blur-md border-white/30 dark:border-white/20">
              <CardContent className="p-8 text-center">
                <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle className="h-8 w-8 text-green-400" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">Thank You!</h3>
                <p className="text-white/70">Your response has been recorded. We appreciate your feedback!</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-white/20 dark:bg-white/10 backdrop-blur-md border-white/30 dark:border-white/20">
              <CardContent className="p-6 sm:p-8">
                {/* Progress */}
                <div className="flex gap-1 mb-6">
                  {SURVEY_QUESTIONS.map((_, i) => (
                    <div
                      key={i}
                      className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${i <= surveyStep ? "bg-indigo-400" : "bg-white/20"
                        }`}
                    />
                  ))}
                </div>

                {/* Name Input */}
                <div className="mb-5">
                  <Label className="text-white/90 text-sm mb-2 block">Your Name</Label>
                  <Input
                    value={surveyName}
                    onChange={(e) => setSurveyName(e.target.value)}
                    placeholder="Enter your name"
                    className="bg-white/10 border-white/20 text-white placeholder:text-white/40"
                  />
                </div>

                {/* Questions */}
                <div className="mb-6">
                  <h3 className="font-semibold text-white mb-4">
                    {surveyStep + 1}. {currentQ.question}
                  </h3>

                  {currentQ.type === "stars" ? (
                    <div className="space-y-4">
                      <div className="flex gap-2 justify-center">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            type="button"
                            onMouseEnter={() => setHoverRating(star)}
                            onMouseLeave={() => setHoverRating(0)}
                            onClick={() => setRating(star)}
                            className="transition-transform hover:scale-125"
                          >
                            <Star
                              className={`h-10 w-10 transition-colors ${star <= (hoverRating || rating)
                                ? "text-yellow-400 fill-yellow-400"
                                : "text-white/30"
                                }`}
                            />
                          </button>
                        ))}
                      </div>
                      {rating > 0 && (
                        <p className="text-center text-white/60 text-sm">
                          {rating === 5 ? "Amazing! ⭐" : rating === 4 ? "Great! 👍" : rating === 3 ? "Good 👌" : rating === 2 ? "Needs improvement" : "We'll do better"}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      {(currentQ as { id: string; question: string; options: string[] }).options.map((opt) => (
                        <button
                          key={opt}
                          onClick={() => handleAnswer(currentQ.id, opt)}
                          className={`p-3 rounded-xl text-sm font-medium text-left transition-all border ${answers[currentQ.id] === opt
                            ? "bg-indigo-500 border-indigo-400 text-white shadow-lg shadow-indigo-500/25"
                            : "bg-white/5 border-white/20 text-white/80 hover:bg-white/10 hover:border-white/30"
                            }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Navigation */}
                <div className="flex items-center justify-between">
                  <div className="flex gap-2">
                    {surveyStep > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-white/60 hover:text-white hover:bg-white/10"
                        onClick={() => setSurveyStep((s) => s - 1)}
                      >
                        ← Back
                      </Button>
                    )}
                    {surveyStep < SURVEY_QUESTIONS.length - 1 && answers[currentQ.id] && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-white/60 hover:text-white hover:bg-white/10"
                        onClick={() => setSurveyStep((s) => s + 1)}
                      >
                        Next →
                      </Button>
                    )}
                  </div>
                  {surveyStep === SURVEY_QUESTIONS.length - 1 && (
                    <div className="flex-1 flex flex-col items-end gap-3">
                      <Input
                        value={suggestion}
                        onChange={(e) => setSuggestion(e.target.value)}
                        placeholder="Any suggestions? (optional)"
                        className="bg-white/10 border-white/20 text-white placeholder:text-white/40 text-sm"
                      />
                      <Button
                        onClick={handleSubmitSurvey}
                        disabled={surveyLoading}
                        className="bg-indigo-500 hover:bg-indigo-600 shadow-lg shadow-indigo-500/25"
                      >
                        {surveyLoading ? "Sending..." : (
                          <>Submit <Send className="ml-2 h-4 w-4" /></>
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-background to-transparent" />
      </section>

      {/* CTA */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
        <h2 className="text-2xl sm:text-3xl font-bold mb-4">Ready to digitize your catalog?</h2>
        <p className="text-muted-foreground mb-8">
          Join wholesalers who are already sharing their catalogs online. Free to get started.
        </p>
        <Button size="lg" asChild>
          <Link to="/register">
            Create Your Catalog Now <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </section>

      {/* Footer */}
      <footer className="border-t bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Store className="h-5 w-5 text-primary" />
              <span className="font-bold">CatalogShare</span>
            </div>
            <div className="text-sm text-muted-foreground flex gap-4">
              <Link to="/about" className="hover:text-foreground transition-colors">About</Link>
              <Link to="/master-login" className="hover:text-foreground transition-colors">Admin</Link>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t text-center">
            <p className="text-xs text-muted-foreground">
              © 2026 CatalogShare. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
