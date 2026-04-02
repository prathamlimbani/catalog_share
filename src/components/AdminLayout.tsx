import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Store, Package, LogOut, Menu, Search, User, Pencil, Crown, CreditCard, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import ThemeToggle from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";
import CompanyEditDialog from "@/components/CompanyEditDialog";
import { CustomerSupportDialog } from "@/components/CustomerSupportDialog";

interface AdminLayoutProps {
    children: React.ReactNode;
    company: any;
    searchQuery: string;
    onSearchChange: (val: string) => void;
    onLogout: () => void;
}

export const AdminLayout = ({
    children,
    company,
    searchQuery,
    onSearchChange,
    onLogout
}: AdminLayoutProps) => {
    const location = useLocation();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
    const navigate = useNavigate();

    const getInitials = (name: string) => {
        return name ? name
            .split(" ")
            .map((n) => n[0])
            .join("")
            .substring(0, 2)
            .toUpperCase() : "AA";
    };

    const NavLinks = () => (
        <>
            <div className="flex items-center gap-3 px-6 py-6 border-b h-[88px]">
                {company?.logo_url ? (
                    <img src={company.logo_url} alt="Logo" className="max-h-12 w-full object-contain object-left shrink-0" />
                ) : (
                    <>
                        <div className="bg-primary text-primary-foreground p-1.5 rounded-md">
                            <Store className="h-5 w-5" />
                        </div>
                        <span className="font-bold text-xl">AdminPanel</span>
                    </>
                )}
            </div>
            <div className="flex-1 py-6 px-4 space-y-2">
                <Link
                    to="/dashboard"
                    className={cn(
                        "flex items-center gap-3 px-4 py-3 rounded-xl transition-colors font-medium",
                        location.pathname === "/dashboard" || location.pathname === "/dashboard/"
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                    onClick={() => setMobileMenuOpen(false)}
                >
                    <Package className="h-5 w-5" />
                    Products
                </Link>

                {company && (
                    <CompanyEditDialog company={company}>
                        <button
                            onClick={() => setMobileMenuOpen(false)}
                            className="flex items-center gap-3 px-4 py-3 w-full text-left rounded-xl transition-colors font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                            <Pencil className="h-5 w-5" />
                            Edit Company
                        </button>
                    </CompanyEditDialog>
                )}

                {company && (
                    <Link
                        to="/billing"
                        className={cn(
                            "flex items-center gap-3 px-4 py-3 rounded-xl transition-colors font-medium",
                            location.pathname === "/billing"
                                ? "bg-primary/10 text-primary"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                        onClick={() => setMobileMenuOpen(false)}
                    >
                        <CreditCard className="h-5 w-5" />
                        Billing
                    </Link>
                )}

                <CustomerSupportDialog plan={company?.subscription_plan || "free"} onOpenChange={(open) => { if (open) setMobileMenuOpen(false); }}>
                    <button
                        className="flex items-center gap-3 px-4 py-3 w-full text-left rounded-xl transition-colors font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                        <Mail className="h-5 w-5" />
                        Customer Support
                    </button>
                </CustomerSupportDialog>
            </div>
            <div className="p-4 border-t">
                <button
                    onClick={onLogout}
                    className="flex items-center gap-3 px-4 py-3 w-full rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground transition-colors font-medium"
                >
                    <LogOut className="h-5 w-5" />
                    Logout
                </button>
            </div>
        </>
    );

    return (
        <div className="min-h-screen bg-secondary/30 flex">
            {/* Desktop Sidebar */}
            <aside className="hidden lg:flex flex-col w-64 bg-card border-r fixed inset-y-0 z-20">
                <NavLinks />
            </aside>

            {/* Main Content */}
            <main className="flex-1 lg:pl-64 flex flex-col min-h-screen min-w-0 w-full">
                {/* Header */}
                <header className="sticky top-0 z-10 bg-card border-b h-16 sm:h-20 px-4 sm:px-8 flex items-center justify-between gap-4">
                    <div className="flex flex-1 items-center gap-3 min-w-0">
                        {/* Mobile Nav Trigger */}
                        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                            <SheetTrigger asChild>
                                <Button variant="ghost" size="icon" className="lg:hidden shrink-0">
                                    <Menu className="h-6 w-6" />
                                </Button>
                            </SheetTrigger>
                            <SheetContent side="left" className="w-72 p-0 flex flex-col bg-card">
                                <NavLinks />
                            </SheetContent>
                        </Sheet>

                        {/* Company Info */}
                        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                            {company?.logo_url && (
                                <img src={company.logo_url} alt="Logo" className="w-8 h-8 rounded-full object-cover shrink-0" />
                            )}
                            <h1 className="text-lg sm:text-2xl font-bold truncate block w-full">{company?.name || 'Dashboard'}</h1>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 sm:gap-4 shrink-0">
                        {/* Search Bar - Hidden on very small screens, expanded on sm */}
                        <div className="relative hidden xs:block">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                type="search"
                                placeholder="Search products..."
                                className="w-[150px] sm:w-[250px] pl-9 bg-secondary/50 border-transparent focus-visible:bg-secondary focus-visible:ring-1 transition-all rounded-full h-10"
                                value={searchQuery}
                                onChange={(e) => onSearchChange(e.target.value)}
                            />
                        </div>

                        <ThemeToggle />

                        <Avatar className="h-9 w-9 bg-primary text-primary-foreground font-semibold">
                            <AvatarFallback className="bg-primary text-primary-foreground">
                                {company?.name ? getInitials(company.name) : <User className="h-4 w-4" />}
                            </AvatarFallback>
                        </Avatar>
                    </div>
                </header>

                {/* Mobile Search Bar (visible only on very small screens) */}
                <div className="p-4 bg-card border-b xs:hidden">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            type="search"
                            placeholder="Search products..."
                            className="w-full pl-9 bg-secondary/50 rounded-full h-10"
                            value={searchQuery}
                            onChange={(e) => onSearchChange(e.target.value)}
                        />
                    </div>
                </div>

                {/* Page Content */}
                <div className="flex-1 p-4 sm:p-8">
                    {children}
                </div>
            </main>
        </div>
    );
};

export default AdminLayout;
