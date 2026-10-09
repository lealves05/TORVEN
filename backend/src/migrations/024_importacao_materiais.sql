-- 024: importar a tabela de materiais/produtos (código do sistema antigo e lote, para poder desfazer).
alter table products add column if not exists legacy_code text;
alter table products add column if not exists import_batch_id uuid references import_batches(id) on delete set null;
create index if not exists products_name_idx on products(company_id, lower(name));
create index if not exists products_legacy_idx on products(company_id, legacy_code) where legacy_code is not null;
alter table import_batches drop constraint if exists import_batches_kind_check;
alter table import_batches add constraint import_batches_kind_check check (kind in ('clientes','veiculos','os','servicos','produtos'));
