delete from import_batches where kind = 'servicos';
alter table import_batches drop constraint if exists import_batches_kind_check;
alter table import_batches add constraint import_batches_kind_check check (kind in ('clientes','veiculos','os'));
drop index if exists services_name_idx;
alter table services drop column if exists import_batch_id;
alter table services drop column if exists legacy_code;
delete from _migrations where name = '023_importacao_servicos.sql';
