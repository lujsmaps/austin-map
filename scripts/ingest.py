"""
Austin VC & Startup Map — EXA Ingest Script

Queries the EXA API for Austin-based startups and VC firms,
then upserts the results into Supabase.

Usage:
    1. Copy .env.example → .env and fill in your keys
    2. pip install -r requirements.txt
    3. python scripts/ingest.py
"""

import os
import random
import json
from datetime import datetime

from dotenv import load_dotenv
from exa_py import Exa
from supabase import create_client

load_dotenv()

# ── Config ─────────────────────────────────────────────────────
exa = Exa(api_key=os.environ.get("EXA_API_KEY"))

supabase = create_client(
    os.environ.get("SUPABASE_URL"),
    os.environ.get("SUPABASE_SERVICE_KEY"),  # service role for RLS bypass
)

# ── EXA Queries ────────────────────────────────────────────────
QUERIES = [
    # Startups
    {"query": "Austin Texas startup company", "type": "startup"},
    {"query": "Austin TX seed stage startup", "type": "startup"},
    {"query": "early stage startup based in Austin Texas", "type": "startup"},
    {"query": "Austin tech startup 2024 2025", "type": "startup"},
    {"query": "Austin Texas B2B SaaS startup", "type": "startup"},
    {"query": "Austin fintech healthtech startup", "type": "startup"},
    # VCs
    {"query": "venture capital firm in Austin Texas", "type": "vc"},
    {"query": "Austin TX VC investor venture fund", "type": "vc"},
    {"query": "Austin angel investor seed fund", "type": "vc"},
    {"query": "Austin Texas venture capital partner", "type": "vc"},
]


# ── Helpers ────────────────────────────────────────────────────

def domain_of(url: str) -> str:
    """Normalize a URL to its bare domain for deduplication."""
    try:
        from urllib.parse import urlparse
        host = urlparse(url).hostname or url
        if host.startswith("www."):
            host = host[4:]
        return host
    except Exception:
        return url


def extract_location():
    """
    Returns jittered downtown Austin coordinates.
    In production, replace this with a geocoding API call
    (Google Maps, Mapbox, etc.) using the company address.
    """
    base_lat = 30.2672
    base_lng = -97.7431
    jitter = lambda: (random.random() - 0.5) * 0.06  # ~3 km spread
    return base_lat + jitter(), base_lng + jitter()


def parse_result(result, query_type: str) -> dict:
    """Parse relevant fields from an EXA result."""
    lat, lng = extract_location()

    # Extract description from highlights or text
    description = None
    if hasattr(result, "highlights") and result.highlights:
        description = " ".join(result.highlights)[:500]
    elif hasattr(result, "text") and result.text:
        description = result.text[:500]

    return {
        "name": result.title or "Unknown",
        "type": query_type,
        "website": result.url or None,
        "description": description,
        "exa_source_url": result.url or None,
        "location": f"SRID=4326;POINT({lng} {lat})",  # WKT for PostGIS
        "city": "Austin",
        "state": "TX",
    }


# ── Main Ingest Logic ──────────────────────────────────────────

def run_query(query_config: dict) -> list:
    """Run a single EXA search query and return results."""
    query = query_config["query"]
    qtype = query_config["type"]
    print(f"\n🔍  Querying EXA: \"{query}\" [{qtype}]")

    results = exa.search_and_contents(
        query,
        type="auto",
        category="company",
        num_results=30,
        highlights={"max_characters": 4000},
    )

    print(f"   ↳ Got {len(results.results)} results")

    # Tag each result with metadata
    tagged = []
    for r in results.results:
        r._query_type = qtype
        r._query_used = query
        tagged.append(r)
    return tagged


def upsert_organization(org: dict) -> str | None:
    """Upsert an organization by website (dedupe key). Returns the org ID."""
    try:
        response = (
            supabase.table("organizations")
            .upsert(org, on_conflict="website")
            .execute()
        )
        if response.data:
            return response.data[0].get("id")
    except Exception as e:
        if "duplicate" in str(e).lower() or "23505" in str(e):
            # Already exists — fetch the existing ID
            existing = (
                supabase.table("organizations")
                .select("id")
                .eq("website", org["website"])
                .single()
                .execute()
            )
            if existing.data:
                return existing.data.get("id")
        print(f"   ⚠️  Upsert failed for \"{org['name']}\": {e}")
    return None


def save_exa_result(result, organization_id: str):
    """Save the raw EXA result for audit/reprocessing."""
    raw = {
        "title": result.title,
        "url": result.url,
        "score": result.score if hasattr(result, "score") else None,
        "published_date": result.published_date if hasattr(result, "published_date") else None,
        "highlights": result.highlights if hasattr(result, "highlights") else None,
    }

    supabase.table("exa_search_results").insert({
        "organization_id": organization_id,
        "query_used": result._query_used,
        "score": result.score if hasattr(result, "score") else None,
        "url": result.url,
        "title": result.title,
        "published_date": result.published_date if hasattr(result, "published_date") else None,
        "raw_result": raw,
    }).execute()


def ingest():
    """Main entry point — run all queries and upsert results."""
    print("🚀  Austin VC & Startup Map — EXA Ingest")
    print("=" * 45, "\n")

    seen: set[str] = set()  # track domains already processed
    total_inserted = 0
    total_skipped = 0

    for q in QUERIES:
        try:
            results = run_query(q)
        except Exception as err:
            print(f"   ❌  EXA query failed: {err}")
            continue

        for result in results:
            domain = domain_of(result.url)

            # Skip duplicates within this run
            if domain in seen:
                total_skipped += 1
                continue
            seen.add(domain)

            org = parse_result(result, q["type"])
            if not org["website"]:
                continue

            org_id = upsert_organization(org)
            if org_id:
                save_exa_result(result, org_id)
                total_inserted += 1
                print(f"   ✅  {org['name']} ({org['type']})")

    print(f"\n{'=' * 45}")
    print(f"✅  Done! Inserted/updated: {total_inserted} | Skipped dupes: {total_skipped}")


if __name__ == "__main__":
    ingest()
