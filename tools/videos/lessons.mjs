// Roteiro das vídeo-aulas do TORVEN. Cada passo: act (o que acontece na tela), say (falas = legendas) e tag (nome do passo,
// aparece no selo "Passo 1 de 4"). Público: pessoas com pouca prática com computador — frases curtas, uma ação por vez,
// dizendo ONDE olhar na tela, e sempre um resumo no fim (cartão gerado pelo gravador a partir de `learn`).

export const MODULES = [
  { key: 'inicio', label: 'Primeiros passos' },
  { key: 'os', label: 'Ordens de serviço' },
  { key: 'comercial', label: 'Clientes, solicitações e orçamentos' },
  { key: 'producao', label: 'Agenda, produção e qualidade' },
  { key: 'materiais', label: 'Materiais e compras' },
  { key: 'financeiro', label: 'Caixa, financeiro e relacionamento' },
  { key: 'relatorios', label: 'Relatórios' },
  { key: 'config', label: 'Configurações e suporte' },
];

const LOGO_FILE = new URL('./assets/logo-exemplo.png', import.meta.url).pathname;
const PHOTOS = ['foto-chegada.jpg', 'foto-servico.jpg', 'foto-pronto.jpg'].map((f) => new URL(`./assets/${f}`, import.meta.url).pathname);
const ICON = '<span class="l"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#c2410c" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg></span>';
/** Cartão explicativo (mesmo visual da abertura). */
const slide = (tag, title, body) => `<div class="k">${ICON}TORVEN · TREINAMENTO</div><div class="n">${tag}</div><h1 style="font-size:50px">${title}</h1>${body}`;
const list = (items) => `<ul class="b">${items.map((t, i) => `<li data-i="${i + 1}">${t}</li>`).join('')}</ul>`;
const flow = (items) => `<div class="flow">${items.map((t, i) => `${i ? '<span class="ar">→</span>' : ''}<div>${t}</div>`).join('')}</div>`;

/** OS da demonstração pelo número (id). */
async function osId(api, n) {
  const r = await api('GET', '/orders?limit=60');
  return (r.items || r).find((o) => o.number === n)?.id;
}
/** Escolhe um cliente no campo de busca de cliente. */
async function pickCustomer(h, typed, name) {
  const inp = h.page.getByPlaceholder('Buscar por nome, telefone ou CPF/CNPJ…').first();
  await h.spot(inp);
  await inp.click(); await inp.pressSequentially(typed, { delay: 90 });
  await h.sleep(900);
  await h.click(h.page.getByText(name, { exact: true }).first(), { wait: 600 });
}
const btn = (h, name) => h.page.getByRole('button', { name, exact: true });

/** Certificado A1 de exemplo (gerado na hora, só para a gravação). */
async function demoPfx(cnpj, password) {
  const { createRequire } = await import('node:module');
  const forge = createRequire(new URL('../../backend/package.json', import.meta.url))('node-forge');
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey; cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86400000); cert.validity.notAfter = new Date(Date.now() + 340 * 86400000);
  cert.setSubject([{ name: 'commonName', value: `OFICINA DEMONSTRACAO LTDA:${cnpj}` }]); cert.setIssuer([{ name: 'commonName', value: 'AC EXEMPLO' }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const der = forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, { algorithm: '3des' })).getBytes();
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const file = path.join(os.tmpdir(), 'certificado-a1.pfx');
  fs.writeFileSync(file, Buffer.from(der, 'binary'));
  return file;
}

export const LESSONS = [
  // ───────────────────────── Primeiros passos
  {
    n: 1, file: '01-conhecendo-o-torven', mod: 'inicio', title: 'Conhecendo o TORVEN', routes: ['/'], start: '/',
    desc: 'A tela inicial, o menu, o botão Novo, a busca e onde pedir ajuda.',
    learn: ['O que a tela inicial mostra', 'Onde fica cada parte do menu', 'O botão Novo, a busca e a ajuda'],
    steps: [
      { tag: 'Tela inicial', say: ['Esta é a tela inicial do TORVEN. É a primeira tela que aparece quando você entra no sistema.', 'Ela mostra, de forma resumida, como está a sua oficina hoje.'] },
      { act: (h) => h.spot('Primeiros passos'), say: ['Este quadro, Primeiros passos, é uma lista do que falta configurar. Cada item tem um atalho que leva direto para a tela certa.'] },
      { act: async (h) => { await h.unspot(); await h.scroll(420); await h.spot('Próximas entregas'); }, say: ['Mais abaixo ficam as próximas entregas, as ordens de serviço por etapa, o estoque baixo e o dinheiro que entrou e saiu.'] },
      { tag: 'O menu', act: async (h) => { await h.unspot(); await h.top(); await h.spot(h.page.locator('aside').first()); }, say: ['Do lado esquerdo fica o menu. É por ele que você chega em todas as telas do sistema.', 'Clique no nome de um grupo para ver as telas que estão dentro dele.'] },
      { act: async (h) => { await h.unspot(); await h.click('Ordens de serviço'); }, say: ['Por exemplo: Ordens de serviço leva para a lista de todos os serviços da oficina.'] },
      { tag: 'Botão Novo', act: async (h) => { await h.go('/'); await h.click(h.page.locator('header').getByRole('button', { name: 'Novo' })); }, say: ['No alto, à direita, o botão laranja Novo é o atalho para começar qualquer coisa: uma ordem de serviço, um orçamento, uma venda.'] },
      { tag: 'Busca', act: async (h) => { await h.esc(); await h.click(h.page.getByRole('button', { name: /Buscar/ }).first()); await h.page.keyboard.type('Ana', { delay: 140 }); await h.sleep(1100); }, say: ['A busca encontra um cliente, uma ordem de serviço ou um material pelo nome. É só clicar nela e escrever.', 'Dica: no teclado, segurar Control e apertar a letra K também abre a busca.'] },
      { tag: 'Ajuda', act: async (h) => { await h.esc(); await h.go('/suporte'); await h.spot(h.page.locator('main h1').first()); }, say: ['Ficou com dúvida? Em Minha conta e ajuda, a tela Suporte e treinamento tem todas as vídeo-aulas, como esta.'] },
      { act: (h) => h.go('/'), say: ['Agora que você conhece a tela inicial, vamos aprender, na próxima aula, a usar os botões e os campos do sistema.'] },
    ],
  },
  {
    n: 2, file: '02-usando-botoes-e-campos', mod: 'inicio', title: 'Como usar o sistema: clicar, escrever e salvar', routes: ['/conta'], start: '/os/nova',
    desc: 'Para quem está começando: o que é clicar, o que é um campo, como salvar, voltar e entender os avisos.',
    learn: ['Clicar e escrever nos campos', 'Os botões de salvar e cancelar', 'Os avisos e o botão O que é isso?'],
    steps: [
      { tag: 'Clicar', say: ['Nesta aula vamos com calma, para quem tem pouca prática com computador.', 'Clicar é apertar uma vez o botão esquerdo do mouse em cima de alguma coisa na tela. No celular, é tocar com o dedo.'] },
      { tag: 'Campos', act: (h) => h.spot(h.page.getByLabel('Problema relatado / serviço solicitado').first()), say: ['Este retângulo em branco é um campo. É nele que você escreve.', 'Clique dentro do campo. Quando aparecer um tracinho piscando, é só digitar.'] },
      { act: async (h) => { await h.unspot(); await h.type('Problema relatado / serviço solicitado', 'Portão arrastando no trilho', { delay: 80 }); }, say: ['Pronto: o texto apareceu no campo. Se errar, apague com a tecla de apagar, que tem uma seta para a esquerda.'] },
      { tag: 'Listas', act: (h) => h.spot(h.page.getByLabel('Técnico responsável').first()), say: ['Alguns campos têm uma setinha. Eles abrem uma lista: você clica e escolhe uma das opções.'] },
      { tag: 'O que é isso?', act: async (h) => { await h.unspot(); await h.click(h.page.getByRole('button', { name: /O que é isso/ }).first(), { wait: 900 }); }, say: ['Viu um ponto de interrogação ao lado do nome de um campo? Clique nele. Ele explica para que serve aquele campo.'] },
      { tag: 'Salvar ou cancelar', act: async (h) => { await h.esc(); await h.spot(btn(h, 'Abrir OS')); }, say: ['No rodapé ficam os botões finais. O botão laranja, aqui Abrir OS, salva o que você preencheu.', 'Quando ele está apagado, é porque falta preencher algo obrigatório, como o cliente.'] },
      { act: async (h) => { await h.unspot(); await h.spot(btn(h, 'Cancelar')); }, say: ['O botão Cancelar sai sem salvar nada. Pode usar sem medo quando quiser desistir.'] },
      { tag: 'Avisos', act: async (h) => { await h.unspot(); await h.card(slide('Avisos do sistema', 'As mensagens que aparecem no canto da tela', list(['Verde: deu certo, foi salvo.', 'Vermelho: algo não foi feito. Leia a mensagem: ela diz o que corrigir.', 'Amarelo: um alerta para você conferir.']))); }, say: ['Depois de salvar, aparece uma mensagem no canto da tela.', 'Verde quer dizer que deu certo. Vermelho quer dizer que algo faltou, e a mensagem explica o quê.'] },
      { act: (h) => h.card(null), say: ['No celular é igual: os botões principais ficam embaixo, e o botão Mais abre o resto do menu.'] },
    ],
  },

  // ───────────────────────── Ordens de serviço
  {
    n: 3, file: '03-abrir-os-pela-placa', mod: 'os', title: 'Abrir a OS pela placa do veículo', routes: ['/os/nova'], start: '/os/nova',
    desc: 'Digite a placa: o TORVEN mostra o veículo e já coloca o dono como cliente da OS.',
    learn: ['Digitar ou fotografar a placa', 'Conferir o veículo e o proprietário', 'Cadastrar um veículo novo com a Tabela FIPE (grátis)'],
    setup: async (api) => {
      await api('POST', '/customers', { kind: 'pf', name: 'Paulo Henrique Souza', phone: '(19) 99812-4455',
        vehicles: [{ plate: 'RIO2A18', brand: 'Fiat', model: 'Strada', year: '2021', color: 'Prata' }] });
      return {};
    },
    steps: [
      { tag: 'Onde fica', act: (h) => h.spot(h.page.getByRole('switch', { name: /Pesquisa por placa/ })), say: ['Para veículos, a forma mais rápida de abrir uma ordem de serviço é pela placa.', 'Na tela Nova ordem de serviço, o quadro da placa fica logo no começo.'] },
      { tag: 'Digitar a placa', act: async (h) => { await h.unspot(); await h.type(h.page.getByLabel('Placa do veículo', { exact: true }), 'RIO2A18', { delay: 160 }); await h.sleep(1600); }, say: ['Clique no campo Placa e digite a placa, com letras e números. Não precisa apertar nada: a busca é automática.'] },
      { tag: 'Conferir', act: (h) => h.spot(h.page.getByLabel('Veículo identificado')), say: ['O TORVEN achou o veículo. Confira a marca, o modelo, o ano e a cor.', 'Embaixo aparece o proprietário. Ele já entrou como cliente desta ordem de serviço.'] },
      { act: async (h) => { await h.unspot(); await h.spot(h.page.getByLabel('Objeto de serviço')); }, say: ['Repare que o objeto de serviço também já foi escolhido: é o próprio veículo.'] },
      { tag: 'Foto da placa', act: async (h) => { await h.unspot(); await h.click('Outra placa'); await h.spot('Foto da placa'); }, say: ['No celular, você pode tocar em Foto da placa. A câmera abre, você fotografa a placa e o sistema lê os números sozinho.'] },
      { tag: 'Placa nova', act: async (h) => { await h.unspot(); await h.type(h.page.getByLabel('Placa do veículo', { exact: true }), 'NOV1C22', { delay: 150 }); await h.sleep(1600); await h.spot('Cadastrar proprietário e veículo'); }, say: ['E se a placa ainda não estiver cadastrada? O sistema avisa e mostra o botão Cadastrar proprietário e veículo.'] },
      { act: async (h) => { await h.click('Cadastrar proprietário e veículo', { wait: 900 }); await h.spot('Outro proprietário'); }, say: ['Se o dono for o cliente que já está na OS, deixe marcado Cliente já escolhido. Se for outra pessoa, clique em Outro proprietário.'] },
      { act: async (h) => { await h.click('Outro proprietário', { wait: 500 }); await h.type('Nome do proprietário', 'Marta Nogueira', { delay: 70 }); }, say: ['Preencha o nome do dono. O telefone é opcional, mas ajuda muito para avisar o cliente.'] },
      { tag: 'Tabela FIPE', act: async (h) => { await h.type(h.page.getByRole('textbox', { name: '1. Marca' }), 'ren', { delay: 140 }); await h.click(h.page.getByRole('option', { name: 'Renault' }), { wait: 900 }); }, say: ['Para o veículo, use a Tabela FIPE, que é grátis. Digite o começo da marca e clique nela.'] },
      { act: async (h) => { await h.type(h.page.getByRole('textbox', { name: '2. Modelo' }), 'kwid', { delay: 140 }); await h.click(h.page.getByRole('listbox', { name: 'Opções — 2. Modelo' }).getByRole('option').first(), { wait: 900 }); }, say: ['Digite parte do modelo, por exemplo kwid, e clique no modelo certo.'] },
      { act: async (h) => { await h.click(h.page.getByRole('button', { name: '2022 Gasolina' }), { wait: 1200 }); await h.spot(h.page.getByLabel('Tabela FIPE')); }, say: ['Clique no ano. Pronto: marca, modelo e ano foram preenchidos, e ainda aparece o valor da tabela FIPE. Só falta a cor.'] },
      { act: async (h) => { await h.click('Salvar e usar na OS', { wait: 1400 }); await h.spot(h.page.getByLabel('Veículo identificado')); }, say: ['Clique em Salvar e usar na OS. Pronto: o cliente e o veículo foram cadastrados e já estão nesta ordem de serviço.'] },
      { act: (h) => h.unspot(), say: ['Agora é só continuar preenchendo a OS, como você vai ver na próxima aula.'] },
    ],
  },
  {
    n: 4, file: '04-abrir-ordem-de-servico', mod: 'os', title: 'Abrir uma ordem de serviço passo a passo', routes: ['/os/nova'], start: '/os/nova',
    desc: 'Cliente, objeto, relato do problema, serviço com valor, técnico, prazo e garantia.',
    learn: ['Escolher o cliente e o objeto', 'Escrever o problema e escolher o serviço', 'Técnico, prazo e abrir a OS'],
    steps: [
      { say: ['Ordem de serviço, ou OS, é a ficha de cada trabalho da oficina. Ela acompanha o serviço desde a chegada até a entrega.'] },
      { tag: 'Cliente', act: async (h) => { await pickCustomer(h, 'Ana', 'Ana Paula Ferreira'); }, say: ['Primeiro, o cliente. Clique no campo Cliente e escreva o começo do nome. Depois clique no nome certo na lista.', 'Cliente novo? Na lista aparece a opção de cadastrar na hora.'] },
      { tag: 'Objeto', act: async (h) => { await h.spot(h.page.getByLabel('Objeto de serviço')); await h.select('Objeto de serviço', { index: 1 }); }, say: ['Agora o objeto de serviço: o equipamento, a peça ou o veículo que o cliente trouxe. Escolha na lista ou cadastre um novo.'] },
      { tag: 'Relato', act: async (h) => { await h.unspot(); await h.type('Problema relatado / serviço solicitado', 'Máquina de solda desarmando depois de 10 minutos de uso.', { delay: 40 }); }, say: ['No campo Problema relatado, escreva o que o cliente contou, com as palavras dele. Isso evita mal-entendidos depois.'] },
      { act: async (h) => { await h.type('Acessórios deixados', 'Tocha e garra negativa', { delay: 50 }); }, say: ['Em Acessórios deixados, anote o que veio junto. Assim nada se perde na hora da entrega.'] },
      { tag: 'Serviço e valor', act: async (h) => { const sel = h.page.getByLabel('Serviço', { exact: true }); await sel.scrollIntoViewIfNeeded(); await h.spot(sel); await sel.selectOption({ index: 1 }); await h.sleep(700); }, say: ['Em Serviços e materiais, escolha o serviço principal. O valor da tabela aparece sozinho ao lado.'] },
      { act: async (h) => { await h.unspot(); await h.type(h.page.getByLabel('Valor do serviço'), '250', { delay: 120 }); await h.sleep(500); await h.spot(h.page.getByLabel('Valor do serviço')); }, say: ['Precisa cobrar diferente? Clique no valor e escreva o novo. O valor da tabela continua guardado, caso queira voltar a ele.'] },
      { tag: 'Execução', act: async (h) => { await h.unspot(); await h.top(); await h.spot('Execução'); await h.select('Técnico responsável', { index: 1 }); }, say: ['À direita, em Execução, escolha o técnico, a prioridade, o prazo de entrega e os dias de garantia.', 'O prazo e a garantia já vêm preenchidos com o padrão da oficina.'] },
      { tag: 'Abrir a OS', act: async (h) => { await h.unspot(); await h.click(btn(h, 'Abrir OS'), { wait: 1800 }); }, say: ['Por fim, clique em Abrir OS. A ordem de serviço ganha um número e abre a ficha completa.'] },
      { act: (h) => h.spot(h.page.locator('h1').first()), say: ['Guarde esse número: é por ele que você e o cliente vão encontrar o serviço depois.'] },
    ],
  },
  {
    n: 5, file: '05-falar-em-vez-de-digitar', mod: 'os', title: 'Falar em vez de digitar: ditado e comandos de voz', routes: ['/os/'], start: '/os/nova',
    desc: 'O microfone dentro dos campos escreve o que você fala. O botão Voz abre e anota OS falando.',
    learn: ['Ditar o relato pelo microfone do campo', 'Falar vírgula, ponto final e nova linha', 'Usar o botão Voz para abrir uma OS'],
    speech: ['portão arrastando no trilho vírgula roldana fazendo barulho ponto final', '', '', '', 'controle remoto e chave do cadeado', '', '', '', 'abrir ordem de serviço para Ana Paula problema portão arrastando no trilho'],
    steps: [
      { tag: 'O microfone', act: (h) => h.spot(h.page.getByRole('button', { name: /Ditar por voz — Problema relatado/ })), say: ['Não gosta de digitar? Dentro dos campos de texto existe um microfone, no canto direito.', 'Ele escreve no campo tudo o que você falar.'] },
      { tag: 'Ditar', act: async (h) => { await h.click(h.page.getByRole('button', { name: /Ditar por voz — Problema relatado/ }), { wait: 300 }); await h.sleep(4200); }, say: ['Clique no microfone. A borda do campo fica vermelha: é sinal de que o sistema está ouvindo.', 'Fale com calma, perto do aparelho. Para pôr pontuação, fale a palavra: vírgula, ponto final ou nova linha.'] },
      { act: (h) => h.spot(h.page.getByLabel('Problema relatado / serviço solicitado').first()), say: ['Veja: o texto apareceu, com a vírgula e o ponto final. Para parar de ouvir, toque no quadradinho vermelho, ou espere alguns segundos em silêncio.'] },
      { act: async (h) => { await h.unspot(); await h.click(h.page.getByRole('button', { name: /Ditar por voz — Acessórios deixados/ }), { wait: 300 }); await h.sleep(3200); }, say: ['Funciona em qualquer campo que tenha o microfone: acessórios, estado do item, diagnóstico e observações.'] },
      { tag: 'Permissão', act: (h) => h.card(slide('Primeira vez', 'O navegador pede permissão', list(['Aparece a pergunta: permitir o uso do microfone?', 'Clique em Permitir. Isso só é pedido uma vez.', 'Funciona no Chrome, no Edge, no Safari e no celular.']))), say: ['Na primeira vez, o navegador pergunta se pode usar o microfone. Clique em Permitir. Isso só acontece uma vez.'] },
      { tag: 'Botão Voz', act: async (h) => { await h.card(null); await h.click(h.page.getByRole('button', { name: 'Comando de voz' }), { wait: 300 }); await h.sleep(4500); }, say: ['No alto da tela fica o botão Voz. Com ele você dá ordens ao sistema, como: abrir ordem de serviço para Ana Paula, problema portão arrastando.'] },
      { act: (h) => h.spot(h.page.getByRole('dialog').last()), say: ['O sistema mostra o que entendeu e só faz alguma coisa depois que você confirma. Nada é salvo sem a sua confirmação.'] },
      { act: async (h) => { await h.unspot(); await h.esc(); }, say: ['Se o sistema entender errado, é só corrigir o texto no campo, como em qualquer escrita.'] },
    ],
  },
  {
    n: 6, file: '06-acompanhar-a-os', mod: 'os', title: 'Acompanhar a OS: etapas, diagnóstico e itens', routes: ['/os'], start: '/os',
    desc: 'O quadro de etapas, a ficha da OS, o diagnóstico, os serviços e materiais e o histórico.',
    learn: ['O caminho da OS, etapa por etapa', 'Escrever o diagnóstico e lançar itens', 'O histórico e o aviso ao cliente'],
    steps: [
      { tag: 'Etapas', act: (h) => h.card(slide('O caminho de uma OS', 'Cada serviço passa por etapas', flow(['Recebida', 'Diagnóstico', 'Aprovação do cliente', 'Execução', 'Pronta', 'Entregue']))), say: ['Toda ordem de serviço passa por etapas: recebida, em diagnóstico, aguardando aprovação, em execução, pronta e entregue.'] },
      { tag: 'O quadro', act: async (h) => { await h.card(null); await h.spot(h.page.getByRole('button', { name: /O que é isso/ }).first()); }, say: ['A tela Ordens de serviço mostra um quadro com uma coluna para cada etapa.', 'Em cada coluna, o botão O que é isso? explica a etapa, e o botão de baixo leva a OS para a etapa seguinte.'] },
      { tag: 'Abrir a ficha', act: async (h) => { await h.unspot(); await h.click(h.page.getByText('Roberto Carlos Nunes').first(), { wait: 1500 }); }, say: ['Para ver tudo sobre um serviço, clique no cartão dele. A ficha da OS abre.'] },
      { act: (h) => h.spot(h.page.getByRole('button', { name: /6 Em execução/ })), say: ['No alto, a linha de etapas mostra onde o serviço está. A etapa colorida é a etapa atual.'] },
      { tag: 'Diagnóstico', act: async (h) => { await h.unspot(); await h.spot(h.page.getByLabel('Diagnóstico técnico').first()); }, say: ['Em Diagnóstico e execução, o técnico escreve o que encontrou e, no final, o que foi feito. Pode usar o microfone para ditar.'] },
      { tag: 'Itens', act: async (h) => { await h.unspot(); await h.spot('Serviços e materiais'); }, say: ['Em Serviços e materiais ficam os serviços cobrados e as peças usadas. As peças saem do estoque automaticamente.', 'Embaixo de cada preço aparece o custo e a margem, só para quem tem permissão de ver valores.'] },
      { tag: 'Histórico', act: async (h) => { await h.unspot(); await h.spot('Histórico'); }, say: ['O Histórico guarda tudo o que aconteceu: quem mudou a etapa, quando, e as anotações do atendimento.'] },
      { tag: 'Avisar o cliente', act: async (h) => { await h.unspot(); await h.top(); await h.spot(btn(h, 'WhatsApp')); }, say: ['O botão WhatsApp, no alto, abre uma mensagem pronta para avisar o cliente sobre o andamento.'] },
      { act: (h) => h.unspot(), say: ['Quando o serviço terminar, use o botão Marcar pronta. Na próxima aula, você aprende a entregar e receber.'] },
    ],
  },
  {
    n: 7, file: '07-entregar-e-receber', mod: 'os', title: 'Entregar a OS e receber o pagamento', routes: ['/os/'], start: '/os',
    desc: 'Do serviço pronto à entrega: receber em dinheiro, PIX, cartão ou na maquininha.',
    learn: ['Abrir a OS pronta para entrega', 'Receber o pagamento', 'Confirmar a entrega ao cliente'],
    setup: async (api) => ({ id: await osId(api, 11) }),
    steps: [
      { tag: 'OS pronta', act: async (h, st) => { await h.go(`/os/${st.id}`); await h.spot(h.page.getByRole('button', { name: /7 Pronta/ })); }, say: ['Esta ordem de serviço está pronta para entrega. É o momento de chamar o cliente.'] },
      { tag: 'Entregar', act: async (h) => { await h.unspot(); await h.click(btn(h, 'Entregar'), { wait: 1200 }); }, say: ['Clique em Entregar. Se ainda falta receber, o sistema mostra o valor em aberto.'] },
      { tag: 'Forma de pagamento', act: (h) => h.spot(h.page.getByRole('dialog').last()), say: ['Escolha como o cliente vai pagar: dinheiro, PIX, cartão de débito ou de crédito. Se for dividido, dá para usar mais de uma forma.'] },
      { act: async (h) => { await h.unspot(); const pix = h.page.locator('.fixed.inset-0').getByRole('button', { name: /PIX/i }).first(); if (await pix.count()) await h.click(pix, { wait: 500 }); }, say: ['Em dinheiro, informe o valor recebido e o sistema calcula o troco.'] },
      { tag: 'Confirmar', act: async (h) => { await h.click(h.page.getByRole('button', { name: /Receber e entregar/ }), { wait: 1800 }); }, say: ['Clique em Receber e entregar. O pagamento entra no caixa do dia e a OS passa para entregue.'] },
      { tag: 'Maquininha', act: async (h) => { await h.card(slide('Maquininha integrada', 'Cartão sem digitar o valor', list(['Configurada em Configurações, Integrações.', 'O valor vai sozinho para a maquininha.', 'A OS só é dada como paga depois que a maquininha confirma.']))); }, say: ['Se a sua oficina usa maquininha integrada, o valor vai direto para ela. O sistema só considera pago depois que a maquininha confirma.'] },
      { act: (h) => h.card(null), say: ['Pagou uma parte só? Use Entregar e deixar a receber. O saldo fica em contas a receber, e o sistema lembra você de cobrar.'] },
    ],
  },
  {
    n: 8, file: '08-imprimir-os-e-recibo', mod: 'os', title: 'Imprimir a OS e o recibo', routes: ['/imprimir/'], start: '/os',
    desc: 'A OS para o cliente assinar, o recibo e como salvar em PDF.',
    learn: ['Imprimir a ordem de serviço', 'Imprimir o recibo', 'Salvar em PDF para mandar pelo WhatsApp'],
    setup: async (api) => ({ id: await osId(api, 8), delivered: await osId(api, 3) }),
    steps: [
      { tag: 'Botão Imprimir', act: async (h, st) => { await h.go(`/os/${st.id}`); await h.spot(h.page.getByRole('link', { name: /Imprimir/ }).first()); }, say: ['Na ficha da OS, o botão Imprimir fica no alto, junto dos outros botões.', 'Imprima na entrada do serviço, para o cliente conferir e assinar.'] },
      { tag: 'A folha', act: async (h, st) => { await h.unspot(); await h.go(`/imprimir/os/${st.id}`); await h.sleep(800); }, say: ['Esta é a ordem de serviço impressa: os dados da oficina, o cliente, o equipamento, o problema, os itens e as assinaturas.'] },
      { act: (h) => h.spot(h.page.getByRole('button', { name: /Imprimir \/ salvar PDF/ })), say: ['Clique em Imprimir ou salvar PDF. A janela de impressão do computador vai abrir.'] },
      { tag: 'Salvar em PDF', act: async (h) => { await h.unspot(); await h.card(slide('Salvar em PDF', 'Para mandar pelo WhatsApp ou e-mail', list(['Na janela de impressão, em Destino, escolha Salvar como PDF.', 'Clique em Salvar e escolha uma pasta.', 'Depois, anexe o arquivo na conversa do cliente.']))); }, say: ['Quer mandar pelo WhatsApp em vez de imprimir? Na janela de impressão, em Destino, escolha Salvar como PDF.'] },
      { tag: 'Recibo', act: async (h, st) => { await h.card(null); await h.go(`/imprimir/os/${st.delivered}?recibo=1`); await h.sleep(700); }, say: ['Depois da entrega, você também pode imprimir o recibo, com os pagamentos recebidos.'] },
      { act: (h) => h.scroll(400), say: ['A aparência da folha, como o logotipo, as cores e os campos que aparecem, é ajustada em Configurações, Documentos. Há uma aula só sobre isso.'] },
    ],
  },
  {
    n: 35, file: '35-os-entregues-e-os-completa', mod: 'os', title: 'OS entregues e impressão da OS completa', routes: ['/os'], start: '/os?view=entregues',
    desc: 'Encontrar as ordens de serviço já entregues e imprimir a OS completa, com serviços, materiais, horas e checklists.',
    learn: ['Abrir a aba Entregues', 'Filtrar por período, cliente ou placa', 'Imprimir a OS completa'],
    setup: async (api) => {
      const l = await api('GET', '/orders?status=entregue&kind=os&limit=50');
      const o = (l.items || l)[0];
      return { id: o?.id };
    },
    steps: [
      { tag: 'Onde fica', act: (h) => h.spot(h.page.getByRole('button', { name: 'Entregues' })), say: ['Na tela Ordens de serviço, ao lado de Quadro e Lista, fica a aba Entregues.', 'Ela mostra só as ordens de serviço que já foram entregues ao cliente.'] },
      { tag: 'Período', act: async (h) => { await h.unspot(); await h.click(h.page.getByRole('button', { name: 'Este ano' }), { wait: 1200 }); }, say: ['Escolha o período da entrega: hoje, sete dias, este mês, o mês anterior ou este ano. Também dá para digitar as datas.'] },
      { act: (h) => h.spot(h.page.locator('.grid').filter({ hasText: 'OS entregues' }).first()), say: ['Em cima aparecem os totais do período: quantas OS foram entregues, o valor, o que já foi recebido e o que ainda falta receber.'] },
      { tag: 'Buscar', act: async (h) => { await h.unspot(); await h.spot(h.page.getByLabel('Buscar OS entregue')); }, say: ['Para achar uma OS, digite o número, o nome do cliente ou a placa no campo de busca.'] },
      { tag: 'OS completa', act: async (h) => { await h.unspot(); await h.spot(h.page.getByRole('link', { name: /OS completa/ }).first()); }, say: ['Em cada linha tem o botão OS completa. Ele abre a impressão com tudo o que aconteceu na ordem de serviço.'] },
      { act: async (h, st) => { await h.unspot(); if (st.id) await h.go(`/imprimir/os/${st.id}/completa`); await h.sleep(1500); }, say: ['A OS completa traz os dados do cliente e do veículo, as datas, os serviços e os materiais apontados, com quantidade e valor.'] },
      { act: async (h) => { await h.scroll(700, 1400); }, say: ['Mais abaixo vêm os totais, as horas apontadas pelos técnicos, os checklists, os pagamentos, as fotos e o histórico.'] },
      { act: async (h) => { await h.top(); await h.spot(h.page.getByRole('button', { name: /Imprimir \/ salvar PDF/ })); }, say: ['Clique em Imprimir ou salvar PDF. Para guardar no computador ou mandar ao cliente, escolha Salvar como PDF.'] },
      { act: async (h) => { await h.unspot(); await h.card(slide('Dica', 'Também dentro da OS', list(['Na ficha da OS, botão OS completa.', 'O botão Imprimir continua com o modelo resumido.', 'Serve para conferência, garantia e prestação de contas.']))); }, say: ['O mesmo botão OS completa também fica dentro de cada ordem de serviço, ao lado de Imprimir.'] },
    ],
  },
  {
    n: 9, file: '09-garantia-e-retorno', mod: 'os', title: 'Garantia: quando o cliente volta', routes: ['/garantias'], start: '/os',
    desc: 'Abrir uma garantia a partir da OS entregue e acompanhar o atendimento.',
    learn: ['Onde ver a garantia de uma OS', 'Abrir o atendimento de garantia', 'Acompanhar as garantias abertas'],
    setup: async (api) => ({ id: await osId(api, 3) }),
    steps: [
      { tag: 'Prazo de garantia', act: async (h, st) => { await h.go(`/os/${st.id}`); await h.spot(h.page.getByText('Garantia', { exact: true }).first()); }, say: ['Toda ordem de serviço entregue tem um prazo de garantia. Ele aparece na própria ficha da OS.'] },
      { tag: 'Abrir garantia', act: async (h) => { await h.unspot(); await h.click(btn(h, 'Abrir garantia'), { wait: 1200 }); }, say: ['O cliente voltou com o mesmo problema? Abra a OS antiga e clique em Abrir garantia.'] },
      { act: async (h) => { const t = h.page.locator('.fixed.inset-0 textarea').first(); if (await t.count()) { await h.type(t, 'Portão voltou a arrastar no trilho.', { delay: 45 }); } }, say: ['Escreva o que o cliente relatou. O sistema já sabe qual foi o serviço e até quando vai a garantia.'] },
      { act: async (h) => { await h.esc(); await h.go('/garantias'); await h.spot(h.page.locator('main h1').first()); }, say: ['Na tela Garantias ficam todos os atendimentos de garantia, com a situação de cada um.'] },
      { act: (h) => h.unspot(), say: ['Assim você sabe quantos serviços voltaram e pode melhorar o que for preciso.'] },
    ],
  },
  {
    n: 10, file: '10-venda-de-balcao', mod: 'os', title: 'Venda de balcão', routes: ['/venda'], start: '/venda',
    desc: 'Vender peças e serviços rápidos sem abrir uma ordem de serviço.',
    learn: ['Adicionar os itens vendidos', 'Cliente opcional', 'Finalizar e receber'],
    steps: [
      { say: ['A venda de balcão é para vendas rápidas, como um disco de corte ou um eletrodo, sem precisar abrir uma ordem de serviço.'] },
      { tag: 'Itens', act: async (h) => { const i = h.page.getByPlaceholder('Adicionar serviço ou material…'); await h.spot(i); await i.click(); await i.pressSequentially('disco', { delay: 120 }); await h.sleep(1000); }, say: ['Clique no campo Adicionar e escreva o nome do produto. A lista mostra o que tem no estoque.'] },
      { act: async (h) => { await h.click(h.page.getByRole('button', { name: 'Materiais', exact: true }).last(), { wait: 600 }); await h.click(h.page.getByText(/Disco de corte/).first(), { wait: 700 }); }, say: ['A lista tem duas abas: Serviços e Materiais. Clique em Materiais e depois no produto certo. Ele entra na venda com a quantidade um. Para mudar a quantidade, é só digitar no campo Qtd.'] },
      { tag: 'Cliente', act: (h) => h.spot(h.page.getByPlaceholder('Buscar por nome, telefone ou CPF/CNPJ…').first()), say: ['O cliente é opcional. Se quiser o nome no recibo, escolha o cliente aqui.'] },
      { tag: 'Finalizar', act: async (h) => { await h.unspot(); await h.click(btn(h, 'Finalizar venda'), { wait: 1200 }); }, say: ['Clique em Finalizar venda e escolha a forma de pagamento. O estoque é baixado e o dinheiro entra no caixa.'] },
      { act: (h) => h.esc(), say: ['Lembre: para vender, o caixa do dia precisa estar aberto. A aula de caixa mostra como abrir.'] },
    ],
  },

  // ───────────────────────── Clientes, solicitações e orçamentos
  {
    n: 11, file: '11-clientes-e-veiculos', mod: 'comercial', title: 'Cadastrar clientes e veículos', routes: ['/clientes'], start: '/clientes',
    desc: 'Pessoa física ou empresa, contatos, endereço e vários veículos no mesmo cadastro.',
    learn: ['Cadastrar um cliente novo', 'Incluir um ou mais veículos', 'Por que cada placa tem um só dono'],
    steps: [
      { tag: 'A lista', act: (h) => h.spot(h.page.getByPlaceholder('Nome, telefone, CPF/CNPJ ou e-mail…')), say: ['Na tela Clientes e veículos ficam todos os seus clientes. Use a busca para achar pelo nome, telefone ou documento.'] },
      { tag: 'Novo cliente', act: async (h) => { await h.unspot(); await h.click(btn(h, 'Novo cliente'), { wait: 900 }); }, say: ['Para cadastrar, clique em Novo cliente. Escolha pessoa física, para uma pessoa, ou pessoa jurídica, para uma empresa.'] },
      { act: async (h) => { await h.type('Nome completo', 'Juliana Martins', { delay: 70 }); await h.type('Celular / WhatsApp', '19998765432', { delay: 60 }); }, say: ['Escreva o nome e o celular. O celular é importante: é por ele que você avisa que o serviço ficou pronto.', 'Só o nome é obrigatório. O resto pode ser completado depois.'] },
      { tag: 'Veículos', act: async (h) => { await h.click(h.page.getByRole('button', { name: 'Adicionar veículo' }), { wait: 500 }); await h.type(h.page.getByLabel('Placa', { exact: true }).last(), 'BRA2E19', { delay: 120 }); await h.type(h.page.getByLabel('Marca').last(), 'Volkswagen', { delay: 60 }); await h.type(h.page.getByLabel('Modelo').last(), 'Saveiro', { delay: 60 }); await h.type(h.page.getByLabel('Ano').last(), '2019', { delay: 90 }); },
        say: ['Na parte Veículos, clique em Adicionar veículo e preencha a placa, a marca, o modelo e o ano.'] },
      { act: async (h) => { await h.click(h.page.getByRole('button', { name: 'Adicionar veículo' }), { wait: 500 }); await h.type(h.page.getByLabel('Placa', { exact: true }).last(), 'QTP5F71', { delay: 120 }); await h.type(h.page.getByLabel('Marca').last(), 'Honda', { delay: 60 }); await h.type(h.page.getByLabel('Modelo').last(), 'CG 160', { delay: 60 }); },
        say: ['O cliente tem mais de um veículo? Clique de novo em Adicionar veículo. Para tirar um veículo, use a lixeira vermelha.'] },
      { act: async (h) => { await h.click(btn(h, 'Salvar'), { wait: 1600 }); }, say: ['Clique em Salvar. A ficha do cliente abre, com os veículos e o histórico de serviços.'] },
      { tag: 'Uma placa, um dono', act: async (h) => { await h.go('/clientes'); await h.click(btn(h, 'Novo cliente'), { wait: 800 }); await h.type('Nome completo', 'Outro cliente', { delay: 60 }); await h.click(h.page.getByRole('button', { name: 'Adicionar veículo' }), { wait: 400 }); await h.type(h.page.getByLabel('Placa', { exact: true }).last(), 'BRA2E19', { delay: 120 }); await h.page.getByLabel('Marca').last().click(); await h.sleep(1200); await h.spot(h.page.getByText(/Já cadastrado para/).first()); },
        say: ['Cada placa só pode estar em um cadastro. Se você digitar uma placa que já existe, aparece o aviso: já cadastrado para, e o nome do dono.', 'Assim não existem dois cadastros para o mesmo carro.'] },
      { act: async (h) => { await h.unspot(); await h.click(btn(h, 'Cancelar'), { wait: 600 }); }, say: ['Essa regra pode ser desligada em Configurações, se a sua oficina precisar. Por exemplo, para frotas.'] },
    ],
  },
  {
    n: 12, file: '12-solicitacao-e-visita', mod: 'comercial', title: 'Solicitação do cliente e visita técnica', routes: ['/solicitacoes'], start: '/solicitacoes',
    desc: 'Anotar o pedido que chegou por telefone ou WhatsApp e agendar a visita para ver o serviço.',
    learn: ['Registrar a solicitação', 'Acompanhar pelas situações', 'Agendar a visita técnica'],
    steps: [
      { say: ['Solicitação é o pedido do cliente antes de você ver o serviço. Por exemplo: o cliente ligou dizendo que o portão não fecha.'] },
      { tag: 'Situações', act: (h) => h.spot(h.page.getByRole('button', { name: /^Nova/ }).first()), say: ['No alto, cada botão é uma situação: nova, em triagem, visita agendada, diagnosticada e orçada. Clique para filtrar.'] },
      { tag: 'Nova solicitação', act: async (h) => { await h.unspot(); await h.click(h.page.locator('main').getByRole('link', { name: 'Nova solicitação' }).or(h.page.locator('main').getByRole('button', { name: 'Nova solicitação' })).first(), { wait: 1000 }); }, say: ['Para registrar, clique em Nova solicitação, no alto, à direita.'] },
      { act: async (h) => { await h.unspot(); await h.select('Canal de entrada', { index: 1 }); await h.type('Nome do contato', 'Sr. Antônio', { delay: 60 }); await h.type(h.page.getByLabel('Telefone', { exact: true }), '19997001122', { delay: 60 }); }, say: ['Diga por onde o pedido chegou, o nome e o telefone de quem pediu. Se o cliente já é cadastrado, escolha no campo Cliente.'] },
      { act: async (h) => { await h.type('O que o cliente precisa (resumo)', 'Portão basculante não fecha', { delay: 50 }); await h.type('Relato do cliente / detalhes', 'Portão travando na metade desde ontem. Cliente pede visita pela manhã.', { delay: 30 }); }, say: ['Escreva um resumo curto e, embaixo, os detalhes que o cliente contou. Pode usar o microfone para ditar.'] },
      { act: async (h) => { await h.click(btn(h, 'Salvar solicitação'), { wait: 1500 }); }, say: ['Clique em Salvar solicitação. Ela ganha um número e entra na lista.'] },
      { tag: 'Visita', act: (h) => h.spot(h.page.getByRole('button', { name: /Agendar visita|Agendar/ }).first()), say: ['Precisa ir até o local? Use Agendar visita. Escolha o técnico, o dia e o horário. A visita aparece na agenda dele.'] },
      { act: (h) => h.unspot(), say: ['Depois da visita, registre o diagnóstico na própria solicitação. Com ele, você monta o orçamento, como mostra a próxima aula.'] },
    ],
  },
  {
    n: 13, file: '13-orcamento-e-aprovacao', mod: 'comercial', title: 'Orçamento e aprovação pelo cliente', routes: ['/orcamentos'], start: '/orcamentos/novo',
    desc: 'Montar o orçamento, enviar o link para o cliente aprovar e transformar em OS.',
    learn: ['Montar o orçamento com itens', 'Enviar o link para aprovação', 'Transformar o orçamento aprovado em OS'],
    steps: [
      { tag: 'Cliente e título', act: async (h) => { await pickCustomer(h, 'Metal', 'Metalúrgica Horizonte Ltda'); await h.type('Título', 'Fabricação de portão basculante 3,0 x 2,4 m', { delay: 35 }); }, say: ['Em Novo orçamento, escolha o cliente e dê um título que o cliente entenda.'] },
      { tag: 'Itens', act: async (h) => { const i = h.page.getByPlaceholder('Adicionar serviço ou material…'); await h.spot(i); await i.click(); await i.pressSequentially('portão', { delay: 110 }); await h.sleep(1000); await h.click(h.page.getByText(/Fabricação de portão basculante/).last(), { wait: 700 }); },
        say: ['Em Itens, escreva o nome do serviço ou do material e clique nele na lista. O preço da tabela entra sozinho e pode ser mudado.'] },
      { act: (h) => h.spot('Condições'), say: ['Em Condições ficam a validade, o prazo de execução, a garantia e a forma de pagamento. Os textos padrão já vêm preenchidos.'] },
      { tag: 'Salvar', act: async (h) => { await h.unspot(); await h.click(btn(h, 'Salvar orçamento'), { wait: 1800 }); }, say: ['Clique em Salvar orçamento.'] },
      { tag: 'Enviar', act: async (h) => { const b2 = h.page.getByRole('button', { name: /Enviar|Link|WhatsApp/ }).first(); await h.spot(b2); }, say: ['Agora envie para o cliente. O orçamento gera um link: o cliente abre no celular, confere e aprova com um toque.'] },
      { tag: 'Aprovado vira OS', act: async (h) => { await h.unspot(); await h.card(slide('Do orçamento à OS', 'Aprovou? Vira ordem de serviço', flow(['Orçamento enviado', 'Cliente aprova pelo link', 'Gerar OS', 'Serviço começa']))); }, say: ['Quando o cliente aprova, o orçamento muda de situação e aparece o botão para gerar a ordem de serviço, já com os itens.'] },
      { act: (h) => h.card(null), say: ['O cliente pediu mudança? Crie uma revisão. O sistema guarda as versões anteriores.'] },
    ],
  },

  {
    n: 30, file: '30-pedidos-do-whatsapp', mod: 'comercial', title: 'Pedidos do WhatsApp: aprovar e responder', routes: ['/whatsapp'], start: '/whatsapp',
    desc: 'Aprovar os pedidos que o agente anotou no WhatsApp e conversar com o cliente.',
    learn: ['Ver os pedidos que chegaram', 'Aprovar: abrir a OS e marcar o horário', 'Ler e responder as conversas'],
    setup: async (api) => {
      for (const t of ['oi', '2', 'BRA2E19', 'troca de óleo e barulho no freio', '1', 'Maria Souza', '1']) await api('POST', '/whatsapp/simulate', { phone: '11977771234', text: t });
      return {};
    },
    steps: [
      { tag: 'Onde fica', act: async (h) => { await h.go('/whatsapp'); await h.spot(h.page.locator('main h1').first()); }, say: ['No menu Atendimento, clique em WhatsApp.', 'Aqui chegam os pedidos que o agente anotou na conversa com o cliente.'] },
      { tag: 'O pedido', act: (h) => h.spot(h.page.locator('li[aria-label^="Pedido nº"]').first()), say: ['Cada cartão mostra o nome do cliente, a placa, o serviço e o horário que ele pediu.'] },
      { tag: 'Aprovar', act: async (h) => { await h.unspot(); await h.click(btn(h, 'Aprovar'), { wait: 1000 }); }, say: ['Para aceitar, clique em Aprovar. Se quiser, escolha o técnico e confira o dia e a hora.'] },
      { act: async (h) => { const d = h.page.getByRole('dialog').last(); await h.spot(d.getByText('Avisar o cliente pelo WhatsApp', { exact: true })); }, say: ['Deixe ligado Avisar o cliente pelo WhatsApp. Assim ele recebe a confirmação com o número da OS.'] },
      { act: async (h) => { await h.click(h.page.getByRole('button', { name: /Aprovar e abrir OS/ }), { wait: 1800 }); }, say: ['Clique em Aprovar e abrir OS. O sistema abre a OS, marca o horário na agenda e avisa o cliente.'] },
      { tag: 'Conversas', act: async (h) => { await h.click(h.page.getByRole('button', { name: 'Conversas', exact: true }), { wait: 1000 }); await h.click(h.page.locator('main ul button').first(), { wait: 1500 }); }, say: ['Na aba Conversas você lê tudo o que o cliente e o agente escreveram.'] },
      { tag: 'Responder', act: (h) => h.spot(btn(h, 'Assumir conversa')), say: ['Quer falar você mesmo? Clique em Assumir conversa e escreva embaixo. O agente para de responder nessa conversa.', 'Depois, clique em Devolver ao agente.'] },
      { act: async (h) => { await h.unspot(); await h.card(slide('Lembre', 'A equipe sempre confirma', list(['O agente só anota o pedido.', 'A OS e a agenda nascem quando você aprova.', 'Recusar também avisa o cliente.']))); }, say: ['O agente nunca abre OS sozinho: ele anota, e a equipe confirma. Se não der para atender, clique em Recusar e diga o motivo.'] },
    ],
  },
  // ───────────────────────── Agenda, produção e qualidade
  {
    n: 14, file: '14-agenda', mod: 'producao', title: 'Agenda da equipe', routes: ['/agenda'], start: '/agenda',
    desc: 'Visitas, execuções e entregas de cada técnico, dia a dia.',
    learn: ['Ler a agenda da semana', 'Agendar um compromisso', 'Evitar horários em conflito'],
    steps: [
      { tag: 'A semana', act: (h) => h.spot(h.page.locator('main').first()), say: ['A agenda mostra a semana da equipe. Cada quadro é um compromisso: visita, execução de OS ou entrega.'] },
      { act: async (h) => { await h.unspot(); await h.spot(h.page.getByRole('button', { name: 'Próxima semana' })); }, say: ['Use as setas para ir para a semana anterior ou a próxima. O botão Hoje volta para a semana atual.'] },
      { tag: 'Agendar', act: async (h) => { await h.unspot(); await h.click(btn(h, 'Agendar'), { wait: 900 }); }, say: ['Para marcar, clique em Agendar. Escolha o tipo, o técnico, o dia e o horário. Se for de uma OS, escolha a OS também.'] },
      { act: (h) => h.spot(h.page.getByRole('dialog').last()), say: ['Se o técnico já tiver outro compromisso no mesmo horário, o sistema avisa antes de salvar.'] },
      { act: async (h) => { await h.unspot(); await h.esc(); }, say: ['Cada técnico também vê os próprios compromissos na tela Meu trabalho, inclusive pelo celular.'] },
    ],
  },
  {
    n: 15, file: '15-producao-e-horas', mod: 'producao', title: 'Painel de produção e horas trabalhadas', routes: ['/producao', '/meu-trabalho'], start: '/producao',
    desc: 'Quem está trabalhando em quê, o cronômetro de horas e a folha de horas.',
    learn: ['Ler o painel de produção', 'Iniciar e encerrar o cronômetro', 'Conferir a folha de horas'],
    setup: async (api) => ({ id: await osId(api, 8) }),
    steps: [
      { tag: 'Painel', act: (h) => h.spot('Fila de execução'), say: ['O Painel de produção mostra os serviços em andamento e quem está trabalhando em cada um, agora.'] },
      { tag: 'Cronômetro', act: async (h, st) => { await h.unspot(); await h.go(`/os/${st.id}`); await h.spot('Execução e horas'); }, say: ['Dentro da OS, em Execução e horas, fica o cronômetro do técnico.'] },
      { act: (h) => h.spot(h.page.getByRole('button', { name: /^(Iniciar|Encerrar)$/ }).first()), say: ['Ao começar o trabalho, clique em Iniciar. Ao parar, clique em Encerrar. O sistema conta o tempo sozinho.', 'Esqueceu de ligar? Use Lançar manual e informe o início e o fim.'] },
      { tag: 'Folha de horas', act: async (h) => { await h.unspot(); await h.go('/producao'); await h.click(btn(h, 'Folha de horas'), { wait: 1000 }); }, say: ['Na aba Folha de horas, você confere as horas de cada técnico no período. Elas entram no custo da OS e nas comissões.'] },
      { tag: 'Meu trabalho', act: async (h) => { await h.go('/meu-trabalho'); await h.spot(h.page.locator('main h1').first()); }, say: ['O técnico usa a tela Meu trabalho, no celular: lá estão os serviços dele, a agenda do dia e o botão do cronômetro.'] },
    ],
  },
  {
    n: 16, file: '16-qualidade-e-checklist', mod: 'producao', title: 'Qualidade: checklist de inspeção', routes: ['/os/'], start: '/os',
    desc: 'Conferir o serviço com uma lista antes de entregar ao cliente.',
    learn: ['Abrir a inspeção final', 'Marcar cada item da lista', 'Aprovar ou reprovar o serviço'],
    setup: async (api) => ({ id: await osId(api, 8) }),
    steps: [
      { tag: 'Onde fica', act: async (h, st) => { await h.go(`/os/${st.id}`); await h.spot('Qualidade e checklists'); }, say: ['Na ficha da OS, em Qualidade e checklists, ficam as listas de conferência do serviço.'] },
      { tag: 'Inspeção final', act: async (h) => { await h.unspot(); await h.click(btn(h, 'Inspeção final'), { wait: 1000 }); }, say: ['Antes de entregar, clique em Inspeção final. Abre uma lista com o que deve ser conferido.'] },
      { tag: 'Marcar itens', act: async (h) => { const d = h.page.getByRole('dialog').last(); await h.click(d.getByRole('button', { name: 'OK', exact: true }).nth(0), { wait: 300 }); await h.click(d.getByRole('button', { name: 'OK', exact: true }).nth(1), { wait: 300 }); }, say: ['Para cada item, clique em OK se está certo, em Não conforme se tem problema, ou em N/A quando não se aplica.'] },
      { act: async (h) => { const d = h.page.getByRole('dialog').last(); await h.click(d.getByRole('button', { name: 'Aprovada', exact: true }), { wait: 400 }); await h.spot(d.getByRole('button', { name: 'Registrar', exact: true })); }, say: ['No fim, escolha Aprovada, Aprovada com ressalva ou Reprovada, e clique em Registrar. Reprovado, o serviço volta para a execução.'] },
      { act: async (h) => { await h.unspot(); await h.esc(); await h.card(slide('Listas da sua oficina', 'Você escolhe o que conferir', list(['Configurações, aba Checklists.', 'Uma lista para cada etapa e para cada tipo de serviço.', 'Pode deixar a inspeção obrigatória para entregar.']))); }, say: ['As listas são da sua oficina. Você muda os itens em Configurações, na aba Checklists, e pode deixar a inspeção obrigatória antes da entrega.'] },
      { act: (h) => h.card(null), say: ['Também dá para usar a lista de recebimento, na chegada do equipamento, para registrar como ele chegou.'] },
    ],
  },

  {
    n: 27, file: '27-tipos-de-os-e-checklists', mod: 'producao', title: 'Tipos de OS e checklists obrigatórios', routes: [], start: '/configuracoes?tab=checklists',
    desc: 'Cadastrar os checklists (obrigatórios ou não), os tipos de serviço da oficina e ligar um ao outro.',
    learn: ['Cadastrar um checklist obrigatório', 'Criar um tipo de OS e vincular o checklist', 'Escolher o tipo ao abrir a OS'],
    steps: [
      { tag: 'Onde fica', act: async (h) => { await h.spot(h.page.locator('#checklists h3')); }, say: ['Em Configurações há duas abas: Checklists e Tipos de OS.', 'Checklist é a lista de conferência. Tipo de OS é o tipo de serviço, por exemplo troca de óleo, funilaria ou solda.'] },
      { tag: 'Novo checklist', act: async (h) => { await h.unspot(); await h.click(h.page.locator('[data-tour="novo-checklist"]'), { wait: 800 }); await h.type('Nome do checklist', 'Recebimento — troca de óleo', { delay: 55 }); await h.type(h.page.getByLabel('Item 1', { exact: true }), 'Nível de combustível anotado', { delay: 40 }); }, say: ['Na aba Checklists, clique em Novo checklist. Dê um nome e escreva o primeiro item a conferir.'] },
      { act: async (h) => { for (const it of ['Riscos e amassados fotografados', 'Objetos de valor retirados']) { await h.type('Novo item', it, { delay: 40 }); await h.click(btn(h, 'Adicionar'), { wait: 400 }); } }, say: ['Para mais itens, escreva no campo de baixo e clique em Adicionar. As setas mudam a ordem e o X apaga.'] },
      { tag: 'Obrigatório', act: async (h) => { await h.click(h.page.getByRole('dialog').last().getByText('Obrigatório', { exact: true }), { wait: 500 }); }, say: ['Ligue Obrigatório: a OS só segue depois que esse checklist for preenchido.'] },
      { act: async (h) => { await h.click(btn(h, 'Salvar checklist'), { wait: 1200 }); await h.spot(h.page.getByText('Recebimento — troca de óleo').first().locator('..').locator('..')); }, say: ['Clique em Salvar checklist. Ele aparece na lista, com o aviso Obrigatório.'] },
      { tag: 'Tipo de OS', act: async (h) => { await h.unspot(); await h.go('/configuracoes?tab=tipos-os'); await h.click(h.page.locator('[data-tour="novo-tipo"]'), { wait: 800 }); await h.type('Nome do tipo', 'Troca de óleo', { delay: 70 }); }, say: ['Agora abra a aba Tipos de OS e clique em Novo tipo de OS. Escreva o nome do tipo.'] },
      { tag: 'Vincular', act: async (h) => { await h.click(h.page.getByRole('dialog').last().getByText('Recebimento — troca de óleo'), { wait: 500 }); await h.spot(h.page.getByRole('dialog').last().getByText('Checklists deste tipo')); }, say: ['Em Checklists deste tipo, marque os checklists que valem para este serviço. Os obrigatórios aparecem marcados em vermelho.'] },
      { act: async (h) => { await h.unspot(); await h.click(btn(h, 'Salvar tipo'), { wait: 1200 }); await h.spot(h.page.getByLabel('Tipo Troca de óleo')); }, say: ['Clique em Salvar tipo. O cartão mostra os checklists ligados a ele.'] },
      { tag: 'Na OS', act: async (h) => { await h.unspot(); await h.go('/os/nova'); await h.select('Tipo de OS', 'Troca de óleo'); await h.spot(h.page.locator('#campo-tipo-os')); }, say: ['Ao abrir uma OS, escolha o Tipo de OS. Embaixo aparecem os checklists deste tipo.', 'Quando você clicar em Abrir OS, o checklist de recebimento já aparece para preencher.'] },
      { act: async (h) => { await h.unspot(); await h.card(slide('Resumo', 'Cada serviço com a sua lista', list(['Checklists: aba Checklists, em Configurações.', 'Tipos de OS: aba Tipos de OS, marcando os checklists.', 'Checklist sem tipo vale para todas as OS.']))); }, say: ['Um checklist pode servir para vários tipos. E o checklist sem nenhum tipo marcado vale para todas as OS.'] },
    ],
  },
  {
    n: 34, file: '34-preencher-checklist-na-os', mod: 'producao', title: 'Preencher o checklist na OS, passo a passo', routes: ['/os/'], start: '/os',
    desc: 'Como preencher o checklist na chegada do veículo e antes de entregar, e o que acontece quando ele é obrigatório.',
    learn: ['Onde o checklist aparece na OS', 'Marcar OK, Não conforme ou N/A', 'Registrar e aprovar ou reprovar'],
    setup: async (api) => {
      const type = await api('POST', '/quality/types', { name: 'Revisão completa', description: 'Revisão geral do veículo' });
      await api('POST', '/quality/templates', { name: 'Chegada do veículo', kind: 'recebimento', required: true, order_type_ids: [type.id],
        items: ['Nível de combustível anotado', 'Lataria sem riscos e amassados', 'Objetos de valor retirados', 'Estepe e macaco no carro'] });
      await api('POST', '/quality/templates', { name: 'Conferência antes da entrega', kind: 'inspecao', required: true, order_type_ids: [type.id],
        items: ['Serviço feito conforme a OS', 'Peças trocadas guardadas para o cliente', 'Veículo limpo por dentro', 'Teste de rodagem feito'] });
      const cs = await api('GET', '/customers?limit=5');
      const c = (cs.items || cs).find((x) => x.kind === 'pf') || (cs.items || cs)[0];
      const o = await api('POST', '/orders', { customer_id: c.id, order_type_id: type.id, problem: 'Revisão completa e barulho na suspensão',
        items: [{ kind: 'servico', description: 'Revisão completa', qty: 1, unit_price: 380 }] });
      return { id: o.id };
    },
    steps: [
      { act: (h) => h.card(slide('Para que serve', 'O checklist é a lista de conferência', list(['Na chegada: anota como o veículo chegou.', 'Antes de entregar: confere se o serviço está certo.', 'Na entrega: o que foi devolvido ao cliente.']))), say: ['O checklist é uma lista de conferência. Ele protege a oficina e o cliente.', 'Na chegada, anota como o veículo chegou. Antes de entregar, confere se o serviço ficou certo.'] },
      { tag: 'Onde fica', act: async (h, st) => { await h.card(null); await h.go(`/os/${st.id}`); await h.sleep(800); await h.spot(h.page.locator('#checklists')); }, say: ['Abra a ordem de serviço. Desça até o quadro Qualidade e checklists.', 'Aqui aparecem os botões das etapas: Recebimento, Inspeção final e Entrega.'] },
      { act: async (h) => { await h.unspot(); await h.spot(h.page.locator('#checklists').getByText('Falta preencher o checklist obrigatório')); }, say: ['Quando o checklist é obrigatório, aparece este aviso amarelo, e o botão da etapa fica destacado em laranja.', 'Enquanto ele não for preenchido, a OS não passa para a próxima etapa.'] },
      { tag: 'Abrir o checklist', act: async (h) => { await h.unspot(); await h.click(h.page.locator('#checklists').getByRole('button', { name: 'Recebimento', exact: true }), { wait: 1000 }); }, say: ['Clique no botão Recebimento. Abre a lista com os itens para conferir.'] },
      { act: (h) => h.spot(h.page.getByRole('dialog').last().locator('.divide-y').first()), say: ['Todos os itens começam marcados como OK. Você só precisa mudar o que estiver diferente.'] },
      { tag: 'Marcar os itens', act: async (h) => { await h.unspot(); const d = h.page.getByRole('dialog').last(); await h.click(d.getByRole('button', { name: 'Não conforme' }).nth(1), { wait: 500 }); await h.type(d.getByPlaceholder('O que foi encontrado'), 'Risco na porta traseira direita', { delay: 55 }); }, say: ['Achou um problema? Clique em Não conforme naquele item. Abre um campo: escreva o que encontrou, por exemplo um risco na porta.'] },
      { act: async (h) => { const d = h.page.getByRole('dialog').last(); await h.click(d.getByRole('button', { name: 'N/A' }).nth(3), { wait: 500 }); }, say: ['Se o item não serve para este veículo, clique em N/A, que quer dizer não se aplica. Por exemplo, um carro sem estepe.'] },
      { tag: 'Resultado', act: async (h) => { const d = h.page.getByRole('dialog').last(); await h.spot(d.getByRole('button', { name: 'Aprovada com ressalva' }).locator('..')); }, say: ['Embaixo fica o resultado. Como teve um item Não conforme, o sistema já mudou para Aprovada com ressalva.', 'Ressalva quer dizer: está tudo certo, mas com uma observação.'] },
      { act: async (h) => { await h.unspot(); const d = h.page.getByRole('dialog').last(); await h.type(d.getByLabel('Observações'), 'Cliente avisado do risco na porta.', { delay: 50 }); }, say: ['Em Observações, escreva o que for importante. Para guardar fotos, use o quadro Fotos e documentos da OS.'] },
      { act: async (h) => { await h.click(h.page.getByRole('dialog').last().getByRole('button', { name: 'Registrar', exact: true }), { wait: 1500 }); await h.spot(h.page.locator('#checklists li').first()); }, say: ['Clique em Registrar. O checklist fica guardado na OS, com a data, o nome de quem preencheu e cada item marcado.', 'O Recebimento saiu do aviso amarelo. Agora a OS pode seguir para o serviço.'] },
      { act: async (h, st) => { await h.unspot(); await h.api('POST', `/orders/${st.id}/status`, { status: 'em_execucao', public: false }); await h.go(`/os/${st.id}`); await h.sleep(1000); await h.spot(h.page.locator('#checklists')); }, say: ['A OS segue o caminho normal: diagnóstico, aprovação e execução. Aqui ela já está em execução.', 'A Inspeção final só fica liberada quando o serviço está em execução ou pronto.'] },
      { tag: 'Antes de entregar', act: async (h) => { await h.unspot(); await h.click(h.page.locator('#checklists').getByRole('button', { name: 'Inspeção final', exact: true }), { wait: 1000 }); }, say: ['Quando o serviço terminar, faça a Inspeção final. Clique no botão Inspeção final.'] },
      { act: async (h) => { const d = h.page.getByRole('dialog').last(); await h.click(d.getByRole('button', { name: 'Marcar todos como OK' }), { wait: 500 }); await h.click(d.getByRole('button', { name: 'Aprovada', exact: true }), { wait: 500 }); }, say: ['Confira cada item no veículo. Se estiver tudo certo, use Marcar todos como OK e escolha Aprovada.'] },
      { act: async (h) => { await h.spot(h.page.getByRole('dialog').last().getByRole('button', { name: 'Reprovada', exact: true })); }, say: ['Se o serviço não ficou bom, escolha Reprovada. A OS volta para a execução, para a equipe corrigir antes de entregar.'] },
      { act: async (h) => { await h.unspot(); await h.click(h.page.getByRole('dialog').last().getByRole('button', { name: 'Registrar', exact: true }), { wait: 1500 }); await h.spot(h.page.locator('#checklists')); }, say: ['Clique em Registrar. Pronto: as duas conferências ficam na OS, uma embaixo da outra.'] },
      { act: async (h) => { await h.unspot(); await h.card(slide('Lembre', 'Três cliques por item, no máximo', list(['OK: está certo.', 'Não conforme: tem problema — escreva o que viu.', 'N/A: não se aplica a este veículo.', 'Obrigatório: a OS só segue depois de registrar.']))); }, say: ['Resumindo: OK quando está certo, Não conforme quando tem problema, e N/A quando não se aplica.', 'Os checklists são montados em Configurações, na aba Checklists.'] },
    ],
  },
  {
    n: 36, file: '36-tipos-de-os-prontos', mod: 'producao', title: 'Tipos de OS prontos: exibir ou ocultar', routes: [], start: '/configuracoes?tab=tipos-os',
    desc: 'Os tipos de OS que já vêm prontos para mecânica, autoelétrica, serralheria e soldas especiais, e como escolher quais aparecem.',
    learn: ['Os tipos prontos e seus checklists', 'Exibir ou ocultar um tipo ou um ramo inteiro', 'Restaurar os tipos padrão'],
    steps: [
      { act: (h) => h.card(slide('Já vem pronto', 'Tipos de OS por ramo', list(['Oficina mecânica: revisão, óleo, freios, suspensão…', 'Autoelétrica: scanner, bateria, ar-condicionado…', 'Serralheria: portão, grades, estruturas…', 'Soldas especiais: alumínio, inox, ferro fundido…']))), say: ['O TORVEN já vem com tipos de ordem de serviço prontos para oficina mecânica, autoelétrica, serralheria e soldas especiais.', 'Cada tipo já tem três checklists: o de chegada, o de inspeção final e o de entrega.'] },
      { tag: 'Onde fica', act: async (h) => { await h.card(null); await h.spot(h.page.getByRole('region', { name: 'Oficina mecânica' }).locator('h4')); }, say: ['Em Configurações, na aba Tipos de OS, eles aparecem separados por ramo.'] },
      { act: async (h) => { await h.unspot(); await h.spot(h.page.getByLabel('Tipo Freios').locator('ul')); }, say: ['Em cada cartão você vê os checklists daquele tipo. Para mudar os itens ou deixar um checklist obrigatório, use a aba Checklists.'] },
      { tag: 'Ocultar um tipo', act: async (h) => { await h.unspot(); await h.click(h.page.getByLabel('Exibir Troca de óleo e filtros na abertura da OS'), { wait: 900 }); await h.spot(h.page.getByLabel('Tipo Troca de óleo e filtros')); }, say: ['Não usa algum tipo? Desmarque a caixa Exibido na abertura da OS. Ele fica oculto e não aparece mais para escolher.', 'As ordens de serviço antigas daquele tipo continuam normais.'] },
      { tag: 'Ocultar um ramo', act: async (h) => { await h.unspot(); await h.click(h.page.getByRole('region', { name: 'Serralheria' }).getByRole('button', { name: /Ocultar todos/ }), { wait: 1000 }); }, say: ['Se a sua oficina não trabalha com serralheria, por exemplo, clique em Ocultar todos, ao lado do nome do ramo. Para voltar, clique em Exibir todos.'] },
      { act: async (h) => { await h.click(h.page.getByRole('button', { name: 'Ocultos', exact: true }), { wait: 900 }); }, say: ['Use os filtros Todos, Exibidos e Ocultos para ver só o que interessa.'] },
      { tag: 'Na OS', act: async (h) => { await h.go('/os/nova'); await h.sleep(800); await h.spot(h.page.locator('#campo-tipo-os')); }, say: ['Na abertura da OS, a lista de tipos mostra só os exibidos, separados por ramo. Ao escolher o tipo, os checklists dele já aparecem.'] },
      { tag: 'Restaurar', act: async (h) => { await h.unspot(); await h.go('/configuracoes?tab=tipos-os'); await h.spot(h.page.getByRole('button', { name: /Restaurar tipos padrão/ })); }, say: ['Apagou um tipo padrão sem querer? Clique em Restaurar tipos padrão. Ele volta com os checklists, sem mexer nos que já existem.'] },
      { act: async (h) => { await h.unspot(); await h.card(slide('Lembre', 'Do seu jeito', list(['Exiba só os tipos que a oficina faz.', 'Edite nomes, descrições e checklists à vontade.', 'Crie tipos novos em Novo tipo de OS.']))); }, say: ['Exiba só o que a sua oficina faz, ajuste os checklists e crie tipos novos quando precisar.'] },
    ],
  },
  {
    n: 28, file: '28-varias-fotos-na-os', mod: 'producao', title: 'Várias fotos de uma vez na OS', routes: [], start: '/os',
    desc: 'Guardar as fotos do serviço na OS: chegada, andamento e entrega.',
    learn: ['Escolher várias fotos de uma vez', 'Escrever a legenda e confirmar a autorização', 'Ver as fotos em tamanho grande'],
    setup: async (api) => ({ id: await osId(api, 8) }),
    steps: [
      { tag: 'Onde fica', act: async (h, st) => { await h.go(`/os/${st.id}`); await h.spot(h.page.locator('#fotos h2')); }, say: ['Na ficha da OS, desça até o quadro Fotos e documentos da OS.'] },
      { tag: 'Escolher', act: async (h) => { await h.spot(btn(h, 'Adicionar fotos')); await h.page.evaluate(() => window.__av?.click()); await h.sleep(500); await h.unspot(); await h.page.locator('[data-testid=anexos-varios]').setInputFiles(PHOTOS); await h.sleep(1800); }, say: ['Clique em Adicionar fotos. Na janela que abre, segure a tecla Control e clique em cada foto que quiser. Depois clique em Abrir.', 'No celular, use Tirar foto, para a câmera, ou Da galeria, para escolher várias.'] },
      { tag: 'Conferir', act: async (h) => { await h.unspot(); await h.type('Legenda da foto 1', 'Risco na porta', { delay: 60 }); }, say: ['Todas as fotos aparecem para conferir. Se quiser, escreva uma legenda em cada uma. O X vermelho tira a foto da lista.'] },
      { tag: 'Salvar', act: async (h) => { const d = h.page.getByRole('dialog').last(); await h.click(d.getByText(/O cliente autorizou/), { wait: 400 }); await h.click(d.getByRole('button', { name: /^Salvar \d+ anexos$/ }), { wait: 2500 }); }, say: ['Marque que o cliente autorizou as fotos e clique em Salvar. O sistema envia uma por uma e mostra o andamento.'] },
      { tag: 'Ver grande', act: async (h) => { await h.click(h.page.getByRole('button', { name: 'Abrir Risco na porta' }), { wait: 1200 }); await h.click(h.page.getByRole('button', { name: 'Próxima foto' }), { wait: 1200 }); }, say: ['Clique numa foto para ver grande. Use as setas dos lados para passar para a próxima. No celular, arraste o dedo.'] },
      { act: async (h) => { await h.esc(); await h.card(slide('Dicas', 'Fotos protegem você e o cliente', list(['Até 20 fotos por vez e 40 por OS.', 'No computador, dá para arrastar as fotos para o quadro.', 'As fotos ficam menores sozinhas, para não pesar.']))); }, say: ['Fotografe o item na chegada, durante o serviço e na entrega. Isso evita discussão depois.'] },
    ],
  },
  // ───────────────────────── Materiais e compras
  {
    n: 17, file: '17-materiais-e-estoque', mod: 'materiais', title: 'Materiais e estoque', routes: ['/estoque'], start: '/estoque',
    desc: 'Cadastro de materiais, estoque mínimo e movimentações.',
    learn: ['Encontrar um material', 'Cadastrar um material novo', 'Ver o que está abaixo do mínimo'],
    steps: [
      { tag: 'A lista', act: (h) => h.spot(h.page.getByPlaceholder('Nome, código ou código de barras…')), say: ['Em Materiais e estoque ficam as peças e os insumos da oficina, com a quantidade de cada um.'] },
      { tag: 'Abaixo do mínimo', act: async (h) => { await h.unspot(); await h.click(h.page.getByRole('button', { name: /Abaixo do mínimo/ }), { wait: 900 }); }, say: ['O botão Abaixo do mínimo mostra só o que está acabando. É a sua lista de compras.'] },
      { tag: 'Novo material', act: async (h) => { await h.click(btn(h, 'Novo material'), { wait: 900 }); }, say: ['Para cadastrar, clique em Novo material. Informe o nome, a unidade, o custo, o preço de venda e o estoque mínimo.'] },
      { act: (h) => h.spot(h.page.getByRole('dialog').last()), say: ['O estoque mínimo é a quantidade em que você quer ser avisado. Por exemplo: dez discos de corte.'] },
      { act: async (h) => { await h.unspot(); await h.esc(); }, say: ['Lembre: o material usado na OS e na venda de balcão sai do estoque sozinho. E a entrada da nota do fornecedor soma ao estoque.'] },
    ],
  },
  {
    n: 18, file: '18-compras-e-entrada-de-nota', mod: 'materiais', title: 'Compras e entrada da nota do fornecedor', routes: ['/compras', '/estoque/entradas', '/fornecedores'], start: '/compras',
    desc: 'Sugestão de compra, cotação com fornecedores, pedido e entrada no estoque.',
    learn: ['Usar a sugestão de compra', 'Cotar e fazer o pedido', 'Dar entrada na nota do fornecedor'],
    steps: [
      { tag: 'Sugestão', act: (h) => h.spot(h.page.getByRole('button', { name: /Cotar/ }).first()), say: ['Em Compras, a aba Sugestão de compra lista o que está abaixo do mínimo e o que as OS estão precisando.'] },
      { tag: 'Cotação', act: async (h) => { await h.unspot(); await h.click(btn(h, 'Cotações'), { wait: 900 }); }, say: ['Clique em Cotar para pedir preços a vários fornecedores. Em Cotações, você anota os preços e escolhe o melhor.'] },
      { tag: 'Pedido', act: async (h) => { await h.click(btn(h, 'Pedidos de compra'), { wait: 900 }); }, say: ['A cotação fechada vira um Pedido de compra, para mandar ao fornecedor.'] },
      { tag: 'Entrada da nota', act: async (h) => { await h.go('/estoque/entradas/nova'); await h.spot('Itens da nota'); }, say: ['Quando o material chega, use Entrada de materiais. Informe o fornecedor, o número da nota e os itens.'] },
      { act: async (h) => { await h.unspot(); await h.spot(btn(h, 'Dar entrada no estoque')); }, say: ['No fim, clique em Dar entrada no estoque. As quantidades somam ao estoque e a conta a pagar é criada.'] },
    ],
  },

  // ───────────────────────── Financeiro
  {
    n: 19, file: '19-caixa-do-dia', mod: 'financeiro', title: 'Caixa do dia: abrir e fechar', routes: ['/financeiro'], start: '/financeiro',
    desc: 'O primeiro passo do dia para receber e o último para conferir o dinheiro.',
    learn: ['Abrir o caixa com o troco', 'Acompanhar entradas e saídas', 'Fechar e conferir o caixa'],
    steps: [
      { say: ['O caixa do dia guarda tudo o que entrou e saiu da oficina hoje. Para receber, ele precisa estar aberto.'] },
      { tag: 'Abrir o caixa', act: async (h) => { await h.type('Troco inicial', '150', { delay: 120 }); }, say: ['De manhã, informe o troco inicial: o dinheiro que já está na gaveta.'] },
      { act: async (h) => { await h.click(btn(h, 'Abrir caixa'), { wait: 1400 }); }, say: ['Clique em Abrir caixa. Pronto, já dá para receber.'] },
      { tag: 'Durante o dia', act: (h) => h.spot(h.page.locator('main').first()), say: ['Cada pagamento recebido nas OS e nas vendas aparece aqui. Retirou dinheiro para pagar algo? Lance como saída, com o motivo.'] },
      { tag: 'Fechar', act: async (h) => { await h.unspot(); await h.spot(h.page.getByRole('button', { name: /Fechar caixa/ }).first()); }, say: ['No fim do dia, clique em Fechar caixa e conte o dinheiro da gaveta. O sistema mostra se sobrou ou faltou.'] },
      { act: (h) => h.unspot(), say: ['Os caixas anteriores ficam guardados em Fechamentos anteriores, para conferência.'] },
    ],
  },
  {
    n: 20, file: '20-contas-e-gestao-financeira', mod: 'financeiro', title: 'Contas a pagar e a receber', routes: ['/financeiro/gestao'], start: '/financeiro',
    desc: 'Contas, vencimentos, contas bancárias, conciliação do extrato e resultado do mês.',
    learn: ['Ver contas a pagar e a receber', 'Contas bancárias e conciliação', 'O resultado do mês (DRE)'],
    steps: [
      { tag: 'Contas', act: async (h) => { await h.click(btn(h, 'Contas a pagar/receber'), { wait: 1000 }); }, say: ['Em Contas a pagar e receber estão os vencimentos: o que os clientes devem e o que a oficina deve pagar.', 'Pagou ou recebeu? Clique na conta e dê a baixa.'] },
      { tag: 'Fluxo de caixa', act: async (h) => { await h.click(btn(h, 'Fluxo de caixa'), { wait: 1000 }); }, say: ['O Fluxo de caixa mostra, dia a dia, quanto entrou e quanto saiu.'] },
      { tag: 'Bancos', act: async (h) => { await h.go('/financeiro/gestao'); await h.spot(h.page.locator('main h1').first()); }, say: ['Em Gestão financeira ficam o caixa e as contas bancárias, com o saldo de cada uma.'] },
      { tag: 'Conciliação', act: async (h) => { await h.unspot(); await h.click(btn(h, 'Conciliação bancária'), { wait: 1000 }); }, say: ['Na Conciliação bancária você importa o extrato do banco e confere, linha por linha, com os lançamentos do sistema.'] },
      { tag: 'Resultado', act: async (h) => { await h.click(btn(h, 'DRE gerencial'), { wait: 1200 }); }, say: ['O DRE mostra o resultado do mês: o que entrou, os custos, as despesas e quanto sobrou.'] },
    ],
  },
  {
    n: 21, file: '21-relacionamento-e-pos-venda', mod: 'financeiro', title: 'Retornos, pós-venda e cobrança', routes: ['/relacionamento'], start: '/relacionamento',
    desc: 'A lista de clientes para contatar: pós-venda, orçamento sem resposta, garantia e cobrança.',
    learn: ['Os tipos de retorno', 'Falar com o cliente pelo WhatsApp', 'Registrar o contato'],
    steps: [
      { tag: 'A lista', act: (h) => h.spot(h.page.getByRole('button', { name: /Pós-venda/ }).first()), say: ['Em Retornos e pós-venda, o TORVEN monta sozinho a lista de clientes para contatar.', 'Pós-venda, orçamento sem resposta, garantia vencendo, manutenção e cobrança.'] },
      { act: async (h) => { await h.unspot(); await h.click(btn(h, 'Para hoje'), { wait: 800 }); }, say: ['O filtro Para hoje mostra o que precisa ser feito hoje.'] },
      { tag: 'WhatsApp', act: (h) => h.spot(h.page.getByRole('button', { name: 'WhatsApp' }).first()), say: ['Clique em WhatsApp para abrir a conversa com o cliente, com uma mensagem já escrita.'] },
      { tag: 'Registrar', act: async (h) => { await h.unspot(); await h.click(h.page.getByRole('button', { name: 'Registrar contato' }).first(), { wait: 900 }); }, say: ['Depois de falar com o cliente, clique em Registrar contato e anote o que foi conversado. Na pós-venda, dá para guardar a nota que o cliente deu, de zero a dez.'] },
      { act: async (h) => { await h.esc(); }, say: ['Cliente pediu para falar outro dia? Use Reagendar. Assim ninguém fica esquecido.'] },
    ],
  },

  {
    n: 31, file: '31-conferir-extrato-com-as-os', mod: 'financeiro', title: 'Conferir o extrato do banco com as OS', routes: [], start: '/financeiro/gestao?aba=conciliacao',
    desc: 'Importar o extrato do banco e ver quais entradas são pagamentos de ordens de serviço.',
    learn: ['Importar o arquivo do extrato', 'Ver o que é pagamento de OS', 'Receber na OS com um clique'],
    setup: async (api) => {
      const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
      const list = await api('GET', '/orders?limit=60');
      let pick = null;
      for (const o of (list.items || list)) {
        if (!(Number(o.total) > 0) || !o.customer_name || ['cancelada', 'entregue'].includes(o.status)) continue;
        const d = await api('GET', `/orders/${o.id}`);
        if (d.balance > 1) { pick = d; break; }
      }
      const money = (v) => v.toFixed(2).replace('.', ',');
      const csv = ['Data;Histórico;Valor', `07/10/2026;PIX RECEBIDO - ${pick.customer_name.toUpperCase()};${money(pick.balance)}`,
        '07/10/2026;TRANSFERENCIA RECEBIDA;180,00', '08/10/2026;TARIFA PACOTE DE SERVICOS;-29,90'].join('\n');
      const file = path.join(os.tmpdir(), 'extrato-banco.csv');
      fs.writeFileSync(file, csv);
      return { file };
    },
    steps: [
      { tag: 'Onde fica', act: (h) => h.spot(btn(h, 'Conciliação bancária')), say: ['No menu Financeiro, abra Contas, conciliação e DRE, e clique na aba Conciliação bancária.'] },
      { act: async (h) => { await h.unspot(); await h.card(slide('Antes', 'Baixe o extrato no banco', list(['No aplicativo ou site do banco, abra o extrato.', 'Escolha o período e toque em Exportar.', 'Formato OFX (o melhor) ou CSV.']))); }, say: ['Primeiro, baixe o extrato no aplicativo ou no site do banco. Escolha o período e exporte no formato OFX ou CSV.'] },
      { tag: 'Importar', act: async (h, st) => { await h.card(null); await h.click(btn(h, 'Importar extrato'), { wait: 800 }); await h.page.getByLabel('Arquivo do extrato').setInputFiles(st.file); await h.sleep(600); await h.spot(h.page.getByRole('dialog').last()); }, say: ['Clique em Importar extrato, escolha a conta do banco e o arquivo que você baixou.'] },
      { act: async (h) => { await h.unspot(); await h.click(h.page.getByRole('dialog').last().getByRole('button', { name: 'Importar', exact: true }), { wait: 1800 }); await h.spot(h.page.locator('section[aria-label="Conferência com as OS"]')); }, say: ['Clique em Importar. O sistema confere cada entrada do banco com as ordens de serviço.', 'Os quadros mostram o que já é de OS, o que provavelmente é de uma OS e o que ficou sem OS.'] },
      { tag: 'Receber na OS', act: async (h) => { await h.unspot(); await h.spot(h.page.getByRole('button', { name: 'Receber nesta OS' }).first()); }, say: ['Quando o sistema reconhece o nome do cliente ou o número da OS, aparece o botão Receber nesta OS.'] },
      { act: async (h) => { await h.click(h.page.getByRole('button', { name: 'Receber nesta OS' }).first(), { wait: 900 }); await h.spot(h.page.getByRole('button', { name: 'Confirmar recebimento' })); }, say: ['Clique nele, confira a forma de pagamento, como PIX, e clique em Confirmar recebimento.'] },
      { act: async (h) => { await h.click(h.page.getByRole('button', { name: 'Confirmar recebimento' }), { wait: 1500 }); await h.spot(h.page.locator('section[aria-label="Conferência com as OS"] button').last()); }, say: ['Pronto: o pagamento entrou na OS e a linha do banco ficou conferida.', 'O último quadro avisa o que foi recebido no sistema, mas não apareceu no banco. Vale conferir.'] },
      { act: async (h) => { await h.unspot(); await h.card(slide('Dica', 'Errou? Dá para desfazer', list(['A setinha ao lado da linha desfaz.', 'Desfazer tira o pagamento da OS.', 'Entradas sem OS: use Lançar novo.']))); }, say: ['Se conferiu errado, clique na setinha ao lado da linha para desfazer. O pagamento sai da OS.'] },
    ],
  },
  {
    n: 33, file: '33-emitir-nota-fiscal', mod: 'financeiro', title: 'Emitir a nota fiscal da OS', routes: ['/notas'], start: '/notas',
    desc: 'Escolher o CNPJ que emite, conferir a nota e emitir — ou registrar a nota feita no site da prefeitura.',
    learn: ['Abrir a nota de uma OS', 'Escolher o CNPJ que emite', 'Emitir ou informar o número da nota'],
    setup: async (api) => {
      const base = { regime: 'simples', cep: '13015-000', street: 'Rua Barão de Jaguara', number: '1000', district: 'Centro', city: 'Campinas', uf: 'SP', city_code: '3509502', im: '12345', docs: { nfse: true, nfe: false } };
      await api('POST', '/fiscal/emitters', { ...base, name: 'Oficina', cnpj: '12345678000195', razao_social: 'OFICINA DEMONSTRACAO LTDA', provider: 'nfeio', environment: 'homologacao', secrets: { api_key: 'chave-de-exemplo' } });
      await api('POST', '/fiscal/emitters', { ...base, name: 'MEI do João', cnpj: '11222333000181', razao_social: 'JOAO SOLDAS MEI', regime: 'mei', provider: 'manual' });
      const list = await api('GET', '/orders?limit=60');
      for (const o of (list.items || list)) {
        if (o.status === 'cancelada' || !o.customer_id) continue;
        const d = await api('GET', `/orders/${o.id}`);
        if (d.items?.some((i) => i.kind === 'servico' && Number(i.unit_price) > 0)) {
          await api('PUT', `/customers/${d.customer_id}`, { document: '529.982.247-25' });
          return { number: d.number };
        }
      }
      return {};
    },
    steps: [
      { tag: 'Onde fica', act: (h) => h.spot(h.page.getByRole('button', { name: /Emitir nota/ }).first()), say: ['No menu Financeiro e fiscal, abra Notas fiscais. Clique em Emitir nota.', 'Também dá para emitir a nota de dentro da própria OS.'] },
      { act: async (h, st) => { await h.click(h.page.getByRole('button', { name: /Emitir nota/ }).first(), { wait: 900 }); await h.type(h.page.getByPlaceholder('Nº da OS ou cliente…'), String(st.number), { delay: 120 }); await h.sleep(900); await h.click(h.page.getByRole('dialog').locator('button').filter({ hasText: `#${st.number}` }).first(), { wait: 1500 }); }, say: ['Digite o número da OS e clique nela na lista.'] },
      { tag: 'Qual CNPJ', act: (h) => h.spot(h.page.locator('[data-tour="escolher-emitente"]')), say: ['Se a sua empresa tem mais de um CNPJ, escolha aqui qual vai emitir. O emitente padrão já vem marcado.'] },
      { act: async (h) => { await h.unspot(); await h.select('Emitir pelo CNPJ', { index: 1 }); await h.sleep(1200); }, say: ['Neste exemplo, vamos emitir pelo MEI do João.'] },
      { tag: 'Conferir', act: (h) => h.spot(h.page.getByText('Valor da nota').first()), say: ['Confira o cliente, os serviços e o valor da nota. Se aparecer um aviso amarelo, corrija antes de emitir, por exemplo o CPF do cliente.'] },
      { tag: 'Site oficial', act: async (h) => { await h.unspot(); await h.spot(h.page.getByText(/Este CNPJ emite/).first()); }, say: ['Este CNPJ emite no site da prefeitura. O TORVEN separa os dados para você copiar: a descrição, os códigos e o valor.'] },
      { act: async (h) => { await h.unspot(); await h.click(h.page.locator('[data-tour="emitir-nota"]'), { wait: 1500 }); }, say: ['Clique em Preparar para emitir no site. Depois, emita a nota no site da prefeitura, como você já faz.'] },
      { tag: 'Informar o número', act: async (h) => { await h.click(h.page.getByRole('button', { name: /Informar nº/ }).first(), { wait: 900 }); await h.type('Número da nota', '1234', { delay: 140 }); }, say: ['Com a nota emitida, volte aqui e clique em Informar número. Digite o número da nota que saiu no site.'] },
      { act: async (h) => { await h.click(h.page.getByRole('button', { name: 'Registrar nota' }), { wait: 1400 }); await h.spot(h.page.getByText('Registrada manualmente').first()); }, say: ['Clique em Registrar nota. Ela fica marcada como registrada manualmente, ligada à OS.'] },
      { act: async (h) => { await h.unspot(); await h.card(slide('Com integração', 'Quando o emissor está ligado', list(['Clique em Emitir nota.', 'Espere: Processando vira Autorizada.', 'Baixe o PDF e o XML na lista.', 'Errou? Cancelar, com o motivo.']))); }, say: ['Nos CNPJs ligados a um emissor, como Focus ou NFE.io, é só clicar em Emitir nota. A nota fica Processando e logo vira Autorizada.', 'O sistema nunca mostra uma nota como autorizada sem a confirmação da prefeitura ou da SEFAZ.'] },
    ],
  },
  // ───────────────────────── Relatórios
  {
    n: 22, file: '22-relatorios', mod: 'relatorios', title: 'Relatórios: como está a oficina', routes: ['/relatorios'], start: '/relatorios',
    desc: 'Indicadores de gestão, financeiro, produção, comissões e estoque.',
    learn: ['Escolher o período', 'Ler os indicadores de gestão', 'Os outros relatórios'],
    steps: [
      { tag: 'Período', act: (h) => h.spot(btn(h, 'Este mês')), say: ['Primeiro escolha o período: hoje, sete dias, trinta dias, este mês, o mês anterior ou este ano.'] },
      { tag: 'Indicadores', act: async (h) => { await h.unspot(); await h.click(btn(h, 'Este mês'), { wait: 900 }); await h.spot('Funil comercial'); }, say: ['Em Indicadores de gestão você vê o funil comercial: quantas solicitações viraram orçamento e quantos orçamentos viraram OS.'] },
      { act: async (h) => { await h.unspot(); await h.spot('Produtividade por técnico'); }, say: ['Mais abaixo, a produtividade de cada técnico e as ordens de serviço que deram menos lucro.'] },
      { tag: 'Outros relatórios', act: async (h) => { await h.unspot(); await h.top(); await h.click(btn(h, 'Financeiro'), { wait: 1000 }); }, say: ['Nas outras abas: Financeiro, Produção, Comissões e Estoque. Escolha a aba e o período.'] },
    ],
  },

  // ───────────────────────── Configurações e suporte
  {
    n: 23, file: '23-logotipo-e-aparencia', mod: 'config', title: 'Logotipo e cores do sistema', routes: ['/configuracoes', '/conta'], start: '/configuracoes?tab=aparencia',
    desc: 'Colocar o logotipo da sua empresa e escolher as cores e o menu.',
    learn: ['Enviar o logotipo', 'Escolher o formato do logo', 'Cor principal, tema e menu'],
    steps: [
      { tag: 'Logotipo', act: (h) => h.spot(h.page.getByText('Logotipo', { exact: true }).first()), say: ['Em Configurações, na aba Aparência, você coloca o logotipo da sua empresa.'] },
      { act: async (h) => { await h.unspot(); await h.page.getByLabel('Arquivo do logotipo').setInputFiles(LOGO_FILE); await h.sleep(1200); await h.spot(h.page.getByAltText('Logotipo atual')); }, say: ['Clique em Enviar logo e escolha o arquivo da imagem no computador. A imagem aparece inteira, sem cortes.', 'Dica: logo com fundo transparente, em PNG, fica melhor.'] },
      { tag: 'Formato', act: async (h) => { await h.unspot(); await h.click(btn(h, 'Horizontal (largo)'), { wait: 600 }); }, say: ['Escolha o formato. Logo quadrado, como um ícone, ou horizontal, quando ele já tem o nome escrito.'] },
      { tag: 'Cores', act: async (h) => { await h.scroll(380); await h.spot('Cor principal'); }, say: ['Escolha a cor principal do sistema, o tema claro ou escuro, e se o menu fica na lateral ou no alto.', 'À direita, a pré-visualização mostra como vai ficar.'] },
      { act: async (h) => { await h.unspot(); await h.spot(h.page.getByRole('button', { name: 'Salvar alterações' })); }, say: ['Por fim, clique em Salvar alterações, no rodapé. Sem salvar, nada muda.'] },
    ],
  },
  {
    n: 24, file: '24-modelo-da-os-impressa', mod: 'config', title: 'O modelo da OS impressa', routes: ['/configuracoes'], start: '/configuracoes?tab=documentos',
    desc: 'Deixe a OS, o recibo e o orçamento com a cara da sua empresa.',
    learn: ['Cabeçalho, cor e posição do logo', 'Títulos, rodapé e o que aparece', 'Papel A4 ou cupom e número de vias'],
    steps: [
      { tag: 'Pré-visualização', act: (h) => h.spot(h.page.getByLabel('Pré-visualização do documento')), say: ['Em Configurações, Documentos, você ajusta a folha da ordem de serviço. À direita, a pré-visualização muda na hora.'] },
      { tag: 'Cabeçalho e cor', act: async (h) => { await h.unspot(); await h.click(btn(h, 'Faixa colorida'), { wait: 500 }); await h.click(h.page.getByRole('button', { name: 'Cor #1d4ed8' }), { wait: 500 }); await h.click(btn(h, 'Centro'), { wait: 500 }); }, say: ['Escolha o estilo do cabeçalho, a cor de destaque e a posição do logo. Veja a folha mudando à direita.'] },
      { tag: 'Textos', act: async (h) => { await h.type('Linha extra no cabeçalho', 'Soldas especiais e serralheria', { delay: 45 }); await h.type('Rodapé', 'PIX: CNPJ da empresa · @suaoficina', { delay: 45 }); }, say: ['Escreva uma frase para o cabeçalho e um rodapé, por exemplo com o PIX e as redes sociais da oficina.'] },
      { tag: 'O que aparece', act: async (h) => { await h.spot('O que aparece na OS'); }, say: ['Em O que aparece na OS, desmarque o que você não quer imprimir. Por exemplo, o diagnóstico ou os valores.'] },
      { tag: 'Papel e vias', act: async (h) => { await h.unspot(); await h.click(btn(h, '2 vias'), { wait: 600 }); }, say: ['Escolha o papel: A4, ou cupom de 80 milímetros, para impressora térmica. E se quer uma ou duas vias, uma para a oficina e outra para o cliente.'] },
      { act: (h) => h.spot(h.page.getByRole('button', { name: 'Salvar alterações' })), say: ['Clique em Salvar alterações. As próximas impressões já saem no novo modelo.'] },
    ],
  },
  {
    n: 25, file: '25-configuracoes-e-equipe', mod: 'config', title: 'Configurações, equipe e permissões', routes: ['/configuracoes', '/tecnicos', '/servicos'], start: '/configuracoes?tab=empresa',
    desc: 'Dados da empresa, regras das OS, tabela de serviços, técnicos, usuários e perfis de acesso.',
    learn: ['Dados da empresa e regras das OS', 'Serviços e técnicos', 'Usuários e o que cada um pode ver'],
    steps: [
      { tag: 'Empresa', act: (h) => h.spot(h.page.getByLabel('Razão social')), say: ['Em Configurações, a aba Empresa guarda os dados que saem nas impressões: nome, CNPJ, telefone e endereço.'] },
      { tag: 'Regras das OS', act: async (h) => { await h.unspot(); await h.click(h.page.getByRole('tab', { name: 'OS e orçamentos' }).or(btn(h, 'OS e orçamentos')).first(), { wait: 1000 }); await h.spot('Padrões das ordens de serviço'); }, say: ['Em OS e orçamentos ficam as regras: garantia e prazo padrão, pesquisa por placa, ditado por voz e a regra de uma placa por cadastro.'] },
      { tag: 'Serviços', act: async (h) => { await h.unspot(); await h.go('/servicos'); await h.spot(h.page.locator('main h1').first()); }, say: ['A Tabela de serviços tem os serviços com o preço e o custo. É dela que vem o valor que aparece na OS.'] },
      { tag: 'Técnicos', act: async (h) => { await h.unspot(); await h.go('/tecnicos'); await h.spot(h.page.locator('main h1').first()); }, say: ['Em Técnicos você cadastra a equipe, com a cor de cada um na agenda e a comissão.'] },
      { tag: 'Usuários', act: async (h) => { await h.unspot(); await h.go('/configuracoes?tab=equipe'); await h.spot(btn(h, 'Novo acesso')); }, say: ['Cada pessoa deve ter o próprio login. Em Usuários, clique em Novo acesso e escolha o perfil dela.'] },
      { tag: 'Perfis', act: async (h) => { await h.unspot(); await h.go('/configuracoes?tab=perfis'); await h.spot(h.page.getByRole('button', { name: /^Técnico/ }).first()); }, say: ['Em Perfis de acesso você decide o que cada perfil pode ver e fazer. Por exemplo, o técnico não vê o financeiro.'] },
    ],
  },
  {
    n: 32, file: '32-cadastro-fiscal-emitentes', mod: 'config', title: 'Cadastro fiscal: CNPJ, emissor e certificado', routes: ['/configuracoes'], start: '/configuracoes?tab=fiscal',
    desc: 'Cadastrar cada CNPJ que emite nota, escolher a empresa emissora e enviar o certificado digital.',
    learn: ['O que é emitente, emissor e certificado', 'Cadastrar um CNPJ e escolher o emissor', 'Enviar o certificado e testar'],
    setup: async () => ({ pfx: await demoPfx('12345678000195', 'senha123') }),
    steps: [
      { act: (h) => h.card(slide('Três palavras', 'Antes de começar', list(['Emitente: o CNPJ que emite a nota.', 'Emissor: a empresa que transmite a nota (Focus, NFE.io, PlugNotas…).', 'Certificado A1: o arquivo .pfx e a senha, comprados na certificadora.']))), say: ['Três palavras antes de começar. Emitente é o CNPJ que emite a nota.', 'Emissor é a empresa contratada que transmite a nota para a prefeitura. E o certificado A1 é a assinatura digital da empresa: um arquivo com senha.'] },
      { tag: 'Novo emitente', act: async (h) => { await h.card(null); await h.click(h.page.locator('[data-tour="novo-emitente"]'), { wait: 900 }); }, say: ['Em Configurações, na aba Fiscal, clique em Novo emitente.'] },
      { act: async (h) => { await h.click(h.page.getByRole('button', { name: /Copiar os dados da minha empresa/ }), { wait: 600 }); await h.type('Apelido', 'Oficina', { delay: 110 }); await h.type(h.page.getByRole('dialog').getByLabel('CNPJ', { exact: true }), '12345678000195', { delay: 80 }); await h.type('Razão social', 'OFICINA DEMONSTRAÇÃO LTDA', { delay: 40 }); }, say: ['Clique em Copiar os dados da minha empresa: o sistema preenche o endereço. Dê um apelido, como Oficina, e confira o CNPJ e a razão social.'] },
      { tag: 'Escolher o emissor', act: async (h) => { await h.click(h.page.getByRole('button', { name: 'Continuar' }), { wait: 800 }); await h.spot(h.page.locator('[data-tour="emissor-focus"]').locator('..')); }, say: ['Agora escolha a empresa emissora que você contratou. Cada cartão explica onde pegar a chave.', 'Não tem emissor? Escolha Emitir no site da prefeitura. O TORVEN prepara os dados para você copiar.'] },
      { act: async (h) => { await h.unspot(); await h.click(h.page.locator('[data-tour="emissor-nfeio"]'), { wait: 600 }); await h.type(h.page.getByRole('dialog').locator('input[type="password"]').first(), 'chave-de-exemplo', { delay: 45 }); }, say: ['Neste exemplo, NFE.io. Cole a chave que o emissor te deu. Ela fica guardada com segurança e não aparece de novo.'] },
      { act: async (h) => { await h.spot(h.page.getByLabel('Ambiente')); }, say: ['Deixe em Homologação no começo. É o modo de testes: as notas não valem de verdade.'] },
      { tag: 'Impostos', act: async (h) => { await h.unspot(); await h.click(h.page.getByRole('button', { name: 'Continuar' }), { wait: 800 }); await h.spot(h.page.getByLabel('Item LC 116')); }, say: ['Na última parte ficam os códigos dos impostos. Já vêm preenchidos com o mais comum. Confirme com o seu contador.'] },
      { act: async (h) => { await h.unspot(); await h.click(h.page.getByRole('button', { name: /Salvar emitente/ }), { wait: 1400 }); }, say: ['Clique em Salvar emitente.'] },
      { tag: 'Certificado', act: async (h, st) => { await h.spot(h.page.getByText('Arquivo do certificado (.pfx ou .p12)').first().locator('..')); await h.page.locator('input[type="file"][accept*=".pfx"]').first().setInputFiles(st.pfx); await h.sleep(700); }, say: ['Agora o certificado. Clique para escolher o arquivo ponto pfx no computador.'] },
      { act: async (h) => { await h.unspot(); await h.type('Senha do certificado', 'senha123', { delay: 110 }); await h.click(h.page.getByRole('button', { name: /Conferir e guardar/ }), { wait: 1500 }); await h.spot(h.page.getByText(/Válido até/).first()); }, say: ['Digite a senha e clique em Conferir e guardar. O TORVEN confere a senha, o CNPJ e mostra até quando o certificado vale.', 'Perto de vencer, o sistema avisa na tela de notas.'] },
      { tag: 'Enviar e testar', act: async (h) => { await h.unspot(); await h.spot(h.page.locator('[data-tour="enviar-cadastro"]').locator('..')); }, say: ['Por fim, clique em Enviar cadastro ao emissor: ele recebe os dados e o certificado. Depois, Testar conexão confirma que a chave funciona.'] },
      { act: async (h) => { await h.unspot(); await h.card(slide('Vários CNPJs', 'Tem mais de uma empresa?', list(['Clique em Novo emitente para cada CNPJ.', 'Cada um com o seu emissor e certificado.', 'Tornar padrão: o que já vem marcado na nota.']))); }, say: ['Tem mais de um CNPJ, como a oficina e um MEI? Cadastre um emitente para cada um. Na hora de emitir, você escolhe qual usar.'] },
    ],
  },
  {
    n: 29, file: '29-whatsapp-e-agente', mod: 'config', title: 'WhatsApp: ligar o agente e testar', routes: [], start: '/configuracoes?tab=integracoes',
    desc: 'O agente que responde o cliente no WhatsApp: horários de atendimento e teste antes de ligar.',
    learn: ['Onde fica o WhatsApp', 'Dias e horários do agente', 'Testar o agente sem enviar nada'],
    steps: [
      { tag: 'Onde fica', act: (h) => h.spot(h.page.locator('#whatsapp-config h3')), say: ['Em Configurações, na aba Integrações, fica o quadro WhatsApp e agente de atendimento.', 'O agente responde o cliente sozinho: diz como está o serviço pela placa e anota pedidos de serviço e de horário.'] },
      { act: async (h) => { await h.unspot(); await h.card(slide('Uma vez só', 'Ligar o WhatsApp oficial', list(['Usa o WhatsApp oficial da Meta.', 'Quem cuida do computador da empresa faz a ligação.', 'O passo a passo está nesta tela, em Como ligar.']))); }, say: ['Ligar o WhatsApp oficial é feito uma vez só, normalmente por quem cuida do computador da empresa. O passo a passo está nesta tela.'] },
      { tag: 'Horários', act: async (h) => { await h.card(null); await h.spot(h.page.getByRole('group', { name: 'Dias de atendimento' })); }, say: ['Em Agente automático, marque os dias e o horário em que a oficina atende. O agente só oferece horários livres dentro deles.'] },
      { tag: 'Testar', act: async (h) => { await h.unspot(); await h.spot(h.page.locator('#testar-agente')); }, say: ['Antes de ligar, teste o agente aqui embaixo. Nada é enviado de verdade.'] },
      { act: async (h) => { await h.unspot(); for (const t of ['oi', '2']) { await h.type(h.page.getByLabel('Mensagem de teste'), t, { delay: 90 }); await h.page.keyboard.press('Enter'); await h.sleep(1300); } }, say: ['Escreva como se fosse o cliente, por exemplo oi. O agente mostra as opções numeradas. Responda 2 para agendar.'] },
      { act: async (h) => { for (const t of ['BRA2E19', 'troca de óleo']) { await h.type(h.page.getByLabel('Mensagem de teste'), t, { delay: 70 }); await h.page.keyboard.press('Enter'); await h.sleep(1300); } }, say: ['O agente pede a placa e o serviço, e mostra os horários livres.'] },
      { act: async (h) => { for (const t of ['1', 'Maria Souza', '1']) { await h.type(h.page.getByLabel('Mensagem de teste'), t, { delay: 80 }); await h.page.keyboard.press('Enter'); await h.sleep(1300); } }, say: ['O cliente escolhe o horário, diz o nome e confirma. O pedido vai para a equipe aprovar.'] },
      { act: async (h) => { await h.card(slide('Resumo', 'O agente anota, a equipe aprova', list(['Status da OS pela placa.', 'Pedidos de serviço e de horário.', 'Detalhes da OS só para o telefone do cliente.']))); }, say: ['Por segurança, os detalhes da OS só são informados para o telefone cadastrado do cliente.'] },
    ],
  },
  {
    n: 26, file: '26-suporte-e-treinamento', mod: 'config', title: 'Como usar as aulas e pedir ajuda', routes: ['/suporte'], start: '/suporte',
    desc: 'Assistir com legenda e mais devagar, buscar uma aula e falar com o suporte.',
    learn: ['Escolher e assistir uma aula', 'Legenda, velocidade e transcrição', 'Falar com o suporte'],
    steps: [
      { tag: 'As aulas', act: (h) => h.spot(h.page.getByPlaceholder('Buscar aula')), say: ['Na tela Suporte e treinamento ficam todas as aulas, separadas por assunto. Use a busca para achar o que precisa.'] },
      { tag: 'Assistir', act: async (h) => { await h.unspot(); await h.spot(h.page.locator('video').first()); }, say: ['Clique numa aula para assistir. As aulas já assistidas ganham um sinal de visto, e a barra mostra o seu progresso.'] },
      { tag: 'Mais devagar', act: async (h) => { await h.unspot(); const v = h.page.getByRole('button', { name: /0,75/ }).first(); if (await v.count()) await h.spot(v); }, say: ['Achou rápido? Escolha a velocidade zero vírgula setenta e cinco. A aula fica mais devagar.', 'A legenda aparece embaixo, e o texto completo da aula fica logo abaixo do vídeo.'] },
      { tag: 'Ajuda na tela', act: async (h) => { await h.unspot(); await h.go('/os/nova'); await h.spot(h.page.getByRole('link', { name: /Ajuda/ }).first()); }, say: ['Em qualquer tela, o botão Ajuda, no alto, abre a aula daquela tela.'] },
      { tag: 'Suporte', act: async (h) => { await h.unspot(); await h.go('/suporte'); await h.scroll(700); await h.spot('Fale com o suporte'); }, say: ['Ainda com dúvida? Em Fale com o suporte estão o WhatsApp e o e-mail da equipe de atendimento.'] },
    ],
  },
];
