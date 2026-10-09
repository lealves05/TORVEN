-- 023: importar a tabela de serviços (código do sistema antigo e lote, para poder desfazer).
alter table services add column if not exists legacy_code text;
alter table services add column if not exists import_batch_id uuid references import_batches(id) on delete set null;
create index if not exists services_name_idx on services(company_id, lower(name));
alter table import_batches drop constraint if exists import_batches_kind_check;
alter table import_batches add constraint import_batches_kind_check check (kind in ('clientes','veiculos','os','servicos'));
