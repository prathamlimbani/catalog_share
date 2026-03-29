import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

/**
 * Hook that checks for an existing Supabase session on mount.
 * If the user is fully set up (master admin or has a company), redirect them
 * away from auth pages. If they are logged in but have no company yet, do NOT
 * redirect — they are mid-registration and should stay on /register.
 * Returns `checking` boolean so login/register pages can show a spinner while resolving.
 */
export const useAuthRedirect = () => {
    const [checking, setChecking] = useState(true);
    const navigate = useNavigate();

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
    }, [navigate]);

    return { checking };
};
