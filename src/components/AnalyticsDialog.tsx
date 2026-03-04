import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BarChart3, Users, MessageCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface AnalyticsDialogProps {
    companyId: string;
}

export function AnalyticsDialog({ companyId }: AnalyticsDialogProps) {
    const [open, setOpen] = useState(false);

    const { data: analytics, isLoading } = useQuery({
        queryKey: ["admin-analytics", companyId],
        queryFn: async () => {
            const { data, error } = await supabase
                .from("analytics_events")
                .select("event_type")
                .eq("company_id", companyId);

            if (error) throw error;

            return {
                visitors: data?.filter(e => e.event_type === "page_view").length || 0,
                whatsappClicks: data?.filter(e => e.event_type === "whatsapp_click").length || 0
            };
        },
        enabled: !!companyId && open,
    });

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" className="h-full py-4 px-6 bg-card hover:bg-muted text-foreground font-medium text-base rounded-xl transition-all shadow-sm w-full sm:w-auto">
                    <BarChart3 className="h-5 w-5 sm:mr-2" />
                    <span className="hidden sm:inline">Analytics</span>
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <BarChart3 className="h-5 w-5 text-primary" />
                        Store Analytics
                    </DialogTitle>
                </DialogHeader>

                <div className="grid grid-cols-2 gap-4 py-4">
                    <Card className="bg-primary/5 border-primary/20">
                        <CardContent className="p-6 flex flex-col items-center justify-center text-center space-y-2">
                            <div className="p-3 bg-primary/10 rounded-full">
                                <Users className="h-6 w-6 text-primary" />
                            </div>
                            <p className="text-sm font-medium text-muted-foreground">Total Visitors</p>
                            {isLoading ? (
                                <Skeleton className="h-8 w-16 mx-auto" />
                            ) : (
                                <h3 className="text-3xl font-bold text-foreground">{analytics?.visitors || 0}</h3>
                            )}
                        </CardContent>
                    </Card>

                    <Card className="bg-green-500/5 border-green-500/20">
                        <CardContent className="p-6 flex flex-col items-center justify-center text-center space-y-2">
                            <div className="p-3 bg-green-500/10 rounded-full">
                                <MessageCircle className="h-6 w-6 text-green-600" />
                            </div>
                            <p className="text-sm font-medium text-muted-foreground">WhatsApp Clicks</p>
                            {isLoading ? (
                                <Skeleton className="h-8 w-16 mx-auto" />
                            ) : (
                                <h3 className="text-3xl font-bold text-foreground">{analytics?.whatsappClicks || 0}</h3>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </DialogContent>
        </Dialog>
    );
}
