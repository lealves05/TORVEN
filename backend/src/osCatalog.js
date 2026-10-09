// Tipos de OS e checklists padrão por ramo (mecânica, autoelétrica, motos, serralheria, soldas especiais).
// Instalados uma vez por empresa (companies.os_catalog_version), OCULTOS: a empresa habilita o(s) ramo(s) dela
// (Configurações › Tipos de OS › Ramo da oficina, ou exibindo tipo a tipo). Tipo oculto = order_types.active false;
// os checklists padrão acompanham: ficam desativados enquanto nenhum tipo exibido os usa (syncCatalogChecklists).
// A empresa pode editar, apagar ou criar outros. Nada aqui é obrigatório: os checklists vêm como
// "não obrigatórios" — a empresa liga o Obrigatório onde quiser.

export const CATALOG_VERSION = 3; // 3: tipos e checklists padrão chegam ocultos
/** Versão do catálogo em que cada ramo entrou. Empresas que já tinham o catálogo recebem o ramo novo OCULTO. */
const SEGMENT_SINCE = { motos: 2 };

export const SEGMENTS = {
  mecanica: 'Oficina mecânica',
  autoeletrica: 'Autoelétrica',
  motos: 'Oficina de motos',
  serralheria: 'Serralheria',
  soldas: 'Soldas especiais',
};

// checklists de chegada e de entrega compartilhados por todos os tipos do ramo
const VEHICLE_IN = ['Placa e quilometragem anotadas', 'Nível de combustível anotado', 'Painel: luzes de alerta acesas anotadas',
  'Lataria: riscos e amassados anotados (fotos)', 'Objetos de valor retirados ou anotados', 'Estepe, macaco e chave de roda conferidos',
  'Reclamação do cliente descrita com as palavras dele'];
const VEHICLE_OUT = ['Serviço explicado ao cliente', 'Peças trocadas mostradas/devolvidas conforme combinado', 'Veículo limpo (volante, bancos, tapetes)',
  'Painel sem luzes de alerta', 'Quilometragem de saída anotada', 'Próxima revisão/garantia informada'];
const MOTO_IN = ['Placa e quilometragem anotadas', 'Nível de combustível anotado', 'Painel: luzes de alerta acesas anotadas',
  'Carenagens, tanque e escapamento: riscos e quebras anotados (fotos)', 'Retrovisores, piscas e manetes conferidos',
  'Capacete, baú, bolsas e acessórios deixados pelo cliente anotados', 'Chave reserva / alarme anotados', 'Reclamação do cliente descrita com as palavras dele'];
const MOTO_OUT = ['Serviço explicado ao cliente', 'Peças trocadas mostradas/devolvidas conforme combinado', 'Calibragem dos pneus conferida',
  'Freios dianteiro e traseiro testados', 'Luzes, buzina e piscas funcionando', 'Moto limpa (banco, tanque, manoplas)', 'Quilometragem de saída anotada',
  'Próxima revisão/garantia informada'];
const METAL_IN = ['Medidas conferidas no local ou na peça', 'Material e espessura definidos com o cliente', 'Acabamento combinado (pintura, galvanizado, natural)',
  'Fotos do local/peça antes do serviço', 'Prazo e forma de instalação combinados'];
const METAL_OUT = ['Medidas finais conferidas', 'Esquadro, prumo e nível conferidos', 'Soldas sem trincas nem porosidade', 'Rebarbas removidas e cantos sem corte',
  'Acabamento conforme combinado', 'Local limpo após instalação', 'Garantia e cuidados explicados ao cliente'];
const WELD_IN = ['Material da peça identificado (aço, inox, alumínio, ferro fundido)', 'Trincas/danos marcados e fotografados', 'Peça limpa e sem óleo/tinta na região',
  'Medidas críticas anotadas antes do serviço', 'Uso da peça e esforço informados pelo cliente'];
const WELD_OUT = ['Cordão sem trincas, poros ou mordeduras', 'Dimensões críticas conferidas', 'Peça sem empeno', 'Acabamento/usinagem conforme combinado',
  'Teste de estanqueidade/funcional feito (quando aplicável)', 'Recomendações de uso explicadas ao cliente'];

/** Cada tipo: chave estável, nome, descrição e checklist de inspeção final (itens). */
export const CATALOG = {
  mecanica: {
    shared: { recebimento: ['Recebimento do veículo', VEHICLE_IN], entrega: ['Entrega do veículo', VEHICLE_OUT] },
    types: [
      ['mec-revisao', 'Revisão preventiva', 'Revisão por quilometragem ou tempo, conforme o manual.', ['Óleo e filtros trocados', 'Níveis completados (freio, arrefecimento, direção, limpador)', 'Correias e mangueiras inspecionadas', 'Freios inspecionados', 'Pneus calibrados e com desgaste anotado', 'Luzes e buzina testadas', 'Etiqueta da próxima revisão colada']],
      ['mec-oleo', 'Troca de óleo e filtros', 'Troca de óleo do motor e filtros.', ['Óleo correto para o motor (especificação)', 'Filtro de óleo trocado', 'Filtros de ar/combustível/cabine conforme pedido', 'Sem vazamento após ligar o motor', 'Nível conferido com o motor desligado', 'Etiqueta de troca colada']],
      ['mec-freios', 'Freios', 'Pastilhas, discos, lonas, tambores, fluido e regulagem.', ['Pastilhas/lonas dentro da medida', 'Discos/tambores medidos', 'Fluido no nível e sem ar no sistema', 'Freio de mão regulado', 'Teste de frenagem sem ruído nem puxar para o lado']],
      ['mec-suspensao', 'Suspensão e direção', 'Amortecedores, molas, buchas, pivôs, terminais e alinhamento.', ['Amortecedores sem vazamento', 'Buchas, pivôs e terminais sem folga', 'Parafusos no torque', 'Alinhamento e balanceamento feitos', 'Teste de rodagem sem ruídos']],
      ['mec-motor', 'Motor (diagnóstico e reparo)', 'Falhas, ruídos, perda de potência, vazamentos, retífica.', ['Diagnóstico registrado antes do reparo', 'Peças substituídas registradas', 'Torques conforme manual', 'Sem vazamentos com o motor quente', 'Marcha lenta e aceleração normais', 'Teste de rodagem feito']],
      ['mec-embreagem', 'Embreagem e câmbio', 'Kit de embreagem, atuador, câmbio e semieixos.', ['Kit de embreagem completo instalado', 'Pedal com curso e altura corretos', 'Engates sem arranhar', 'Óleo do câmbio no nível', 'Teste de arrancada em subida']],
      ['mec-arrefecimento', 'Arrefecimento', 'Radiador, bomba d\'água, válvula termostática, ventoinha.', ['Sistema sem vazamentos', 'Aditivo na proporção certa', 'Ventoinha liga na temperatura correta', 'Sem ar no sistema', 'Temperatura estável em teste']],
    ],
  },
  autoeletrica: {
    shared: { recebimento: ['Recebimento do veículo (autoelétrica)', [...VEHICLE_IN, 'Códigos de falha lidos no scanner (se houver)']], entrega: ['Entrega do veículo', VEHICLE_OUT] },
    types: [
      ['ae-diagnostico', 'Diagnóstico elétrico (scanner)', 'Leitura de falhas, testes de sensores e chicote.', ['Códigos de falha registrados', 'Causa encontrada e explicada', 'Códigos apagados após o reparo', 'Teste confirmando que a falha não voltou']],
      ['ae-carga', 'Bateria e sistema de carga', 'Bateria, alternador, regulador e cabos.', ['Teste de bateria (tensão e partida)', 'Tensão de carga do alternador medida', 'Terminais limpos e apertados', 'Correia do alternador conferida', 'Fuga de corrente verificada']],
      ['ae-partida', 'Motor de partida', 'Revisão ou troca do motor de partida.', ['Consumo de corrente na partida medido', 'Fixação e cabos apertados', 'Partida a frio e a quente testadas']],
      ['ae-iluminacao', 'Iluminação e sinalização', 'Faróis, lanternas, setas, luz de freio e regulagem.', ['Todas as lâmpadas acendendo', 'Faróis regulados', 'Setas e alerta na frequência certa', 'Luz de freio e ré funcionando']],
      ['ae-arcondicionado', 'Ar-condicionado automotivo', 'Carga de gás, compressor, higienização.', ['Pressões de alta e baixa medidas', 'Sem vazamento (teste com detector/UV)', 'Temperatura de saída medida', 'Filtro de cabine trocado/limpo', 'Ventilação em todas as velocidades']],
      ['ae-injecao', 'Injeção eletrônica', 'Bicos, sensores, corpo de borboleta e ignição.', ['Bicos testados/limpos', 'Sensores conferidos com o scanner', 'Velas e cabos/bobinas conferidos', 'Marcha lenta estável', 'Sem códigos de falha após o teste']],
      ['ae-acessorios', 'Acessórios elétricos', 'Som, alarme, travas, vidros, câmeras e rastreador.', ['Acessório funcionando em todas as funções', 'Fiação protegida e presa', 'Fusível adequado instalado', 'Sem consumo de bateria com o carro desligado', 'Cliente orientado sobre o uso']],
    ],
  },
  motos: {
    shared: { recebimento: ['Recebimento da moto', MOTO_IN], entrega: ['Entrega da moto', MOTO_OUT] },
    types: [
      ['moto-revisao', 'Revisão de moto', 'Revisão por quilometragem ou tempo, conforme o manual da moto.', ['Óleo do motor e filtro trocados', 'Filtro de ar limpo/trocado', 'Vela conferida/trocada', 'Relação lubrificada e com folga regulada', 'Freios e fluido conferidos', 'Cabos de embreagem e acelerador lubrificados e regulados', 'Pneus calibrados e com desgaste anotado', 'Luzes, buzina e piscas testados', 'Parafusos principais no torque']],
      ['moto-oleo', 'Troca de óleo da moto', 'Troca do óleo do motor e filtro.', ['Óleo correto para a moto (viscosidade e norma JASO)', 'Filtro de óleo / tela limpos ou trocados', 'Arruela do bujão trocada', 'Nível conferido no visor/vareta com a moto em pé', 'Sem vazamento após ligar o motor', 'Etiqueta da próxima troca colada']],
      ['moto-relacao', 'Relação (corrente, coroa e pinhão)', 'Troca ou regulagem do kit de transmissão.', ['Kit completo trocado (corrente, coroa e pinhão)', 'Alinhamento da roda traseira conferido', 'Folga da corrente regulada', 'Porcas da coroa e do eixo no torque', 'Corrente lubrificada', 'Teste de rodagem sem ruído']],
      ['moto-freios', 'Freios da moto', 'Pastilhas, lonas, discos, fluido e regulagem.', ['Pastilhas/lonas dentro da medida', 'Discos medidos e sem empeno', 'Fluido trocado/no nível e sem ar', 'Freio traseiro regulado', 'Luz de freio acendendo nos dois manetes/pedal', 'Teste de frenagem feito']],
      ['moto-suspensao', 'Suspensão da moto', 'Bengalas (retentores e óleo), amortecedor e caixa de direção.', ['Retentores sem vazamento', 'Óleo da bengala na quantidade certa', 'Amortecedor sem vazamento e regulado', 'Caixa de direção sem folga e sem pontos', 'Teste de rodagem em piso irregular']],
      ['moto-alimentacao', 'Carburação / injeção da moto', 'Limpeza de carburador ou bicos, sincronismo e marcha lenta.', ['Carburador/bico limpo', 'Boia/nível de combustível conferido (carburada)', 'Filtro de combustível conferido', 'Marcha lenta regulada e estável', 'Partida a frio e a quente testadas', 'Sem códigos de falha (injetada)']],
      ['moto-eletrica', 'Parte elétrica da moto', 'Bateria, retificador, estator, partida, chicote e iluminação.', ['Bateria testada (tensão e partida)', 'Tensão de carga medida em rotação', 'Retificador/estator conferidos', 'Chicote sem emendas soltas', 'Luzes, piscas e painel funcionando']],
      ['moto-motor', 'Motor da moto (reparo e retífica)', 'Ruídos, perda de potência, fumaça, consumo de óleo, retífica.', ['Diagnóstico registrado antes do reparo', 'Peças substituídas registradas', 'Folga de válvulas regulada', 'Torques conforme manual', 'Sem vazamentos com o motor quente', 'Amaciamento explicado ao cliente']],
      ['moto-pneus', 'Pneus e rodas da moto', 'Troca de pneus e câmaras, aros, raios e rolamentos.', ['Pneu na medida e sentido de rodagem corretos', 'Data de fabricação do pneu anotada', 'Raios esticados / aro sem empeno', 'Rolamentos de roda sem folga', 'Calibragem conforme o manual', 'Eixos e porcas no torque']],
    ],
  },
  serralheria: {
    shared: { recebimento: ['Visita / medição', METAL_IN], entrega: ['Entrega / instalação', METAL_OUT] },
    types: [
      ['ser-portao', 'Portão (fabricação e instalação)', 'Portões de abrir, correr ou basculantes.', ['Folhas no esquadro', 'Roldanas/dobradiças correndo livres', 'Trilho nivelado e fixado', 'Fechadura e trinco funcionando', 'Pintura de fundo/acabamento aplicada']],
      ['ser-manutencao', 'Manutenção de portão e automação', 'Roldanas, trilhos, dobradiças, motor e cremalheira.', ['Defeito encontrado registrado', 'Peças trocadas registradas', 'Fins de curso regulados', 'Teste de abrir/fechar 3 vezes', 'Sensor anti-esmagamento testado (automação)']],
      ['ser-grades', 'Grades, janelas e portas', 'Grades de proteção, janelas e portas metálicas.', ['Medidas conferidas no vão', 'Fixação em todos os pontos', 'Abertura e fechamento sem travar', 'Vedação/cantos sem rebarba']],
      ['ser-estrutura', 'Estrutura metálica e cobertura', 'Coberturas, mezaninos, galpões e estruturas.', ['Projeto/croqui aprovado pelo cliente', 'Perfis e espessuras conforme combinado', 'Soldas e parafusos conferidos', 'Prumo e nível conferidos', 'Calhas e caimento conferidos (coberturas)']],
      ['ser-escada', 'Escadas e corrimãos', 'Escadas, guarda-corpos e corrimãos.', ['Altura e espelho dos degraus uniformes', 'Corrimão firme e sem cantos vivos', 'Guarda-corpo na altura correta', 'Fixação conferida']],
      ['ser-mobiliario', 'Mobiliário metálico', 'Mesas, bancadas, prateleiras e móveis sob medida.', ['Medidas conforme o pedido', 'Sem balanço (nivelado)', 'Soldas lixadas', 'Acabamento sem riscos']],
    ],
  },
  soldas: {
    shared: { recebimento: ['Recebimento da peça', WELD_IN], entrega: ['Entrega da peça', WELD_OUT] },
    types: [
      ['sol-aluminio', 'Solda em alumínio (TIG)', 'Cárteres, cabeçotes, rodas, tanques e peças em alumínio.', ['Liga identificada e vareta compatível', 'Pré-aquecimento quando necessário', 'Cordão sem porosidade', 'Teste de estanqueidade (peças com fluido)']],
      ['sol-inox', 'Solda em inox', 'Tanques, tubulações, equipamentos de cozinha e indústria.', ['Gás de purga usado na raiz (quando aplicável)', 'Sem oxidação/coloração excessiva', 'Decapagem/passivação feita', 'Acabamento sanitário conferido (quando exigido)']],
      ['sol-ferrofundido', 'Recuperação de ferro fundido', 'Cabeçotes, blocos, carcaças e peças fundidas.', ['Trinca mapeada com líquido penetrante', 'Furos de alívio nas pontas da trinca', 'Pré-aquecimento e resfriamento lento', 'Teste de estanqueidade feito', 'Planicidade conferida (cabeçote)']],
      ['sol-enchimento', 'Recuperação por enchimento', 'Eixos, buchas, dentes, assentos desgastados.', ['Medida original anotada', 'Material de enchimento compatível', 'Usinagem/retífica na medida final', 'Dureza/acabamento conferidos']],
      ['sol-implementos', 'Solda em implementos e carrocerias', 'Carrocerias, baús, implementos agrícolas e reboques.', ['Região danificada reforçada', 'Chapa/perfil de reforço com espessura adequada', 'Pontos de fadiga verificados', 'Pintura de proteção aplicada']],
      ['sol-tubulacao', 'Solda de tubulação e vasos', 'Tubulações, reservatórios e linhas de pressão.', ['Procedimento/eletrodo adequado ao material', 'Alinhamento das juntas conferido', 'Teste hidrostático ou de estanqueidade feito', 'Registro do soldador e data']],
    ],
  },
};

/** O que cada ramo acrescenta nas listas da empresa (só acrescenta, nunca remove o que a empresa já tem). */
export const SEGMENT_SETTINGS = {
  mecanica: { equipmentCategories: ['Carro / utilitário'], serviceCategories: ['Mecânica automotiva'], materialCategories: ['Peças automotivas', 'Óleos e lubrificantes'] },
  autoeletrica: { equipmentCategories: ['Carro / utilitário'], serviceCategories: ['Autoelétrica'], materialCategories: ['Material elétrico automotivo', 'Baterias'] },
  motos: { equipmentCategories: ['Moto'], serviceCategories: ['Mecânica de motos', 'Elétrica de motos'], materialCategories: ['Peças de moto', 'Pneus e câmaras', 'Óleos e lubrificantes', 'Kit relação'] },
  serralheria: {}, soldas: {},
};

/** Instala o catálogo na empresa (idempotente pela chave). `visible`: exibir os tipos na abertura da OS. */
export async function installCatalog(db, companyId, { segments = Object.keys(CATALOG), visible = true } = {}) {
  let created = 0;
  for (const seg of segments) {
    const c = CATALOG[seg];
    if (!c) continue;
    // checklists compartilhados do ramo (chegada e entrega)
    const shared = {};
    for (const [kind, [name, items]] of Object.entries(c.shared)) {
      const key = `${seg}-${kind}`;
      const { rows: [t] } = await db.query(
        `insert into checklist_templates (company_id, name, kind, items, template_key, active) values ($1,$2,$3,$4,$5,$6)
         on conflict (company_id, template_key) where template_key is not null do update set template_key = excluded.template_key returning id`,
        [companyId, name, kind, JSON.stringify(items), key, visible]);
      shared[kind] = t.id;
    }
    for (const [key, name, description, inspection] of c.types) {
      const { rows: [ex] } = await db.query('select id from order_types where company_id = $1 and (template_key = $2 or lower(name) = lower($3))', [companyId, key, name]);
      let typeId = ex?.id;
      if (!typeId) {
        const { rows: [t] } = await db.query(
          'insert into order_types (company_id, name, description, active, segment, template_key) values ($1,$2,$3,$4,$5,$6) returning id',
          [companyId, name, description, visible, seg, key]);
        typeId = t.id; created += 1;
      }
      const { rows: [insp] } = await db.query(
        `insert into checklist_templates (company_id, name, kind, items, template_key, active) values ($1,$2,'inspecao',$3,$4,$5)
         on conflict (company_id, template_key) where template_key is not null do update set template_key = excluded.template_key returning id`,
        [companyId, `Inspeção — ${name}`, JSON.stringify(inspection), `${key}-inspecao`, visible]);
      for (const tid of [shared.recebimento, insp.id, shared.entrega]) {
        await db.query('insert into order_type_checklists (company_id, order_type_id, template_id) values ($1,$2,$3) on conflict do nothing', [companyId, typeId, tid]);
      }
    }
  }
  return created;
}

/** Checklists padrão acompanham os tipos: ativa os ligados aos tipos que acabaram de ser exibidos (`activate`) e desativa
 *  os que não servem a nenhum tipo exibido — exceto se algum tipo ligado tem OS em andamento (para não sumir da OS aberta).
 *  Checklists criados pela oficina (sem template_key) nunca mudam aqui. */
export async function syncCatalogChecklists(db, companyId, { activate = [] } = {}) {
  let on = 0;
  if (activate.length) {
    ({ rowCount: on } = await db.query(
      `update checklist_templates c set active = true
        where c.company_id = $1 and c.template_key is not null and not c.active
          and exists (select 1 from order_type_checklists x join order_types t on t.id = x.order_type_id
                       where x.template_id = c.id and t.active and t.id = any($2::uuid[]))`, [companyId, activate]));
  }
  const { rowCount: off } = await db.query(
    `update checklist_templates c set active = false
      where c.company_id = $1 and c.template_key is not null and c.active
        and not exists (select 1 from order_type_checklists x join order_types t on t.id = x.order_type_id where x.template_id = c.id and t.active)
        and not exists (select 1 from order_type_checklists x join orders o on o.order_type_id = x.order_type_id and o.company_id = $1
                         where x.template_id = c.id and o.status not in ('entregue', 'cancelada'))`, [companyId]);
  return { on, off };
}

/** Primeira vez que a empresa abre os tipos de OS: instala o catálogo OCULTO; a oficina habilita o ramo dela.
 *  Empresa que já tinha uma versão anterior: recebe os ramos novos ocultos e, se ainda não escolheu o ramo, os tipos
 *  padrão que nunca usou numa OS ficam ocultos (com os checklists deles). Os já usados não mudam. */
export async function ensureCatalog(db, companyId) {
  const { rows: [c] } = await db.query('select os_catalog_version, settings from companies where id = $1 for update', [companyId]);
  if (!c || c.os_catalog_version >= CATALOG_VERSION) return 0;
  const v = c.os_catalog_version;
  let n = 0;
  if (v === 0) n = await installCatalog(db, companyId, { visible: false });
  else {
    n = await installCatalog(db, companyId, { segments: Object.keys(CATALOG).filter((k) => (SEGMENT_SINCE[k] || 1) > v), visible: false });
    if (v < 3 && !(c.settings?.segments || []).length) {
      await db.query(
        `update order_types t set active = false, updated_at = now()
          where t.company_id = $1 and t.template_key is not null and t.active
            and not exists (select 1 from orders o where o.company_id = $1 and o.order_type_id = t.id)`, [companyId]);
    }
    await syncCatalogChecklists(db, companyId);
  }
  await db.query('update companies set os_catalog_version = $2 where id = $1', [companyId, CATALOG_VERSION]);
  return n;
}

/** Ramo da oficina: exibe os tipos padrão (e checklists) dos ramos escolhidos, oculta os dos outros ramos (os criados
 *  pela oficina não mudam), completa as listas de categorias e, se só trabalha com motos, a FIPE já abre em "Moto". */
export async function applyProfile(db, companyId, segments) {
  const segs = [...new Set(segments)].filter((k) => CATALOG[k]);
  await ensureCatalog(db, companyId);
  const created = await installCatalog(db, companyId, { segments: segs, visible: true });
  const { rows } = await db.query(
    `update order_types set active = (segment = any($2::text[])), updated_at = now()
      where company_id = $1 and segment is not null and active is distinct from (segment = any($2::text[])) returning active`,
    [companyId, segs]);
  const { rows: on } = await db.query('select id from order_types where company_id = $1 and active and segment = any($2::text[])', [companyId, segs]);
  await syncCatalogChecklists(db, companyId, { activate: on.map((x) => x.id) });
  const { rows: [co] } = await db.query('select settings from companies where id = $1 for update', [companyId]);
  const s = { ...(co.settings || {}), segments: segs };
  for (const seg of segs) {
    for (const [k, add] of Object.entries(SEGMENT_SETTINGS[seg] || {})) {
      const cur = Array.isArray(s[k]) ? s[k] : [];
      s[k] = [...cur, ...add.filter((x) => !cur.some((y) => String(y).toLowerCase() === x.toLowerCase()))];
    }
  }
  const carros = segs.some((x) => x === 'mecanica' || x === 'autoeletrica');
  s.fipeDefaultType = segs.includes('motos') && !carros ? 'motorcycles' : 'cars';
  await db.query('update companies set settings = $2 where id = $1', [companyId, s]);
  const shown = rows.filter((x) => x.active).length;
  return { segments: segs, shown, hidden: rows.length - shown, created };
}
