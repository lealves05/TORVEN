# TORVEN — plataforma para assistência técnica

Plataforma web (frontend + API) para empresas de **soldas especiais, serralheria, caldeiraria leve e pequenos reparos mecânicos**:
do primeiro contato do cliente até a entrega, o faturamento e o recebimento. Responsiva (no celular as listas viram cartões),
personalizável por empresa e por usuário, multiempresa e com perfis de acesso aplicados na API.

## Fluxo principal

```
Solicitação → visita/triagem → diagnóstico → orçamento (revisões) → aprovação total/parcial → OS → execução → entrega → nota fiscal → recebimento → garantia
```

Estados técnicos (OS), comerciais (solicitação/orçamento), fiscais (documento) e financeiros (lançamentos) são guardados separadamente.

## O que está operacional

| Área | Situação |
|---|---|
| **Navegação** | Menu lateral recolhível com grupos e dicas, trilha (breadcrumbs), busca global (`Ctrl/⌘+K` ou `/`), central de notificações calculada a partir dos dados, atalhos (`Alt+S` solicitação, `Alt+O` OS, `Alt+Q` orçamento), barra superior opcional |
| **Empresas e unidades** | Cadastro da empresa na tela de login, versão de demonstração ativável para uso normal, unidades (matriz/filiais), numeração com prefixo configurável (`SOL-`, `ORC-`, `OS-`, `ENT-`) |
| **Perfis de acesso** | Proprietário, administrador, gerente, atendimento, orçamentista, supervisor técnico, técnico, compras e estoque, financeiro, fiscal e consulta — permissões editáveis por perfil e verificadas no backend |
| **Clientes e objetos de serviço** | Pessoa física/jurídica, várias pessoas de contato, endereços de cobrança/execução/entrega, objetos (equipamento, peça, estrutura, veículo) com material, dimensões, quantidade, placa, patrimônio e condição de recebimento; fotos autorizadas (reduzidas no navegador) e PDFs |
| **Solicitações** | Entrada por telefone/WhatsApp/e-mail/balcão/site/indicação, triagem, agendamento de visita técnica, diagnóstico, perda/cancelamento com motivo, histórico, geração de orçamento ou OS direta |
| **Orçamentos** | Mão de obra, materiais, consumíveis, deslocamento, terceiros e outras despesas; itens opcionais/alternativos com grupos; escopo, premissas e exclusões; desconto, acréscimos, tributos estimados, custo e margem; **revisões versionadas** a cada envio; registro de aprovação total/parcial ou recusa (quem, como, quando); link público com escolha de opcionais; conversão em OS só com os itens aprovados |
| **Ordens de serviço** | Quadro kanban e lista, etapas, técnico por serviço, materiais que baixam estoque, pagamentos parciais, link de acompanhamento, impressão; estados separados na OS (técnico, qualidade, entrega, financeiro, fiscal) |
| **Agenda e programação** | Visitas, execuções, entregas e retiradas por técnico em visão semanal; conflito de horário detectado (confirmação explícita para sobrepor); visitas das solicitações entram na agenda automaticamente; baixa (concluído / não realizado com motivo) |
| **Execução e horas** | Cronômetro por técnico (um aberto por vez), lançamento manual justificado e auditado, bloqueio de sobreposição e de horas futuras; custo real de mão de obra na OS (hora do técnico); painel de produção e folha de horas com CSV |
| **Qualidade e entrega** | Checklists editáveis (recebimento, inspeção final, entrega); inspeção reprovada devolve a OS para execução; opções para exigir inspeção aprovada e nome de quem recebeu; entrega registra recebedor e documento |
| **Garantias** | Chamado aberto a partir da OS entregue (indica se está no prazo), análise técnica, parecer procedente/improcedente, OS de retrabalho sem custo vinculada à original, conclusão só após o retrabalho entregue |
| **Materiais e compras** | Estoque, entrada de nota do fornecedor com custo médio e contas a pagar, ajustes e inventário, fornecedores |
| **Financeiro** | Caixa (abertura/fechamento), contas a pagar/receber, comissões, relatórios gerenciais |
| **Fiscal** | Focus NFe (NFS-e nacional/municipal e NF-e) com cadastro guiado dentro do sistema. **Sem provedor configurado nada é emitido**: o sistema mostra *“Emissão indisponível: integração fiscal não configurada”* e só permite preparar o documento para conferência (sem número, protocolo ou valor fiscal) |
| **Auditoria** | Registro permanente de preços, aprovações, estoque, caixa, pagamentos, documentos fiscais, usuários, perfis, unidades e configurações (sem gravar senhas, tokens ou certificados) |

Ainda **não** fazem parte da plataforma (fases seguintes): requisição de materiais para a OS, compras com cotação, conciliação bancária,
DRE completa, relacionamento/pós-venda e Torven Pay. Nenhum desses itens aparece no menu até estar funcionando.

> Mensagens externas: o TORVEN **não envia** WhatsApp/e-mail sozinho. O usuário escolhe o canal, confirma e a mensagem abre no aparelho dele; o sistema registra o envio.

## Tecnologias

| Camada | Stack |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS, React Router, Recharts, date-fns, lucide-react |
| API | Node.js 20+, Express 5, PostgreSQL (`pg`), JWT, bcrypt, zod, helmet, rate-limit |
| Banco | PostgreSQL 16 (Supabase em produção) — migrações versionadas aplicadas na inicialização |
| Fiscal | Focus NFe (API REST v2) |

## Instalação local

```bash
# 1) Banco (PostgreSQL 16)
docker compose up -d

# 2) API  (http://localhost:3333)
cd backend
cp .env.example .env
npm install
npm run dev          # aplica as migrações pendentes ao iniciar

# 3) Frontend  (http://localhost:5173 — /api é encaminhado para a API)
cd ../frontend
npm install
npm run dev
```

Abra http://localhost:5173 e use **Cadastrar empresa** (com ou sem dados de exemplo) ou **Experimentar a demonstração**.

### Variáveis de ambiente

**API (`backend/.env`)**

| Variável | Obrigatória | Descrição |
|---|---|---|
| `DATABASE_URL` | sim | Conexão PostgreSQL. No Supabase use o *pooler* |
| `JWT_SECRET` | sim em produção | Texto longo e aleatório para assinar as sessões (na Edge Function é gerado e guardado no banco, tabela `_secrets`) |
| `CORS_ORIGIN` | não | Domínios do site autorizados, separados por vírgula (`https://torven.vercel.app,*.vercel.app`) |
| `PORT` | não | Porta da API (padrão 3333) |
| `DATABASE_SSL` | não | `false` para desligar SSL em bancos locais fora de `localhost` |
| `FOCUS_URL_HOMOLOGACAO` / `FOCUS_URL_PRODUCAO` | não | Só para testes com o simulador da Focus |

Tokens da Focus NFe **não** vão em variável de ambiente: são cadastrados por empresa em *Configurações › Fiscal*, ficam no banco e nunca voltam inteiros ao navegador.

**Frontend (`frontend/.env`)**

| Variável | Descrição |
|---|---|
| `VITE_API_URL` | URL da API quando ela não está no mesmo domínio (vazio = usa `/api`) |
| `VITE_BASE` | Subcaminho de publicação (ex.: `/TORVEN/` no GitHub Pages) |

## Migrações

- Arquivos SQL em `backend/src/migrations/NNN_nome.sql`, aplicados em ordem e registrados na tabela `_migrations`.
- Rodam automaticamente quando a API inicia (local, Render ou Edge Function). Cada arquivo roda numa transação.
- `004_fase1_comercial.sql` (Fase 1): unidades, perfis ampliados, auditoria, contatos/endereços, objetos de serviço, anexos,
  solicitações, orçamentos v2 (revisões e aprovações) e documentos fiscais “preparados” (os antigos “internos” perdem o número simulado).

- `005_fase2_operacao.sql` (Fase 2): agenda, apontamentos de horas, checklists/inspeções, garantias, campos de entrega e custo real na OS.

**Reversão (rollback)** — cada migração nova tem um script manual em `backend/src/migrations/rollback/` (reverta da mais nova para a mais antiga):

```bash
pg_dump "$DATABASE_URL" > antes-do-rollback.sql          # sempre faça backup antes
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/src/migrations/rollback/005_fase2_operacao.down.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/src/migrations/rollback/004_fase1_comercial.down.sql   # só se for voltar também a Fase 1
# publique a versão anterior do código; se a versão nova subir de novo, a migração é reaplicada
```

O script 005 apaga agenda, apontamentos, inspeções e garantias. O 004 apaga solicitações, contatos, endereços, anexos, revisões/aprovações e auditoria, e reconverte perfis e estados novos para os antigos.

## Testes

```bash
cd backend
# terminal 1 — API apontando o fiscal para o simulador
FOCUS_URL_HOMOLOGACAO=http://localhost:4999 FOCUS_URL_PRODUCAO=http://localhost:4999 npm run dev
# terminal 2 — teste ponta a ponta (sobe o simulador da Focus na porta 4999)
MOCK_FOCUS=4999 npm test
```

O teste (`scripts/smoke.mjs`, 130 verificações) cobre cadastro, OS, estoque, pagamentos, fiscal (preparar sem provedor, emitir,
consultar, cancelar, cadastro da empresa na Focus), relatórios, demonstração e toda a Fase 1: unidades, contatos, endereços,
anexos, solicitação → visita → diagnóstico → orçamento → revisões → aprovação parcial → OS, busca global, notificações,
auditoria, permissões por perfil e **isolamento entre empresas**; e a Fase 2: agenda com conflito, cronômetro e lançamento manual,
custo real, inspeção obrigatória/reprovação, entrega com recebedor, garantia com retrabalho e restrições do perfil técnico. Build do site: `cd frontend && npm run build`.

## Backup e restauração

```bash
# backup completo (dados + estrutura)
pg_dump --no-owner --format=custom "$DATABASE_URL" -f torven-$(date +%F).dump
# restaurar em um banco vazio
pg_restore --no-owner --clean --if-exists -d "$DATABASE_URL_DESTINO" torven-AAAA-MM-DD.dump
```

No Supabase os backups diários automáticos ficam em *Database › Backups*. Anexos (fotos/PDFs) ficam no próprio banco e entram no mesmo backup.

## Publicação

| Parte | Onde | Endereço |
|---|---|---|
| Site | **Vercel** (workflow `deploy.yml`, a cada push na `main`) | https://torven-ebon.vercel.app |
| Site (espelho) | GitHub Pages (workflow `pages.yml`) | https://lealves05.github.io/TORVEN/ |
| API | Supabase Edge Function `torven-api` | `/api/*` do site é encaminhado para ela (`frontend/vercel.json`) |
| Banco | Supabase PostgreSQL (São Paulo) | migrações automáticas na primeira requisição |

- A Edge Function é uma carregadora: importa o código da API publicado junto com o site em `/edge/torven-api.js`
  (gerado por `node backend/scripts/build-edge.mjs`). Cada `git push` atualiza site **e** API.
- Segredo necessário no GitHub: `VERCEL_TOKEN` (*Settings › Secrets › Actions*). Nunca coloque tokens no código.
- Alternativa com servidor dedicado: `render.yaml` (Render) para a API; defina `VITE_API_URL` no site e `CORS_ORIGIN` na API.

## Configurar a emissão de notas (passo a passo dentro do sistema)

Tudo é feito em **Configurações › Fiscal (NF-e / NFS-e)**, com o sistema já rodando. A tela mostra um checklist de 6 etapas:

1. **Dados fiscais da empresa** — CNPJ (com checagem dos dígitos), IE, IM, regime (Simples/MEI/normal), CNAE, endereço e código IBGE (preenchidos pelo CEP), e quais notas a empresa vai emitir (NFS-e, NF-e). Os campos que faltam ficam em vermelho.
2. **Conta Focus NFe** — cole o **token principal da conta** (painel Focus › Minha conta › Token). O TORVEN confere o token e, se a empresa já existir na Focus, importa os tokens dela.
   *Alternativa:* se o seu plano não liberar a API de empresas, cadastre a empresa no painel da Focus e cole os tokens de homologação e produção da empresa.
3. **Empresa e certificado A1** — envie o arquivo `.pfx`/`.p12` e a senha. Use **Validar sem gravar** (a Focus confere tudo sem salvar) e depois **Cadastrar empresa na Focus**. O TORVEN cria (ou atualiza) a empresa, liga NF-e/NFS-e, importa os tokens e mostra a validade do certificado. O certificado vai direto para a Focus e **não é armazenado** no TORVEN. Para renovar, envie o novo arquivo na mesma tela. Se já emitia notas por outro sistema, informe o próximo número da NF-e e da DPS.
4. **Tributação** — item LC 116 / código de tributação nacional, ISS, regime especial, CFOP, CSOSN/CST e séries; aponta materiais sem NCM.
5. **Teste em homologação** — botão de teste de conexão nos dois ambientes e emissão de NFS-e e NF-e de teste (R$ 1,00) para um cliente, com a consulta da autorização.
6. **Produção** — com o checklist completo, ative a emissão em produção (pode voltar para homologação a qualquer momento).

O sistema avisa no painel e na tela de notas quando o certificado estiver a 30 dias ou menos do vencimento.

> Regras tributárias variam por município, estado e atividade. Valide os códigos com seu contador antes de emitir em produção.

## Estrutura

```
TORVEN/
├── backend/
│   ├── src/routes/        auth, empresa, unidades, usuários, clientes, solicitações, orçamentos, OS, agenda, produção,
│   │                      qualidade, garantias, materiais,
│   │                      compras, caixa, notas, anexos, auditoria, busca/notificações, relatórios, público
│   ├── src/domain.js      numeração, itens, estoque e financeiro da OS
│   ├── src/audit.js       trilha de auditoria (explícita + automática para operações sensíveis)
│   ├── src/fiscal.js      integração Focus NFe
│   ├── src/migrations/    SQL versionado (+ rollback/)
│   └── scripts/           smoke.mjs (teste ponta a ponta), build-edge.mjs (bundle da Edge Function)
├── frontend/src/
│   ├── components/        Layout (menu, trilha), Workspace (busca, notificações, atalhos), Table, ItemsEditor, Attachments…
│   └── pages/             Início, Solicitações, Orçamentos, OS, Venda, Agenda, Produção, Garantias, Clientes, Estoque, Entradas, Financeiro,
│                          Notas, Relatórios, Unidades, Auditoria, Configurações, Impressão, páginas públicas
└── docker-compose.yml
```

## Segurança

- Senhas com bcrypt, sessões JWT (7 dias), limite de tentativas no login e nos links públicos
- Autorização verificada na API em cada rota; consultas sempre filtradas pela empresa; RLS ligado em todas as tabelas
- Operações que mexem em OS, estoque e financeiro rodam numa única transação
- Auditoria de preços, aprovações, estoque, caixa, pagamentos, documentos fiscais, permissões e configurações
- Nenhuma autorização fiscal, número ou protocolo é simulado; nenhuma mensagem externa é enviada sem ação do usuário
- Links públicos com token aleatório; anexos só de tipos permitidos (JPG, PNG, WEBP, PDF) e com confirmação de autorização do cliente
