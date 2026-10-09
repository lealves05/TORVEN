-- 025: ler a nota do fornecedor (XML, PDF ou foto) na entrada de materiais.
-- Guarda o código do produto no fornecedor para reconhecer o material nas próximas notas.
alter table purchase_items add column if not exists supplier_code text;
alter table purchase_items add column if not exists barcode text;
alter table purchase_items add column if not exists ncm text;
alter table purchases add column if not exists source text;   -- 'xml' | 'ia' | null (digitada)

create table if not exists supplier_product_codes (
  company_id  uuid not null references companies(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete cascade,
  code        text not null,
  product_id  uuid not null references products(id) on delete cascade,
  updated_at  timestamptz not null default now(),
  primary key (company_id, supplier_id, code)
);
alter table supplier_product_codes enable row level security;
create index if not exists purchases_invoice_key_idx on purchases(company_id, invoice_key) where invoice_key is not null;
