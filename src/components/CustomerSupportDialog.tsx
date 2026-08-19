import { useState } from "react";
import { SUPPORT_PHONE, SUPPORT_PHONE_DIGITS, SUPPORT_PHONE_ENABLED } from "@/lib/appInfo";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Mail, Phone, Lock } from "lucide-react";
import { useEntitlement } from "@/hooks/useEntitlement";

interface CustomerSupportDialogProps {
    children?: React.ReactNode;
    /**
     * @deprecated Ignored — `plan === "pro"` hid the phone line from the ₹499
     * Monthly Support subscribers that CustomerCare.tsx promises priority phone
     * support to. Kept so existing call sites keep compiling.
     */
    plan?: string;
    externalOpen?: boolean;
    onExternalOpenChange?: (open: boolean) => void;
}

export function CustomerSupportDialog({ children, externalOpen, onExternalOpenChange }: CustomerSupportDialogProps) {
    const [internalOpen, setInternalOpen] = useState(false);
    const { entitlement } = useEntitlement();
    const canCall = entitlement.supportPhoneUnlocked;

    // Determine if we're in externally controlled mode
    const isExternallyControlled = externalOpen !== undefined;
    const open = isExternallyControlled ? externalOpen : internalOpen;
    const setOpen = isExternallyControlled
        ? (v: boolean) => onExternalOpenChange?.(v)
        : setInternalOpen;

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            {children && (
                <DialogTrigger asChild>
                    {children}
                </DialogTrigger>
            )}
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle className="text-center text-xl font-bold">Customer Support</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-4 py-4">
                    <Button asChild variant="outline" className="h-auto py-5 flex flex-col gap-3 relative overflow-hidden group shadow-sm hover:border-primary/50">
                        <a href="mailto:catalogshare123@gmail.com?subject=customer%20care%20support">
                            <div className="bg-primary/10 p-3 rounded-full group-hover:bg-primary/20 transition-colors">
                                <Mail className="h-6 w-6 text-primary group-hover:scale-110 transition-transform" />
                            </div>
                            <div className="text-center">
                                <span className="font-semibold block text-base border-b-0">Email Support</span>
                                <span className="text-sm text-muted-foreground mt-1 block">catalogshare123@gmail.com</span>
                            </div>
                        </a>
                    </Button>

                    <Button
                        asChild={canCall}
                        variant="outline"
                        disabled={!canCall}
                        className={`h-auto py-5 flex flex-col gap-3 relative overflow-hidden group shadow-sm ${!canCall ? 'opacity-80 bg-muted/30 border-dashed cursor-not-allowed' : 'hover:border-primary/50'}`}
                    >
                        {canCall ? (
                            <a href={`tel:${SUPPORT_PHONE_DIGITS}`}>
                                <div className="bg-primary/10 p-3 rounded-full group-hover:bg-primary/20 transition-colors">
                                    <Phone className="h-6 w-6 text-primary group-hover:scale-110 transition-transform" />
                                </div>
                                <div className="text-center">
                                    <span className="font-semibold block text-base border-b-0">Call Support</span>
                                    <span className="text-sm text-muted-foreground mt-1 block">{SUPPORT_PHONE}</span>
                                </div>
                            </a>
                        ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center p-0">
                                <div className="bg-muted p-3 rounded-full mb-3">
                                    <Phone className="h-6 w-6 text-muted-foreground" />
                                </div>
                                <div className="text-center">
                                    <span className="font-semibold block text-muted-foreground text-base">Call Support</span>
                                    <span className="text-xs font-semibold text-amber-600 bg-amber-500/10 px-3 py-1 rounded-full flex items-center justify-center gap-1.5 mt-2 mx-auto w-max">
                                        <Lock className="h-3 w-3" /> PRO &amp; SUPPORT PLANS
                                    </span>
                                </div>
                            </div>
                        )}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
