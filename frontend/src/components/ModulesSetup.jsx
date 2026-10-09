// Configurações › Módulos e extensões: liga/desliga o que a oficina usa e mostra o que ainda falta configurar.
// O plano (central) decide o que está disponível; aqui a empresa decide o que aparece e funciona no dia a dia.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, Inbox, CalendarDays, HeartHandshake, MessageCircle, Link2, Timer, ShieldCheck, ListChecks, BadgePercent, ShoppingBag, PackagePlus,
  ScanLine, FileSpreadsheet, Landmark, Banknote, CreditCard, Receipt, BarChart3, Download, Car, Gauge, Sparkles, Bot, Building2, Settings2, CheckCircle2, AlertCircle, Lock,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { Toggle, Loading, cx } from './ui';

const CFG = (tab) => `/configuracoes?tab=${tab}`;
/**
 * keys: chaves gravadas juntas (a 1ª é a principal). plan: chave do plano (pode ficar fora do plano).
 * status: chave do retorno /modules.status. setup: onde configurar.
 */
const GROUPS = [
  { title: 'Atendimento e vendas', items: [
    { keys: ['comercial'], icon: Inbox, title: 'Solicitações e orçamentos', text: 'Pedidos de serviço, orçamentos com aprovação e conversão em OS.' },
    { keys: ['agenda'], icon: CalendarDays, title: 'Agenda', text: 'Agenda da oficina e programação dos técnicos.' },
    { keys: ['relacionamento'], icon: HeartHandshake, title: 'Retornos e pós-venda', text: 'Lembretes de revisão, pós-venda e retorno de clientes.' },
    { keys: ['whatsapp'], icon: MessageCircle, title: 'Atendimento pelo WhatsApp', text: 'Agente automático que responde status da OS, agenda horários e registra pedidos. Usa a API oficial do WhatsApp Business (Meta), contratada à parte.', status: 'whatsapp', setup: [CFG('integracoes'), 'Conectar WhatsApp'] },
    { keys: ['publicLinks'], legacy: true, icon: Link2, title: 'Links para o cliente', text: 'Aprovação de orçamento e acompanhamento da OS pela internet, sem o cliente instalar nada.' },
  ] },
  { title: 'Oficina', items: [
    { keys: ['producao'], icon: Timer, title: 'Painel de produção', text: 'Execução das OS, apontamento de horas e painel da oficina.' },
    { keys: ['qualidade'], icon: ShieldCheck, title: 'Qualidade, entrega e garantias', text: 'Conferência na entrega e controle de garantias.' },
    { keys: ['tipos_os_checklists'], icon: ListChecks, title: 'Tipos de OS e checklists', text: 'Checklist de entrada/inspeção com fotos para cada tipo de serviço.', setup: [CFG('tipos-os'), 'Escolher tipos de OS'] },
    { keys: ['comissoes', 'commissions'], icon: BadgePercent, title: 'Comissões dos técnicos', text: 'Cálculo de comissão por serviço; cada técnico vê a sua.' },
  ] },
  { title: 'Estoque e compras', items: [
    { keys: ['compras'], icon: ShoppingBag, title: 'Compras e cotações', text: 'Sugestão de compra, cotação com fornecedores e pedidos de compra.' },
    { keys: ['purchases'], legacy: true, icon: PackagePlus, title: 'Entrada de materiais', text: 'Lançar a nota do fornecedor: estoque, custo médio e contas a pagar.' },
    { keys: ['leitura_nota'], icon: ScanLine, title: 'Leitura da nota do fornecedor', text: 'Na entrada de materiais, importa a nota pelo arquivo XML (sem custo) ou por PDF e foto (com a IA). Reconhece fornecedor e materiais.', status: 'leitura_nota', setup: [`${CFG('integracoes')}#ia`, 'Ligar a IA para foto/PDF'] },
    { keys: ['importacao_planilhas'], icon: FileSpreadsheet, title: 'Importar planilhas', text: 'Traz clientes, veículos, OS, tabela de serviços e de materiais de outro sistema ou do Excel.', setup: ['/dados', 'Abrir importação'] },
  ] },
  { title: 'Financeiro e fiscal', items: [
    { keys: ['financeiro'], icon: Landmark, title: 'Contas, fluxo de caixa e DRE', text: 'Contas a pagar e a receber, fluxo de caixa e resultado do mês.' },
    { keys: ['conciliacao_bancaria'], icon: Banknote, title: 'Conciliação bancária', text: 'Importa o extrato do banco e confere com as OS e lançamentos.' },
    { keys: ['maquininha'], icon: CreditCard, title: 'Maquininha de cartão', text: 'Envia a cobrança da OS para a maquininha e baixa o pagamento sozinho.', status: 'maquininha', setup: [CFG('integracoes'), 'Configurar maquininha'] },
    { keys: ['fiscal', 'invoices'], icon: Receipt, title: 'Notas fiscais (NF-e / NFS-e)', text: 'Emissão de nota de serviço e de produto a partir da OS, por um provedor fiscal.', status: 'fiscal', setup: [CFG('fiscal'), 'Configurar emissão'] },
    { keys: ['relatorios'], icon: BarChart3, title: 'Relatórios e indicadores', text: 'Faturamento, serviços, técnicos, clientes e estoque.' },
    { keys: ['exportacao'], icon: Download, title: 'Exportação de dados', text: 'Planilhas para o Excel e cópia completa dos dados.' },
  ] },
  { title: 'Veículos', items: [
    { keys: ['consulta_placa'], icon: Car, title: 'Consulta de veículo pela placa', text: 'Preenche marca, modelo, ano e chassi pela placa. Serviço pago de um provedor à sua escolha.', status: 'consulta_placa', setup: [CFG('integracoes'), 'Escolher provedor'] },
    { keys: ['tabela_fipe'], icon: Gauge, title: 'Tabela FIPE', text: 'Marca, modelo e valor FIPE no cadastro do veículo (gratuito).' },
  ] },
  { title: 'Extensões', items: [
    { keys: [], icon: Sparkles, title: 'Inteligência artificial (Claude)', text: 'Entende as mensagens do WhatsApp e lê PDF/foto de notas de fornecedor. Serviço da Anthropic, cobrado por uso na sua própria conta.', status: 'ia', setup: [`${CFG('integracoes')}#ia`, 'Configurar IA'] },
    { keys: ['assistente'], icon: Bot, title: 'Assistente (texto e voz)', text: 'Peça em palavras: "abrir OS para a placa…", "quanto recebi hoje?". Cada usuário só faz o que o perfil permite.' },
    { keys: ['consulta_cnpj'], icon: Building2, title: 'Consulta de CNPJ', text: 'Ao digitar o CNPJ de cliente ou fornecedor, preenche razão social, telefone e endereço com os dados abertos da Receita Federal (gratuito).' },
  ] },
];

export default function ModulesSetup() {
  const { inPlan, refresh, can } = useAuth();
  const { toast } = useUI();
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState('');
  const load = useCallback(() => api.get('/modules').then(setData).catch((e) => { toast(e.message, 'error'); setData({ keys: [], status: {} }); }), [toast]);
  useEffect(() => { load(); }, [load]);
  const enabled = useMemo(() => Object.fromEntries((data?.keys || []).map((k) => [k.key, k.enabled])), [data]);

  if (!data) return <Loading />;
  const toggle = async (item, on) => {
    setSaving(item.keys[0]);
    try {
      for (const k of item.keys) await api.put(`/modules/${k}`, { enabled: on });
      setData((d) => ({ ...d, keys: d.keys.map((k) => (item.keys.includes(k.key) ? { ...k, enabled: on } : k)) }));
      toast(`${item.title}: ${on ? 'ligado' : 'desligado'}`);
      refresh();
    } catch (e) { toast(e.message, 'error'); } finally { setSaving(''); }
  };
  const term = q.trim().toLowerCase();
  const match = (i) => !term || `${i.title} ${i.text}`.toLowerCase().includes(term);

  return (
    <div className="space-y-6">
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <p className="min-w-[240px] flex-1 text-sm text-ink-soft">Ligue só o que a sua oficina usa. Módulo desligado some do menu para todos, mas <b>nenhum dado é apagado</b> — é só ligar de novo.</p>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input className="input pl-9" placeholder="Buscar módulo…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {GROUPS.map((g) => {
        const items = g.items.filter(match);
        if (!items.length) return null;
        return (
          <section key={g.title} aria-label={g.title}>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-faint">{g.title}</h3>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {items.map((i) => {
                const main = i.keys[0];
                const plan = !main || i.legacy ? true : inPlan(main);
                const on = !main || enabled[main] !== false;
                const st = i.status ? data.status?.[i.status] : null;
                const I = i.icon;
                return (
                  <article key={i.title} className={cx('card flex flex-col gap-3 p-4', (!on || !plan) && 'opacity-80')} data-testid={`modulo-${main || 'ia'}`}>
                    <div className="flex items-start gap-3">
                      <span className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-app-sm', on && plan ? 'bg-primary/10 text-primary' : 'bg-muted text-ink-faint')}><I className="h-5 w-5" /></span>
                      <div className="min-w-0 flex-1">
                        <h4 className="font-semibold leading-tight">{i.title}</h4>
                        <p className="mt-1 text-xs text-ink-faint">{i.text}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      {!plan && <span className="chip gap-1 bg-muted text-ink-soft"><Lock className="h-3 w-3" /> Fora do seu plano</span>}
                      {plan && on && st && (
                        <span className={cx('chip gap-1', st.configured ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300')}>
                          {st.configured ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}{st.text}
                        </span>
                      )}
                    </div>
                    <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                      {main ? (
                        <Toggle checked={on && plan} disabled={!plan || saving === main} onChange={(v) => toggle(i, v)} label={on && plan ? 'Ligado' : 'Desligado'} />
                      ) : <span className="text-xs text-ink-faint">Extensão por chave própria</span>}
                      {plan && on && i.setup && (can('integrations') || can('settings')) && (
                        <Link to={i.setup[0]} className="btn-outline h-8 text-xs"><Settings2 className="h-3.5 w-3.5" /> {i.setup[1]}</Link>
                      )}
                      {!plan && <span className="text-xs text-ink-faint">Fale com o suporte para incluir no plano.</span>}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
