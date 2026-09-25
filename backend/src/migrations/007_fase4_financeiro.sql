-- TORVEN — Fase 4: financeiro (contas, transferências, conciliação bancária, fluxo projetado, DRE)
-- Reversão: backend/src/migrations/rollback/007_fase4_financeiro.down.sql

create table if not exists financial_accounts (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  name            text not null,
  kind            text not null default 'banco' check (kind in ('caixa','banco','cartao','aplicacao','outro')),
  bank_name       text,
  agency          text,
  account_number  text,
  opening_balance numeric(14,2) not null default 0,
  is_default_cash boolean not null default false,
  is_default_bank boolean not null default false,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);
create index if not exists financial_accounts_idx on financial_accounts(company_id);

insert into financial_accounts (company_id, name, kind, is_default_cash)
select c.id, 'Caixa da oficina', 'caixa', true from companies c
 where not exists (select 1 from financial_accounts a where a.company_id = c.id and a.is_default_cash);
insert into financial_accounts (company_id, name, kind, is_default_bank)
select c.id, 'Conta bancária principal', 'banco', true from companies c
 where not exists (select 1 from financial_accounts a where a.company_id = c.id and a.is_default_bank);

alter table transactions add column if not exists account_id uuid references financial_accounts(id) on delete set null;
alter table transactions add column if not exists reconciled_at timestamptz;
alter table transactions add column if not exists statement_line_id uuid;
alter table transactions add column if not exists transfer_id uuid;
create index if not exists transactions_account_idx on transactions(account_id, paid_at);

-- Conta padrão ao dar baixa: dinheiro → caixa; demais formas → conta bancária principal.
create or replace function torven_tx_default_account() returns trigger language plpgsql as $$
begin
  if new.paid_at is not null and new.account_id is null then
    select id into new.account_id from financial_accounts
     where company_id = new.company_id and active
       and ((coalesce(new.method, '') = 'dinheiro' and is_default_cash) or (coalesce(new.method, '') <> 'dinheiro' and is_default_bank))
     limit 1;
  end if;
  return new;
end $$;
drop trigger if exists transactions_default_account on transactions;
create trigger transactions_default_account before insert or update of paid_at, method, account_id on transactions
  for each row execute function torven_tx_default_account();

update transactions t set account_id = a.id
  from financial_accounts a
 where t.account_id is null and t.paid_at is not null and a.company_id = t.company_id
   and ((coalesce(t.method, '') = 'dinheiro' and a.is_default_cash) or (coalesce(t.method, '') <> 'dinheiro' and a.is_default_bank));

-- ---------- Extratos e conciliação ----------
create table if not exists bank_statements (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  account_id   uuid not null references financial_accounts(id) on delete cascade,
  filename     text,
  format       text not null check (format in ('ofx','csv')),
  period_start date,
  period_end   date,
  lines_count  int not null default 0,
  imported_by  uuid references users(id) on delete set null,
  imported_at  timestamptz not null default now()
);

create table if not exists statement_lines (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies(id) on delete cascade,
  statement_id   uuid not null references bank_statements(id) on delete cascade,
  account_id     uuid not null references financial_accounts(id) on delete cascade,
  posted_on      date not null,
  amount         numeric(14,2) not null,          -- positivo = crédito, negativo = débito
  description    text,
  fitid          text,
  status         text not null default 'pendente' check (status in ('pendente','conciliado','ignorado')),
  transaction_id uuid references transactions(id) on delete set null,
  reconciled_by  uuid references users(id) on delete set null,
  reconciled_at  timestamptz
);
create index if not exists statement_lines_idx on statement_lines(statement_id);
create unique index if not exists statement_lines_fitid_uq on statement_lines(account_id, fitid) where fitid is not null;

alter table financial_accounts enable row level security;
alter table bank_statements    enable row level security;
alter table statement_lines    enable row level security;
