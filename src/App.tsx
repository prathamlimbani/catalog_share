import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { CartProvider } from "@/contexts/CartContext";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import AdminDashboard from "./pages/AdminDashboard";
import MasterLogin from "./pages/MasterLogin";
import MasterAdmin from "./pages/MasterAdmin";
import StoreFront from "./pages/StoreFront";
import StoreProducts from "./pages/StoreProducts";
import StoreCart from "./pages/StoreCart";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <CartProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            {/* Platform pages */}
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/dashboard" element={<AdminDashboard />} />

            {/* Master admin */}
            <Route path="/master-login" element={<MasterLogin />} />
            <Route path="/master-admin" element={<MasterAdmin />} />

            {/* Public store pages */}
            <Route path="/store/:slug" element={<StoreFront />} />
            <Route path="/store/:slug/products" element={<StoreProducts />} />
            <Route path="/store/:slug/cart" element={<StoreCart />} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </CartProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
