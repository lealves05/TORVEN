-- Reversão manual da migração 004 (execute com psql; já remove o registro em _migrations). Faça backup antes (pg_dump)..
-- ATENÇÃO: apaga solicitações, contatos, endereços, anexos, versões/aprovações de orçamento e auditoria.
begin;
update users set role = 'attendant' where role in ('manager','estimator','purchasing','finance','fiscal','viewer');
update users set role = 'technician' where role = 'supervisor';
alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check check (role in ('owner','admin','attendant','technician'));
update quotes set status = 'aprovado' where status = 'parcialmente_aprovado';
update quotes set status = 'enviado' where status = 'aguardando_decisao';
update quotes set status = 'expirado' where status = 'vencido';
alter table quotes drop constraint if exists quotes_status_check;
alter table quotes add constraint quotes_status_check check (status in ('rascunho','enviado','aprovado','recusado','expirado','convertido'));
update quote_items set kind = case when product_id is not null and kind = 'consumivel' then 'material' else 'avulso' end where kind in ('consumivel','deslocamento','terceiro','outro');
update order_items set kind = 'material' where kind = 'consumivel' and product_id is not null;
update order_items set kind = 'avulso' where kind in ('consumivel','deslocamento','terceiro','outro');
alter table quote_items drop constraint if exists quote_items_kind_check;
alter table quote_items add constraint quote_items_kind_check check (kind in ('servico','material','avulso'));
alter table order_items drop constraint if exists order_items_kind_check;
alter table order_items add constraint order_items_kind_check check (kind in ('servico','material','avulso'));
alter table invoices drop constraint if exists invoices_status_check;
alter table invoices add constraint invoices_status_check check (status in ('processando','autorizada','erro','cancelada','interna','preparada'));
alter table quotes drop column if exists request_id; alter table orders drop column if exists request_id;
drop table if exists quote_approvals, quote_versions, request_events, service_requests, attachments,
  customer_addresses, customer_contacts, audit_log;
alter table users drop column if exists unit_id; alter table orders drop column if exists unit_id; alter table quotes drop column if exists unit_id;
drop table if exists units;
delete from _migrations where name = '004_fase1_comercial.sql';
commit;
