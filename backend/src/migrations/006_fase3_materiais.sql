-- TORVEN — Fase 3: materiais (sugestão de compra, cotação, pedido de compra, recebimento conferido, separação para OS)
-- Reversão: backend/src/migrations/rollback/006_fase3_materiais.down.sql

alter table products add column if not exists max_stock numeric(12,3);
alter table products add column if not exists lead_days int;

-- ---------- Cotação de compra ----------
create table if not exists purchase_quotations (
  id          uuid primary key default gen_random_uuid(),
  number      int not null,
  company_id  uuid not null references companies(id) on delete cascade,
  title       text not null,
  status      text not null default 'aberta' check (status in ('aberta','fechada','cancelada')),
  due_date    date,
  notes       text,
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  closed_at   timestamptz
);
create unique index if not exists purchase_quotations_number_uq on purchase_quotations(company_id, number);

create table if not exists quotation_items (
  id            uuid primary key default gen_random_uuid(),
  quotation_id  uuid not null references purchase_quotations(id) on delete cascade,
  product_id    uuid references products(id) on delete set null,
  order_id      uuid references orders(id) on delete set null,   -- compra específica para uma OS
  description   text not null,
  unit          text,
  qty           numeric(12,3) not null check (qty > 0),
  chosen_supplier_id uuid references suppliers(id) on delete set null,
  position      int not null default 0
);
create index if not exists quotation_items_idx on quotation_items(quotation_id);

create table if not exists quotation_suppliers (
  quotation_id uuid not null references purchase_quotations(id) on delete cascade,
  supplier_id  uuid not null references suppliers(id) on delete cascade,
  primary key (quotation_id, supplier_id)
);

create table if not exists quotation_prices (
  item_id     uuid not null references quotation_items(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete cascade,
  unit_cost   numeric(12,4) not null check (unit_cost >= 0),
  lead_days   int,
  notes       text,
  updated_at  timestamptz not null default now(),
  primary key (item_id, supplier_id)
);

-- ---------- Pedido de compra ----------
create table if not exists purchase_orders (
  id             uuid primary key default gen_random_uuid(),
  number         int not null,
  company_id     uuid not null references companies(id) on delete cascade,
  supplier_id    uuid not null references suppliers(id) on delete restrict,
  quotation_id   uuid references purchase_quotations(id) on delete set null,
  status         text not null default 'rascunho' check (status in ('rascunho','enviado','parcial','recebido','cancelado')),
  expected_date  date,
  total          numeric(12,2) not null default 0,
  notes          text,
  sent_at        timestamptz,
  sent_via       text,
  cancel_reason  text,
  created_by     uuid references users(id) on delete set null,
  created_at     timestamptz not null default now()
);
create unique index if not exists purchase_orders_number_uq on purchase_orders(company_id, number);

create table if not exists purchase_order_items (
  id                uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
  product_id        uuid references products(id) on delete set null,
  order_id          uuid references orders(id) on delete set null,
  description       text not null,
  unit              text,
  qty               numeric(12,3) not null check (qty > 0),
  unit_cost         numeric(12,4) not null default 0,
  qty_received      numeric(12,3) not null default 0,
  position          int not null default 0
);
create index if not exists purchase_order_items_idx on purchase_order_items(purchase_order_id);

-- ---------- Recebimento conferido ----------
alter table purchases add column if not exists purchase_order_id uuid references purchase_orders(id) on delete set null;
alter table purchase_items add column if not exists po_item_id uuid references purchase_order_items(id) on delete set null;
alter table purchase_items add column if not exists lot text;            -- lote / corrida
alter table purchase_items add column if not exists certificate text;    -- certificado de qualidade
alter table purchase_items add column if not exists qty_ordered numeric(12,3);

-- ---------- Separação de materiais para a OS ----------
alter table order_items add column if not exists picked_qty numeric(12,3) not null default 0;
alter table order_items add column if not exists picked_at timestamptz;
alter table order_items add column if not exists picked_by uuid references users(id) on delete set null;

alter table attachments drop constraint if exists attachments_entity_check;
alter table attachments add constraint attachments_entity_check
  check (entity in ('equipment','request','quote','order','customer','warranty','inspection','purchase','purchase_order'));

alter table purchase_quotations  enable row level security;
alter table quotation_items      enable row level security;
alter table quotation_suppliers  enable row level security;
alter table quotation_prices     enable row level security;
alter table purchase_orders      enable row level security;
alter table purchase_order_items enable row level security;
