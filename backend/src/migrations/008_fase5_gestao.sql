-- TORVEN — Fase 5: relacionamento (pós-venda, follow-ups) e gestão
-- Reversão: backend/src/migrations/rollback/008_fase5_gestao.down.sql

create table if not exists followups (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  customer_id uuid references customers(id) on delete cascade,
  order_id    uuid references orders(id) on delete cascade,
  quote_id    uuid references quotes(id) on delete cascade,
  kind        text not null check (kind in ('pos_venda','orcamento','garantia_vencendo','manutencao','cobranca','outro')),
  title       text not null,
  due_date    date not null,
  status      text not null default 'pendente' check (status in ('pendente','feito','cancelado')),
  channel     text,
  result      text,
  rating      smallint check (rating between 0 and 10),
  auto_key    text,
  assigned_to uuid references users(id) on delete set null,
  done_by     uuid references users(id) on delete set null,
  done_at     timestamptz,
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists followups_idx on followups(company_id, status, due_date);
create unique index if not exists followups_auto_uq on followups(company_id, auto_key) where auto_key is not null;

alter table followups enable row level security;
