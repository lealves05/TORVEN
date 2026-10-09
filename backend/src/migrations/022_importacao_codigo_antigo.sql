-- 022: importação de outro sistema — código do cliente no sistema antigo (para ligar veículos e OS) e lote de veículos.
alter table customers add column if not exists legacy_code text;
create index if not exists customers_legacy_code_idx on customers(company_id, legacy_code) where legacy_code is not null;
alter table import_batches drop constraint if exists import_batches_kind_check;
alter table import_batches add constraint import_batches_kind_check check (kind in ('clientes','veiculos','os'));
