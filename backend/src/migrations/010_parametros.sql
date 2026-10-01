-- Parâmetros do sistema (valem para todas as empresas), editáveis pelo MASTER da central da plataforma.
-- Somente create. Sem a central, os valores padrão do código continuam valendo.
create table if not exists system_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table system_settings enable row level security;
