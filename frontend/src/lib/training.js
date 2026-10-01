// Vídeo-aulas narradas do TORVEN (arquivos em /public/treinamento/<file>.mp4, -capa.jpg e .jpg).
// `routes`: telas em que a aula é sugerida como ajuda.
export const MODULES = [
  { key: 'inicio', label: 'Primeiros passos' },
  { key: 'os', label: 'Ordens de serviço e balcão' },
  { key: 'comercial', label: 'Atendimento e comercial' },
  { key: 'producao', label: 'Agenda e produção' },
  { key: 'materiais', label: 'Materiais e estoque' },
  { key: 'financeiro', label: 'Financeiro' },
  { key: 'relatorios', label: 'Relatórios' },
  { key: 'config', label: 'Configurações' },
];

export const LESSONS = [
  { n: 1, file: '01-conhecendo-o-torven', mod: 'inicio', s: 43, title: 'Conhecendo o TORVEN', routes: ['/'],
    desc: 'O painel inicial, o menu e os atalhos do dia a dia.', learn: ['O que mostram os indicadores do Início', 'Como o menu está organizado', 'Busca rápida e botão Novo'] },
  { n: 2, file: '02-abrir-ordem-de-servico', mod: 'os', s: 41, title: 'Abrir uma ordem de serviço', routes: ['/os/nova'],
    desc: 'Cliente, equipamento, problema relatado, técnico e prazo.', learn: ['Escolher ou cadastrar o cliente', 'Descrever o problema', 'Prioridade, técnico, prazo e garantia'] },
  { n: 3, file: '03-executar-a-os', mod: 'os', s: 44, title: 'Diagnóstico, execução e entrega da OS', routes: ['/os'],
    desc: 'As etapas da OS, o diagnóstico, os itens, o tempo e a entrega.', learn: ['Etapas da OS', 'Diagnóstico, serviços e materiais', 'Receber e entregar'] },
  { n: 4, file: '04-solicitacao-e-orcamento', mod: 'comercial', s: 42, title: 'Solicitação e orçamento', routes: ['/solicitacoes', '/orcamentos'],
    desc: 'Registrar o pedido do cliente e transformar em orçamento.', learn: ['Registrar a solicitação', 'Montar o orçamento', 'Aprovação e conversão em OS'] },
  { n: 5, file: '05-venda-de-balcao', mod: 'os', s: 28, title: 'Venda de balcão', routes: ['/venda'],
    desc: 'Vender peças e serviços rápidos sem abrir OS.', learn: ['Adicionar itens', 'Cliente opcional', 'Finalizar e receber'] },
  { n: 6, file: '06-agenda-e-producao', mod: 'producao', s: 30, title: 'Agenda e painel de produção', routes: ['/agenda', '/producao'],
    desc: 'Programar visitas, execuções e entregas e acompanhar o tempo da equipe.', learn: ['Agendar compromissos', 'Painel de produção', 'Folha de horas'] },
  { n: 7, file: '07-materiais-e-estoque', mod: 'materiais', s: 37, title: 'Materiais, estoque e entrada de nota', routes: ['/estoque', '/compras', '/fornecedores'],
    desc: 'Cadastro de materiais, alertas de mínimo e entrada pela nota do fornecedor.', learn: ['Materiais e estoque mínimo', 'Entrada de materiais', 'Compras e cotações'] },
  { n: 8, file: '08-caixa-e-financeiro', mod: 'financeiro', s: 30, title: 'Caixa e financeiro', routes: ['/financeiro'],
    desc: 'Caixa do dia, fluxo de caixa, contas e DRE.', learn: ['Abrir e fechar o caixa', 'Contas a pagar e a receber', 'Conciliação e DRE'] },
  { n: 9, file: '09-relatorios', mod: 'relatorios', s: 28, title: 'Relatórios gerenciais', routes: ['/relatorios'],
    desc: 'Indicadores de gestão, financeiro, produção, comissões e estoque.', learn: ['Escolher o período', 'Indicadores de gestão', 'Produção e comissões'] },
  { n: 10, file: '10-configuracoes-e-equipe', mod: 'config', s: 31, title: 'Configurações, equipe e permissões', routes: ['/configuracoes', '/tecnicos', '/servicos'],
    desc: 'Dados da empresa, OS e orçamentos, módulos, usuários e perfis.', learn: ['Dados da empresa e aparência', 'Regras de OS e orçamento', 'Usuários e perfis de acesso'] },
];

const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
export const videoUrl = (l) => `${base}/treinamento/${l.file}.mp4`;
export const posterUrl = (l) => `${base}/treinamento/${l.file}-capa.jpg`;
export const thumbUrl = (l) => `${base}/treinamento/${l.file}.jpg`;
export const fmtDur = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
/** Aula sugerida para a tela atual (a de rota mais específica). */
export const lessonFor = (pathname) => LESSONS.filter((l) => l.routes.some((r) => (r === '/' ? pathname === '/' : pathname.startsWith(r))))
  .sort((a, b) => Math.max(...b.routes.map((r) => r.length)) - Math.max(...a.routes.map((r) => r.length)))[0] || null;
