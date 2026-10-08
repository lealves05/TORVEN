-- TORVEN — 015: atendimento pelo WhatsApp (API oficial da Meta) com agente e conferência do extrato com as OS.
-- Somente criação de objetos e colunas novas. Rollback: migrations/rollback/015_whatsapp_conferencia_os.down.sql

-- integrações: passam a aceitar WhatsApp e IA (entender mensagens livres)
alter table integration_configs drop constraint if exists integration_configs_kind_check;
alter table integration_configs add constraint integration_configs_kind_check check (kind in ('placa', 'maquininha', 'whatsapp', 'ia'));

-- um número de WhatsApp só pode estar ligado a uma empresa
create unique index if not exists integration_configs_wa_phone_uq on integration_configs ((config->>'phone_number_id'))
  where kind = 'whatsapp' and coalesce(config->>'phone_number_id', '') <> '';

-- conversas: uma por telefone do cliente
create table if not exists wa_conversations (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  phone           text not null,                       -- só dígitos, com DDI (ex.: 5519999998888)
  name            text,                                -- nome do perfil no WhatsApp ou informado na conversa
  customer_id     uuid references customers(id) on delete set null,
  mode            text not null default 'agente' check (mode in ('agente', 'humano')),
  state           text not null default 'inicio',     -- etapa da conversa com o agente
  context         jsonb not null default '{}',         -- dados colhidos (placa, problema, data…)
  unread          int not null default 0,
  simulated       boolean not null default false,      -- conversa de teste (tela "Testar o agente"): nada é enviado
  last_inbound_at timestamptz,                         -- janela de 24 h da Meta para responder livremente
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique (company_id, phone)
);
create index if not exists wa_conversations_recent_idx on wa_conversations(company_id, last_message_at desc);
alter table wa_conversations enable row level security;

create table if not exists wa_messages (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  conversation_id uuid not null references wa_conversations(id) on delete cascade,
  direction       text not null check (direction in ('in', 'out')),
  author          text not null check (author in ('cliente', 'agente', 'equipe')),
  body            text not null,
  wa_message_id   text,
  status          text not null default 'ok' check (status in ('ok', 'enviado', 'simulado', 'falhou')),
  error           text,
  user_id         uuid references users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists wa_messages_conv_idx on wa_messages(conversation_id, created_at);
create unique index if not exists wa_messages_waid_uq on wa_messages(company_id, wa_message_id) where wa_message_id is not null;
alter table wa_messages enable row level security;

-- pedidos que chegam pelo WhatsApp entram como solicitação (pré-OS) aguardando aprovação da equipe
alter table service_requests add column if not exists requested_start timestamptz;   -- horário pedido pelo cliente
alter table service_requests add column if not exists plate text;                   -- placa informada na conversa
alter table service_requests add column if not exists conversation_id uuid references wa_conversations(id) on delete set null;
create index if not exists service_requests_conv_idx on service_requests(conversation_id) where conversation_id is not null;

-- conferência do extrato: OS identificada para cada crédito
alter table statement_lines add column if not exists order_id uuid references orders(id) on delete set null;
-- lançamento criado a partir do extrato ("Lançar novo" / "Receber nesta OS"): desfazer a conferência apaga o lançamento
alter table transactions add column if not exists origin text check (origin in ('extrato', 'extrato_os'));
