-- ============================================
-- 002: Core tables for Austin VC & Startup Map
-- ============================================

-- ─── Organizations (startups + VCs) ────────────────────────────
CREATE TABLE public.organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('startup', 'vc')),
  website     TEXT UNIQUE,                          -- dedupe key
  description TEXT,
  logo_url    TEXT,
  location    geography(POINT, 4326),               -- PostGIS point
  address     TEXT,
  city        TEXT DEFAULT 'Austin',
  state       TEXT DEFAULT 'TX',
  founded_year INTEGER,
  stage       TEXT,                                  -- seed, series-a, growth, etc.
  employee_count TEXT,                               -- range like "11-50"
  exa_source_url TEXT,                               -- original EXA result URL
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Spatial index for map queries
CREATE INDEX idx_organizations_location
  ON public.organizations USING GIST (location);

-- Fast lookups by type
CREATE INDEX idx_organizations_type
  ON public.organizations (type);

-- ─── Funding Rounds ────────────────────────────────────────────
CREATE TABLE public.funding_rounds (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  round_type       TEXT,                             -- pre-seed, seed, series-a …
  amount_usd       NUMERIC(15, 2),
  announced_date   DATE,
  lead_investor    TEXT,
  source_url       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_funding_org
  ON public.funding_rounds (organization_id);

-- ─── People ────────────────────────────────────────────────────
CREATE TABLE public.people (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  title        TEXT,
  linkedin_url TEXT,
  avatar_url   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Organization ↔ People (junction) ──────────────────────────
CREATE TABLE public.organization_people (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  person_id       UUID NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  role            TEXT,                              -- founder, partner, ceo …
  PRIMARY KEY (organization_id, person_id)
);

-- ─── Tags / Industry Verticals ─────────────────────────────────
CREATE TABLE public.tags (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name     TEXT NOT NULL UNIQUE,
  category TEXT                                     -- industry, technology, etc.
);

-- ─── Organization ↔ Tags (junction) ────────────────────────────
CREATE TABLE public.organization_tags (
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tag_id          UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  PRIMARY KEY (organization_id, tag_id)
);

-- ─── EXA Search Results (raw audit log) ────────────────────────
CREATE TABLE public.exa_search_results (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  query_used       TEXT NOT NULL,
  score            REAL,
  url              TEXT,
  title            TEXT,
  published_date   TIMESTAMPTZ,
  raw_result       JSONB,                            -- full EXA payload
  fetched_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_exa_results_org
  ON public.exa_search_results (organization_id);


-- ─── Auto-update updated_at trigger ────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ─── Row Level Security ────────────────────────────────────────
-- Enable RLS on all tables (public read, service-role write)
ALTER TABLE public.organizations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funding_rounds     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.people             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_tags  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exa_search_results ENABLE ROW LEVEL SECURITY;

-- Allow public (anon) reads
CREATE POLICY "Public read" ON public.organizations      FOR SELECT USING (true);
CREATE POLICY "Public read" ON public.funding_rounds     FOR SELECT USING (true);
CREATE POLICY "Public read" ON public.people             FOR SELECT USING (true);
CREATE POLICY "Public read" ON public.organization_people FOR SELECT USING (true);
CREATE POLICY "Public read" ON public.tags               FOR SELECT USING (true);
CREATE POLICY "Public read" ON public.organization_tags  FOR SELECT USING (true);
CREATE POLICY "Public read" ON public.exa_search_results FOR SELECT USING (true);

-- Allow service_role full access (used by ingest script)
CREATE POLICY "Service write" ON public.organizations      FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write" ON public.funding_rounds     FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write" ON public.people             FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write" ON public.organization_people FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write" ON public.tags               FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write" ON public.organization_tags  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service write" ON public.exa_search_results FOR ALL USING (auth.role() = 'service_role');
