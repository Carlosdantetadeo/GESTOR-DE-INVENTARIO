-- ==============================================================================
-- MIGRACIÓN 036 — Búsqueda semántica de productos (embeddings / pgvector)
-- Propósito : reconocer el producto correcto aunque se diga distinto. Cada
--             producto guarda un embedding (vector 384, modelo multilingüe de
--             HuggingFace). La búsqueda compara por similitud coseno, scopeada
--             por empresa. Es aditiva: no toca stock, ni el bot, ni RLS existente.
-- Idempotente: IF NOT EXISTS / OR REPLACE.
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- Vector por producto (nullable: se llena con el backfill / al importar).
ALTER TABLE public.productos ADD COLUMN IF NOT EXISTS embedding vector(384);

-- Índice HNSW para similitud coseno (no requiere training; ideal catálogo chico/medio).
CREATE INDEX IF NOT EXISTS productos_embedding_idx
  ON public.productos USING hnsw (embedding vector_cosine_ops);

-- Búsqueda semántica scopeada por empresa (SECURITY INVOKER → respeta RLS).
CREATE OR REPLACE FUNCTION public.buscar_productos_semantico(
  query_embedding vector(384),
  match_count int DEFAULT 5
)
RETURNS TABLE (id bigint, nombre text, referencia text, distancia float)
LANGUAGE sql STABLE
AS $$
  SELECT p.id, p.nombre, p.referencia, (p.embedding <=> query_embedding) AS distancia
  FROM public.productos p
  WHERE p.embedding IS NOT NULL
    AND p.empresa_id = public.get_my_empresa_id()
  ORDER BY p.embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.buscar_productos_semantico(vector, int) TO anon, authenticated;

-- ==============================================================================
-- FIN MIGRACIÓN 036
-- Verificación:
--   SELECT extname FROM pg_extension WHERE extname = 'vector';
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='productos' AND column_name='embedding';
-- ==============================================================================
