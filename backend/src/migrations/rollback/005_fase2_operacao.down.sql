-- Reversão manual da migração 005 (faça backup com pg_dump antes). Apaga agenda, apontamentos, inspeções e garantias.
begin;
delete from attachments where entity in ('warranty','inspection');
alter table attachments drop constraint if exists attachments_entity_check;
alter table attachments add constraint attachments_entity_check check (entity in ('equipment','request','quote','order','customer'));
drop table if exists warranty_claims, order_inspections, checklist_templates, order_time_logs, schedule_entries;
alter table orders drop column if exists inspection_result, drop column if exists delivered_to, drop column if exists delivered_document,
  drop column if exists labor_minutes, drop column if exists labor_cost, drop column if exists warranty_of;
delete from _migrations where name = '005_fase2_operacao.sql';
commit;
