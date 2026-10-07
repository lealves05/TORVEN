// Vídeo-aulas do TORVEN — gerado por tools/videos/gen-training.mjs (não edite à mão).
// Arquivos em /public/treinamento/<file>.mp4 (narração + legenda na imagem), .vtt (transcrição), -capa.jpg e .jpg.
// `routes`: telas em que a aula é sugerida pelo botão Ajuda; `text`: falas (usadas na busca).
export const MODULES = [
  {
    "key": "inicio",
    "label": "Primeiros passos"
  },
  {
    "key": "os",
    "label": "Ordens de serviço"
  },
  {
    "key": "comercial",
    "label": "Clientes, solicitações e orçamentos"
  },
  {
    "key": "producao",
    "label": "Agenda, produção e qualidade"
  },
  {
    "key": "materiais",
    "label": "Materiais e compras"
  },
  {
    "key": "financeiro",
    "label": "Caixa, financeiro e relacionamento"
  },
  {
    "key": "relatorios",
    "label": "Relatórios"
  },
  {
    "key": "config",
    "label": "Configurações e suporte"
  }
];

export const LESSONS = [
  {
    "n": 1,
    "file": "01-conhecendo-o-torven",
    "mod": "inicio",
    "s": 118,
    "title": "Conhecendo o TORVEN",
    "routes": [
      "/"
    ],
    "desc": "A tela inicial, o menu, o botão Novo, a busca e onde pedir ajuda.",
    "learn": [
      "O que a tela inicial mostra",
      "Onde fica cada parte do menu",
      "O botão Novo, a busca e a ajuda"
    ],
    "text": "Esta é a tela inicial do TORVEN. É a primeira tela que aparece quando você entra no sistema. Ela mostra, de forma resumida, como está a sua oficina hoje. Este quadro, Primeiros passos, é uma lista do que falta configurar. Cada item tem um atalho que leva direto para a tela certa. Mais abaixo ficam as próximas entregas, as ordens de serviço por etapa, o estoque baixo e o dinheiro que entrou e saiu. Do lado esquerdo fica o menu. É por ele que você chega em todas as telas do sistema. Clique no nome de um grupo para ver as telas que estão dentro dele. Por exemplo: Ordens de serviço leva para a lista de todos os serviços da oficina. No alto, à direita, o botão laranja Novo é o atalho para começar qualquer coisa: uma ordem de serviço, um orçamento, uma venda. A busca encontra um cliente, uma ordem de serviço ou um material pelo nome. É só clicar nela e escrever. Dica: no teclado, segurar Control e apertar a letra K também abre a busca. Ficou com dúvida? Em Minha conta e ajuda, a tela Suporte e treinamento tem todas as vídeo-aulas, como esta. Agora que você conhece a tela inicial, vamos aprender, na próxima aula, a usar os botões e os campos do sistema."
  },
  {
    "n": 2,
    "file": "02-usando-botoes-e-campos",
    "mod": "inicio",
    "s": 111,
    "title": "Como usar o sistema: clicar, escrever e salvar",
    "routes": [
      "/conta"
    ],
    "desc": "Para quem está começando: o que é clicar, o que é um campo, como salvar, voltar e entender os avisos.",
    "learn": [
      "Clicar e escrever nos campos",
      "Os botões de salvar e cancelar",
      "Os avisos e o botão O que é isso?"
    ],
    "text": "Nesta aula vamos com calma, para quem tem pouca prática com computador. Clicar é apertar uma vez o botão esquerdo do mouse em cima de alguma coisa na tela. No celular, é tocar com o dedo. Este retângulo em branco é um campo. É nele que você escreve. Clique dentro do campo. Quando aparecer um tracinho piscando, é só digitar. Pronto: o texto apareceu no campo. Se errar, apague com a tecla de apagar, que tem uma seta para a esquerda. Alguns campos têm uma setinha. Eles abrem uma lista: você clica e escolhe uma das opções. Viu um ponto de interrogação ao lado do nome de um campo? Clique nele. Ele explica para que serve aquele campo. No rodapé ficam os botões finais. O botão laranja, aqui Abrir OS, salva o que você preencheu. Quando ele está apagado, é porque falta preencher algo obrigatório, como o cliente. O botão Cancelar sai sem salvar nada. Pode usar sem medo quando quiser desistir. Depois de salvar, aparece uma mensagem no canto da tela. Verde quer dizer que deu certo. Vermelho quer dizer que algo faltou, e a mensagem explica o quê. No celular é igual: os botões principais ficam embaixo, e o botão Mais abre o resto do menu."
  },
  {
    "n": 3,
    "file": "03-abrir-os-pela-placa",
    "mod": "os",
    "s": 127,
    "title": "Abrir a OS pela placa do veículo",
    "routes": [
      "/os/nova"
    ],
    "desc": "Digite a placa: o TORVEN mostra o veículo e já coloca o dono como cliente da OS.",
    "learn": [
      "Digitar ou fotografar a placa",
      "Conferir o veículo e o proprietário",
      "Cadastrar um veículo novo pela placa"
    ],
    "text": "Para veículos, a forma mais rápida de abrir uma ordem de serviço é pela placa. Na tela Nova ordem de serviço, o quadro da placa fica logo no começo. Clique no campo Placa e digite a placa, com letras e números. Não precisa apertar nada: a busca é automática. O TORVEN achou o veículo. Confira a marca, o modelo, o ano e a cor. Embaixo aparece o proprietário. Ele já entrou como cliente desta ordem de serviço. Repare que o objeto de serviço também já foi escolhido: é o próprio veículo. No celular, você pode tocar em Foto da placa. A câmera abre, você fotografa a placa e o sistema lê os números sozinho. E se a placa ainda não estiver cadastrada? O sistema avisa e mostra o botão Cadastrar proprietário e veículo. Se o dono for o cliente que já está na OS, deixe marcado Cliente já escolhido. Se for outra pessoa, clique em Outro proprietário. Preencha o nome do dono, a marca e o modelo. O telefone é opcional, mas ajuda muito para avisar o cliente. Clique em Salvar e usar na OS. Pronto: o cliente e o veículo foram cadastrados e já estão nesta ordem de serviço. Agora é só continuar preenchendo a OS, como você vai ver na próxima aula."
  },
  {
    "n": 4,
    "file": "04-abrir-ordem-de-servico",
    "mod": "os",
    "s": 126,
    "title": "Abrir uma ordem de serviço passo a passo",
    "routes": [
      "/os/nova"
    ],
    "desc": "Cliente, objeto, relato do problema, serviço com valor, técnico, prazo e garantia.",
    "learn": [
      "Escolher o cliente e o objeto",
      "Escrever o problema e escolher o serviço",
      "Técnico, prazo e abrir a OS"
    ],
    "text": "Ordem de serviço, ou OS, é a ficha de cada trabalho da oficina. Ela acompanha o serviço desde a chegada até a entrega. Primeiro, o cliente. Clique no campo Cliente e escreva o começo do nome. Depois clique no nome certo na lista. Cliente novo? Na lista aparece a opção de cadastrar na hora. Agora o objeto de serviço: o equipamento, a peça ou o veículo que o cliente trouxe. Escolha na lista ou cadastre um novo. No campo Problema relatado, escreva o que o cliente contou, com as palavras dele. Isso evita mal-entendidos depois. Em Acessórios deixados, anote o que veio junto. Assim nada se perde na hora da entrega. Em Serviços e materiais, escolha o serviço principal. O valor da tabela aparece sozinho ao lado. Precisa cobrar diferente? Clique no valor e escreva o novo. O valor da tabela continua guardado, caso queira voltar a ele. À direita, em Execução, escolha o técnico, a prioridade, o prazo de entrega e os dias de garantia. O prazo e a garantia já vêm preenchidos com o padrão da oficina. Por fim, clique em Abrir OS. A ordem de serviço ganha um número e abre a ficha completa. Guarde esse número: é por ele que você e o cliente vão encontrar o serviço depois."
  },
  {
    "n": 5,
    "file": "05-falar-em-vez-de-digitar",
    "mod": "os",
    "s": 116,
    "title": "Falar em vez de digitar: ditado e comandos de voz",
    "routes": [
      "/os/"
    ],
    "desc": "O microfone dentro dos campos escreve o que você fala. O botão Voz abre e anota OS falando.",
    "learn": [
      "Ditar o relato pelo microfone do campo",
      "Falar vírgula, ponto final e nova linha",
      "Usar o botão Voz para abrir uma OS"
    ],
    "text": "Não gosta de digitar? Dentro dos campos de texto existe um microfone, no canto direito. Ele escreve no campo tudo o que você falar. Clique no microfone. A borda do campo fica vermelha: é sinal de que o sistema está ouvindo. Fale com calma, perto do aparelho. Para pôr pontuação, fale a palavra: vírgula, ponto final ou nova linha. Veja: o texto apareceu, com a vírgula e o ponto final. Para parar de ouvir, toque no quadradinho vermelho, ou espere alguns segundos em silêncio. Funciona em qualquer campo que tenha o microfone: acessórios, estado do item, diagnóstico e observações. Na primeira vez, o navegador pergunta se pode usar o microfone. Clique em Permitir. Isso só acontece uma vez. No alto da tela fica o botão Voz. Com ele você dá ordens ao sistema, como: abrir ordem de serviço para Ana Paula, problema portão arrastando. O sistema mostra o que entendeu e só faz alguma coisa depois que você confirma. Nada é salvo sem a sua confirmação. Se o sistema entender errado, é só corrigir o texto no campo, como em qualquer escrita."
  },
  {
    "n": 6,
    "file": "06-acompanhar-a-os",
    "mod": "os",
    "s": 111,
    "title": "Acompanhar a OS: etapas, diagnóstico e itens",
    "routes": [
      "/os"
    ],
    "desc": "O quadro de etapas, a ficha da OS, o diagnóstico, os serviços e materiais e o histórico.",
    "learn": [
      "O caminho da OS, etapa por etapa",
      "Escrever o diagnóstico e lançar itens",
      "O histórico e o aviso ao cliente"
    ],
    "text": "Toda ordem de serviço passa por etapas: recebida, em diagnóstico, aguardando aprovação, em execução, pronta e entregue. A tela Ordens de serviço mostra um quadro com uma coluna para cada etapa. Em cada coluna, o botão O que é isso? explica a etapa, e o botão de baixo leva a OS para a etapa seguinte. Para ver tudo sobre um serviço, clique no cartão dele. A ficha da OS abre. No alto, a linha de etapas mostra onde o serviço está. A etapa colorida é a etapa atual. Em Diagnóstico e execução, o técnico escreve o que encontrou e, no final, o que foi feito. Pode usar o microfone para ditar. Em Serviços e materiais ficam os serviços cobrados e as peças usadas. As peças saem do estoque automaticamente. Embaixo de cada preço aparece o custo e a margem, só para quem tem permissão de ver valores. O Histórico guarda tudo o que aconteceu: quem mudou a etapa, quando, e as anotações do atendimento. O botão WhatsApp, no alto, abre uma mensagem pronta para avisar o cliente sobre o andamento. Quando o serviço terminar, use o botão Marcar pronta. Na próxima aula, você aprende a entregar e receber."
  },
  {
    "n": 7,
    "file": "07-entregar-e-receber",
    "mod": "os",
    "s": 81,
    "title": "Entregar a OS e receber o pagamento",
    "routes": [
      "/os/"
    ],
    "desc": "Do serviço pronto à entrega: receber em dinheiro, PIX, cartão ou na maquininha.",
    "learn": [
      "Abrir a OS pronta para entrega",
      "Receber o pagamento",
      "Confirmar a entrega ao cliente"
    ],
    "text": "Esta ordem de serviço está pronta para entrega. É o momento de chamar o cliente. Clique em Entregar. Se ainda falta receber, o sistema mostra o valor em aberto. Escolha como o cliente vai pagar: dinheiro, PIX, cartão de débito ou de crédito. Se for dividido, dá para usar mais de uma forma. Em dinheiro, informe o valor recebido e o sistema calcula o troco. Clique em Receber e entregar. O pagamento entra no caixa do dia e a OS passa para entregue. Se a sua oficina usa maquininha integrada, o valor vai direto para ela. O sistema só considera pago depois que a maquininha confirma. Pagou uma parte só? Use Entregar e deixar a receber. O saldo fica em contas a receber, e o sistema lembra você de cobrar."
  },
  {
    "n": 8,
    "file": "08-imprimir-os-e-recibo",
    "mod": "os",
    "s": 81,
    "title": "Imprimir a OS e o recibo",
    "routes": [
      "/imprimir/"
    ],
    "desc": "A OS para o cliente assinar, o recibo e como salvar em PDF.",
    "learn": [
      "Imprimir a ordem de serviço",
      "Imprimir o recibo",
      "Salvar em PDF para mandar pelo WhatsApp"
    ],
    "text": "Na ficha da OS, o botão Imprimir fica no alto, junto dos outros botões. Imprima na entrada do serviço, para o cliente conferir e assinar. Esta é a ordem de serviço impressa: os dados da oficina, o cliente, o equipamento, o problema, os itens e as assinaturas. Clique em Imprimir ou salvar PDF. A janela de impressão do computador vai abrir. Quer mandar pelo WhatsApp em vez de imprimir? Na janela de impressão, em Destino, escolha Salvar como PDF. Depois da entrega, você também pode imprimir o recibo, com os pagamentos recebidos. A aparência da folha, como o logotipo, as cores e os campos que aparecem, é ajustada em Configurações, Documentos. Há uma aula só sobre isso."
  },
  {
    "n": 9,
    "file": "09-garantia-e-retorno",
    "mod": "os",
    "s": 66,
    "title": "Garantia: quando o cliente volta",
    "routes": [
      "/garantias"
    ],
    "desc": "Abrir uma garantia a partir da OS entregue e acompanhar o atendimento.",
    "learn": [
      "Onde ver a garantia de uma OS",
      "Abrir o atendimento de garantia",
      "Acompanhar as garantias abertas"
    ],
    "text": "Toda ordem de serviço entregue tem um prazo de garantia. Ele aparece na própria ficha da OS. O cliente voltou com o mesmo problema? Abra a OS antiga e clique em Abrir garantia. Escreva o que o cliente relatou. O sistema já sabe qual foi o serviço e até quando vai a garantia. Na tela Garantias ficam todos os atendimentos de garantia, com a situação de cada um. Assim você sabe quantos serviços voltaram e pode melhorar o que for preciso."
  },
  {
    "n": 10,
    "file": "10-venda-de-balcao",
    "mod": "os",
    "s": 73,
    "title": "Venda de balcão",
    "routes": [
      "/venda"
    ],
    "desc": "Vender peças e serviços rápidos sem abrir uma ordem de serviço.",
    "learn": [
      "Adicionar os itens vendidos",
      "Cliente opcional",
      "Finalizar e receber"
    ],
    "text": "A venda de balcão é para vendas rápidas, como um disco de corte ou um eletrodo, sem precisar abrir uma ordem de serviço. Clique no campo Adicionar e escreva o nome do produto. A lista mostra o que tem no estoque. A lista tem duas abas: Serviços e Materiais. Clique em Materiais e depois no produto certo. Ele entra na venda com a quantidade um. Para mudar a quantidade, é só digitar no campo Qtd. O cliente é opcional. Se quiser o nome no recibo, escolha o cliente aqui. Clique em Finalizar venda e escolha a forma de pagamento. O estoque é baixado e o dinheiro entra no caixa. Lembre: para vender, o caixa do dia precisa estar aberto. A aula de caixa mostra como abrir."
  },
  {
    "n": 11,
    "file": "11-clientes-e-veiculos",
    "mod": "comercial",
    "s": 126,
    "title": "Cadastrar clientes e veículos",
    "routes": [
      "/clientes"
    ],
    "desc": "Pessoa física ou empresa, contatos, endereço e vários veículos no mesmo cadastro.",
    "learn": [
      "Cadastrar um cliente novo",
      "Incluir um ou mais veículos",
      "Por que cada placa tem um só dono"
    ],
    "text": "Na tela Clientes e veículos ficam todos os seus clientes. Use a busca para achar pelo nome, telefone ou documento. Para cadastrar, clique em Novo cliente. Escolha pessoa física, para uma pessoa, ou pessoa jurídica, para uma empresa. Escreva o nome e o celular. O celular é importante: é por ele que você avisa que o serviço ficou pronto. Só o nome é obrigatório. O resto pode ser completado depois. Na parte Veículos, clique em Adicionar veículo e preencha a placa, a marca, o modelo e o ano. O cliente tem mais de um veículo? Clique de novo em Adicionar veículo. Para tirar um veículo, use a lixeira vermelha. Clique em Salvar. A ficha do cliente abre, com os veículos e o histórico de serviços. Cada placa só pode estar em um cadastro. Se você digitar uma placa que já existe, aparece o aviso: já cadastrado para, e o nome do dono. Assim não existem dois cadastros para o mesmo carro. Essa regra pode ser desligada em Configurações, se a sua oficina precisar. Por exemplo, para frotas."
  },
  {
    "n": 12,
    "file": "12-solicitacao-e-visita",
    "mod": "comercial",
    "s": 95,
    "title": "Solicitação do cliente e visita técnica",
    "routes": [
      "/solicitacoes"
    ],
    "desc": "Anotar o pedido que chegou por telefone ou WhatsApp e agendar a visita para ver o serviço.",
    "learn": [
      "Registrar a solicitação",
      "Acompanhar pelas situações",
      "Agendar a visita técnica"
    ],
    "text": "Solicitação é o pedido do cliente antes de você ver o serviço. Por exemplo: o cliente ligou dizendo que o portão não fecha. No alto, cada botão é uma situação: nova, em triagem, visita agendada, diagnosticada e orçada. Clique para filtrar. Para registrar, clique em Nova solicitação, no alto, à direita. Diga por onde o pedido chegou, o nome e o telefone de quem pediu. Se o cliente já é cadastrado, escolha no campo Cliente. Escreva um resumo curto e, embaixo, os detalhes que o cliente contou. Pode usar o microfone para ditar. Clique em Salvar solicitação. Ela ganha um número e entra na lista. Precisa ir até o local? Use Agendar visita. Escolha o técnico, o dia e o horário. A visita aparece na agenda dele. Depois da visita, registre o diagnóstico na própria solicitação. Com ele, você monta o orçamento, como mostra a próxima aula."
  },
  {
    "n": 13,
    "file": "13-orcamento-e-aprovacao",
    "mod": "comercial",
    "s": 89,
    "title": "Orçamento e aprovação pelo cliente",
    "routes": [
      "/orcamentos"
    ],
    "desc": "Montar o orçamento, enviar o link para o cliente aprovar e transformar em OS.",
    "learn": [
      "Montar o orçamento com itens",
      "Enviar o link para aprovação",
      "Transformar o orçamento aprovado em OS"
    ],
    "text": "Em Novo orçamento, escolha o cliente e dê um título que o cliente entenda. Em Itens, escreva o nome do serviço ou do material e clique nele na lista. O preço da tabela entra sozinho e pode ser mudado. Em Condições ficam a validade, o prazo de execução, a garantia e a forma de pagamento. Os textos padrão já vêm preenchidos. Clique em Salvar orçamento. Agora envie para o cliente. O orçamento gera um link: o cliente abre no celular, confere e aprova com um toque. Quando o cliente aprova, o orçamento muda de situação e aparece o botão para gerar a ordem de serviço, já com os itens. O cliente pediu mudança? Crie uma revisão. O sistema guarda as versões anteriores."
  },
  {
    "n": 14,
    "file": "14-agenda",
    "mod": "producao",
    "s": 60,
    "title": "Agenda da equipe",
    "routes": [
      "/agenda"
    ],
    "desc": "Visitas, execuções e entregas de cada técnico, dia a dia.",
    "learn": [
      "Ler a agenda da semana",
      "Agendar um compromisso",
      "Evitar horários em conflito"
    ],
    "text": "A agenda mostra a semana da equipe. Cada quadro é um compromisso: visita, execução de OS ou entrega. Use as setas para ir para a semana anterior ou a próxima. O botão Hoje volta para a semana atual. Para marcar, clique em Agendar. Escolha o tipo, o técnico, o dia e o horário. Se for de uma OS, escolha a OS também. Se o técnico já tiver outro compromisso no mesmo horário, o sistema avisa antes de salvar. Cada técnico também vê os próprios compromissos na tela Meu trabalho, inclusive pelo celular."
  },
  {
    "n": 15,
    "file": "15-producao-e-horas",
    "mod": "producao",
    "s": 72,
    "title": "Painel de produção e horas trabalhadas",
    "routes": [
      "/producao",
      "/meu-trabalho"
    ],
    "desc": "Quem está trabalhando em quê, o cronômetro de horas e a folha de horas.",
    "learn": [
      "Ler o painel de produção",
      "Iniciar e encerrar o cronômetro",
      "Conferir a folha de horas"
    ],
    "text": "O Painel de produção mostra os serviços em andamento e quem está trabalhando em cada um, agora. Dentro da OS, em Execução e horas, fica o cronômetro do técnico. Ao começar o trabalho, clique em Iniciar. Ao parar, clique em Encerrar. O sistema conta o tempo sozinho. Esqueceu de ligar? Use Lançar manual e informe o início e o fim. Na aba Folha de horas, você confere as horas de cada técnico no período. Elas entram no custo da OS e nas comissões. O técnico usa a tela Meu trabalho, no celular: lá estão os serviços dele, a agenda do dia e o botão do cronômetro."
  },
  {
    "n": 16,
    "file": "16-qualidade-e-checklist",
    "mod": "producao",
    "s": 78,
    "title": "Qualidade: checklist de inspeção",
    "routes": [
      "/os/"
    ],
    "desc": "Conferir o serviço com uma lista antes de entregar ao cliente.",
    "learn": [
      "Abrir a inspeção final",
      "Marcar cada item da lista",
      "Aprovar ou reprovar o serviço"
    ],
    "text": "Na ficha da OS, em Qualidade e checklists, ficam as listas de conferência do serviço. Antes de entregar, clique em Inspeção final. Abre uma lista com o que deve ser conferido. Para cada item, clique em OK se está certo, em Não conforme se tem problema, ou em N/A quando não se aplica. No fim, escolha Aprovada, Aprovada com ressalva ou Reprovada, e clique em Registrar. Reprovado, o serviço volta para a execução. As listas são da sua oficina. Você muda os itens em Configurações, e pode exigir a inspeção aprovada antes da entrega. Também dá para usar a lista de recebimento, na chegada do equipamento, para registrar como ele chegou."
  },
  {
    "n": 17,
    "file": "17-materiais-e-estoque",
    "mod": "materiais",
    "s": 61,
    "title": "Materiais e estoque",
    "routes": [
      "/estoque"
    ],
    "desc": "Cadastro de materiais, estoque mínimo e movimentações.",
    "learn": [
      "Encontrar um material",
      "Cadastrar um material novo",
      "Ver o que está abaixo do mínimo"
    ],
    "text": "Em Materiais e estoque ficam as peças e os insumos da oficina, com a quantidade de cada um. O botão Abaixo do mínimo mostra só o que está acabando. É a sua lista de compras. Para cadastrar, clique em Novo material. Informe o nome, a unidade, o custo, o preço de venda e o estoque mínimo. O estoque mínimo é a quantidade em que você quer ser avisado. Por exemplo: dez discos de corte. Lembre: o material usado na OS e na venda de balcão sai do estoque sozinho. E a entrada da nota do fornecedor soma ao estoque."
  },
  {
    "n": 18,
    "file": "18-compras-e-entrada-de-nota",
    "mod": "materiais",
    "s": 65,
    "title": "Compras e entrada da nota do fornecedor",
    "routes": [
      "/compras",
      "/estoque/entradas",
      "/fornecedores"
    ],
    "desc": "Sugestão de compra, cotação com fornecedores, pedido e entrada no estoque.",
    "learn": [
      "Usar a sugestão de compra",
      "Cotar e fazer o pedido",
      "Dar entrada na nota do fornecedor"
    ],
    "text": "Em Compras, a aba Sugestão de compra lista o que está abaixo do mínimo e o que as OS estão precisando. Clique em Cotar para pedir preços a vários fornecedores. Em Cotações, você anota os preços e escolhe o melhor. A cotação fechada vira um Pedido de compra, para mandar ao fornecedor. Quando o material chega, use Entrada de materiais. Informe o fornecedor, o número da nota e os itens. No fim, clique em Dar entrada no estoque. As quantidades somam ao estoque e a conta a pagar é criada."
  },
  {
    "n": 19,
    "file": "19-caixa-do-dia",
    "mod": "financeiro",
    "s": 63,
    "title": "Caixa do dia: abrir e fechar",
    "routes": [
      "/financeiro"
    ],
    "desc": "O primeiro passo do dia para receber e o último para conferir o dinheiro.",
    "learn": [
      "Abrir o caixa com o troco",
      "Acompanhar entradas e saídas",
      "Fechar e conferir o caixa"
    ],
    "text": "O caixa do dia guarda tudo o que entrou e saiu da oficina hoje. Para receber, ele precisa estar aberto. De manhã, informe o troco inicial: o dinheiro que já está na gaveta. Clique em Abrir caixa. Pronto, já dá para receber. Cada pagamento recebido nas OS e nas vendas aparece aqui. Retirou dinheiro para pagar algo? Lance como saída, com o motivo. No fim do dia, clique em Fechar caixa e conte o dinheiro da gaveta. O sistema mostra se sobrou ou faltou. Os caixas anteriores ficam guardados em Fechamentos anteriores, para conferência."
  },
  {
    "n": 20,
    "file": "20-contas-e-gestao-financeira",
    "mod": "financeiro",
    "s": 68,
    "title": "Contas a pagar e a receber",
    "routes": [
      "/financeiro/gestao"
    ],
    "desc": "Contas, vencimentos, contas bancárias, conciliação do extrato e resultado do mês.",
    "learn": [
      "Ver contas a pagar e a receber",
      "Contas bancárias e conciliação",
      "O resultado do mês (DRE)"
    ],
    "text": "Em Contas a pagar e receber estão os vencimentos: o que os clientes devem e o que a oficina deve pagar. Pagou ou recebeu? Clique na conta e dê a baixa. O Fluxo de caixa mostra, dia a dia, quanto entrou e quanto saiu. Em Gestão financeira ficam o caixa e as contas bancárias, com o saldo de cada uma. Na Conciliação bancária você importa o extrato do banco e confere, linha por linha, com os lançamentos do sistema. O DRE mostra o resultado do mês: o que entrou, os custos, as despesas e quanto sobrou."
  },
  {
    "n": 21,
    "file": "21-relacionamento-e-pos-venda",
    "mod": "financeiro",
    "s": 64,
    "title": "Retornos, pós-venda e cobrança",
    "routes": [
      "/relacionamento"
    ],
    "desc": "A lista de clientes para contatar: pós-venda, orçamento sem resposta, garantia e cobrança.",
    "learn": [
      "Os tipos de retorno",
      "Falar com o cliente pelo WhatsApp",
      "Registrar o contato"
    ],
    "text": "Em Retornos e pós-venda, o TORVEN monta sozinho a lista de clientes para contatar. Pós-venda, orçamento sem resposta, garantia vencendo, manutenção e cobrança. O filtro Para hoje mostra o que precisa ser feito hoje. Clique em WhatsApp para abrir a conversa com o cliente, com uma mensagem já escrita. Depois de falar com o cliente, clique em Registrar contato e anote o que foi conversado. Na pós-venda, dá para guardar a nota que o cliente deu, de zero a dez. Cliente pediu para falar outro dia? Use Reagendar. Assim ninguém fica esquecido."
  },
  {
    "n": 22,
    "file": "22-relatorios",
    "mod": "relatorios",
    "s": 56,
    "title": "Relatórios: como está a oficina",
    "routes": [
      "/relatorios"
    ],
    "desc": "Indicadores de gestão, financeiro, produção, comissões e estoque.",
    "learn": [
      "Escolher o período",
      "Ler os indicadores de gestão",
      "Os outros relatórios"
    ],
    "text": "Primeiro escolha o período: hoje, sete dias, trinta dias, este mês, o mês anterior ou este ano. Em Indicadores de gestão você vê o funil comercial: quantas solicitações viraram orçamento e quantos orçamentos viraram OS. Mais abaixo, a produtividade de cada técnico e as ordens de serviço que deram menos lucro. Nas outras abas: Financeiro, Produção, Comissões e Estoque. Escolha a aba e o período."
  },
  {
    "n": 23,
    "file": "23-logotipo-e-aparencia",
    "mod": "config",
    "s": 67,
    "title": "Logotipo e cores do sistema",
    "routes": [
      "/configuracoes",
      "/conta"
    ],
    "desc": "Colocar o logotipo da sua empresa e escolher as cores e o menu.",
    "learn": [
      "Enviar o logotipo",
      "Escolher o formato do logo",
      "Cor principal, tema e menu"
    ],
    "text": "Em Configurações, na aba Aparência, você coloca o logotipo da sua empresa. Clique em Enviar logo e escolha o arquivo da imagem no computador. A imagem aparece inteira, sem cortes. Dica: logo com fundo transparente, em PNG, fica melhor. Escolha o formato. Logo quadrado, como um ícone, ou horizontal, quando ele já tem o nome escrito. Escolha a cor principal do sistema, o tema claro ou escuro, e se o menu fica na lateral ou no alto. À direita, a pré-visualização mostra como vai ficar. Por fim, clique em Salvar alterações, no rodapé. Sem salvar, nada muda."
  },
  {
    "n": 24,
    "file": "24-modelo-da-os-impressa",
    "mod": "config",
    "s": 86,
    "title": "O modelo da OS impressa",
    "routes": [
      "/configuracoes"
    ],
    "desc": "Deixe a OS, o recibo e o orçamento com a cara da sua empresa.",
    "learn": [
      "Cabeçalho, cor e posição do logo",
      "Títulos, rodapé e o que aparece",
      "Papel A4 ou cupom e número de vias"
    ],
    "text": "Em Configurações, Documentos, você ajusta a folha da ordem de serviço. À direita, a pré-visualização muda na hora. Escolha o estilo do cabeçalho, a cor de destaque e a posição do logo. Veja a folha mudando à direita. Escreva uma frase para o cabeçalho e um rodapé, por exemplo com o PIX e as redes sociais da oficina. Em O que aparece na OS, desmarque o que você não quer imprimir. Por exemplo, o diagnóstico ou os valores. Escolha o papel: A4, ou cupom de 80 milímetros, para impressora térmica. E se quer uma ou duas vias, uma para a oficina e outra para o cliente. Clique em Salvar alterações. As próximas impressões já saem no novo modelo."
  },
  {
    "n": 25,
    "file": "25-configuracoes-e-equipe",
    "mod": "config",
    "s": 82,
    "title": "Configurações, equipe e permissões",
    "routes": [
      "/configuracoes",
      "/tecnicos",
      "/servicos"
    ],
    "desc": "Dados da empresa, regras das OS, tabela de serviços, técnicos, usuários e perfis de acesso.",
    "learn": [
      "Dados da empresa e regras das OS",
      "Serviços e técnicos",
      "Usuários e o que cada um pode ver"
    ],
    "text": "Em Configurações, a aba Empresa guarda os dados que saem nas impressões: nome, CNPJ, telefone e endereço. Em OS e orçamentos ficam as regras: garantia e prazo padrão, pesquisa por placa, ditado por voz e a regra de uma placa por cadastro. A Tabela de serviços tem os serviços com o preço e o custo. É dela que vem o valor que aparece na OS. Em Técnicos você cadastra a equipe, com a cor de cada um na agenda e a comissão. Cada pessoa deve ter o próprio login. Em Usuários, clique em Novo acesso e escolha o perfil dela. Em Perfis de acesso você decide o que cada perfil pode ver e fazer. Por exemplo, o técnico não vê o financeiro."
  },
  {
    "n": 26,
    "file": "26-suporte-e-treinamento",
    "mod": "config",
    "s": 72,
    "title": "Como usar as aulas e pedir ajuda",
    "routes": [
      "/suporte"
    ],
    "desc": "Assistir com legenda e mais devagar, buscar uma aula e falar com o suporte.",
    "learn": [
      "Escolher e assistir uma aula",
      "Legenda, velocidade e transcrição",
      "Falar com o suporte"
    ],
    "text": "Na tela Suporte e treinamento ficam todas as aulas, separadas por assunto. Use a busca para achar o que precisa. Clique numa aula para assistir. As aulas já assistidas ganham um sinal de visto, e a barra mostra o seu progresso. Achou rápido? Escolha a velocidade zero vírgula setenta e cinco. A aula fica mais devagar. A legenda aparece embaixo, e o texto completo da aula fica logo abaixo do vídeo. Em qualquer tela, o botão Ajuda, no alto, abre a aula daquela tela. Ainda com dúvida? Em Fale com o suporte estão o WhatsApp e o e-mail da equipe de atendimento."
  }
];

export const TOTAL_SECONDS = 2214;

const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
export const videoUrl = (l) => `${base}/treinamento/${l.file}.mp4`;
export const posterUrl = (l) => `${base}/treinamento/${l.file}-capa.jpg`;
export const thumbUrl = (l) => `${base}/treinamento/${l.file}.jpg`;
export const captionsUrl = (l) => `${base}/treinamento/${l.file}.vtt`;
export const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Aula sugerida para a tela atual (a rota mais específica que combina). */
export function lessonFor(pathname) {
  let best = null; let len = -1;
  for (const l of LESSONS) {
    for (const r of l.routes) {
      const ok = r === '/' ? pathname === '/' : r.endsWith('/') ? pathname.startsWith(r) && pathname.length > r.length : pathname === r || pathname.startsWith(`${r}/`);
      if (ok && r.length > len) { best = l; len = r.length; }
    }
  }
  return best;
}
