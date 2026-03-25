-- ============================================
-- 001: Enable required extensions
-- ============================================

-- PostGIS for geographic point storage & spatial queries
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;

-- UUID generation (v4)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
