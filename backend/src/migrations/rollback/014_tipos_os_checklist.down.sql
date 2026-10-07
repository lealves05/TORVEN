-- Reverte 014 (apaga os tipos de OS e o vínculo dos checklists; mantém OS, checklists e inspeções).
drop index if exists orders_type_idx;
alter table orders drop column if exists order_type_id;
drop index if exists checklist_templates_type_idx;
alter table checklist_templates drop column if exists required;
alter table checklist_templates drop column if exists order_type_id;
drop table if exists order_types;
delete from _migrations where name = '014_tipos_os_checklist.sql';
