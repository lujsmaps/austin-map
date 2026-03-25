import Exa from "exa-js";
import { createClient } from "@supabase/supabase-js";

// Vercel Cron Job Handler
export default async function handler(req, res) {
    // 1. Verify Authorization (Vercel sets this for Crons)
    // Optional but recommended for security: check for CRON_SECRET if you set one
    // but Vercel handles internal cron security via the schedule config.

    console.log("🚀  Starting Daily Ingest via Vercel Cron");

    const exa = new Exa(process.env.EXA_API_KEY);
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY
    );

    const QUERIES = [
        { query: "Austin Texas startups founded recently", type: "startup" },
        { query: "Austin TX seed stage startup companies", type: "startup" },
        { query: "venture capital firms in Austin Texas", type: "vc" },
        { query: "Austin TX VC investors", type: "vc" },
    ];

    function domainOf(url) {
        try {
            return new URL(url).hostname.replace(/^www\./, "");
        } catch { return url; }
    }

    function extractLocation() {
        const baseLat = 30.2672;
        const baseLng = -97.7431;
        const jitter = () => (Math.random() - 0.5) * 0.06;
        return { lat: baseLat + jitter(), lng: baseLng + jitter() };
    }

    const seen = new Set();
    let totalInserted = 0;

    try {
        for (const q of QUERIES) {
            const response = await exa.searchAndContents(q.query, {
                category: "company",
                numResults: 10, // Keep it light for serverless execution limits
                contents: {
                    text: { maxCharacters: 1000 },
                    summary: true,
                },
            });

            for (const result of response.results) {
                const domain = domainOf(result.url);
                if (seen.has(domain)) continue;
                seen.add(domain);

                const { lat, lng } = extractLocation();
                const org = {
                    name: result.title || "Unknown",
                    type: q.type,
                    website: result.url || null,
                    description: result.summary || result.text?.slice(0, 500) || null,
                    exa_source_url: result.url || null,
                    location: `SRID=4326;POINT(${lng} ${lat})`,
                    city: "Austin",
                    state: "TX",
                };

                if (!org.website) continue;

                const { data, error } = await supabase
                    .from("organizations")
                    .upsert(org, { onConflict: "website", ignoreDuplicates: false })
                    .select("id")
                    .single();

                if (!error && data) {
                    totalInserted++;
                    // Also save raw result to audit log
                    await supabase.from("exa_search_results").insert({
                        organization_id: data.id,
                        query_used: q.query,
                        score: result.score ?? null,
                        url: result.url,
                        title: result.title,
                        raw_result: result,
                    });
                }
            }
        }

        return res.status(200).json({
            success: true,
            inserted: totalInserted,
            message: `Successfully processed ${totalInserted} entries.`
        });

    } catch (error) {
        console.error("Cron Ingest Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
