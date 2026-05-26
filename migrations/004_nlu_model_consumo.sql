-- migrations/004_nlu_model_consumo.sql
-- Modelo NLU por empresa + tabla de consumo IA diferenciado por cliente

-- Preferencia de modelo por empresa (por defecto Groq Llama, el más económico)
ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS nlu_model TEXT NOT NULL DEFAULT 'groq-llama';

-- Registro de consumo IA por empresa
CREATE TABLE IF NOT EXISTS public.consumo_ia (
  id              UUID          NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  empresa_id      UUID          NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  modelo          TEXT          NOT NULL,
  tipo            TEXT          NOT NULL DEFAULT 'nlu',  -- 'nlu' | 'vision' | 'stt'
  tokens_entrada  INT           NOT NULL DEFAULT 0,
  tokens_salida   INT           NOT NULL DEFAULT 0,
  costo_usd       NUMERIC(10,6) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- RLS: cada empresa solo ve su propio consumo
ALTER TABLE public.consumo_ia ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "empresa ve su consumo" ON public.consumo_ia;
CREATE POLICY "empresa ve su consumo" ON public.consumo_ia
  FOR SELECT USING (empresa_id = get_my_empresa_id());

-- Índice para consultas por empresa + fecha
CREATE INDEX IF NOT EXISTS consumo_ia_empresa_fecha_idx
  ON public.consumo_ia(empresa_id, created_at DESC);
