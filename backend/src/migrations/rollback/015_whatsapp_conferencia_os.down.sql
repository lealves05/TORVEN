-- Reverte 015 (apaga conversas e mensagens do WhatsApp e as integrações de WhatsApp/IA; mantém OS, solicitações e extratos).
alter table statement_lines drop column if exists order_id;
alter table transactions drop column if exists origin;
drop index if exists integration_configs_wa_phone_uq;
drop index if exists service_requests_conv_idx;
alter table service_requests drop column if exists conversation_id;
alter table service_requests drop column if exists plate;
alter table service_requests drop column if exists requested_start;
drop table if exists wa_messages;
drop table if exists wa_conversations;
delete from integration_configs where kind in ('whatsapp', 'ia');
alter table integration_configs drop constraint if exists integration_configs_kind_check;
alter table integration_configs add constraint integration_configs_kind_check check (kind in ('placa', 'maquininha'));
delete from _migrations where name = '015_whatsapp_conferencia_os.sql';
