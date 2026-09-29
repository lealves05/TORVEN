-- Ligação com a central da plataforma (MASTER do ORBI): assinatura, bloqueio, período de teste e módulos
-- passam a ser decididos pela central, com a mesma base de cobrança de todos os sistemas.
-- Somente create/alter ... add. Sem a central configurada, nada muda no funcionamento.
alter table companies add column if not exists platform_access    jsonb;         -- última situação recebida da central
alter table companies add column if not exists platform_access_at timestamptz;   -- quando foi recebida
alter table companies add column if not exists platform_registered_at timestamptz; -- quando a empresa foi cadastrada na central
alter table users     add column if not exists last_login_at timestamptz;

-- configuração da ligação (endereço da central e segredo) para ambientes sem variáveis de ambiente (Edge Function)
create table if not exists _secrets (key text primary key, value text not null);
alter table _secrets enable row level security;
