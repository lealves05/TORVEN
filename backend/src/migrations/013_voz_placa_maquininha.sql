-- TORVEN — 013: OS por voz (sem tabela nova), placa do veículo, consulta de placa e cobrança na maquininha.
-- Somente criação de objetos e colunas novas. Rollback: migrations/rollback/013_voz_placa_maquininha.down.sql

-- ---------- Veículo (objeto de serviço) ----------
alter table equipment add column if not exists color        text;
alter table equipment add column if not exists vehicle_data jsonb;   -- dados devolvidos pela consulta de placa (sem dados do dono)
create index if not exists equipment_plate_idx on equipment(company_id, upper(replace(plate, '-', ''))) where plate is not null;

-- ---------- Integrações da empresa (consulta de placa, maquininhas) ----------
-- config: dados não secretos; secret_enc: tokens/chaves cifrados (AES-256-GCM), nunca devolvidos ao navegador
create table if not exists integration_configs (
  company_id  uuid not null references companies(id) on delete cascade,
  kind        text not null check (kind in ('placa', 'maquininha')),
  provider    text not null,
  enabled     boolean not null default false,
  config      jsonb not null default '{}',
  secret_enc  text,
  updated_by  uuid references users(id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (company_id, kind, provider)
);
alter table integration_configs enable row level security;

-- consultas de placa: cache (evita pagar duas vezes pela mesma placa) e controle de gasto mensal
create table if not exists plate_lookups (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  plate       text not null,
  provider    text not null,
  ok          boolean not null,
  data        jsonb,
  message     text,
  user_id     uuid references users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists plate_lookups_idx on plate_lookups(company_id, plate, created_at desc);
alter table plate_lookups enable row level security;

-- ---------- Maquininhas ----------
create table if not exists payment_terminals (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  provider     text not null,
  name         text not null,
  external_id  text,                     -- terminal_id (Mercado Pago), número de série (Stone), merchant/terminal (Cielo)...
  is_default   boolean not null default false,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists payment_terminals_idx on payment_terminals(company_id, active);
create unique index if not exists payment_terminals_default_uq on payment_terminals(company_id) where is_default and active;
alter table payment_terminals enable row level security;

create table if not exists terminal_charges (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id) on delete cascade,
  order_id           uuid not null references orders(id) on delete cascade,
  terminal_id        uuid references payment_terminals(id) on delete set null,
  provider           text not null,
  amount             numeric(12,2) not null check (amount > 0),
  method             text not null check (method in ('credito', 'debito', 'pix')),
  installments       int not null default 1 check (installments between 1 and 18),
  status             text not null default 'pendente' check (status in
                       ('pendente', 'enviada', 'paga', 'recusada', 'cancelada', 'expirada', 'erro', 'divergente')),
  external_reference text not null,      -- nossa referência única enviada ao provedor
  external_id        text,               -- id do pedido/ordem no provedor
  link_url           text,               -- InfinitePay (link/QR)
  paid_amount        numeric(12,2),
  nsu                text,
  card_brand         text,
  transaction_id     uuid references transactions(id) on delete set null,  -- lançamento no financeiro (uma vez)
  message            text,
  raw                jsonb,
  created_by         uuid references users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  paid_at            timestamptz
);
create unique index if not exists terminal_charges_ref_uq on terminal_charges(external_reference);
create unique index if not exists terminal_charges_ext_uq on terminal_charges(provider, external_id) where external_id is not null;
create index if not exists terminal_charges_order_idx on terminal_charges(order_id, created_at desc);
-- uma cobrança em andamento por OS (evita cobrar duas vezes ao tocar duas vezes no botão)
create unique index if not exists terminal_charges_open_uq on terminal_charges(order_id) where status in ('pendente', 'enviada');
alter table terminal_charges enable row level security;
