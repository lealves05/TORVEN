# TORVEN — gestão para assistência técnica

Sistema web (frontend + backend) para oficinas de **soldas especiais, serralheria e pequenos reparos mecânicos**.
Mesma base técnica do ORBI: clean, responsivo (funciona no celular) e personalizável pela própria empresa.

## Funcionalidades

**Ordens de serviço**
- Entrada do equipamento/peça: cliente, equipamento (marca, modelo, nº de série), problema relatado, acessórios deixados e estado na entrada
- Etapas: recebida → diagnóstico → aguardando aprovação → aprovada → aguardando material → em execução → pronta → entregue (ou cancelada)
- **Quadro (kanban)** com arrastar e soltar, lista com filtros, prazo de entrega com alerta de atraso, prioridade e serviço na oficina ou externo
- Serviços (hora, m², peça, valor fechado) e materiais na mesma OS, técnico por serviço, desconto por item e geral
- Materiais lançados **baixam o estoque automaticamente**; editar/cancelar/reabrir a OS devolve ou baixa a diferença
- Histórico com anotações internas ou visíveis ao cliente, garantia com data de vencimento
- Recebimento parcial (sinal), pagamento dividido, troco, saldo parcelado "a receber", estorno
- Impressão A4 da OS e recibo (ou "salvar como PDF"), mensagens prontas de WhatsApp
- **Link de acompanhamento** para o cliente ver a etapa e aprovar o serviço

**Orçamentos**
- Itens do catálogo ou avulsos, validade, prazo, garantia, forma de pagamento e termos
- Envio por WhatsApp com **link público**: o cliente aprova ou recusa online
- Orçamento aprovado **vira OS em um clique** (itens, cliente e equipamento copiados)
- Expiração automática, duplicação, impressão/PDF, taxa de aprovação

**Venda de balcão** — materiais e serviços rápidos com recebimento na hora, troco e recibo

**Estoque e compras**
- Materiais com unidade (kg, m, barra, m³ de gás…), custo médio, preço, mínimo, localização e dados fiscais (NCM, origem, CFOP)
- **Entrada de materiais** (nota do fornecedor): atualiza estoque e custo médio com rateio de frete/despesas/desconto, cria materiais novos, atualiza preço de venda e gera **contas a pagar** parceladas
- Entrada/saída avulsa e inventário, histórico de movimentações, alerta de estoque baixo, fornecedores

**Financeiro**
- Abertura e fechamento de caixa com conferência, sangria e suprimento
- Fluxo de caixa, contas a pagar e a receber (baixa, desfazer baixa, recorrência), taxas de cartão lançadas como despesa
- Comissões por técnico/serviço com lançamento do pagamento

**Notas fiscais (Focus NFe)**
- **NFS-e** dos serviços (padrão nacional/DPS ou municipal) e **NF-e** dos materiais, geradas a partir da OS ou venda
- Prévia com validação (CNPJ, IBGE, NCM, endereço), consulta da autorização, DANFE/XML, cancelamento com justificativa
- Homologação e produção separadas; tokens guardados no servidor e nunca devolvidos inteiros ao navegador
- Sem Focus configurada, gera documento interno (sem valor fiscal)

**Relatórios** — entradas × saídas, DRE simplificada (receita, CMV, margem, despesas), formas de pagamento, faturamento por tipo de serviço, produção e comissão por técnico, serviços e materiais mais vendidos, prazo cumprido, tempo médio, melhores clientes, estoque valorizado com cobertura em dias. Exportação CSV.

**Personalização e acessos**
- Cor, tema claro/escuro, cantos, fonte, densidade, menu superior ou lateral, logo
- Categorias de serviços, materiais e equipamentos, formas de pagamento, termos da OS/orçamento, modelos de WhatsApp
- **Perfis editáveis** (administrador, atendimento, técnico): técnico pode ver só as próprias OS e sem valores — regras aplicadas na API
- Multiempresa: cada cadastro cria uma empresa isolada

## Tecnologias

| Camada | Stack |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS, React Router, Recharts, date-fns, lucide-react |
| Backend | Node.js 20+, Express 5, PostgreSQL (`pg`), JWT, bcrypt, zod, helmet, rate-limit |
| Banco | PostgreSQL 16 (Supabase em produção) — migrações automáticas na inicialização |
| Fiscal | Focus NFe (API REST v2) |

## Rodar localmente

```bash
# 1) Banco
docker compose up -d

# 2) API  (http://localhost:3333)
cd backend
cp .env.example .env
npm install
npm run dev

# 3) Frontend  (http://localhost:5173)
cd ../frontend
npm install
npm run dev
```

Abra http://localhost:5173, clique em **Cadastre sua empresa** e deixe marcado “Começar com dados de exemplo”.

Teste automático da API (com a API rodando): `cd backend && npm test`.
Para testar também as notas fiscais contra um simulador da Focus NFe, rode a API com
`FOCUS_URL_HOMOLOGACAO=http://localhost:4999` e o teste com `MOCK_FOCUS=4999 npm test`.

## Publicar (igual ao ORBI)

| Parte | Serviço | Observação |
|---|---|---|
| Frontend | **Vercel** — projeto `torven` (pasta `frontend`) | encaminha `/api/*` para a API (`frontend/vercel.json`) |
| API | **Vercel** — projeto `torven-api` (pasta `backend`) | função serverless (`backend/api/index.js`) |
| Banco | **Supabase** (PostgreSQL) | crie um projeto novo para o TORVEN |

1. **Supabase** → novo projeto → **Connect → Transaction pooler** (porta 6543) → copie a URL.
2. **GitHub** → crie o repositório `torven` e envie esta pasta.
3. Em *Settings → Secrets → Actions* do repositório: `VERCEL_TOKEN`, `DATABASE_URL` e `JWT_SECRET` (texto longo aleatório).
4. O workflow `.github/workflows/deploy.yml` cria os projetos na Vercel, publica API e site e roda o teste ponta a ponta a cada `git push` na `main`.

Alternativa com servidor sempre ligado: `render.yaml` (Render Blueprint) para a API; defina `VITE_API_URL` no frontend e `CORS_ORIGIN` na API.

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
├── backend/              API Express
│   ├── src/routes/       auth, empresa, clientes, OS, orçamentos, materiais, compras, caixa, notas, relatórios, público
│   ├── src/domain.js     regras de numeração, itens, estoque e financeiro da OS
│   ├── src/fiscal.js     integração Focus NFe (NFS-e nacional/municipal e NF-e)
│   ├── src/migrations/   SQL versionado
│   └── scripts/smoke.mjs teste ponta a ponta (com simulador da Focus)
├── frontend/             SPA React
│   └── src/pages/        Dashboard, OS (quadro/lista/detalhe), Orçamentos, Venda, Clientes, Estoque, Entradas,
│                         Financeiro, Notas, Relatórios, Configurações, Impressão, páginas públicas
├── render.yaml
└── docker-compose.yml
```

## Segurança

- Senhas com bcrypt, sessões JWT (7 dias), limite de tentativas no login e nos links públicos
- Todas as consultas isoladas por empresa; RLS ligado em todas as tabelas (a Data API pública do Supabase não enxerga nada)
- Links públicos usam token aleatório por OS/orçamento
- Defina um `JWT_SECRET` forte em produção
