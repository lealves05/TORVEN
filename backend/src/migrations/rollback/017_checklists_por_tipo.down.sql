-- Reverte 017 (volta ao vínculo de um tipo por checklist: mantém o primeiro vínculo de cada checklist).
update checklist_templates c set order_type_id = l.order_type_id
  from (select distinct on (template_id) template_id, order_type_id from order_type_checklists order by template_id, created_at) l
 where l.template_id = c.id;
drop table if exists order_type_checklists;
drop index if exists checklist_templates_company_idx;
drop index if exists order_inspections_order_kind_idx;
delete from _migrations where name = '017_checklists_por_tipo.sql';
