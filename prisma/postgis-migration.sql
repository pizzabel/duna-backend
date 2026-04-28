-- D-una · Migración PostGIS y triggers de seguridad
-- Ejecutar DESPUÉS de `prisma migrate dev` para añadir columnas geoespaciales
-- y triggers que Prisma no puede generar nativamente.

-- ─────────────────────────────────────────────
-- 1. EXTENSIONES
-- ─────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─────────────────────────────────────────────
-- 2. COLUMNAS GEOESPACIALES
-- ─────────────────────────────────────────────

-- Ubicación del usuario (para feed hiperlocal personalizado)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS location GEOGRAPHY(POINT, 4326);

CREATE INDEX IF NOT EXISTS idx_users_location
  ON users USING GIST(location);

-- Ubicación de cada publicación (núcleo del feed hiperlocal)
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS location GEOGRAPHY(POINT, 4326) NOT NULL
  DEFAULT ST_MakePoint(-74.0721, 4.7110)::geography;  -- default: Bogotá centro

CREATE INDEX IF NOT EXISTS idx_posts_location
  ON posts USING GIST(location);

-- Índices adicionales de rendimiento
CREATE INDEX IF NOT EXISTS idx_posts_status_created
  ON posts(status, "createdAt" DESC);

CREATE INDEX IF NOT EXISTS idx_tx_auto_release
  ON transactions("autoReleaseAt")
  WHERE status = 'DELIVERED';

-- Índice de búsqueda de texto en publicaciones (pg_trgm)
CREATE INDEX IF NOT EXISTS idx_posts_title_trgm
  ON posts USING GIN(title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_posts_desc_trgm
  ON posts USING GIN(description gin_trgm_ops);

-- ─────────────────────────────────────────────
-- 3. TRIGGER: MENSAJES INMUTABLES (antifraude)
-- Los mensajes son append-only. Ningún UPDATE ni DELETE permitido.
-- Esto garantiza el log de auditoría para disputas.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION prevent_message_modification()
  RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Messages are immutable — audit log cannot be modified (D-una antifraude)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS msg_immutable ON messages;
CREATE TRIGGER msg_immutable
  BEFORE UPDATE OR DELETE ON messages
  FOR EACH ROW EXECUTE FUNCTION prevent_message_modification();

-- ─────────────────────────────────────────────
-- 4. TRIGGER: ACTUALIZAR RATING PROMEDIO
-- Se dispara cuando se inserta un review para mantener
-- ratingAvg y ratingCount actualizados automáticamente.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_user_rating()
  RETURNS TRIGGER AS $$
BEGIN
  UPDATE users
  SET
    "ratingAvg"   = (SELECT AVG(rating) FROM reviews WHERE "revieweeId" = NEW."revieweeId"),
    "ratingCount" = (SELECT COUNT(*)    FROM reviews WHERE "revieweeId" = NEW."revieweeId"),
    "updatedAt"   = NOW()
  WHERE id = NEW."revieweeId";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS after_review_insert ON reviews;
CREATE TRIGGER after_review_insert
  AFTER INSERT ON reviews
  FOR EACH ROW EXECUTE FUNCTION update_user_rating();

-- ─────────────────────────────────────────────
-- 5. FUNCIÓN: SCORE DEL FEED HIPERLOCAL
-- Fórmula configurable. Se puede llamar desde SQL o desde el ORM.
-- Parámetros: lat FLOAT, lng FLOAT
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION feed_score(
  post_location   GEOGRAPHY,
  user_location   GEOGRAPHY,
  view_count      INTEGER,
  created_at      TIMESTAMPTZ,
  seller_rating   NUMERIC
) RETURNS FLOAT AS $$
DECLARE
  dist_km   FLOAT;
  age_hours FLOAT;
BEGIN
  dist_km   := ST_Distance(post_location, user_location) / 1000.0;
  age_hours := EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600.0;

  RETURN (
      0.45 * (1.0 / (1.0 + dist_km))
    + 0.30 * EXP(-age_hours / 48.0)
    + 0.15 * (LN(1.0 + COALESCE(view_count, 0)) / 10.0)
    + 0.10 * (COALESCE(seller_rating, 3) / 5.0)
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ─────────────────────────────────────────────
-- 6. SEED: CATEGORÍAS INICIALES
-- ─────────────────────────────────────────────
INSERT INTO categories (id, name, slug, icon) VALUES
  (gen_random_uuid(), 'Electrónica',    'electronica',     '📱'),
  (gen_random_uuid(), 'Vehículos',      'vehiculos',       '🚗'),
  (gen_random_uuid(), 'Ropa y accesorios', 'ropa',         '👗'),
  (gen_random_uuid(), 'Hogar y muebles', 'hogar',          '🛋️'),
  (gen_random_uuid(), 'Deportes',       'deportes',        '⚽'),
  (gen_random_uuid(), 'Libros y juegos', 'libros',         '📚'),
  (gen_random_uuid(), 'Mascotas',       'mascotas',        '🐾'),
  (gen_random_uuid(), 'Otros',          'otros',           '📦')
ON CONFLICT (slug) DO NOTHING;
