-- Reverte 020 (os tipos e checklists criados continuam; só perdem a marcação de "padrão").
drop index if exists order_types_template_uq;
drop index if exists checklist_templates_template_uq;
alter table order_types drop column if exists segment;
alter table order_types drop column if exists template_key;
alter table checklist_templates drop column if exists template_key;
alter table companies drop column if exists os_catalog_version;
delete from _migrations where name = '020_catalogo_tipos_os.sql';
