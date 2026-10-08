-- TORVEN — 016: emitentes fiscais (vários CNPJs), emissor escolhido pela empresa e certificado A1 guardado cifrado.
-- Somente criação de objetos e colunas novas. Rollback: migrations/rollback/016_emitentes_fiscais.down.sql

create table if not exists fiscal_emitters (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  name          text not null,                         -- apelido (ex.: "Matriz", "MEI do João")
  cnpj          text not null,
  razao_social  text not null,
  nome_fantasia text,
  ie            text,
  im            text,
  regime        text not null default 'simples' check (regime in ('simples', 'mei', 'normal')),
  email         text,
  phone         text,
  cep           text, street text, number text, complement text, district text, city text, uf text, city_code text,
  provider      text not null check (provider in ('focus', 'nfeio', 'plugnotas', 'nuvemfiscal', 'enotas', 'generico', 'manual')),
  environment   text not null default 'homologacao' check (environment in ('homologacao', 'producao')),
  docs          jsonb not null default '{"nfse": true, "nfe": false}',
  settings      jsonb not null default '{}',           -- parâmetros fiscais e configuração não secreta do emissor
  provider_ref  jsonb not null default '{}',           -- identificadores devolvidos pelo emissor (empresa, certificado)
  secret_enc    text,                                  -- credenciais do emissor (cifradas)
  cert_enc      text,                                  -- certificado A1 + senha (cifrados)
  cert_info     jsonb,                                 -- titular, CNPJ e validade lidos do certificado
  sync_status   text,                                  -- ok | erro | pendente
  sync_message  text,
  synced_at     timestamptz,
  next_dps_homologacao int not null default 1,
  next_dps_producao    int not null default 1,
  next_nfe_homologacao int not null default 1,         -- número da NF-e quando o emissor exige que o sistema numere
  next_nfe_producao    int not null default 1,
  is_default    boolean not null default false,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists fiscal_emitters_name_uq on fiscal_emitters(company_id, lower(name));
create unique index if not exists fiscal_emitters_default_uq on fiscal_emitters(company_id) where is_default;
alter table fiscal_emitters enable row level security;

alter table invoices add column if not exists emitter_id uuid references fiscal_emitters(id) on delete set null;
alter table invoices add column if not exists external_id text;   -- identificador da nota no emissor
alter table invoices add column if not exists manual boolean not null default false; -- emitida fora do TORVEN e registrada à mão
