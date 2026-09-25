export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const bad = (msg, extra) => new HttpError(400, msg, extra);
export const notFound = (msg = 'Registro não encontrado') => new HttpError(404, msg);

/** Valida req.body com um schema zod e devolve os dados limpos. */
export function parse(schema, data) {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const first = r.error.issues[0];
    const field = first.path.join('.');
    throw bad(field ? `${field}: ${first.message}` : first.message, { issues: r.error.issues });
  }
  return r.data;
}

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function slugify(s) {
  return String(s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    .slice(0, 40) || 'empresa';
}

// ---------- Fuso horário ----------
/** Diferença (min) entre o horário local do fuso e UTC em um instante. */
export function tzOffsetMinutes(tz, date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUTC - date.getTime()) / 60000);
}

/** 'YYYY-MM-DD' + 'HH:mm' no fuso tz -> Date (UTC). */
export function zonedToUtc(dateStr, timeStr, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off = tzOffsetMinutes(tz, new Date(guess));
  const first = guess - off * 60000;
  const off2 = tzOffsetMinutes(tz, new Date(first));
  return new Date(guess - off2 * 60000);
}

/** Date -> { date:'YYYY-MM-DD', time:'HH:mm', weekday } no fuso tz. */
export function utcToZoned(date, tz) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, weekday: wd };
}

export const weekdayOf = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

export const toMin = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};


export const onlyDigits = (s) => String(s || '').replace(/\D/g, '');

// ---------- Configurações padrão da empresa ----------
export const ORDER_STATUS = [
  'aberta', 'diagnostico', 'aguardando_aprovacao', 'aprovada', 'aguardando_material',
  'em_execucao', 'pronta', 'entregue', 'cancelada',
];
export const OPEN_STATUSES = ORDER_STATUS.filter((s) => !['entregue', 'cancelada'].includes(s));

export const DEFAULT_SETTINGS = {
  timezone: 'America/Sao_Paulo',
  currency: 'BRL',
  primaryColor: '#ea580c',
  theme: 'system',
  radius: 'lg',
  layout: 'side',
  paymentMethods: [
    { id: 'dinheiro', name: 'Dinheiro', fee: 0, active: true },
    { id: 'pix', name: 'PIX', fee: 0, active: true },
    { id: 'debito', name: 'Cartão de débito', fee: 1.5, active: true },
    { id: 'credito', name: 'Cartão de crédito', fee: 3.5, active: true },
    { id: 'boleto', name: 'Boleto', fee: 0, active: true },
    { id: 'transferencia', name: 'Transferência', fee: 0, active: true },
  ],
  incomeCategories: ['Ordens de serviço', 'Venda de materiais', 'Serviços externos', 'Outras receitas'],
  expenseCategories: [
    'Compra de materiais', 'Gases e consumíveis', 'Ferramentas e EPI', 'Aluguel', 'Energia elétrica',
    'Água/Internet/Telefone', 'Salários', 'Comissões', 'Manutenção de máquinas', 'Combustível/Deslocamento',
    'Terceirização', 'Taxas de cartão', 'Impostos', 'Estornos', 'Outras despesas',
  ],
  serviceCategories: [
    'Solda TIG', 'Solda MIG/MAG', 'Solda eletrodo revestido', 'Solda em alumínio', 'Solda em inox',
    'Solda em ferro fundido', 'Brasagem', 'Serralheria', 'Usinagem / Torno', 'Reparo mecânico',
    'Manutenção de máquinas de solda', 'Serviço externo',
  ],
  materialCategories: [
    'Eletrodos', 'Varetas e arames', 'Gases', 'Chapas', 'Tubos e perfis', 'Metalon', 'Cantoneiras e barras',
    'Parafusos e fixadores', 'Discos e abrasivos', 'Tintas e fundos', 'Peças de reposição', 'Outros',
  ],
  equipmentCategories: [
    'Máquina de solda', 'Portão / Grade', 'Estrutura metálica', 'Peça / Componente', 'Motor / Redutor',
    'Equipamento agrícola', 'Veículo / Implemento', 'Móvel / Mobiliário metálico', 'Outros',
  ],
  cardFeesAsExpense: true,
  requireOpenCash: false,
  orders: {
    defaultWarrantyDays: 90,
    defaultPromiseDays: 3,
    quoteValidityDays: 15,
    allowNegativeStock: true,
    requirePaymentToDeliver: false,
    requireInspection: false,
    requireReceiver: false,
    defaultVisitMinutes: 60,
    termsOrder:
      'O equipamento/peça deixado para reparo deverá ser retirado em até 90 dias após o aviso de conclusão. '
      + 'A garantia cobre apenas o serviço executado e não cobre mau uso, sobrecarga ou intervenção de terceiros.',
    termsQuote:
      'Orçamento sujeito à confirmação após desmontagem/inspeção. Materiais conforme disponibilidade. '
      + 'Pagamento: 50% na aprovação e 50% na entrega, ou conforme combinado.',
  },
  whatsapp: {
    quote: 'Olá {cliente}! Segue o orçamento nº {numero} da {empresa} no valor de {total}. Você pode ver e aprovar por aqui: {link}',
    ready: 'Olá {cliente}! Sua OS nº {numero} ({equipamento}) está pronta para retirada na {empresa}. Total: {total}. Acompanhe: {link}',
    status: 'Olá {cliente}! Atualização da OS nº {numero} na {empresa}: {status}. Acompanhe: {link}',
  },
  modules: { purchases: true, invoices: true, commissions: true, publicLinks: true },
  dateFormat: 'dd/MM/yyyy',
  numbering: { request: 'SOL', quote: 'ORC', order: 'OS', purchase: 'ENT', digits: 5 },
  quotes: {
    taxRate: 0,
    assumptions: 'Valores considerando o material e as dimensões informadas na solicitação. Serviço executado em horário comercial.',
    exclusions: 'Pintura, acabamentos e desmontagem/montagem de partes não descritas no escopo.',
  },
  requestChannels: ['telefone', 'whatsapp', 'email', 'presencial', 'site', 'indicacao', 'outro'],
};

export const DEFAULT_FISCAL = {
  provider: 'none', // 'focus' | 'none'
  environment: 'homologacao',
  token_homologacao: '',
  token_producao: '',
  nfseMode: 'nacional', // 'nacional' | 'municipal'
  simplesNacional: true,
  codigoOpcaoSimples: 3, // 1 não optante · 2 MEI · 3 ME/EPP
  regimeEspecial: 0,
  issRate: 2,
  issRetido: false,
  itemListaServico: '14.01',
  codigoTributacaoNacional: '140101',
  codigoTributarioMunicipio: '',
  cnae: '',
  naturezaOperacao: 'Venda de mercadoria',
  cfopDentro: '5102',
  cfopFora: '6102',
  icmsSituacao: '102',
  pisCofinsSituacao: '07',
  serieNfe: 1,
  serieDps: 1,
  nextDpsNumber: 1,               // produção
  nextDpsNumberHomologacao: 1,
  nextInternalNumber: 1,
  // cadastro da empresa na Focus NFe (API de empresas)
  account_token: '',              // token principal da conta Focus (não é o token da empresa)
  focus_company_id: null,
  certificate: null,              // { valid_from, valid_until, cnpj }
  registered_at: null,
  synced_at: null,
  docs: { nfe: true, nfse: true },
  cpfCnpjContabilidade: '',
  tested: { homologacao_nfse: null, homologacao_nfe: null },
};

export const dpsKey = (env) => (env === 'producao' ? 'nextDpsNumber' : 'nextDpsNumberHomologacao');

/** Valida CNPJ/CPF pelos dígitos verificadores. */
export function validDocument(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (/^(\d)\1+$/.test(d)) return false;
  const calc = (base, weights) => {
    const sum = base.split('').reduce((a, n, i) => a + Number(n) * weights[i], 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  if (d.length === 11) {
    const w1 = [10, 9, 8, 7, 6, 5, 4, 3, 2];
    const w2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2];
    return calc(d.slice(0, 9), w1) === +d[9] && calc(d.slice(0, 10), w2) === +d[10];
  }
  if (d.length === 14) {
    const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    return calc(d.slice(0, 12), w1) === +d[12] && calc(d.slice(0, 13), w2) === +d[13];
  }
  return false;
}

// ---------- Perfis de acesso ----------
export const PERMISSIONS = [
  { group: 'Atendimento e comercial', key: 'requests_view', label: 'Ver solicitações e visitas' },
  { group: 'Atendimento e comercial', key: 'requests_manage', label: 'Registrar e tratar solicitações, agendar visitas' },
  { group: 'Atendimento e comercial', key: 'quotes_view', label: 'Ver orçamentos' },
  { group: 'Atendimento e comercial', key: 'quotes', label: 'Criar, revisar e editar orçamentos' },
  { group: 'Atendimento e comercial', key: 'quotes_send', label: 'Enviar orçamentos ao cliente' },
  { group: 'Atendimento e comercial', key: 'quotes_approve', label: 'Registrar aprovação/recusa e converter em OS' },
  { group: 'Clientes', key: 'customers_view', label: 'Acessar cadastro de clientes' },
  { group: 'Clientes', key: 'customers_contact', label: 'Ver telefone, e-mail e documento' },
  { group: 'Clientes', key: 'customers_edit', label: 'Cadastrar e editar clientes, contatos e objetos' },
  { group: 'Clientes', key: 'customers_export', label: 'Exportar clientes' },
  { group: 'Ordens de serviço', key: 'orders_view', label: 'Ver ordens de serviço', type: 'scope' },
  { group: 'Ordens de serviço', key: 'orders_create', label: 'Abrir OS e vendas de balcão' },
  { group: 'Ordens de serviço', key: 'orders_edit', label: 'Editar OS (itens, diagnóstico, status)' },
  { group: 'Ordens de serviço', key: 'orders_values', label: 'Ver valores e custos' },
  { group: 'Ordens de serviço', key: 'orders_deliver', label: 'Entregar OS ao cliente' },
  { group: 'Ordens de serviço', key: 'orders_cancel', label: 'Cancelar OS' },
  { group: 'Agenda e produção', key: 'schedule_view', label: 'Ver agenda e painel de produção' },
  { group: 'Agenda e produção', key: 'schedule_manage', label: 'Programar visitas, execuções e entregas' },
  { group: 'Agenda e produção', key: 'time_log', label: 'Apontar horas', type: 'scope' },
  { group: 'Agenda e produção', key: 'inspections', label: 'Registrar inspeção de qualidade' },
  { group: 'Agenda e produção', key: 'warranty_manage', label: 'Registrar e analisar garantias' },
  { group: 'Materiais e estoque', key: 'materials_manage', label: 'Materiais e ajustes de estoque' },
  { group: 'Materiais e estoque', key: 'purchases', label: 'Compras e entrada de materiais' },
  { group: 'Materiais e estoque', key: 'suppliers', label: 'Fornecedores' },
  { group: 'Financeiro', key: 'checkout', label: 'Receber pagamentos de OS/vendas' },
  { group: 'Financeiro', key: 'discount', label: 'Conceder desconto' },
  { group: 'Financeiro', key: 'cash', label: 'Caixa, contas, estornos e fechamento' },
  { group: 'Financeiro', key: 'reports', label: 'Relatórios gerenciais' },
  { group: 'Financeiro', key: 'commissions', label: 'Ver comissões', type: 'scope' },
  { group: 'Fiscal', key: 'invoices_issue', label: 'Preparar e emitir documentos fiscais' },
  { group: 'Fiscal', key: 'invoices_cancel', label: 'Cancelar documentos fiscais' },
  { group: 'Cadastros', key: 'services_manage', label: 'Serviços, especialidades e preços' },
  { group: 'Cadastros', key: 'technicians_manage', label: 'Técnicos e equipes' },
  { group: 'Administração', key: 'settings', label: 'Configurações da empresa' },
  { group: 'Administração', key: 'units_manage', label: 'Unidades' },
  { group: 'Administração', key: 'fiscal_settings', label: 'Integração fiscal (certificado/token)' },
  { group: 'Administração', key: 'users', label: 'Usuários e perfis de acesso' },
  { group: 'Administração', key: 'audit_view', label: 'Logs e auditoria' },
  { group: 'Administração', key: 'data_export', label: 'Exportar dados' },
];

export const ROLES = {
  owner: 'Proprietário', admin: 'Administrador', manager: 'Gerente', attendant: 'Atendimento', estimator: 'Orçamentista',
  supervisor: 'Supervisor técnico', technician: 'Técnico', purchasing: 'Compras e estoque', finance: 'Financeiro',
  fiscal: 'Fiscal', viewer: 'Consulta',
};

const ALL = Object.fromEntries(PERMISSIONS.map((p) => [p.key, p.type === 'scope' ? 'all' : true]));
const NONE = Object.fromEntries(PERMISSIONS.map((p) => [p.key, p.type === 'scope' ? 'none' : false]));
const pick = (keys, base = NONE) => ({ ...base, ...Object.fromEntries(keys.map((k) => [k, PERMISSIONS.find((p) => p.key === k)?.type === 'scope' ? 'all' : true])) });

export const DEFAULT_PERMISSIONS = {
  admin: { ...ALL },
  manager: { ...ALL, users: false, fiscal_settings: false, units_manage: false },
  attendant: pick(['requests_view', 'requests_manage', 'quotes_view', 'quotes', 'quotes_send', 'quotes_approve', 'customers_view',
    'customers_contact', 'customers_edit', 'orders_view', 'orders_create', 'orders_edit', 'orders_values', 'orders_deliver', 'checkout', 'cash', 'discount',
    'schedule_view', 'schedule_manage', 'warranty_manage']),
  estimator: pick(['requests_view', 'requests_manage', 'quotes_view', 'quotes', 'quotes_send', 'customers_view', 'customers_contact',
    'customers_edit', 'orders_view', 'orders_values', 'services_manage', 'schedule_view']),
  supervisor: pick(['requests_view', 'requests_manage', 'quotes_view', 'quotes', 'customers_view', 'orders_view', 'orders_create',
    'orders_edit', 'orders_deliver', 'materials_manage', 'technicians_manage', 'commissions', 'schedule_view', 'schedule_manage', 'time_log',
    'inspections', 'warranty_manage']),
  technician: { ...NONE, requests_view: true, quotes_view: true, customers_view: true, orders_view: 'own', orders_create: true,
    orders_edit: true, commissions: 'own', schedule_view: true, time_log: 'own' },
  purchasing: pick(['materials_manage', 'purchases', 'suppliers', 'orders_view', 'quotes_view', 'customers_view', 'schedule_view']),
  finance: pick(['checkout', 'discount', 'cash', 'reports', 'commissions', 'invoices_issue', 'orders_view', 'orders_values',
    'quotes_view', 'customers_view', 'customers_contact', 'customers_export', 'data_export', 'purchases', 'suppliers']),
  fiscal: pick(['invoices_issue', 'invoices_cancel', 'fiscal_settings', 'orders_view', 'orders_values', 'customers_view',
    'customers_contact', 'reports', 'quotes_view']),
  viewer: { ...NONE, requests_view: true, quotes_view: true, customers_view: true, orders_view: 'all', reports: true, schedule_view: true },
};

export function permissionsFor(role, settings) {
  if (role === 'owner') return { ...ALL };
  const base = DEFAULT_PERMISSIONS[role] || DEFAULT_PERMISSIONS.viewer;
  return { ...base, ...(settings?.permissions?.[role] || {}) };
}

export function withDefaults(settings = {}) {
  const out = { ...DEFAULT_SETTINGS, ...settings };
  for (const k of ['orders', 'whatsapp', 'modules', 'numbering', 'quotes']) {
    out[k] = { ...DEFAULT_SETTINGS[k], ...(settings?.[k] || {}) };
  }
  out.permissions = Object.fromEntries(Object.keys(DEFAULT_PERMISSIONS).map((r) =>
    [r, { ...DEFAULT_PERMISSIONS[r], ...(settings?.permissions?.[r] || {}) }]));
  return out;
}

export const fiscalWithDefaults = (f = {}) => ({
  ...DEFAULT_FISCAL, ...(f || {}),
  docs: { ...DEFAULT_FISCAL.docs, ...(f?.docs || {}) },
  tested: { ...DEFAULT_FISCAL.tested, ...(f?.tested || {}) },
});

/** Token aleatório para links públicos. */
export const publicToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 24);
