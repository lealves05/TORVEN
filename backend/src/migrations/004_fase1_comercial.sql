-- TORVEN — Fase 1: base comercial
-- Reversão: ver backend/src/migrations/rollback/004_fase1_comercial.down.sql (remove apenas o que esta migração criou).

-- ---------- Perfis de acesso ampliados ----------
alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check check (role in (
  'owner','admin','manager','attendant','estimator','supervisor','technician','purchasing','finance','fiscal','viewer'));

-- ---------- Unidades ----------
create table if not exists units (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  name        text not null,
  phone       text,
  cep         text, street text, number text, complement text, district text, city text, uf text, city_code text,
  is_default  boolean not null default false,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists units_company_idx on units(company_id);
insert into units (company_id, name, is_default, cep, street, number, district, city, uf, city_code)
select c.id, 'Matriz', true, c.cep, c.street, c.number, c.district, c.city, c.uf, c.city_code
  from companies c where not exists (select 1 from units u where u.company_id = c.id);
alter table users  add column if not exists unit_id uuid references units(id) on delete set null;
alter table orders add column if not exists unit_id uuid references units(id) on delete set null;
alter table quotes add column if not exists unit_id uuid references units(id) on delete set null;

-- ---------- Auditoria ----------
create table if not exists audit_log (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references companies(id) on delete cascade,
  user_id     uuid references users(id) on delete set null,
  user_name   text,
  entity      text not null,
  entity_id   text,
  action      text not null,
  summary     text,
  data        jsonb,
  ip          text,
  created_at  timestamptz not null default now()
);
create index if not exists audit_company_idx on audit_log(company_id, created_at desc);
create index if not exists audit_entity_idx on audit_log(company_id, entity, entity_id);

-- ---------- Clientes: contatos e endereços ----------
create table if not exists customer_contacts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  name        text not null,
  role        text,
  phone       text,
  email       text,
  is_primary  boolean not null default false,
  receives_quotes boolean not null default true,
  notes       text,
  created_at  timestamptz not null default now()
);
create index if not exists customer_contacts_idx on customer_contacts(customer_id);

create table if not exists customer_addresses (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  kind        text not null default 'execucao' check (kind in ('cobranca','execucao','entrega')),
  label       text,
  cep text, street text, number text, complement text, district text, city text, uf text, city_code text,
  reference   text,
  created_at  timestamptz not null default now()
);
create index if not exists customer_addresses_idx on customer_addresses(customer_id);

-- ---------- Objetos de serviço (equipamentos, peças, estruturas, veículos…) ----------
alter table equipment add column if not exists quantity     numeric(12,3) not null default 1;
alter table equipment add column if not exists dimensions   text;
alter table equipment add column if not exists material     text;
alter table equipment add column if not exists asset_tag    text;   -- patrimônio
alter table equipment add column if not exists plate        text;   -- placa
alter table equipment add column if not exists condition    text;   -- condição de recebimento

-- ---------- Anexos (fotos autorizadas, documentos) ----------
create table if not exists attachments (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  entity      text not null check (entity in ('equipment','request','quote','order','customer')),
  entity_id   uuid not null,
  filename    text not null,
  mime        text not null,
  size        int not null,
  data        text not null,         -- base64 (imagens comprimidas no navegador)
  caption     text,
  authorized  boolean not null default true,
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists attachments_entity_idx on attachments(company_id, entity, entity_id);

-- ---------- Solicitações ----------
create table if not exists service_requests (
  id               uuid primary key default gen_random_uuid(),
  number           int not null,
  company_id       uuid not null references companies(id) on delete cascade,
  unit_id          uuid references units(id) on delete set null,
  customer_id      uuid references customers(id) on delete set null,
  contact_name     text,
  contact_phone    text,
  contact_email    text,
  channel          text not null default 'telefone' check (channel in ('telefone','whatsapp','email','presencial','site','indicacao','outro')),
  equipment_id     uuid references equipment(id) on delete set null,
  title            text not null,
  description      text,
  service_location text not null default 'oficina' check (service_location in ('oficina','externo')),
  address          text,
  desired_date     date,
  priority         text not null default 'normal' check (priority in ('baixa','normal','alta','urgente')),
  status           text not null default 'nova' check (status in (
                     'nova','em_triagem','visita_agendada','diagnosticada','em_orcamento','orcada','convertida','perdida','cancelada')),
  visit_at         timestamptz,
  visit_technician_id uuid references technicians(id) on delete set null,
  visit_notes      text,
  diagnosis        text,
  lost_reason      text,
  quote_id         uuid references quotes(id) on delete set null,
  order_id         uuid references orders(id) on delete set null,
  assigned_to      uuid references users(id) on delete set null,
  created_by       uuid references users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists service_requests_number_uq on service_requests(company_id, number);
create index if not exists service_requests_status_idx on service_requests(company_id, status);

create table if not exists request_events (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references service_requests(id) on delete cascade,
  from_status text,
  to_status   text,
  message     text,
  user_id     uuid references users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists request_events_idx on request_events(request_id, created_at);

alter table quotes add column if not exists request_id uuid references service_requests(id) on delete set null;
alter table orders add column if not exists request_id uuid references service_requests(id) on delete set null;

-- ---------- Orçamentos v2 ----------
-- categorias de item: mão de obra, material, consumível, deslocamento, terceiros, outras despesas
alter table quote_items drop constraint if exists quote_items_kind_check;
alter table quote_items add constraint quote_items_kind_check
  check (kind in ('servico','material','consumivel','deslocamento','terceiro','outro','avulso'));
alter table order_items drop constraint if exists order_items_kind_check;
alter table order_items add constraint order_items_kind_check
  check (kind in ('servico','material','consumivel','deslocamento','terceiro','outro','avulso'));
alter table quote_items add column if not exists optional   boolean not null default false;
alter table quote_items add column if not exists approved   boolean;         -- aprovação parcial por item
alter table quote_items add column if not exists group_label text;          -- alternativas / seções
alter table quote_items add column if not exists notes text;

-- estados: expirado → vencido; novos: aguardando_decisao, parcialmente_aprovado
alter table quotes drop constraint if exists quotes_status_check;
update quotes set status = 'vencido' where status = 'expirado';
alter table quotes add constraint quotes_status_check check (status in (
  'rascunho','enviado','aguardando_decisao','aprovado','parcialmente_aprovado','recusado','vencido','convertido'));

alter table quotes add column if not exists revision       int not null default 0;
alter table quotes add column if not exists scope          text;
alter table quotes add column if not exists assumptions    text;   -- premissas
alter table quotes add column if not exists exclusions     text;
alter table quotes add column if not exists surcharge      numeric(12,2) not null default 0;   -- acréscimos
alter table quotes add column if not exists tax_rate       numeric(6,3) not null default 0;    -- tributos estimados (%)
alter table quotes add column if not exists tax_amount     numeric(12,2) not null default 0;
alter table quotes add column if not exists cost_total     numeric(12,2) not null default 0;
alter table quotes add column if not exists approved_total numeric(12,2);
alter table quotes add column if not exists sent_at        timestamptz;
alter table quotes add column if not exists sent_via       text;

create table if not exists quote_versions (
  id          uuid primary key default gen_random_uuid(),
  quote_id    uuid not null references quotes(id) on delete cascade,
  revision    int not null,
  snapshot    jsonb not null,
  total       numeric(12,2) not null,
  sent_via    text,
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (quote_id, revision)
);

create table if not exists quote_approvals (
  id            uuid primary key default gen_random_uuid(),
  quote_id      uuid not null references quotes(id) on delete cascade,
  revision      int not null,
  decision      text not null check (decision in ('aprovado','parcialmente_aprovado','recusado')),
  decided_by    text not null,                -- nome de quem decidiu (cliente)
  via           text not null check (via in ('presencial','telefone','whatsapp','email','link','assinatura','outro')),
  decided_at    timestamptz not null default now(),
  approved_items jsonb,
  approved_total numeric(12,2),
  notes         text,
  recorded_by   uuid references users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists quote_approvals_idx on quote_approvals(quote_id, created_at);

-- ---------- Fiscal: sem emissão simulada ----------
-- documentos "internos" antigos passam a "preparada" (sem número oficial)
alter table invoices drop constraint if exists invoices_status_check;
update invoices set status = 'preparada', number = null, series = null where status = 'interna';
alter table invoices add constraint invoices_status_check check (status in ('preparada','processando','autorizada','erro','cancelada'));

-- ---------- Segurança Supabase ----------
alter table units             enable row level security;
alter table audit_log         enable row level security;
alter table customer_contacts enable row level security;
alter table customer_addresses enable row level security;
alter table attachments       enable row level security;
alter table service_requests  enable row level security;
alter table request_events    enable row level security;
alter table quote_versions    enable row level security;
alter table quote_approvals   enable row level security;

-- ---------- Navegação: menu lateral recolhível passa a ser o padrão ----------
update companies set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{layout}', '"side"');
