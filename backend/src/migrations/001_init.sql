-- TORVEN — schema inicial
create extension if not exists pgcrypto;

create table if not exists companies (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,           -- razão social / nome
  trade_name             text,                    -- nome fantasia
  slug                   text not null unique,
  document               text,                    -- CNPJ / CPF
  state_registration     text,                    -- IE
  municipal_registration text,                    -- IM
  phone                  text,
  email                  text,
  cep                    text,
  street                 text,
  number                 text,
  complement             text,
  district               text,
  city                   text,
  uf                     text,
  city_code              text,                    -- IBGE
  logo_url               text,
  settings               jsonb not null default '{}'::jsonb,
  fiscal                 jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now()
);

create table if not exists technicians (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  name            text not null,
  phone           text,
  email           text,
  specialty       text,
  color           text not null default '#ea580c',
  commission_rate numeric(5,2) not null default 0,
  hourly_cost     numeric(10,2) not null default 0,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);
create index if not exists technicians_company_idx on technicians(company_id);

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  name          text not null,
  email         text not null unique,
  password_hash text not null,
  role          text not null default 'admin' check (role in ('owner','admin','attendant','technician')),
  technician_id uuid references technicians(id) on delete set null,
  active        boolean not null default true,
  preferences   jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists users_company_idx on users(company_id);

create table if not exists customers (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references companies(id) on delete cascade,
  kind                   text not null default 'pf' check (kind in ('pf','pj')),
  name                   text not null,
  trade_name             text,
  document               text,
  state_registration     text,
  municipal_registration text,
  phone                  text,
  phone2                 text,
  email                  text,
  cep                    text,
  street                 text,
  number                 text,
  complement             text,
  district               text,
  city                   text,
  uf                     text,
  city_code              text,
  notes                  text,
  tags                   text[] not null default '{}',
  active                 boolean not null default true,
  created_at             timestamptz not null default now()
);
create index if not exists customers_company_name_idx on customers(company_id, lower(name));
create index if not exists customers_company_doc_idx on customers(company_id, document);

create table if not exists equipment (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  category    text,
  description text not null,
  brand       text,
  model       text,
  serial      text,
  year        text,
  notes       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists equipment_customer_idx on equipment(customer_id);

create table if not exists suppliers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  name        text not null,
  document    text,
  contact     text,
  phone       text,
  email       text,
  address     text,
  notes       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists suppliers_company_idx on suppliers(company_id);

create table if not exists services (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  name            text not null,
  category        text,
  description     text,
  unit            text not null default 'serv',
  price           numeric(12,2) not null default 0,
  cost            numeric(12,2) not null default 0,
  est_minutes     int not null default 60,
  commission_rate numeric(5,2),
  service_code    text,                        -- item da LC 116 (ex.: 14.01)
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);
create index if not exists services_company_idx on services(company_id);

create table if not exists products (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  name        text not null,
  sku         text,
  barcode     text,
  category    text,
  unit        text not null default 'un',
  cost        numeric(12,4) not null default 0,
  price       numeric(12,2) not null default 0,
  stock       numeric(12,3) not null default 0,
  min_stock   numeric(12,3) not null default 0,
  location    text,
  ncm         text,
  cfop        text,
  origin      smallint not null default 0,
  supplier_id uuid references suppliers(id) on delete set null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists products_company_idx on products(company_id);

create table if not exists purchases (
  id             uuid primary key default gen_random_uuid(),
  number         int not null,
  company_id     uuid not null references companies(id) on delete cascade,
  supplier_id    uuid references suppliers(id) on delete set null,
  invoice_number text,
  invoice_series text,
  invoice_key    text,
  issue_date     date,
  received_at    timestamptz,
  status         text not null default 'rascunho' check (status in ('rascunho','recebida','cancelada')),
  subtotal       numeric(12,2) not null default 0,
  freight        numeric(12,2) not null default 0,
  other          numeric(12,2) not null default 0,
  discount       numeric(12,2) not null default 0,
  total          numeric(12,2) not null default 0,
  notes          text,
  created_by     uuid references users(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists purchases_company_idx on purchases(company_id, created_at desc);
create unique index if not exists purchases_number_uq on purchases(company_id, number);

create table if not exists purchase_items (
  id          uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references purchases(id) on delete cascade,
  product_id  uuid references products(id) on delete set null,
  description text not null,
  unit        text,
  qty         numeric(12,3) not null,
  unit_cost   numeric(12,4) not null default 0,
  total       numeric(12,2) not null default 0,
  position    int not null default 0
);
create index if not exists purchase_items_idx on purchase_items(purchase_id);

create table if not exists quotes (
  id              uuid primary key default gen_random_uuid(),
  number          int not null,
  company_id      uuid not null references companies(id) on delete cascade,
  customer_id     uuid references customers(id) on delete set null,
  equipment_id    uuid references equipment(id) on delete set null,
  technician_id   uuid references technicians(id) on delete set null,
  title           text not null,
  description     text,
  status          text not null default 'rascunho'
                  check (status in ('rascunho','enviado','aprovado','recusado','expirado','convertido')),
  valid_until     date,
  subtotal        numeric(12,2) not null default 0,
  discount        numeric(12,2) not null default 0,
  total           numeric(12,2) not null default 0,
  payment_terms   text,
  delivery_days   int,
  warranty_days   int,
  terms           text,
  internal_notes  text,
  public_token    text unique,
  approved_at     timestamptz,
  refused_at      timestamptz,
  customer_response text,
  order_id        uuid,
  created_by      uuid references users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists quotes_company_idx on quotes(company_id, created_at desc);
create unique index if not exists quotes_number_uq on quotes(company_id, number);

create table if not exists quote_items (
  id          uuid primary key default gen_random_uuid(),
  quote_id    uuid not null references quotes(id) on delete cascade,
  position    int not null default 0,
  kind        text not null check (kind in ('servico','material','avulso')),
  service_id  uuid references services(id) on delete set null,
  product_id  uuid references products(id) on delete set null,
  description text not null,
  unit        text,
  qty         numeric(12,3) not null default 1,
  unit_price  numeric(12,2) not null default 0,
  unit_cost   numeric(12,4) not null default 0,
  discount    numeric(12,2) not null default 0,
  total       numeric(12,2) not null default 0
);
create index if not exists quote_items_idx on quote_items(quote_id);

create table if not exists orders (
  id               uuid primary key default gen_random_uuid(),
  number           int not null,
  company_id       uuid not null references companies(id) on delete cascade,
  kind             text not null default 'os' check (kind in ('os','venda')),
  customer_id      uuid references customers(id) on delete set null,
  equipment_id     uuid references equipment(id) on delete set null,
  quote_id         uuid references quotes(id) on delete set null,
  technician_id    uuid references technicians(id) on delete set null,
  status           text not null default 'aberta' check (status in (
                     'aberta','diagnostico','aguardando_aprovacao','aprovada','aguardando_material',
                     'em_execucao','pronta','entregue','cancelada')),
  priority         text not null default 'normal' check (priority in ('baixa','normal','alta','urgente')),
  service_location text not null default 'oficina' check (service_location in ('oficina','externo')),
  service_address  text,
  received_at      timestamptz not null default now(),
  promised_at      timestamptz,
  started_at       timestamptz,
  finished_at      timestamptz,
  delivered_at     timestamptz,
  cancelled_at     timestamptz,
  problem          text,
  diagnosis        text,
  solution         text,
  accessories      text,
  condition        text,
  subtotal         numeric(12,2) not null default 0,
  discount         numeric(12,2) not null default 0,
  total            numeric(12,2) not null default 0,
  warranty_days    int not null default 0,
  warranty_until   date,
  notes            text,
  internal_notes   text,
  public_token     text unique,
  cash_session_id  uuid,
  created_by       uuid references users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists orders_company_idx on orders(company_id, created_at desc);
create unique index if not exists orders_number_uq on orders(company_id, number);
create index if not exists orders_company_status_idx on orders(company_id, status);
create index if not exists orders_customer_idx on orders(customer_id);

alter table quotes drop constraint if exists quotes_order_fk;
alter table quotes add constraint quotes_order_fk foreign key (order_id) references orders(id) on delete set null;

create table if not exists order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references orders(id) on delete cascade,
  position         int not null default 0,
  kind             text not null check (kind in ('servico','material','avulso')),
  service_id       uuid references services(id) on delete set null,
  product_id       uuid references products(id) on delete set null,
  technician_id    uuid references technicians(id) on delete set null,
  description      text not null,
  unit             text,
  qty              numeric(12,3) not null default 1,
  unit_price       numeric(12,2) not null default 0,
  unit_cost        numeric(12,4) not null default 0,
  discount         numeric(12,2) not null default 0,
  total            numeric(12,2) not null default 0,
  commission_rate  numeric(5,2) not null default 0,
  commission_value numeric(12,2) not null default 0
);
create index if not exists order_items_idx on order_items(order_id);

create table if not exists order_events (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id) on delete cascade,
  type        text not null default 'nota',
  from_status text,
  to_status   text,
  message     text,
  public      boolean not null default false,
  user_id     uuid references users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists order_events_idx on order_events(order_id, created_at);

create table if not exists stock_movements (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  product_id    uuid not null references products(id) on delete cascade,
  type          text not null check (type in ('entrada','saida','ajuste')),
  qty           numeric(12,3) not null,          -- positivo entra, negativo sai
  balance_after numeric(12,3),
  unit_cost     numeric(12,4),
  reason        text,
  order_id      uuid references orders(id) on delete set null,
  purchase_id   uuid references purchases(id) on delete set null,
  created_by    uuid references users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists stock_movements_product_idx on stock_movements(product_id, created_at desc);
create index if not exists stock_movements_order_idx on stock_movements(order_id);

create table if not exists cash_sessions (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  opened_by       uuid references users(id) on delete set null,
  opened_at       timestamptz not null default now(),
  opening_amount  numeric(12,2) not null default 0,
  closed_by       uuid references users(id) on delete set null,
  closed_at       timestamptz,
  closing_amount  numeric(12,2),
  expected_amount numeric(12,2),
  notes           text
);
create index if not exists cash_sessions_company_idx on cash_sessions(company_id, opened_at desc);

create table if not exists transactions (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  type            text not null check (type in ('entrada','saida')),
  category        text not null default 'Outros',
  description     text,
  amount          numeric(12,2) not null check (amount >= 0),
  method          text,
  due_date        date,
  paid_at         timestamptz,
  document        text,
  order_id        uuid references orders(id) on delete cascade,
  purchase_id     uuid references purchases(id) on delete cascade,
  cash_session_id uuid references cash_sessions(id) on delete set null,
  customer_id     uuid references customers(id) on delete set null,
  supplier_id     uuid references suppliers(id) on delete set null,
  technician_id   uuid references technicians(id) on delete set null,
  auto            boolean not null default false,  -- gerado pelo sistema (taxa, compra, OS)
  created_by      uuid references users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists transactions_company_paid_idx on transactions(company_id, paid_at);
create index if not exists transactions_company_due_idx on transactions(company_id, due_date);
create index if not exists transactions_order_idx on transactions(order_id);

create table if not exists invoices (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  order_id          uuid references orders(id) on delete set null,
  customer_id       uuid references customers(id) on delete set null,
  kind              text not null check (kind in ('nfse','nfe')),
  provider          text not null default 'interno',
  environment       text,
  ref               text not null unique,
  status            text not null default 'processando'
                    check (status in ('processando','autorizada','erro','cancelada','interna')),
  number            text,
  series            text,
  access_key        text,
  verification_code text,
  amount            numeric(12,2) not null default 0,
  description       text,
  customer          jsonb,
  items             jsonb,
  pdf_url           text,
  xml_url           text,
  message           text,
  request           jsonb,
  response          jsonb,
  issued_at         timestamptz,
  cancelled_at      timestamptz,
  cancel_reason     text,
  created_by        uuid references users(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists invoices_company_idx on invoices(company_id, created_at desc);
create index if not exists invoices_order_idx on invoices(order_id);

-- Supabase: RLS ligado em todas as tabelas (a API conecta como dono e ignora RLS;
-- sem políticas, a Data API pública não enxerga nada).
alter table companies       enable row level security;
alter table technicians     enable row level security;
alter table users           enable row level security;
alter table customers       enable row level security;
alter table equipment       enable row level security;
alter table suppliers       enable row level security;
alter table services        enable row level security;
alter table products        enable row level security;
alter table purchases       enable row level security;
alter table purchase_items  enable row level security;
alter table quotes          enable row level security;
alter table quote_items     enable row level security;
alter table orders          enable row level security;
alter table order_items     enable row level security;
alter table order_events    enable row level security;
alter table stock_movements enable row level security;
alter table cash_sessions   enable row level security;
alter table transactions    enable row level security;
alter table invoices        enable row level security;
