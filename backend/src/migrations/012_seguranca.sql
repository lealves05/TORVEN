-- TORVEN — 012: segurança da sessão e limites de tentativas compartilhados.
-- auth_version: muda a cada troca/redefinição de senha; tokens com versão diferente deixam de valer (F02).
alter table users add column if not exists auth_version integer not null default 0;
-- contadores de tentativas compartilhados entre instâncias (Edge/serverless) — F07
create table if not exists rate_limits (
  key        text primary key,      -- hash do escopo + IP/identificador
  count      integer not null,
  reset_at   timestamptz not null
);
alter table rate_limits enable row level security;
create index if not exists rate_limits_reset_idx on rate_limits (reset_at);
