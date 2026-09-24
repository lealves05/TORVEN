-- Versão de demonstração: empresa criada com um clique, convertida para uso normal depois
alter table companies add column if not exists is_demo boolean not null default false;
create index if not exists companies_demo_idx on companies(is_demo, created_at);
