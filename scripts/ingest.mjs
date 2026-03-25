/**
 * Austin VC & Startup Map — EXA Ingest Script
 *
 * Queries the EXA API for Austin-based startups and VC firms,
 * then upserts the results into Supabase.
 *
 * Usage:
 *   1. Copy .env.example → .env and fill in your keys
 *   2. npm install
 *   3. npm run ingest
 */

import "dotenv/config";
import Exa from "exa-js";
import { createClient } from "@supabase/supabase-js";

// ── Config ─────────────────────────────────────────────────────
const exa = new Exa(process.env.EXA_API_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // service role for RLS bypass
);

// ── EXA Queries ────────────────────────────────────────────────
const QUERIES = [
  // Startups
  { query: "Austin Texas startups founded recently", type: "startup" },
  { query: "Austin TX seed stage startup companies", type: "startup" },
  { query: "early stage startups based in Austin Texas", type: "startup" },
  { query: "Austin tech startup companies 2024 2025", type: "startup" },
  { query: "Austin Texas B2B SaaS startups", type: "startup" },
  { query: "Austin fintech healthtech startups", type: "startup" },

  // VCs
  { query: "venture capital firms in Austin Texas", type: "vc" },
  { query: "Austin TX VC investors and venture funds", type: "vc" },
  { query: "Austin angel investors and seed funds", type: "vc" },
  { query: "Austin Texas venture capital partners", type: "vc" },
];

// ── Helpers ────────────────────────────────────────────────────

/**
 * Normalize a URL to its bare domain for deduplication.
 * "https://www.example.com/about" → "example.com"
 */
function domainOf(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host;
  } catch {
    return url;
  }
}

/**
 * Attempt to extract a lat/lng from the EXA result text.
 * Falls back to central Austin coordinates.
 *
 * In production you'd call a geocoding API (Google Maps, Mapbox, etc.)
 * using the extracted address. For now we jitter around downtown Austin
 * so every pin is visible on the map.
 */
function extractLocation(result) {
  // Default: downtown Austin with small random jitter so pins don't stack
  const baseLat = 30.2672;
  const baseLng = -97.7431;
  const jitter = () => (Math.random() - 0.5) * 0.06; // ~3 km spread

  return {
    lat: baseLat + jitter(),
    lng: baseLng + jitter(),
  };
}

/**
 * Parse relevant fields from an EXA result + its summary/text.
 */
function parseResult(result, queryType) {
  const { lat, lng } = extractLocation(result);

  return {
    name: result.title || "Unknown",
    type: queryType,
    website: result.url || null,
    description: result.summary || result.text?.slice(0, 500) || null,
    exa_source_url: result.url || null,
    location: `SRID=4326;POINT(${lng} ${lat})`, // WKT for PostGIS
    city: "Austin",
    state: "TX",
  };
}

// ── Main Ingest Logic ──────────────────────────────────────────

async function runQuery({ query, type }) {
  console.log(`\n🔍  Querying EXA: "${query}" [${type}]`);

  const response = await exa.searchAndContents(query, {
    category: "company",
    numResults: 30,
    contents: {
      text: { maxCharacters: 2000 },
      summary: true,
    },
  });

  console.log(`   ↳ Got ${response.results.length} results`);
  return response.results.map((r) => ({ ...r, _queryType: type, _queryUsed: query }));
}

async function upsertOrganization(org) {
  // Upsert by website (dedupe key)
  const { data, error } = await supabase
    .from("organizations")
    .upsert(org, { onConflict: "website", ignoreDuplicates: false })
    .select("id")
    .single();

  if (error) {
    // Duplicate or constraint error — try to fetch existing
    if (error.code === "23505" || error.message?.includes("duplicate")) {
      const { data: existing } = await supabase
        .from("organizations")
        .select("id")
        .eq("website", org.website)
        .single();
      return existing?.id;
    }
    console.warn(`   ⚠️  Upsert failed for "${org.name}": ${error.message}`);
    return null;
  }

  return data?.id;
}

async function saveExaResult(result, organizationId) {
  await supabase.from("exa_search_results").insert({
    organization_id: organizationId,
    query_used: result._queryUsed,
    score: result.score ?? null,
    url: result.url,
    title: result.title,
    published_date: result.publishedDate || null,
    raw_result: result,
  });
}

async function ingest() {
  console.log("🚀  Austin VC & Startup Map — EXA Ingest");
  console.log("=========================================\n");

  const seen = new Set(); // track domains we've already processed
  let totalInserted = 0;
  let totalSkipped = 0;

  for (const q of QUERIES) {
    let results;
    try {
      results = await runQuery(q);
    } catch (err) {
      console.error(`   ❌  EXA query failed: ${err.message}`);
      continue;
    }

    for (const result of results) {
      const domain = domainOf(result.url);

      // Skip duplicates within this run
      if (seen.has(domain)) {
        totalSkipped++;
        continue;
      }
      seen.add(domain);

      const org = parseResult(result, q.type);
      if (!org.website) continue;

      const orgId = await upsertOrganization(org);
      if (orgId) {
        await saveExaResult(result, orgId);
        totalInserted++;
        console.log(`   ✅  ${org.name} (${org.type})`);
      }
    }

    // Rate-limit: small delay between queries
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\n=========================================`);
  console.log(`✅  Done! Inserted/updated: ${totalInserted} | Skipped dupes: ${totalSkipped}`);
}

ingest().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
