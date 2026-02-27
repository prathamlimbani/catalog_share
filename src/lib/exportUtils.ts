import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";

export const exportDataToExcel = async (companyId: string, companyName: string) => {
    try {
        // 1. Fetch Company Data
        const { data: companyData, error: companyErr } = await supabase
            .from("companies")
            .select("*")
            .eq("id", companyId)
            .single();

        if (companyErr) throw companyErr;

        // 2. Fetch Products Data
        const { data: productsData, error: productsErr } = await supabase
            .from("products")
            .select("*")
            .eq("company_id", companyId)
            .order("created_at", { ascending: false });

        if (productsErr) throw productsErr;

        // 3. Fetch Surveys/Feedback Data (using the company slug)
        let surveysData: any[] = [];
        if (companyData.slug) {
            const { data: fetchedSurveys, error: surveysErr } = await supabase
                .from("surveys")
                .select("*")
                .eq("store_slug", companyData.slug)
                .order("created_at", { ascending: false });

            if (surveysErr) throw surveysErr;
            surveysData = fetchedSurveys || [];
        }

        // 4. Fetch Analytics Data
        const { data: analyticsData, error: analyticsErr } = await supabase
            .from("analytics_events")
            .select("*")
            .eq("company_id", companyId)
            .order("created_at", { ascending: false });

        if (analyticsErr) throw analyticsErr;

        // Create a new Workbook
        const wb = XLSX.utils.book_new();

        // Sheet 1: Company Profile
        const companyProfile = [
            {
                "Company Name": companyData.name,
                "Store Slug": companyData.slug,
                "Phone": companyData.phone || "N/A",
                "Created At": new Date(companyData.created_at).toLocaleString(),
                "Theme Primary": companyData.theme_primary || "Default",
            }
        ];
        const wsCompany = XLSX.utils.json_to_sheet(companyProfile);
        XLSX.utils.book_append_sheet(wb, wsCompany, "Company Profile");

        // Sheet 2: Products
        const productsFormatted = productsData.map(p => {
            // Format features
            const features = p.features && p.features.length > 0 ? p.features.join(", ") : "None";

            // Format feature_sizes mapping to a readable string
            let sizesDetails = "";
            if (p.feature_sizes && typeof p.feature_sizes === 'object' && Object.keys(p.feature_sizes).length > 0) {
                sizesDetails = Object.entries(p.feature_sizes)
                    .map(([feat, sizeArr]) => `${feat}: ${(sizeArr as string[]).join(", ")}`)
                    .join(" | ");
            } else if (p.size) {
                sizesDetails = p.size;
            } else {
                sizesDetails = "None";
            }

            return {
                "ID": p.id,
                "Name": p.name,
                "Category": p.category || "Uncategorized",
                "Price": p.price,
                "In Stock": p.in_stock ? "Yes" : "No",
                "Trending": p.is_trending ? "Yes" : "No",
                "Options": features,
                "Sizes": sizesDetails,
                "Description": p.description || "",
                "Created At": new Date(p.created_at).toLocaleString()
            };
        });
        const wsProducts = XLSX.utils.json_to_sheet(productsFormatted);
        // Autofit slightly
        wsProducts["!cols"] = [{ wch: 36 }, { wch: 25 }, { wch: 15 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 20 }, { wch: 30 }, { wch: 40 }, { wch: 20 }];
        XLSX.utils.book_append_sheet(wb, wsProducts, "Products");

        // Sheet 3: Surveys & Feedback
        const surveysFormatted = surveysData.map(s => ({
            "Name": s.name,
            "Role": s.role,
            "Rating": `${s.rating} / 5`,
            "Suggestion/Feedback": s.suggestion || "None",
            "Date": new Date(s.created_at).toLocaleString()
        }));
        const wsSurveys = XLSX.utils.json_to_sheet(surveysFormatted.length > 0 ? surveysFormatted : [{ Message: "No feedback recorded yet." }]);
        wsSurveys["!cols"] = [{ wch: 20 }, { wch: 15 }, { wch: 10 }, { wch: 50 }, { wch: 20 }];
        XLSX.utils.book_append_sheet(wb, wsSurveys, "Feedback & Suggestions");

        // Sheet 4: Analytics
        const analyticsFormatted = analyticsData.map(a => ({
            "Event Type": a.event_type,
            "Page URL": a.page_url,
            "Product ID": a.product_id || "N/A",
            "Date": new Date(a.created_at).toLocaleString()
        }));
        const wsAnalytics = XLSX.utils.json_to_sheet(analyticsFormatted.length > 0 ? analyticsFormatted : [{ Message: "No analytics events recorded yet." }]);
        wsAnalytics["!cols"] = [{ wch: 15 }, { wch: 30 }, { wch: 36 }, { wch: 20 }];
        XLSX.utils.book_append_sheet(wb, wsAnalytics, "Analytics");

        // Trigger Download
        const fileName = `${companyName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_data_export.xlsx`;
        XLSX.writeFile(wb, fileName);

        return { success: true, fileName };
    } catch (error) {
        console.error("Export Error:", error);
        throw error;
    }
};

export const exportMasterDataToExcel = async () => {
    try {
        // 1. Fetch All Companies
        const { data: companiesData, error: companyErr } = await supabase
            .from("companies")
            .select("*")
            .order("created_at", { ascending: false });

        if (companyErr) throw companyErr;

        // 2. Fetch All Products
        const { data: productsData, error: productsErr } = await supabase
            .from("products")
            .select("*, companies(name, slug)")
            .order("created_at", { ascending: false });

        if (productsErr) throw productsErr;

        // 3. Fetch All Surveys
        const { data: surveysData, error: surveysErr } = await supabase
            .from("surveys")
            .select("*")
            .order("created_at", { ascending: false });

        if (surveysErr) throw surveysErr;

        // 4. Fetch All Analytics Events
        const { data: analyticsData, error: analyticsErr } = await supabase
            .from("analytics_events")
            .select("*, companies(name)")
            .order("created_at", { ascending: false });

        if (analyticsErr) throw analyticsErr;

        // Create a new Workbook
        const wb = XLSX.utils.book_new();

        // Sheet 1: All Companies
        const companiesFormatted = (companiesData || []).map(c => ({
            "ID": c.id,
            "Company Name": c.name,
            "Store Slug": c.slug,
            "Phone": c.phone || "N/A",
            "Email": c.email || "N/A",
            "Address": c.address || "N/A",
            "GST Number": c.gst_number || "N/A",
            "Created At": new Date(c.created_at).toLocaleString(),
            "Theme": c.theme_primary || "Default"
        }));
        const wsCompanies = XLSX.utils.json_to_sheet(companiesFormatted.length > 0 ? companiesFormatted : [{ Message: "No companies found." }]);
        wsCompanies["!cols"] = [{ wch: 36 }, { wch: 25 }, { wch: 20 }, { wch: 15 }, { wch: 25 }, { wch: 30 }, { wch: 15 }, { wch: 20 }, { wch: 15 }, { wch: 15 }];
        XLSX.utils.book_append_sheet(wb, wsCompanies, "All Companies");

        // Sheet 2: All Products
        const productsFormatted = (productsData || []).map(p => {
            const features = p.features && p.features.length > 0 ? p.features.join(", ") : "None";
            let sizesDetails = "";
            if (p.feature_sizes && typeof p.feature_sizes === 'object' && Object.keys(p.feature_sizes).length > 0) {
                sizesDetails = Object.entries(p.feature_sizes)
                    .map(([feat, sizeArr]) => `${feat}: ${(sizeArr as string[]).join(", ")}`)
                    .join(" | ");
            } else if (p.size) {
                sizesDetails = p.size;
            } else {
                sizesDetails = "None";
            }

            // Extract company name from the joined table if present
            const companyName = p.companies ? (p.companies as any).name : "Unknown Company";
            const companySlug = p.companies ? (p.companies as any).slug : "N/A";

            return {
                "Product ID": p.id,
                "Company": companyName,
                "Store Slug": companySlug,
                "Name": p.name,
                "Category": p.category || "Uncategorized",
                "Price": p.price,
                "In Stock": p.in_stock ? "Yes" : "No",
                "Trending": p.is_trending ? "Yes" : "No",
                "Options": features,
                "Sizes": sizesDetails,
                "Description": p.description || "",
                "Created At": new Date(p.created_at).toLocaleString()
            };
        });
        const wsProducts = XLSX.utils.json_to_sheet(productsFormatted.length > 0 ? productsFormatted : [{ Message: "No products found." }]);
        wsProducts["!cols"] = [{ wch: 36 }, { wch: 25 }, { wch: 20 }, { wch: 25 }, { wch: 15 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 20 }, { wch: 30 }, { wch: 40 }, { wch: 20 }];
        XLSX.utils.book_append_sheet(wb, wsProducts, "All Products");

        // Sheet 3: All Surveys & Feedback
        const surveysFormatted = (surveysData || []).map(s => ({
            "Survey ID": s.id,
            "Store Slug": s.store_slug || "Global",
            "Name": s.name,
            "Role": s.role,
            "Rating": `${s.rating} / 5`,
            "Suggestion/Feedback": s.suggestion || "None",
            "Date": new Date(s.created_at).toLocaleString()
        }));
        const wsSurveys = XLSX.utils.json_to_sheet(surveysFormatted.length > 0 ? surveysFormatted : [{ Message: "No feedback recorded yet." }]);
        wsSurveys["!cols"] = [{ wch: 36 }, { wch: 20 }, { wch: 20 }, { wch: 15 }, { wch: 10 }, { wch: 50 }, { wch: 20 }];
        XLSX.utils.book_append_sheet(wb, wsSurveys, "All Feedback & Surveys");

        // Sheet 4: All Analytics Events
        const analyticsFormatted = (analyticsData || []).map(a => {
            const companyName = a.companies ? (a.companies as any).name : "Unknown Company";
            return {
                "Event ID": a.id,
                "Company": companyName,
                "Event Type": a.event_type,
                "Page URL": a.page_url,
                "Product ID": a.product_id || "N/A",
                "Date": new Date(a.created_at).toLocaleString()
            };
        });
        const wsAnalytics = XLSX.utils.json_to_sheet(analyticsFormatted.length > 0 ? analyticsFormatted : [{ Message: "No analytics events recorded yet." }]);
        wsAnalytics["!cols"] = [{ wch: 36 }, { wch: 25 }, { wch: 15 }, { wch: 30 }, { wch: 36 }, { wch: 20 }];
        XLSX.utils.book_append_sheet(wb, wsAnalytics, "All Analytics");

        // Trigger Download
        const fileName = `Master_Data_Export_${new Date().toISOString().split('T')[0]}.xlsx`;
        XLSX.writeFile(wb, fileName);

        return { success: true, fileName };
    } catch (error) {
        console.error("Master Export Error:", error);
        throw error;
    }
};
