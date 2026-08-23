import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

interface AuthRedirectOptions {
    /**
     * Where to send a user who is signed in but has no company yet. The
     * Register page leaves this unset so the user stays on step 2; the Login
     * page passes "/register", because a signed-in-but-incomplete user who
     * landed back on the login form (a Google redirect that created the account
     * but not the company) has nothing to do there and no visible way forward.
     */
    incompleteTo?: string;
}

/**
 * Hook that checks for an existing Supabase session on mount.
 * If the user is fully set up (master admin or has a company), redirect them
 * away from auth pages. If they are logged in but have no company yet, either
 * stay put (Register, mid-flow) or route to `incompleteTo` (Login).
 * Returns `checking` boolean so login/register pages can show a spinner while resolving.
 */
export const useAuthRedirect = (options: AuthRedirectOptions = {}) => {
    const [checking, setChecking] = useState(true);
    const navigate = useNavigate();
    const { incompleteTo } = options;

    useEffect(() => {
        const checkSession = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (!session?.user) {
                    setChecking(false);
                    return;
                }

                const user = session.user;

                // Check if master admin
                const { data: roles } = await supabase
                    .from("user_roles")
                    .select("role")
                    .eq("user_id", user.id)
                    .eq("role", "admin");

                if (roles && roles.length > 0) {
                    navigate("/master-admin", { replace: true });
                    return;
                }

                // Check if has a company — only redirect if fully set up
                const { data: companies } = await supabase
                    .from("companies")
                    .select("slug")
                    .eq("owner_id", user.id)
                    .limit(1);

                if (companies && companies.length > 0) {
                    navigate("/dashboard", { replace: true });
                } else if (incompleteTo) {
                    // Signed in, no company — send them to finish setting up
                    // rather than stranding them on the page they landed on.
                    navigate(incompleteTo, { replace: true });
                } else {
                    // Logged in but no company yet → stay on current page
                    // (user is likely mid-registration on /register)
                    setChecking(false);
                }
            } catch {
                // Session check failed — just show the page
                setChecking(false);
            }
        };

        checkSession();
    }, [navigate, incompleteTo]);

    return { checking };
};
