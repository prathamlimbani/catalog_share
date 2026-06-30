import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Heart, Sparkles, Crown } from "lucide-react";
import { useRazorpaySubscription } from "@/hooks/useRazorpaySubscription";

export function SupportPromoDialog({ company }: { company: any }) {
    const [open, setOpen] = useState(false);
    const { subscribe, loading } = useRazorpaySubscription(
        company?.id || "",
        company?.name || "",
        company?.email || ""
    );

    useEffect(() => {
        if (!company) return;
        
        // Don't show if they are already on support or pro plan
        if (company.subscription_plan === "support" || company.subscription_plan === "pro") return;
        
        const lastPopupDate = localStorage.getItem("lastSupportPopupDate");
        const today = new Date().toISOString().split("T")[0];
        
        // Use a timeout to ensure it pops up smoothly after the page loads
        if (lastPopupDate !== today) {
            const timer = setTimeout(() => {
                setOpen(true);
                localStorage.setItem("lastSupportPopupDate", today);
            }, 1000); // 1 second delay
            return () => clearTimeout(timer);
        }
    }, [company]);

    if (!company) return null;

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="sm:max-w-md border-rose-200 shadow-xl shadow-rose-500/10">
                <DialogHeader>
                    <DialogTitle className="flex items-center justify-center gap-2 text-2xl font-bold text-rose-600 mb-2">
                        <Heart className="h-7 w-7 fill-rose-500 text-rose-500 animate-pulse" />
                        Support Our Platform
                    </DialogTitle>
                    <DialogDescription className="text-center text-base">
                        Get our Monthly Support Subscription for just <strong className="text-foreground">₹499/month</strong>!
                    </DialogDescription>
                </DialogHeader>
                
                <div className="py-4 px-2">
                    <div className="bg-rose-50/50 rounded-xl p-4 border border-rose-100 mb-4">
                        <p className="text-sm text-rose-900 font-medium mb-3">By subscribing, you unlock all Pro features and help us keep improving the platform:</p>
                        <ul className="space-y-2.5 text-sm text-rose-800">
                            <li className="flex items-center gap-2">
                                <Crown className="h-4 w-4 text-rose-500 shrink-0" />
                                <span><strong>Priority Support</strong> & Call Assistance</span>
                            </li>
                            <li className="flex items-center gap-2">
                                <Sparkles className="h-4 w-4 text-rose-500 shrink-0" />
                                <span><strong>Unlimited</strong> Products & Custom Branding</span>
                            </li>
                            <li className="flex items-center gap-2">
                                <Heart className="h-4 w-4 text-rose-500 shrink-0" />
                                <span>Fund new features like this Estimate tool</span>
                            </li>
                        </ul>
                    </div>
                </div>

                <DialogFooter className="flex-col sm:flex-row gap-3 sm:justify-between">
                    <Button variant="outline" className="w-full sm:w-auto text-muted-foreground" onClick={() => setOpen(false)} disabled={loading}>
                        Maybe Later
                    </Button>
                    <Button 
                        className="w-full sm:w-auto bg-gradient-to-r from-rose-600 to-pink-600 hover:from-rose-700 hover:to-pink-700 text-white font-bold shadow-md shadow-rose-500/20" 
                        disabled={loading}
                        onClick={() => subscribe("support", "Monthly Support Subscription", 499, () => setOpen(false))}
                    >
                        <Heart className="h-4 w-4 mr-2" /> Subscribe Now
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
