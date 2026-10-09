delete from import_batches where kind = 'veiculos';
alter table import_batches drop constraint if exists import_batches_kind_check;
alter table import_batches add constraint import_batches_kind_check check (kind in ('clientes','os'));
drop index if exists customers_legacy_code_idx;
alter table customers drop column if exists legacy_code;
delete from _migrations where name = '022_importacao_codigo_antigo.sql';
