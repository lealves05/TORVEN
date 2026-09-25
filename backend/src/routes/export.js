// Exportação dos dados da empresa (CSV por tabela ou cópia completa em JSON). Nunca inclui senhas, tokens ou certificados.
import { Router } from 'express';
import { q } from '../db.js';
import { need } from '../auth.js';
import { notFound } from '../util.js';
import { audit } from '../audit.js';

const r = Router();
r.use(need('data_export'));

/** Tabelas exportáveis: [nome, SQL filtrado pela empresa]. */
export const EXPORTS = {
  clientes: ['Clientes', 'select * from customers where company_id = $1 order by name'],
  contatos: ['Contatos de clientes', 'select * from customer_contacts where company_id = $1'],
  enderecos: ['Endereços de clientes', 'select * from customer_addresses where company_id = $1'],
  objetos: ['Objetos de serviço', 'select * from equipment where company_id = $1'],
  solicitacoes: ['Solicitações', 'select * from service_requests where company_id = $1 order by number'],
  orcamentos: ['Orçamentos', 'select * from quotes where company_id = $1 order by number'],
  orcamento_itens: ['Itens de orçamento', 'select i.* from quote_items i join quotes qt on qt.id = i.quote_id where qt.company_id = $1'],
  os: ['Ordens de serviço', 'select * from orders where company_id = $1 order by number'],
  os_itens: ['Itens das OS', 'select i.* from order_items i join orders o on o.id = i.order_id where o.company_id = $1'],
  os_historico: ['Histórico das OS', 'select e.* from order_events e join orders o on o.id = e.order_id where o.company_id = $1'],
  agenda: ['Agenda', 'select * from schedule_entries where company_id = $1'],
  apontamentos: ['Apontamentos de horas', 'select * from order_time_logs where company_id = $1'],
  inspecoes: ['Inspeções', 'select * from order_inspections where company_id = $1'],
  garantias: ['Garantias', 'select * from warranty_claims where company_id = $1'],
  materiais: ['Materiais', 'select * from products where company_id = $1 order by name'],
  movimentos_estoque: ['Movimentações de estoque', 'select * from stock_movements where company_id = $1 order by created_at'],
  fornecedores: ['Fornecedores', 'select * from suppliers where company_id = $1'],
  entradas: ['Entradas de materiais', 'select * from purchases where company_id = $1 order by number'],
  pedidos_compra: ['Pedidos de compra', 'select * from purchase_orders where company_id = $1 order by number'],
  contas: ['Contas financeiras', 'select * from financial_accounts where company_id = $1'],
  lancamentos: ['Lançamentos financeiros', 'select * from transactions where company_id = $1 order by created_at'],
  documentos_fiscais: ['Documentos fiscais', `select id, order_id, customer_id, kind, provider, environment, ref, status, number, series, access_key,
      verification_code, amount, description, customer, items, pdf_url, xml_url, message, issued_at, cancelled_at, created_at
      from invoices where company_id = $1 order by created_at`],
  servicos: ['Serviços', 'select * from services where company_id = $1'],
  tecnicos: ['Técnicos', 'select * from technicians where company_id = $1'],
  usuarios: ['Usuários', 'select id, name, email, role, technician_id, unit_id, active, created_at from users where company_id = $1'],
  retornos: ['Relacionamento (retornos)', 'select * from followups where company_id = $1'],
  auditoria: ['Auditoria', 'select * from audit_log where company_id = $1 order by created_at'],
};

const cell = (v) => {
  if (v == null) return '';
  const t = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return `"${t.replaceAll('"', '""')}"`;
};

r.get('/', (_req, res) => res.json(Object.entries(EXPORTS).map(([key, [label]]) => ({ key, label }))));

r.get('/backup.json', async (req, res) => {
  const out = { generated_at: new Date().toISOString(), company_id: req.companyId, tables: {} };
  const { rows: [company] } = await q(
    `select id, name, trade_name, slug, document, state_registration, municipal_registration, phone, email, cep, street, number,
            complement, district, city, uf, city_code, settings, created_at from companies where id = $1`, [req.companyId]);
  out.company = company;
  for (const [key, [, sql]] of Object.entries(EXPORTS)) out.tables[key] = (await q(sql, [req.companyId])).rows;
  await audit(null, req, { entity: 'settings', entityId: req.companyId, action: 'export_backup', summary: 'Cópia completa dos dados exportada (JSON)' });
  res.setHeader('Content-Disposition', `attachment; filename="torven-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(out);
});

r.get('/:key.csv', async (req, res) => {
  const def = EXPORTS[req.params.key];
  if (!def) throw notFound('Exportação não encontrada');
  const { rows, fields } = await q(def[1], [req.companyId]);
  const cols = fields.map((f) => f.name);
  const csv = [cols.map(cell).join(';'), ...rows.map((x) => cols.map((c) => cell(x[c])).join(';'))].join('\n');
  await audit(null, req, { entity: 'settings', entityId: req.companyId, action: 'export', summary: `Exportação: ${def[0]} (${rows.length} linhas)` });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="torven-${req.params.key}.csv"`);
  res.end(`﻿${csv}`);
});

export default r;
