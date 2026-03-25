import Exa from "exa-js";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export async function GET(req) {
    // Check for Cron Secret if configured
    const authHeader = req.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return new Response('Unauthorized', { status: 401 });
    }

    console.log("🚀 Starting Daily Ingest via Next.js API Route");

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
                numResults: 10,
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

        return NextResponse.json({
            success: true,
            inserted: totalInserted,
            message: `Successfully processed ${totalInserted} entries.`
        });

    } catch (error) {
        console.error("Cron Ingest Error:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
