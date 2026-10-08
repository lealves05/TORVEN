// Gerado por tools/videos/gen-training.mjs (não edite à mão). Aula sugerida pelo botão Ajuda de cada tela.
export const HELP = [[1,"Conhecendo o TORVEN",["/"]],[2,"Como usar o sistema: clicar, escrever e salvar",["/conta"]],[3,"Abrir a OS pela placa do veículo",["/os/nova"]],[4,"Abrir uma ordem de serviço passo a passo",["/os/nova"]],[5,"Falar em vez de digitar: ditado e comandos de voz",["/os/"]],[6,"Acompanhar a OS: etapas, diagnóstico e itens",["/os"]],[7,"Entregar a OS e receber o pagamento",["/os/"]],[8,"Imprimir a OS e o recibo",["/imprimir/"]],[35,"OS entregues e impressão da OS completa",["/os"]],[9,"Garantia: quando o cliente volta",["/garantias"]],[10,"Venda de balcão",["/venda"]],[11,"Cadastrar clientes e veículos",["/clientes"]],[12,"Solicitação do cliente e visita técnica",["/solicitacoes"]],[13,"Orçamento e aprovação pelo cliente",["/orcamentos"]],[30,"Pedidos do WhatsApp: aprovar e responder",["/whatsapp"]],[14,"Agenda da equipe",["/agenda"]],[15,"Painel de produção e horas trabalhadas",["/producao","/meu-trabalho"]],[16,"Qualidade: checklist de inspeção",["/os/"]],[27,"Tipos de OS e checklists obrigatórios",[]],[34,"Preencher o checklist na OS, passo a passo",["/os/"]],[36,"Tipos de OS prontos: exibir ou ocultar",[]],[28,"Várias fotos de uma vez na OS",[]],[17,"Materiais e estoque",["/estoque"]],[18,"Compras e entrada da nota do fornecedor",["/compras","/estoque/entradas","/fornecedores"]],[19,"Caixa do dia: abrir e fechar",["/financeiro"]],[20,"Contas a pagar e a receber",["/financeiro/gestao"]],[21,"Retornos, pós-venda e cobrança",["/relacionamento"]],[31,"Conferir o extrato do banco com as OS",[]],[33,"Emitir a nota fiscal da OS",["/notas"]],[22,"Relatórios: como está a oficina",["/relatorios"]],[23,"Logotipo e cores do sistema",["/configuracoes","/conta"]],[24,"O modelo da OS impressa",["/configuracoes"]],[25,"Configurações, equipe e permissões",["/configuracoes","/tecnicos","/servicos"]],[32,"Cadastro fiscal: CNPJ, emissor e certificado",["/configuracoes"]],[29,"WhatsApp: ligar o agente e testar",[]],[26,"Como usar as aulas e pedir ajuda",["/suporte"]]];

/** Aula da tela atual (a rota mais específica que combina) ou null. */
export function helpFor(pathname) {
  let best = null; let len = -1;
  for (const [n, title, routes] of HELP) {
    for (const r of routes) {
      const ok = r === '/' ? pathname === '/' : r.endsWith('/') ? pathname.startsWith(r) && pathname.length > r.length : pathname === r || pathname.startsWith(`${r}/`);
      if (ok && r.length > len) { best = { n, title }; len = r.length; }
    }
  }
  return best;
}
