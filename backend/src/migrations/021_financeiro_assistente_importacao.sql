-- 021: lembretes financeiros, assistente (perfil por usuário e registro das interações), importação de clientes e OS.

-- Lembretes (pagar o aluguel dia 5, ligar para o contador...). Podem estar ligados a um lançamento.
create table if not exists finance_reminders (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies(id) on delete cascade,
  title          text not null,
  note           text,
  due_date       date not null,
  amount         numeric(12,2),
  repeat         text not null default 'nao' check (repeat in ('nao','semanal','mensal','anual')),
  transaction_id uuid references transactions(id) on delete set null,
  assigned_to    uuid references users(id) on delete set null,
  source         text not null default 'manual' check (source in ('manual','assistente')),
  done_at        timestamptz,
  done_by        uuid references users(id) on delete set null,
  created_by     uuid references users(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists finance_reminders_due_idx on finance_reminders(company_id, due_date) where done_at is null;

-- Assistente: o que cada usuário pode pedir a ele (null = padrão do perfil de acesso)
alter table users add column if not exists agent_permissions jsonb;

-- Registro de cada pedido ao assistente (o que foi pedido, o que ele entendeu e o que aconteceu)
create table if not exists agent_log (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  user_id     uuid references users(id) on delete set null,
  text        text not null,
  intent      text not null,
  outcome     text not null check (outcome in ('respondido','aguardando','confirmado','cancelado','negado','nao_entendido','erro')),
  detail      text,
  created_at  timestamptz not null default now()
);
create index if not exists agent_log_idx on agent_log(company_id, created_at desc);

-- Importações de planilha (permite desfazer o que foi criado)
create table if not exists import_batches (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  kind        text not null check (kind in ('clientes','os')),
  filename    text,
  total       int not null default 0,
  created     int not null default 0,
  updated     int not null default 0,
  skipped     int not null default 0,
  errors      jsonb not null default '[]'::jsonb,
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  undone_at   timestamptz
);
create index if not exists import_batches_idx on import_batches(company_id, created_at desc);
alter table customers add column if not exists import_batch_id uuid references import_batches(id) on delete set null;
alter table equipment add column if not exists import_batch_id uuid references import_batches(id) on delete set null;
alter table orders add column if not exists import_batch_id uuid references import_batches(id) on delete set null;
alter table orders add column if not exists legacy_number text;   -- número da OS no sistema antigo
