-- Configuração fiscal: notas de teste e dados do cadastro na Focus NFe
alter table invoices add column if not exists test boolean not null default false;
alter table invoices alter column order_id drop not null;
