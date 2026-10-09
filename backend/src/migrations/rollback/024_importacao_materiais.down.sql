-- desfaz 024
delete from import_batches where kind = 'produtos';
alter table import_batches drop constraint if exists import_batches_kind_check;
alter table import_batches add constraint import_batches_kind_check check (kind in ('clientes','veiculos','os','servicos'));
drop index if exists products_legacy_idx;
drop index if exists products_name_idx;
alter table products drop column if exists import_batch_id;
alter table products drop column if exists legacy_code;
delete from _migrations where name = '024_importacao_materiais.sql';
