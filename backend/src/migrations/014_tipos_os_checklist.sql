-- TORVEN — 014: tipos de ordem de serviço com checklists vinculados.
-- Somente criação de objetos e colunas novas. Rollback: migrations/rollback/014_tipos_os_checklist.down.sql

create table if not exists order_types (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  name        text not null,
  description text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists order_types_name_uq on order_types(company_id, lower(name));
alter table order_types enable row level security;

-- checklist sem tipo = geral (vale para todas as OS); com tipo = só para as OS daquele tipo
alter table checklist_templates add column if not exists order_type_id uuid references order_types(id) on delete set null;
-- obrigatório: a etapa (recebimento, inspeção final, entrega) só avança depois de registrado
alter table checklist_templates add column if not exists required boolean not null default false;
create index if not exists checklist_templates_type_idx on checklist_templates(company_id, order_type_id);

alter table orders add column if not exists order_type_id uuid references order_types(id) on delete set null;
create index if not exists orders_type_idx on orders(company_id, order_type_id) where order_type_id is not null;
