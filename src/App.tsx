import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { CartProvider } from "@/contexts/CartContext";
import { lazy, Suspense, useEffect } from "react";

import { isAppBuild, isNative } from "@/native/platform";
import { installAuthListener } from "@/native/bootstrap";
import DeepLinkHandler from "@/components/DeepLinkHandler";
import HomeRoute from "@/components/HomeRoute";
import AppLockGate from "@/components/AppLockGate";
import ErrorBoundary from "@/components/ErrorBoundary";

// Eager: the first screen the user can possibly see.
import Landing from "./pages/Landing";
import StoreFront from "./pages/StoreFront";
import NotFound from "./pages/NotFound";

// Lazy: everything else.
const About = lazy(() => import("./pages/About"));
const Pricing = lazy(() => import("./pages/Pricing"));
const Terms = lazy(() => import("./pages/Terms"));
const Privacy = lazy(() => import("./pages/Privacy"));
const RefundPolicy = lazy(() => import("./pages/RefundPolicy"));
const DeleteAccount = lazy(() => import("./pages/DeleteAccount"));
const CustomerCare = lazy(() => import("./pages/CustomerCare"));
const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const MasterLogin = lazy(() => import("./pages/MasterLogin"));
const MasterAdmin = lazy(() => import("./pages/MasterAdmin"));
const StoreProducts = lazy(() => import("./pages/StoreProducts"));
const StoreCart = lazy(() => import("./pages/StoreCart"));
const StoreAbout = lazy(() => import("./pages/StoreAbout"));
const Billing = lazy(() => import("./pages/Billing"));
const Receipt = lazy(() => import("./pages/Receipt"));
const Invoices = lazy(() => import("./pages/Invoices"));
const More = lazy(() => import("./pages/More"));
const MyStore = lazy(() => import("./pages/MyStore"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      gcTime: 5 * 60 * 1000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

const Loading = () => (
  <div className="flex min-h-dvh items-center justify-center">
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
  </div>
);

/**
 * Reset scroll on navigation.
 *
 * The router restores nothing by default, so on a phone every push landed the
 * user halfway down the new screen.
 */
const ScrollToTop = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [pathname]);
  return null;
};

/**
 * Sign-out cleanup. Mounted inside the router so it can navigate.
 * The listener itself wipes the offline store, cached entitlement and ads.
 */
const AuthWatcher = () => {
  useEffect(() => {
    return installAuthListener(() => {
      queryClient.clear();
      // Home, not /login: the welcome page offers both signing in and
      // creating a new company, which a bare form does not.
      window.location.replace("/");
    });
  }, []);
  return null;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <CartProvider>
        <Toaster />
        <Sonner position={isNative ? "top-center" : "bottom-right"} />
        <BrowserRouter>
          <ScrollToTop />
          <AuthWatcher />
          {/* Routes an incoming App Link (https://catalogshare.online/store/...) to the
              matching in-app screen. Must live inside the router to navigate. */}
          <DeepLinkHandler />
          {/* Biometric app lock. Inside the router so the lock screen's own
              sign-out escape can still clear local data and navigate. */}
          <AppLockGate>
            <ErrorBoundary>
              <Suspense fallback={<Loading />}>
                <Routes>
                  {/* Same home page in both targets. In the app HomeRoute sends a
                      signed-in merchant straight to work, and shows the welcome
                      page — with its Login and Create Your Catalog actions — to
                      everyone else. */}
                  <Route path="/" element={isAppBuild ? <HomeRoute /> : <Landing />} />

                  <Route path="/about" element={<About />} />
                  <Route path="/pricing" element={<Pricing />} />
                  <Route path="/customer-care" element={<CustomerCare />} />

                  {/* Legal — required by Google Play to be reachable in-app. */}
                  <Route path="/terms" element={<Terms />} />
                  <Route path="/privacy" element={<Privacy />} />
                  <Route path="/refund" element={<RefundPolicy />} />
                  <Route path="/account-deletion" element={<DeleteAccount />} />
                  {/* Play listings and older links point at these spellings. */}
                  <Route path="/privacy-policy" element={<Navigate to="/privacy" replace />} />
                  <Route path="/delete-account" element={<Navigate to="/account-deletion" replace />} />
                  <Route path="/refund-policy" element={<Navigate to="/refund" replace />} />

                  {/* Auth */}
                  <Route path="/login" element={<Login />} />
                  <Route path="/register" element={<Register />} />
                  <Route path="/forgot-password" element={<ForgotPassword />} />

                  {/* Signed-in app */}
                  <Route path="/dashboard" element={<AdminDashboard />} />
                  <Route path="/invoices" element={<Invoices />} />
                  <Route path="/store" element={<MyStore />} />
                  <Route path="/account" element={<More />} />
                {/* Renamed from /more; keep the old path working for anything
                    already linking to it. */}
                <Route path="/more" element={<Navigate to="/account" replace />} />
                  <Route path="/billing" element={<Billing />} />
                  <Route path="/billing/receipt/:paymentId" element={<Receipt />} />

                  {/* Public storefront */}
                  <Route path="/store/:slug" element={<StoreFront />} />
                  <Route path="/store/:slug/products" element={<StoreProducts />} />
                  <Route path="/store/:slug/cart" element={<StoreCart />} />
                  <Route path="/store/:slug/about" element={<StoreAbout />} />

                  {/* Platform-owner console. Excluded from the app build entirely so
                      the admin bundle, its RPC names and its destructive actions
                      never ship inside the APK. */}
                  {!isAppBuild && (
                    <>
                      <Route path="/master-login" element={<MasterLogin />} />
                      <Route path="/master-admin" element={<MasterAdmin />} />
                    </>
                  )}

                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </AppLockGate>
        </BrowserRouter>
      </CartProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
