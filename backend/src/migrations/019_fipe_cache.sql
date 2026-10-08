-- TORVEN — 019: cópia local da Tabela FIPE (dados públicos: marcas, modelos, anos e preço de referência).
-- Compartilhada entre as empresas para gastar pouco da cota gratuita da API FIPE. Não guarda nada de cliente.
-- Rollback: migrations/rollback/019_fipe_cache.down.sql
create table if not exists fipe_cache (
  key        text primary key,          -- ex.: cars/brands, cars/brands/59/models
  data       jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table fipe_cache enable row level security;
