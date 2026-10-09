alter table orders drop column if exists legacy_number;
alter table orders drop column if exists import_batch_id;
alter table equipment drop column if exists import_batch_id;
alter table customers drop column if exists import_batch_id;
drop table if exists import_batches;
drop table if exists agent_log;
alter table users drop column if exists agent_permissions;
drop table if exists finance_reminders;
delete from _migrations where name = '021_financeiro_assistente_importacao.sql';
