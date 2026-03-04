import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { CartProvider } from "@/contexts/CartContext";
import { lazy, Suspense } from "react";

// Eager load critical pages
import Landing from "./pages/Landing";
import StoreFront from "./pages/StoreFront";
import NotFound from "./pages/NotFound";

// Lazy load non-critical pages
const About = lazy(() => import("./pages/About"));
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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,       // 1 min — don't refetch within 1 min
      gcTime: 5 * 60 * 1000,      // 5 min garbage collection
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

const Loading = () => (
  <div className="min-h-screen flex items-center justify-center">
    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <CartProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Suspense fallback={<Loading />}>
            <Routes>
              {/* Platform pages */}
              <Route path="/" element={<Landing />} />
              <Route path="/about" element={<About />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/dashboard" element={<AdminDashboard />} />
              <Route path="/billing" element={<Billing />} />

              {/* Master admin */}
              <Route path="/master-login" element={<MasterLogin />} />
              <Route path="/master-admin" element={<MasterAdmin />} />

              {/* Public store pages */}
              <Route path="/store/:slug" element={<StoreFront />} />
              <Route path="/store/:slug/products" element={<StoreProducts />} />
              <Route path="/store/:slug/cart" element={<StoreCart />} />
              <Route path="/store/:slug/about" element={<StoreAbout />} />

              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </CartProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
