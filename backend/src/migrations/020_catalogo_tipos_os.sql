-- TORVEN — 020: tipos de OS e checklists padrão por ramo (mecânica, autoelétrica, serralheria, soldas especiais).
-- Só colunas novas. Rollback: migrations/rollback/020_catalogo_tipos_os.down.sql
alter table order_types add column if not exists segment text;          -- ramo do tipo padrão (null = criado pela empresa)
alter table order_types add column if not exists template_key text;     -- chave do tipo padrão (evita duplicar)
create unique index if not exists order_types_template_uq on order_types(company_id, template_key) where template_key is not null;
alter table checklist_templates add column if not exists template_key text;
create unique index if not exists checklist_templates_template_uq on checklist_templates(company_id, template_key) where template_key is not null;
alter table companies add column if not exists os_catalog_version int not null default 0;
