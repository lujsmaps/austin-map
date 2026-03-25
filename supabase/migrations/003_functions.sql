-- ============================================
-- 003: Utility functions for map queries
-- ============================================

-- ─── Nearby organizations ──────────────────────────────────────
-- Returns organizations within `radius_m` meters of a lat/lng point.
-- Usage: SELECT * FROM nearby_organizations(30.2672, -97.7431, 5000);
CREATE OR REPLACE FUNCTION public.nearby_organizations(
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  radius_m DOUBLE PRECISION DEFAULT 10000  -- 10 km default
)
RETURNS SETOF public.organizations
LANGUAGE sql STABLE
AS $$
  SELECT *
  FROM public.organizations
  WHERE ST_DWithin(
    location,
    ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
    radius_m
  )
  ORDER BY location <-> ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography;
$$;

-- ─── Organizations inside a bounding box ───────────────────────
-- For the map viewport: pass SW and NE corner coordinates.
-- Usage: SELECT * FROM organizations_in_bbox(30.20, -97.80, 30.35, -97.70);
CREATE OR REPLACE FUNCTION public.organizations_in_bbox(
  sw_lat DOUBLE PRECISION,
  sw_lng DOUBLE PRECISION,
  ne_lat DOUBLE PRECISION,
  ne_lng DOUBLE PRECISION,
  filter_type TEXT DEFAULT NULL
)
RETURNS SETOF public.organizations
LANGUAGE sql STABLE
AS $$
  SELECT *
  FROM public.organizations
  WHERE ST_Within(
    location::geometry,
    ST_MakeEnvelope(sw_lng, sw_lat, ne_lng, ne_lat, 4326)
  )
  AND (filter_type IS NULL OR type = filter_type);
$$;

-- ─── Organization detail view (with tags) ──────────────────────
-- Returns org info enriched with an array of tag names.
CREATE OR REPLACE FUNCTION public.organization_detail(org_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  type TEXT,
  website TEXT,
  description TEXT,
  logo_url TEXT,
  address TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  founded_year INTEGER,
  stage TEXT,
  employee_count TEXT,
  tags TEXT[]
)
LANGUAGE sql STABLE
AS $$
  SELECT
    o.id,
    o.name,
    o.type,
    o.website,
    o.description,
    o.logo_url,
    o.address,
    ST_Y(o.location::geometry) AS lat,
    ST_X(o.location::geometry) AS lng,
    o.founded_year,
    o.stage,
    o.employee_count,
    ARRAY(
      SELECT t.name
      FROM public.organization_tags ot
      JOIN public.tags t ON t.id = ot.tag_id
      WHERE ot.organization_id = o.id
    ) AS tags
  FROM public.organizations o
  WHERE o.id = org_id;
$$;
