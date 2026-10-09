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
    "s": 155,
    "title": "Abrir a OS pela placa do veículo",
    "routes": [
      "/os/nova"
    ],
    "desc": "Digite a placa: o TORVEN mostra o veículo e já coloca o dono como cliente da OS.",
    "learn": [
      "Digitar ou fotografar a placa",
      "Conferir o veículo e o proprietário",
      "Cadastrar um veículo novo com a Tabela FIPE (grátis)"
    ],
    "text": "Para veículos, a forma mais rápida de abrir uma ordem de serviço é pela placa. Na tela Nova ordem de serviço, o quadro da placa fica logo no começo. Clique no campo Placa e digite a placa, com letras e números. Não precisa apertar nada: a busca é automática. O TORVEN achou o veículo. Confira a marca, o modelo, o ano e a cor. Embaixo aparece o proprietário. Ele já entrou como cliente desta ordem de serviço. Repare que o objeto de serviço também já foi escolhido: é o próprio veículo. No celular, você pode tocar em Foto da placa. A câmera abre, você fotografa a placa e o sistema lê os números sozinho. E se a placa ainda não estiver cadastrada? O sistema avisa e mostra o botão Cadastrar proprietário e veículo. Se o dono for o cliente que já está na OS, deixe marcado Cliente já escolhido. Se for outra pessoa, clique em Outro proprietário. Preencha o nome do dono. O telefone é opcional, mas ajuda muito para avisar o cliente. Para o veículo, use a Tabela FIPE, que é grátis. Digite o começo da marca e clique nela. Digite parte do modelo, por exemplo kwid, e clique no modelo certo. Clique no ano. Pronto: marca, modelo e ano foram preenchidos, e ainda aparece o valor da tabela FIPE. Só falta a cor. Clique em Salvar e usar na OS. Pronto: o cliente e o veículo foram cadastrados e já estão nesta ordem de serviço. Agora é só continuar preenchendo a OS, como você vai ver na próxima aula."
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
    "n": 35,
    "file": "35-os-entregues-e-os-completa",
    "mod": "os",
    "s": 107,
    "title": "OS entregues e impressão da OS completa",
    "routes": [
      "/os"
    ],
    "desc": "Encontrar as ordens de serviço já entregues e imprimir a OS completa, com serviços, materiais, horas e checklists.",
    "learn": [
      "Abrir a aba Entregues",
      "Filtrar por período, cliente ou placa",
      "Imprimir a OS completa"
    ],
    "text": "Na tela Ordens de serviço, ao lado de Quadro e Lista, fica a aba Entregues. Ela mostra só as ordens de serviço que já foram entregues ao cliente. Escolha o período da entrega: hoje, sete dias, este mês, o mês anterior ou este ano. Também dá para digitar as datas. Em cima aparecem os totais do período: quantas OS foram entregues, o valor, o que já foi recebido e o que ainda falta receber. Para achar uma OS, digite o número, o nome do cliente ou a placa no campo de busca. Em cada linha tem o botão OS completa. Ele abre a impressão com tudo o que aconteceu na ordem de serviço. A OS completa traz os dados do cliente e do veículo, as datas, os serviços e os materiais apontados, com quantidade e valor. Mais abaixo vêm os totais, as horas apontadas pelos técnicos, os checklists, os pagamentos, as fotos e o histórico. Clique em Imprimir ou salvar PDF. Para guardar no computador ou mandar ao cliente, escolha Salvar como PDF. O mesmo botão OS completa também fica dentro de cada ordem de serviço, ao lado de Imprimir."
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
    "n": 30,
    "file": "30-pedidos-do-whatsapp",
    "mod": "comercial",
    "s": 97,
    "title": "Pedidos do WhatsApp: aprovar e responder",
    "routes": [
      "/whatsapp"
    ],
    "desc": "Aprovar os pedidos que o agente anotou no WhatsApp e conversar com o cliente.",
    "learn": [
      "Ver os pedidos que chegaram",
      "Aprovar: abrir a OS e marcar o horário",
      "Ler e responder as conversas"
    ],
    "text": "No menu Atendimento, clique em WhatsApp. Aqui chegam os pedidos que o agente anotou na conversa com o cliente. Cada cartão mostra o nome do cliente, a placa, o serviço e o horário que ele pediu. Para aceitar, clique em Aprovar. Se quiser, escolha o técnico e confira o dia e a hora. Deixe ligado Avisar o cliente pelo WhatsApp. Assim ele recebe a confirmação com o número da OS. Clique em Aprovar e abrir OS. O sistema abre a OS, marca o horário na agenda e avisa o cliente. Na aba Conversas você lê tudo o que o cliente e o agente escreveram. Quer falar você mesmo? Clique em Assumir conversa e escreva embaixo. O agente para de responder nessa conversa. Depois, clique em Devolver ao agente. O agente nunca abre OS sozinho: ele anota, e a equipe confirma. Se não der para atender, clique em Recusar e diga o motivo."
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
    "s": 81,
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
    "text": "Na ficha da OS, em Qualidade e checklists, ficam as listas de conferência do serviço. Antes de entregar, clique em Inspeção final. Abre uma lista com o que deve ser conferido. Para cada item, clique em OK se está certo, em Não conforme se tem problema, ou em N/A quando não se aplica. No fim, escolha Aprovada, Aprovada com ressalva ou Reprovada, e clique em Registrar. Reprovado, o serviço volta para a execução. As listas são da sua oficina. Você muda os itens em Configurações, na aba Checklists, e pode deixar a inspeção obrigatória antes da entrega. Também dá para usar a lista de recebimento, na chegada do equipamento, para registrar como ele chegou."
  },
  {
    "n": 27,
    "file": "27-tipos-de-os-e-checklists",
    "mod": "producao",
    "s": 145,
    "title": "Tipos de OS e checklists obrigatórios",
    "routes": [],
    "desc": "Cadastrar os checklists (obrigatórios ou não), os tipos de serviço da oficina e ligar um ao outro.",
    "learn": [
      "Cadastrar um checklist obrigatório",
      "Criar um tipo de OS e vincular o checklist",
      "Escolher o tipo ao abrir a OS"
    ],
    "text": "Em Configurações há duas abas: Checklists e Tipos de OS. Checklist é a lista de conferência. Tipo de OS é o tipo de serviço, por exemplo troca de óleo, funilaria ou solda. Na aba Checklists, clique em Novo checklist. Dê um nome e escreva o primeiro item a conferir. Para mais itens, escreva no campo de baixo e clique em Adicionar. As setas mudam a ordem e o X apaga. Ligue Obrigatório: a OS só segue depois que esse checklist for preenchido. Clique em Salvar checklist. Ele aparece na lista, com o aviso Obrigatório. Agora abra a aba Tipos de OS e clique em Novo tipo de OS. Escreva o nome do tipo. Em Checklists deste tipo, marque os checklists que valem para este serviço. Os obrigatórios aparecem marcados em vermelho. Clique em Salvar tipo. O cartão mostra os checklists ligados a ele. Ao abrir uma OS, escolha o Tipo de OS. Embaixo aparecem os checklists deste tipo. Quando você clicar em Abrir OS, o checklist de recebimento já aparece para preencher. Um checklist pode servir para vários tipos. E o checklist sem nenhum tipo marcado vale para todas as OS."
  },
  {
    "n": 34,
    "file": "34-preencher-checklist-na-os",
    "mod": "producao",
    "s": 208,
    "title": "Preencher o checklist na OS, passo a passo",
    "routes": [
      "/os/"
    ],
    "desc": "Como preencher o checklist na chegada do veículo e antes de entregar, e o que acontece quando ele é obrigatório.",
    "learn": [
      "Onde o checklist aparece na OS",
      "Marcar OK, Não conforme ou N/A",
      "Registrar e aprovar ou reprovar"
    ],
    "text": "O checklist é uma lista de conferência. Ele protege a oficina e o cliente. Na chegada, anota como o veículo chegou. Antes de entregar, confere se o serviço ficou certo. Abra a ordem de serviço. Desça até o quadro Qualidade e checklists. Aqui aparecem os botões das etapas: Recebimento, Inspeção final e Entrega. Quando o checklist é obrigatório, aparece este aviso amarelo, e o botão da etapa fica destacado em laranja. Enquanto ele não for preenchido, a OS não passa para a próxima etapa. Clique no botão Recebimento. Abre a lista com os itens para conferir. Todos os itens começam marcados como OK. Você só precisa mudar o que estiver diferente. Achou um problema? Clique em Não conforme naquele item. Abre um campo: escreva o que encontrou, por exemplo um risco na porta. Se o item não serve para este veículo, clique em N/A, que quer dizer não se aplica. Por exemplo, um carro sem estepe. Embaixo fica o resultado. Como teve um item Não conforme, o sistema já mudou para Aprovada com ressalva. Ressalva quer dizer: está tudo certo, mas com uma observação. Em Observações, escreva o que for importante. Para guardar fotos, use o quadro Fotos e documentos da OS. Clique em Registrar. O checklist fica guardado na OS, com a data, o nome de quem preencheu e cada item marcado. O Recebimento saiu do aviso amarelo. Agora a OS pode seguir para o serviço. A OS segue o caminho normal: diagnóstico, aprovação e execução. Aqui ela já está em execução. A Inspeção final só fica liberada quando o serviço está em execução ou pronto. Quando o serviço terminar, faça a Inspeção final. Clique no botão Inspeção final. Confira cada item no veículo. Se estiver tudo certo, use Marcar todos como OK e escolha Aprovada. Se o serviço não ficou bom, escolha Reprovada. A OS volta para a execução, para a equipe corrigir antes de entregar. Clique em Registrar. Pronto: as duas conferências ficam na OS, uma embaixo da outra. Resumindo: OK quando está certo, Não conforme quando tem problema, e N/A quando não se aplica. Os checklists são montados em Configurações, na aba Checklists."
  },
  {
    "n": 36,
    "file": "36-tipos-de-os-prontos",
    "mod": "producao",
    "s": 137,
    "title": "Tipos de OS prontos: exibir ou ocultar",
    "routes": [],
    "desc": "Os tipos de OS que já vêm prontos para mecânica, autoelétrica, motos, serralheria e soldas especiais, e como escolher quais aparecem.",
    "learn": [
      "Os tipos prontos e seus checklists",
      "Exibir ou ocultar um tipo ou um ramo inteiro",
      "Restaurar os tipos padrão"
    ],
    "text": "O TORVEN já vem com tipos de ordem de serviço prontos para oficina mecânica, autoelétrica, oficina de motos, serralheria e soldas especiais. Cada tipo já tem três checklists: o de chegada, o de inspeção final e o de entrega. Eles chegam ocultos. Você exibe só os do ramo da sua oficina, no quadro Ramo da oficina. A aula trinta e sete mostra como. Em Configurações, na aba Tipos de OS, eles aparecem separados por ramo. Nesta oficina de demonstração, mecânica, serralheria e soldas já estão exibidos. Em cada cartão você vê os checklists daquele tipo. Para mudar os itens ou deixar um checklist obrigatório, use a aba Checklists. Não usa algum tipo? Desmarque a caixa Exibido na abertura da OS. Ele fica oculto e não aparece mais para escolher. As ordens de serviço antigas daquele tipo continuam normais. Se a sua oficina não trabalha com serralheria, por exemplo, clique em Ocultar todos, ao lado do nome do ramo. Para voltar, clique em Exibir todos. Use os filtros Todos, Exibidos e Ocultos para ver só o que interessa. Na abertura da OS, a lista de tipos mostra só os exibidos, separados por ramo. Ao escolher o tipo, os checklists dele já aparecem. Apagou um tipo padrão sem querer? Clique em Restaurar tipos padrão. Ele volta com os checklists, sem mexer nos que já existem. Exiba só o que a sua oficina faz, ajuste os checklists e crie tipos novos quando precisar."
  },
  {
    "n": 37,
    "file": "37-oficina-de-motos",
    "mod": "producao",
    "s": 121,
    "title": "Sistema pronto para oficina de motos",
    "routes": [],
    "desc": "Ajustar o TORVEN ao ramo da oficina: tipos de OS e checklists de moto, categorias e Tabela FIPE já em Moto.",
    "learn": [
      "Escolher o ramo da oficina",
      "Os tipos de OS e checklists de moto",
      "Abrir a OS da moto"
    ],
    "text": "Nesta aula você vai deixar o TORVEN pronto para uma oficina de motos, em poucos cliques. Os tipos de OS prontos e os checklists deles chegam ocultos. Em Configurações, na aba Tipos de OS, fica o quadro Ramo da oficina. Nele você marca o que a sua oficina faz. Desmarque o que a oficina não faz e marque Oficina de motos. Se a oficina também atende carros, deixe Oficina mecânica marcada junto. Clique em Ajustar ao ramo. O sistema avisa o que vai acontecer: os tipos de moto e os checklists deles ficam exibidos, e os dos outros ramos ficam ocultos. Nada é apagado. Clique em Ajustar. Pronto: agora aparecem os tipos de OS de moto, cada um com os seus checklists. Veja a troca da relação: chegada da moto, inspeção da relação e entrega da moto. Os itens falam de corrente, coroa, pinhão e alinhamento da roda. Na abertura da OS, a lista de tipos já mostra só os serviços de moto. Ao escolher o tipo, os checklists dele aparecem sozinhos. E, ao cadastrar a moto do cliente, a Tabela FIPE já abre na opção Moto. Se a oficina passar a atender outro ramo, é só marcar e ajustar de novo. Os tipos que você criou continuam do jeito que estão."
  },
  {
    "n": 28,
    "file": "28-varias-fotos-na-os",
    "mod": "producao",
    "s": 93,
    "title": "Várias fotos de uma vez na OS",
    "routes": [],
    "desc": "Guardar as fotos do serviço na OS: chegada, andamento e entrega.",
    "learn": [
      "Escolher várias fotos de uma vez",
      "Escrever a legenda e confirmar a autorização",
      "Ver as fotos em tamanho grande"
    ],
    "text": "Na ficha da OS, desça até o quadro Fotos e documentos da OS. Clique em Adicionar fotos. Na janela que abre, segure a tecla Control e clique em cada foto que quiser. Depois clique em Abrir. No celular, use Tirar foto, para a câmera, ou Da galeria, para escolher várias. Todas as fotos aparecem para conferir. Se quiser, escreva uma legenda em cada uma. O X vermelho tira a foto da lista. Marque que o cliente autorizou as fotos e clique em Salvar. O sistema envia uma por uma e mostra o andamento. Clique numa foto para ver grande. Use as setas dos lados para passar para a próxima. No celular, arraste o dedo. Fotografe o item na chegada, durante o serviço e na entrega. Isso evita discussão depois."
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
    "s": 65,
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
    "text": "O caixa do dia guarda tudo o que entrou e saiu da oficina hoje. Para receber, ele precisa estar aberto. De manhã, informe o troco inicial: o dinheiro que já está na gaveta. Clique em Abrir caixa. Pronto, já dá para receber. Cada pagamento recebido nas OS e nas vendas aparece aqui. Retirou dinheiro para pagar algo? Lance como saída, com o motivo. No fim do dia, clique em Fechar caixa e conte o dinheiro da gaveta. O sistema mostra se sobrou ou faltou. Os caixas anteriores ficam guardados no menu Financeiro, em Caixas fechados, para conferência."
  },
  {
    "n": 20,
    "file": "20-contas-e-gestao-financeira",
    "mod": "financeiro",
    "s": 77,
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
    "text": "No menu Financeiro, Contas a receber mostra o que os clientes devem à oficina, com o vencimento de cada conta. Recebeu? Clique no sinal de certo, ao lado da conta, para dar a baixa. Contas a pagar mostra o que a oficina deve pagar. As vencidas aparecem em vermelho. Em Lançamentos você vê, mês a mês, tudo o que entrou e saiu. Em Contas, conciliação e DRE ficam o caixa e as contas bancárias, com o saldo de cada uma. Na Conciliação bancária você importa o extrato do banco e confere, linha por linha, com os lançamentos do sistema. O DRE mostra o resultado do mês: o que entrou, os custos, as despesas e quanto sobrou."
  },
  {
    "n": 38,
    "file": "38-financeiro-alertas-e-lembretes",
    "mod": "financeiro",
    "s": 148,
    "title": "Financeiro: incluir conta, caixas fechados, alertas e lembretes",
    "routes": [
      "/financeiro/"
    ],
    "desc": "As opções do menu Financeiro, como incluir uma conta, ver os caixas fechados e receber alertas e lembretes de vencimento.",
    "learn": [
      "As opções do menu Financeiro",
      "Incluir uma conta a pagar",
      "Caixas fechados e transferências",
      "Alertas e lembretes"
    ],
    "text": "O menu Financeiro reúne tudo do dinheiro da oficina: contas a receber e a pagar, incluir conta, transferência, notas de compra, comissões, caixa, caixas fechados, alertas e lembretes. Para lançar uma conta que vai vencer, como a conta de energia, clique em Incluir conta a pagar. Escreva a descrição e o valor. Confira o vencimento e a categoria. Clique em Salvar. A conta aparece na lista, em aberto, até você dar a baixa. Se a conta se repete todo mês, como o aluguel, use Repetir mensalmente. Em Transferência você registra, por exemplo, o dinheiro do caixa levado para o banco. Não conta como receita nem despesa. Em Caixas fechados ficam todos os fechamentos, com o que era esperado, o que foi contado e a diferença. Marque Só com diferença para achar os caixas que sobraram ou faltaram. O botão Ver mostra cada movimento. Em Alertas e lembretes você vê as contas vencidas, as que vão vencer e o caixa aberto há muito tempo. Clique num alerta para ver as contas. Para não esquecer de nada, crie um lembrete: escreva o que é, a data e se repete todo mês. Clique em Salvar. No dia, o aviso aparece no sino. Quando fizer, clique em Feito: se repete, o próximo é criado sozinho. O sino, no alto da tela, junta todos os avisos: contas vencendo, contas vencidas, caixa aberto e lembretes do dia. Inclua as contas assim que chegarem, dê a baixa quando pagar ou receber e olhe os alertas todo dia."
  },
  {
    "n": 39,
    "file": "39-assistente",
    "mod": "financeiro",
    "s": 121,
    "title": "Assistente: pergunte e peça por texto ou voz",
    "routes": [],
    "desc": "O Assistente responde sobre contas e caixa, inclui contas, dá baixa e cria lembretes — sempre pedindo confirmação.",
    "learn": [
      "Perguntar ao Assistente",
      "Incluir conta e lembrete pelo Assistente",
      "Liberar o Assistente por usuário"
    ],
    "text": "O Assistente entende pedidos escritos ou falados, como contas a pagar desta semana, ou lançar conta a pagar de 350 reais da energia. Clique em Assistente, no alto da tela. Escreva a pergunta e clique em enviar. Ele responde na hora, com a lista e o total. Para gravar alguma coisa, ele mostra um resumo do que entendeu, com os campos para conferir. Nada é gravado ainda. Está certo? Clique em Confirmar. Se não, clique em Cancelar. Também dá para falar: toque no microfone e diga, por exemplo, me lembre de pagar o IPTU dia 20. Confirme, e o lembrete aparece no sino no dia certo. Quem pode usar? Em Configurações, Usuários, clique em Assistente ao lado de cada pessoa. Ligue ou desligue o Assistente e marque o que ela pode pedir: consultar, incluir contas, dar baixa, lembretes e consultar OS. O Assistente nunca faz mais do que a pessoa poderia fazer na tela, sempre mostra o resumo antes de gravar, e tudo fica registrado."
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
    "n": 31,
    "file": "31-conferir-extrato-com-as-os",
    "mod": "financeiro",
    "s": 106,
    "title": "Conferir o extrato do banco com as OS",
    "routes": [],
    "desc": "Importar o extrato do banco e ver quais entradas são pagamentos de ordens de serviço.",
    "learn": [
      "Importar o arquivo do extrato",
      "Ver o que é pagamento de OS",
      "Receber na OS com um clique"
    ],
    "text": "No menu Financeiro, abra Contas, conciliação e DRE, e clique na aba Conciliação bancária. Primeiro, baixe o extrato no aplicativo ou no site do banco. Escolha o período e exporte no formato OFX ou CSV. Clique em Importar extrato, escolha a conta do banco e o arquivo que você baixou. Clique em Importar. O sistema confere cada entrada do banco com as ordens de serviço. Os quadros mostram o que já é de OS, o que provavelmente é de uma OS e o que ficou sem OS. Quando o sistema reconhece o nome do cliente ou o número da OS, aparece o botão Receber nesta OS. Clique nele, confira a forma de pagamento, como PIX, e clique em Confirmar recebimento. Pronto: o pagamento entrou na OS e a linha do banco ficou conferida. O último quadro avisa o que foi recebido no sistema, mas não apareceu no banco. Vale conferir. Se conferiu errado, clique na setinha ao lado da linha para desfazer. O pagamento sai da OS."
  },
  {
    "n": 33,
    "file": "33-emitir-nota-fiscal",
    "mod": "financeiro",
    "s": 124,
    "title": "Emitir a nota fiscal da OS",
    "routes": [
      "/notas"
    ],
    "desc": "Escolher o CNPJ que emite, conferir a nota e emitir — ou registrar a nota feita no site da prefeitura.",
    "learn": [
      "Abrir a nota de uma OS",
      "Escolher o CNPJ que emite",
      "Emitir ou informar o número da nota"
    ],
    "text": "No menu Financeiro, abra Notas fiscais. Clique em Emitir nota. Também dá para emitir a nota de dentro da própria OS. Digite o número da OS e clique nela na lista. Se a sua empresa tem mais de um CNPJ, escolha aqui qual vai emitir. O emitente padrão já vem marcado. Neste exemplo, vamos emitir pelo MEI do João. Confira o cliente, os serviços e o valor da nota. Se aparecer um aviso amarelo, corrija antes de emitir, por exemplo o CPF do cliente. Este CNPJ emite no site da prefeitura. O TORVEN separa os dados para você copiar: a descrição, os códigos e o valor. Clique em Preparar para emitir no site. Depois, emita a nota no site da prefeitura, como você já faz. Com a nota emitida, volte aqui e clique em Informar número. Digite o número da nota que saiu no site. Clique em Registrar nota. Ela fica marcada como registrada manualmente, ligada à OS. Nos CNPJs ligados a um emissor, como Focus ou NFE.io, é só clicar em Emitir nota. A nota fica Processando e logo vira Autorizada. O sistema nunca mostra uma nota como autorizada sem a confirmação da prefeitura ou da SEFAZ."
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
    "s": 94,
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
    "text": "Em Configurações, a aba Empresa guarda os dados que saem nas impressões: nome, CNPJ, telefone e endereço. Em OS e orçamentos ficam as regras: garantia e prazo padrão, pesquisa por placa, ditado por voz e a regra de uma placa por cadastro. A Tabela de serviços tem os serviços com o preço e o custo. É dela que vem o valor que aparece na OS. Em Técnicos você cadastra a equipe, com a cor de cada um na agenda e a comissão. Cada pessoa deve ter o próprio login. Em Usuários, clique em Novo acesso e escolha o perfil dela. Tem sócio? Pode haver mais de um Proprietário. Só um proprietário dá ou tira esse perfil, e a empresa sempre fica com pelo menos um. Em Perfis de acesso você decide o que cada perfil pode ver e fazer. Por exemplo, o técnico não vê o financeiro."
  },
  {
    "n": 32,
    "file": "32-cadastro-fiscal-emitentes",
    "mod": "config",
    "s": 164,
    "title": "Cadastro fiscal: CNPJ, emissor e certificado",
    "routes": [
      "/configuracoes"
    ],
    "desc": "Cadastrar cada CNPJ que emite nota, escolher a empresa emissora e enviar o certificado digital.",
    "learn": [
      "O que é emitente, emissor e certificado",
      "Cadastrar um CNPJ e escolher o emissor",
      "Enviar o certificado e testar"
    ],
    "text": "Três palavras antes de começar. Emitente é o CNPJ que emite a nota. Emissor é a empresa contratada que transmite a nota para a prefeitura. E o certificado A1 é a assinatura digital da empresa: um arquivo com senha. Em Configurações, na aba Fiscal, clique em Novo emitente. Clique em Copiar os dados da minha empresa: o sistema preenche o endereço. Dê um apelido, como Oficina, e confira o CNPJ e a razão social. Agora escolha a empresa emissora que você contratou. Cada cartão explica onde pegar a chave. Não tem emissor? Escolha Emitir no site da prefeitura. O TORVEN prepara os dados para você copiar. Neste exemplo, NFE.io. Cole a chave que o emissor te deu. Ela fica guardada com segurança e não aparece de novo. Deixe em Homologação no começo. É o modo de testes: as notas não valem de verdade. Na última parte ficam os códigos dos impostos. Já vêm preenchidos com o mais comum. Confirme com o seu contador. Clique em Salvar emitente. Agora o certificado. Clique para escolher o arquivo ponto pfx no computador. Digite a senha e clique em Conferir e guardar. O TORVEN confere a senha, o CNPJ e mostra até quando o certificado vale. Perto de vencer, o sistema avisa na tela de notas. Por fim, clique em Enviar cadastro ao emissor: ele recebe os dados e o certificado. Depois, Testar conexão confirma que a chave funciona. Tem mais de um CNPJ, como a oficina e um MEI? Cadastre um emitente para cada um. Na hora de emitir, você escolhe qual usar."
  },
  {
    "n": 29,
    "file": "29-whatsapp-e-agente",
    "mod": "config",
    "s": 104,
    "title": "WhatsApp: ligar o agente e testar",
    "routes": [],
    "desc": "O agente que responde o cliente no WhatsApp: horários de atendimento e teste antes de ligar.",
    "learn": [
      "Onde fica o WhatsApp",
      "Dias e horários do agente",
      "Testar o agente sem enviar nada"
    ],
    "text": "Em Configurações, na aba Integrações, fica o quadro WhatsApp e agente de atendimento. O agente responde o cliente sozinho: diz como está o serviço pela placa e anota pedidos de serviço e de horário. Ligar o WhatsApp oficial é feito uma vez só, normalmente por quem cuida do computador da empresa. O passo a passo está nesta tela. Em Agente automático, marque os dias e o horário em que a oficina atende. O agente só oferece horários livres dentro deles. Antes de ligar, teste o agente aqui embaixo. Nada é enviado de verdade. Escreva como se fosse o cliente, por exemplo oi. O agente mostra as opções numeradas. Responda 2 para agendar. O agente pede a placa e o serviço, e mostra os horários livres. O cliente escolhe o horário, diz o nome e confirma. O pedido vai para a equipe aprovar. Por segurança, os detalhes da OS só são informados para o telefone cadastrado do cliente."
  },
  {
    "n": 40,
    "file": "40-importar-e-exportar-dados",
    "mod": "config",
    "s": 111,
    "title": "Importar e exportar clientes e OS",
    "routes": [
      "/dados"
    ],
    "desc": "Trazer clientes e OS de outro sistema ou de uma planilha do Excel, conferir a prévia, importar, desfazer e exportar.",
    "learn": [
      "Baixar o modelo da planilha",
      "Conferir a prévia e importar",
      "Desfazer e exportar"
    ],
    "text": "Mudando de sistema? Dá para trazer os clientes e as ordens de serviço antigas de uma planilha do Excel. Em Configurações, Importar e exportar dados, clique em Baixar modelo. Ele já vem com as colunas certas e um exemplo. Preencha no Excel, uma linha por cliente. Se já tiver uma planilha, basta que a primeira linha tenha os nomes das colunas. Clique em Escolher planilha e selecione o arquivo. Antes de gravar, o sistema mostra a prévia, linha por linha. Novo é cliente que vai ser criado. Erro mostra o que está errado, como um CPF incompleto. Está tudo certo? Clique em Importar. As linhas com erro ficam de fora, e você pode corrigir e importar só elas depois. Cada importação fica guardada. Importou o arquivo errado? Clique em Desfazer, e o que foi criado é apagado. As OS antigas entram do mesmo jeito: número antigo, datas, cliente, veículo, serviço, valor e situação. Elas não mexem no seu financeiro. Para levar os dados para o Excel, use Exportar dados: clientes, veículos, OS, itens das OS, lançamentos e muito mais. Comece pelo modelo, confira a prévia e, se precisar, desfaça. Só quem tem a permissão de importar vê essa opção."
  },
  {
    "n": 26,
    "file": "26-suporte-e-treinamento",
    "mod": "config",
    "s": 73,
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

export const TOTAL_SECONDS = 4055;

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
