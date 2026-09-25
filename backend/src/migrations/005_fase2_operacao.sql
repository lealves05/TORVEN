-- TORVEN — Fase 2: operação técnica (agenda, apontamento de horas, inspeção, entrega e garantia)
-- Reversão: backend/src/migrations/rollback/005_fase2_operacao.down.sql

-- ---------- Agenda / programação ----------
create table if not exists schedule_entries (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  unit_id       uuid references units(id) on delete set null,
  kind          text not null default 'execucao' check (kind in ('visita','execucao','entrega','retirada','outro')),
  title         text not null,
  order_id      uuid references orders(id) on delete cascade,
  request_id    uuid references service_requests(id) on delete cascade,
  technician_id uuid references technicians(id) on delete set null,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  location      text,
  status        text not null default 'agendado' check (status in ('agendado','em_andamento','concluido','cancelado','nao_realizado')),
  notes         text,
  created_by    uuid references users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists schedule_company_idx on schedule_entries(company_id, starts_at);
create index if not exists schedule_tech_idx on schedule_entries(technician_id, starts_at);
create index if not exists schedule_order_idx on schedule_entries(order_id);
create index if not exists schedule_request_idx on schedule_entries(request_id);

-- visitas já agendadas nas solicitações passam a aparecer na agenda (1 h)
insert into schedule_entries (company_id, unit_id, kind, title, request_id, technician_id, starts_at, ends_at, location, created_by)
select r.company_id, r.unit_id, 'visita', 'Visita — ' || r.title, r.id, r.visit_technician_id, r.visit_at, r.visit_at + interval '1 hour',
       r.address, r.created_by
  from service_requests r
 where r.visit_at is not null and r.status = 'visita_agendada'
   and not exists (select 1 from schedule_entries s where s.request_id = r.id and s.kind = 'visita');

-- ---------- Apontamento de horas ----------
create table if not exists order_time_logs (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  order_id      uuid not null references orders(id) on delete cascade,
  technician_id uuid not null references technicians(id) on delete restrict,
  user_id       uuid references users(id) on delete set null,
  activity      text not null default 'execucao' check (activity in ('diagnostico','execucao','retrabalho','inspecao','deslocamento','outro')),
  started_at    timestamptz not null,
  ended_at      timestamptz,
  minutes       numeric(10,2),
  hourly_cost   numeric(12,2) not null default 0,
  cost          numeric(12,2),
  notes         text,
  manual        boolean not null default false,
  created_at    timestamptz not null default now(),
  check (ended_at is null or ended_at > started_at)
);
create index if not exists time_logs_order_idx on order_time_logs(order_id);
create index if not exists time_logs_company_idx on order_time_logs(company_id, started_at desc);
-- um cronômetro aberto por técnico
create unique index if not exists time_logs_open_uq on order_time_logs(technician_id) where ended_at is null;

-- ---------- Checklists e inspeção ----------
create table if not exists checklist_templates (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  name        text not null,
  kind        text not null default 'inspecao' check (kind in ('recebimento','inspecao','entrega')),
  items       jsonb not null default '[]'::jsonb,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists checklist_templates_idx on checklist_templates(company_id, kind);

insert into checklist_templates (company_id, name, kind, items)
select c.id, 'Inspeção final de solda', 'inspecao',
       '["Inspeção visual do cordão (trincas, porosidade, mordedura)","Dimensões conferidas com o pedido","Alinhamento e esquadro","Rebarbas removidas / acabamento","Teste funcional (quando aplicável)","Limpeza da peça"]'::jsonb
  from companies c where not exists (select 1 from checklist_templates t where t.company_id = c.id and t.kind = 'inspecao');
insert into checklist_templates (company_id, name, kind, items)
select c.id, 'Entrega ao cliente', 'entrega',
       '["Serviço demonstrado ao cliente","Peças substituídas devolvidas/descartadas conforme combinado","Garantia explicada","Acessórios devolvidos"]'::jsonb
  from companies c where not exists (select 1 from checklist_templates t where t.company_id = c.id and t.kind = 'entrega');

create table if not exists order_inspections (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  order_id     uuid not null references orders(id) on delete cascade,
  kind         text not null default 'inspecao' check (kind in ('recebimento','inspecao','entrega')),
  template_id  uuid references checklist_templates(id) on delete set null,
  items        jsonb not null default '[]'::jsonb,
  result       text not null check (result in ('aprovado','aprovado_ressalva','reprovado')),
  notes        text,
  inspector_id uuid references users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists order_inspections_idx on order_inspections(order_id, created_at desc);

-- ---------- OS: entrega, custo real de mão de obra e retrabalho de garantia ----------
alter table orders add column if not exists inspection_result text;
alter table orders add column if not exists delivered_to text;
alter table orders add column if not exists delivered_document text;
alter table orders add column if not exists labor_minutes numeric(10,2) not null default 0;
alter table orders add column if not exists labor_cost numeric(12,2) not null default 0;
alter table orders add column if not exists warranty_of uuid references orders(id) on delete set null;

-- ---------- Garantias ----------
create table if not exists warranty_claims (
  id              uuid primary key default gen_random_uuid(),
  number          int not null,
  company_id      uuid not null references companies(id) on delete cascade,
  order_id        uuid not null references orders(id) on delete restrict,
  customer_id     uuid references customers(id) on delete set null,
  status          text not null default 'aberta' check (status in ('aberta','em_analise','procedente','improcedente','concluida')),
  within_warranty boolean not null default true,
  description     text not null,
  analysis        text,
  resolution      text,
  rework_order_id uuid references orders(id) on delete set null,
  opened_by       uuid references users(id) on delete set null,
  opened_at       timestamptz not null default now(),
  closed_at       timestamptz
);
create unique index if not exists warranty_claims_number_uq on warranty_claims(company_id, number);
create index if not exists warranty_claims_order_idx on warranty_claims(order_id);

alter table attachments drop constraint if exists attachments_entity_check;
alter table attachments add constraint attachments_entity_check check (entity in ('equipment','request','quote','order','customer','warranty','inspection'));

alter table schedule_entries    enable row level security;
alter table order_time_logs     enable row level security;
alter table checklist_templates enable row level security;
alter table order_inspections   enable row level security;
alter table warranty_claims     enable row level security;
