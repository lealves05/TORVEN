import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = (v) => brl.format(Number(v) || 0);
export const num = (v, d = 0) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: d }).format(Number(v) || 0);

const toDate = (d) => (d instanceof Date ? d : typeof d === 'string' && d.length === 10 ? parseISO(d) : new Date(d));
export const fmt = (d, pattern = 'dd/MM/yyyy') => (d ? format(toDate(d), pattern, { locale: ptBR }) : '—');
export const fmtTime = (d) => fmt(d, 'HH:mm');
export const fmtDateTime = (d) => fmt(d, "dd/MM/yyyy 'às' HH:mm");
export const ymd = (d = new Date()) => format(d, 'yyyy-MM-dd');

export const ORDER_STATUS = {
  aberta: { label: 'Recebida', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300', dot: 'bg-sky-500' },
  diagnostico: { label: 'Em diagnóstico', cls: 'bg-violet-500/10 text-violet-700 dark:text-violet-300', dot: 'bg-violet-500' },
  aguardando_aprovacao: { label: 'Aguardando aprovação', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', dot: 'bg-amber-500' },
  aprovada: { label: 'Aprovada', cls: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300', dot: 'bg-indigo-500' },
  aguardando_material: { label: 'Aguardando material', cls: 'bg-orange-500/15 text-orange-700 dark:text-orange-300', dot: 'bg-orange-500' },
  em_execucao: { label: 'Em execução', cls: 'bg-blue-500/10 text-blue-700 dark:text-blue-300', dot: 'bg-blue-500' },
  pronta: { label: 'Pronta p/ entrega', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500' },
  entregue: { label: 'Entregue', cls: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-300', dot: 'bg-zinc-400' },
  cancelada: { label: 'Cancelada', cls: 'bg-red-500/10 text-red-700 dark:text-red-300', dot: 'bg-red-500' },
};
export const OPEN_STATUSES = ['aberta', 'diagnostico', 'aguardando_aprovacao', 'aprovada', 'aguardando_material', 'em_execucao', 'pronta'];

export const PRIORITY = {
  baixa: { label: 'Baixa', cls: 'text-ink-faint' },
  normal: { label: 'Normal', cls: 'text-ink-soft' },
  alta: { label: 'Alta', cls: 'text-amber-600' },
  urgente: { label: 'Urgente', cls: 'text-red-600 font-semibold' },
};

export const QUOTE_STATUS = {
  rascunho: { label: 'Rascunho', cls: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-300' },
  enviado: { label: 'Enviado', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300' },
  aprovado: { label: 'Aprovado', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  recusado: { label: 'Recusado', cls: 'bg-red-500/10 text-red-700 dark:text-red-300' },
  expirado: { label: 'Expirado', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  convertido: { label: 'Virou OS', cls: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300' },
};

export const INVOICE_STATUS = {
  processando: { label: 'Processando', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  autorizada: { label: 'Autorizada', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  erro: { label: 'Erro', cls: 'bg-red-500/10 text-red-700 dark:text-red-300' },
  cancelada: { label: 'Cancelada', cls: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-300' },
  interna: { label: 'Interna', cls: 'bg-sky-500/10 text-sky-700 dark:text-sky-300' },
};

export const ROLES = { owner: 'Proprietário', admin: 'Administrador', attendant: 'Atendimento', technician: 'Técnico' };

export const ITEM_KIND = { servico: 'Serviço', material: 'Material', avulso: 'Avulso' };


export const onlyDigits = (s) => String(s || '').replace(/\D/g, '');

export function maskPhone(v) {
  const d = onlyDigits(v).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Link de WhatsApp com mensagem preenchida a partir do modelo do salão. */
export function whatsappLink(phone, template, vars) {
  let d = onlyDigits(phone);
  if (!d) return null;
  if (d.length <= 11) d = `55${d}`;
  const text = Object.entries(vars).reduce((t, [k, v]) => t.replaceAll(`{${k}}`, v ?? ''), template || '');
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
}

export function downloadCSV(filename, rows) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const csv = [cols.map(esc).join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export const initials = (name = '') =>
  name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

export const qty = (v) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(Number(v) || 0);

export function maskDoc(v) {
  const d = onlyDigits(v).slice(0, 14);
  if (d.length <= 11) {
    return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  return d.replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2');
}

export const maskCep = (v) => onlyDigits(v).slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2');

/** Busca endereço no ViaCEP (com código IBGE do município). */
export async function lookupCep(cep) {
  const d = onlyDigits(cep);
  if (d.length !== 8) return null;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${d}/json/`);
    const j = await r.json();
    if (j.erro) return null;
    return { street: j.logradouro, district: j.bairro, city: j.localidade, uf: j.uf, city_code: j.ibge };
  } catch { return null; }
}

/** Substitui {variáveis} de um modelo de mensagem. */
export const fillTemplate = (template, vars) =>
  Object.entries(vars).reduce((t, [k, v]) => t.replaceAll(`{${k}}`, v ?? ''), template || '');

export const waLink = (phone, text) => {
  let d = onlyDigits(phone);
  if (!d) return null;
  if (d.length <= 11) d = `55${d}`;
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
};

export const methodName = (settings, id) =>
  settings?.paymentMethods?.find((m) => m.id === id)?.name || (id === 'fiado' ? 'A receber' : id || '—');

export const toLocalInput = (d) => (d ? fmt(d, "yyyy-MM-dd'T'HH:mm") : '');
