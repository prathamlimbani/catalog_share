/**
 * The MERCHANT's export: one shop's own data, formatted to be read.
 *
 * Deliberately not the same thing as the master export, which now lives in
 * src/lib/tableauExport.ts. That one feeds a BI tool and is all ISO dates,
 * numeric ratings and join keys; this one is opened in Excel by a shopkeeper,
 * so "27/08/2026, 3:04 pm" and "4 / 5" are the right answers here and the
 * wrong ones there. Splitting them is what lets each be correct for its reader.
 *
 * What the two DO share is the paginator, because the bug they shared was
 * fetching without one: a bare select stops at `db-max-rows` and says nothing,
 * so any shop past a thousand products or events was silently exporting a
 * sample.
 */

import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { fetchPaged } from "@/lib/fetchPaged";

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
        const productsPage = await fetchPaged((from, to) =>
            supabase
                .from("products")
                .select("*")
                .eq("company_id", companyId)
                .order("created_at", { ascending: false })
                .range(from, to),
        );
        if (productsPage.error) throw new Error(productsPage.error);
        const productsData = productsPage.rows as any[];

        // 3. Fetch Surveys/Feedback Data (using the company slug)
        let surveysData: any[] = [];
        if (companyData.slug) {
            const surveysPage = await fetchPaged((from, to) =>
                supabase
                    .from("surveys")
                    .select("*")
                    .eq("store_slug", companyData.slug)
                    .order("created_at", { ascending: false })
                    .range(from, to),
            );
            if (surveysPage.error) throw new Error(surveysPage.error);
            surveysData = surveysPage.rows as any[];
        }

        // 4. Fetch Analytics Data
        const analyticsPage = await fetchPaged((from, to) =>
            supabase
                .from("analytics_events")
                .select("*")
                .eq("company_id", companyId)
                .order("created_at", { ascending: false })
                .range(from, to),
        );
        if (analyticsPage.error) throw new Error(analyticsPage.error);
        const analyticsData = analyticsPage.rows as any[];

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
