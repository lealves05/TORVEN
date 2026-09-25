// Trilha de auditoria: quem fez o quê, quando, em qual registro.
import { q } from './db.js';

/**
 * @param {{query: Function}|null} db  conexão da transação (ou null para o pool)
 * @param {object} req  requisição autenticada
 */
export async function audit(db, req, { entity, entityId = null, action, summary = null, data = null }) {
  const run = db ? (t, p) => db.query(t, p) : q;
  try {
    await run(
      `insert into audit_log (company_id, user_id, user_name, entity, entity_id, action, summary, data, ip)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [req.companyId, req.user?.id || null, req.user?.name || null, entity, entityId ? String(entityId) : null, action,
        summary, data ? JSON.stringify(data) : null, req.ip || null]);
  } catch (e) {
    console.error('[audit] falha ao registrar', e.message);
  }
}

const SECRET = /(password|senha|token|certificate|certificado|base64|secret)/i;
const clean = (v, depth = 0) => {
  if (v == null || depth > 3) return v;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => clean(x, depth + 1));
  if (typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).filter(([k]) => !SECRET.test(k)).map(([k, x]) => [k, clean(x, depth + 1)]));
  }
  return typeof v === 'string' && v.length > 300 ? `${v.slice(0, 300)}…` : v;
};

/** Rotas registradas automaticamente na auditoria: [método, regex do caminho, entidade, descrição]. */
const AUTO = [
  ['POST', /^\/products\/?$/, 'price', 'Material cadastrado'],
  ['PUT', /^\/products\/[^/]+$/, 'price', 'Material alterado (preço/custo/estoque mínimo)'],
  ['DELETE', /^\/products\/[^/]+$/, 'stock', 'Material inativado'],
  ['POST', /^\/products\/[^/]+\/adjust$/, 'stock', 'Ajuste de estoque'],
  ['POST', /^\/services\/?$/, 'price', 'Serviço cadastrado'],
  ['PUT', /^\/services\/[^/]+$/, 'price', 'Serviço alterado (preço/comissão)'],
  ['POST', /^\/cash\/session\/open$/, 'cash', 'Caixa aberto'],
  ['POST', /^\/cash\/session\/close$/, 'cash', 'Caixa fechado'],
  ['POST', /^\/cash\/transactions\/?$/, 'cash', 'Lançamento financeiro criado'],
  ['PUT', /^\/cash\/transactions\/[^/]+$/, 'cash', 'Lançamento financeiro alterado'],
  ['POST', /^\/cash\/transactions\/[^/]+\/pay$/, 'payment', 'Baixa de lançamento'],
  ['POST', /^\/cash\/transactions\/[^/]+\/unpay$/, 'payment', 'Baixa estornada'],
  ['DELETE', /^\/cash\/transactions\/[^/]+$/, 'cash', 'Lançamento excluído'],
  ['POST', /^\/orders\/[^/]+\/payments$/, 'payment', 'Pagamento recebido na OS'],
  ['DELETE', /^\/orders\/[^/]+\/payments\/[^/]+$/, 'payment', 'Pagamento da OS estornado'],
  ['PUT', /^\/orders\/[^/]+$/, 'order', 'OS alterada (itens/valores)'],
  ['POST', /^\/orders\/[^/]+\/deliver$/, 'order', 'OS entregue'],
  ['POST', /^\/orders\/[^/]+\/cancel$/, 'order', 'OS cancelada'],
  ['POST', /^\/orders\/[^/]+\/reopen$/, 'order', 'OS reaberta'],
  ['POST', /^\/orders\/quick-sale$/, 'order', 'Venda de balcão'],
  ['POST', /^\/purchases\/?$/, 'stock', 'Entrada de materiais'],
  ['PUT', /^\/purchases\/[^/]+$/, 'stock', 'Entrada de materiais alterada'],
  ['POST', /^\/purchases\/[^/]+\/cancel$/, 'stock', 'Entrada de materiais cancelada'],
  ['DELETE', /^\/purchases\/[^/]+$/, 'stock', 'Entrada de materiais excluída'],
  ['PUT', /^\/company\/fiscal\/?$/, 'fiscal', 'Configuração fiscal alterada'],
  ['POST', /^\/company\/fiscal\/(account|register|sync)$/, 'fiscal', 'Integração fiscal: cadastro/sincronização'],
  ['POST', /^\/company\/fiscal\/test-invoice$/, 'fiscal', 'Nota de teste enviada'],
];

/** Middleware: registra na auditoria as operações sensíveis que terminaram com sucesso. */
export function autoAudit(req, res, next) {
  if (req.method === 'GET') return next();
  const path = req.path;
  const rule = AUTO.find(([m, re]) => m === req.method && re.test(path));
  if (!rule) return next();
  const body = clean(req.body);
  res.on('finish', () => {
    if (res.statusCode >= 400 || !req.companyId) return;
    const id = path.split('/')[2];
    audit(null, req, {
      entity: rule[2], entityId: /^[0-9a-f-]{36}$/.test(id || '') ? id : null, action: `${req.method.toLowerCase()} ${path.replace(/[0-9a-f-]{36}/g, ':id')}`,
      summary: rule[3], data: body && Object.keys(body).length ? body : null,
    });
  });
  next();
}
