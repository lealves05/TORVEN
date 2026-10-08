-- TORVEN — 017: um checklist pode ser usado em vários tipos de OS (vínculo muitos-para-muitos).
-- Checklist sem nenhum vínculo = geral (vale para todas as OS). A coluna antiga checklist_templates.order_type_id
-- fica só por compatibilidade (não é mais lida). Rollback: migrations/rollback/017_checklists_por_tipo.down.sql
create table if not exists order_type_checklists (
  company_id    uuid not null references companies(id) on delete cascade,
  order_type_id uuid not null references order_types(id) on delete cascade,
  template_id   uuid not null references checklist_templates(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (order_type_id, template_id)
);
create index if not exists order_type_checklists_tpl_idx on order_type_checklists(template_id);
alter table order_type_checklists enable row level security;

insert into order_type_checklists (company_id, order_type_id, template_id)
select c.company_id, c.order_type_id, c.id from checklist_templates c where c.order_type_id is not null
on conflict do nothing;

-- consultas frequentes (desempenho)
create index if not exists checklist_templates_company_idx on checklist_templates(company_id, kind) where active;
create index if not exists order_inspections_order_kind_idx on order_inspections(order_id, kind);
