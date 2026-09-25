// Dados de exemplo para explorar o sistema (opcional no cadastro).
import { ensureCompanyDefaults, refreshLabor } from './domain.js';
import { DEFAULT_SETTINGS, publicToken, round2 } from './util.js';
import { prepareItems, insertItems, syncOrderStock, logEvent, moveStock } from './domain.js';

const DAY = 86400000;
/** Data/hora no fuso de São Paulo (dias a partir de hoje). */
const brAt = (days, h, m = 0) => {
  const d = new Date(Date.now() + days * DAY).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  return new Date(`${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-03:00`);
};
const ago = (d, h = 10) => { const x = new Date(Date.now() - d * DAY); x.setHours(h, 0, 0, 0); return x; };

export async function seedDemo(db, companyId, userId) {
  const ins = async (sql, params) => (await db.query(sql, params)).rows[0];

  await db.query(
    `update companies set trade_name = coalesce(trade_name, name), cep = '13015-000', street = 'Rua Barão de Jaguara', number = '1000',
            district = 'Centro', city = 'Campinas', uf = 'SP', city_code = '3509502' where id = $1`, [companyId]);

  // Técnicos
  const techs = [];
  for (const [name, specialty, color, rate] of [
    ['Carlos Mendes', 'Solda TIG / inox / alumínio', '#ea580c', 10],
    ['Rafael Souza', 'Serralheria e estruturas', '#2563eb', 8],
    ['João Pereira', 'Mecânica e máquinas de solda', '#16a34a', 8],
  ]) {
    techs.push(await ins(
      'insert into technicians (company_id, name, specialty, color, commission_rate, hourly_cost) values ($1,$2,$3,$4,$5,45) returning *',
      [companyId, name, specialty, color, rate]));
  }

  // Serviços
  const svc = {};
  for (const [name, category, unit, price, minutes, code] of [
    ['Solda TIG em alumínio (hora)', 'Solda em alumínio', 'h', 180, 60, '14.01'],
    ['Solda TIG em inox (hora)', 'Solda em inox', 'h', 160, 60, '14.01'],
    ['Solda MIG/MAG em aço carbono (hora)', 'Solda MIG/MAG', 'h', 120, 60, '14.01'],
    ['Solda com eletrodo revestido (hora)', 'Solda eletrodo revestido', 'h', 100, 60, '14.01'],
    ['Solda em ferro fundido (peça)', 'Solda em ferro fundido', 'serv', 350, 180, '14.01'],
    ['Recuperação de trinca em bloco/cabeçote', 'Solda em ferro fundido', 'serv', 650, 300, '14.01'],
    ['Fabricação de portão basculante (m²)', 'Serralheria', 'm²', 480, 120, '14.13'],
    ['Instalação de portão/grade', 'Serralheria', 'serv', 350, 180, '14.13'],
    ['Conserto de portão (roldanas, trilho, solda)', 'Serralheria', 'serv', 280, 120, '14.13'],
    ['Grade de proteção sob medida (m²)', 'Serralheria', 'm²', 320, 90, '14.13'],
    ['Manutenção preventiva de máquina de solda', 'Manutenção de máquinas de solda', 'serv', 220, 90, '14.01'],
    ['Diagnóstico técnico', 'Reparo mecânico', 'serv', 80, 45, '14.01'],
    ['Torneamento / usinagem (hora)', 'Usinagem / Torno', 'h', 150, 60, '14.01'],
    ['Visita técnica / deslocamento', 'Serviço externo', 'serv', 90, 60, '14.01'],
  ]) {
    svc[name] = await ins(
      `insert into services (company_id, name, category, unit, price, est_minutes, service_code) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [companyId, name, category, unit, price, minutes, code]);
  }

  // Fornecedores
  const sup = [];
  for (const [name, doc, contact, phone] of [
    ['Gases Industriais Paulista Ltda', '11.222.333/0001-44', 'Márcia', '(19) 3232-1000'],
    ['Aços & Perfis Campinas', '22.333.444/0001-55', 'Roberto', '(19) 3272-2000'],
    ['Solda Center Distribuidora', '33.444.555/0001-66', 'Fernanda', '(11) 4004-3000'],
  ]) {
    sup.push(await ins('insert into suppliers (company_id, name, document, contact, phone) values ($1,$2,$3,$4,$5) returning *',
      [companyId, name, doc, contact, phone]));
  }

  // Materiais
  const prod = {};
  for (const [name, category, unit, cost, price, stock, min, ncm, s] of [
    ['Eletrodo 6013 2,5mm', 'Eletrodos', 'kg', 28, 45, 18, 5, '83111000', 2],
    ['Eletrodo 7018 3,25mm', 'Eletrodos', 'kg', 34, 55, 12, 5, '83111000', 2],
    ['Vareta TIG ER4043 alumínio 2,4mm', 'Varetas e arames', 'kg', 95, 150, 4, 2, '76052100', 2],
    ['Vareta TIG ER308L inox 2,4mm', 'Varetas e arames', 'kg', 120, 190, 3, 2, '72230000', 2],
    ['Arame MIG ER70S-6 0,8mm (rolo 15kg)', 'Varetas e arames', 'un', 310, 420, 3, 1, '72299000', 2],
    ['Gás argônio puro (m³)', 'Gases', 'm³', 38, 70, 20, 10, '28042100', 0],
    ['Gás mistura Ar/CO2 (m³)', 'Gases', 'm³', 30, 60, 14, 10, '28042900', 0],
    ['Chapa aço carbono 1/8" (kg)', 'Chapas', 'kg', 8.5, 14, 240, 80, '72085200', 1],
    ['Chapa inox 304 1,5mm (kg)', 'Chapas', 'kg', 32, 52, 40, 20, '72199000', 1],
    ['Metalon 30x30 #18 (barra 6m)', 'Metalon', 'br', 62, 95, 30, 10, '73066100', 1],
    ['Metalon 50x30 #18 (barra 6m)', 'Metalon', 'br', 88, 130, 6, 8, '73066100', 1],
    ['Tubo redondo 1" #18 (barra 6m)', 'Tubos e perfis', 'br', 48, 75, 15, 6, '73063000', 1],
    ['Cantoneira 1"x1/8" (barra 6m)', 'Cantoneiras e barras', 'br', 55, 85, 12, 6, '72162100', 1],
    ['Roldana para portão 2" canal V', 'Peças de reposição', 'un', 22, 45, 16, 8, '83024900', 1],
    ['Trilho para portão (barra 6m)', 'Peças de reposição', 'br', 70, 115, 4, 2, '73089090', 1],
    ['Disco de corte 7"', 'Discos e abrasivos', 'un', 6.5, 14, 60, 20, '68042211', 2],
    ['Disco flap 4.1/2" grão 80', 'Discos e abrasivos', 'un', 9, 18, 35, 15, '68052000', 2],
    ['Fundo zarcão (galão 3,6L)', 'Tintas e fundos', 'un', 85, 130, 5, 2, '32089010', 1],
    ['Esmalte sintético preto (galão 3,6L)', 'Tintas e fundos', 'un', 95, 145, 4, 2, '32089010', 1],
    ['Tocha TIG WP-26 (reposição)', 'Peças de reposição', 'un', 280, 450, 2, 1, '85159000', 2],
  ]) {
    const p = await ins(
      `insert into products (company_id, name, category, unit, cost, price, min_stock, ncm, supplier_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [companyId, name, category, unit, cost, price, min, ncm, sup[s].id]);
    await moveStock(db, { companyId, productId: p.id, qty: stock, type: 'ajuste', reason: 'Estoque inicial', unitCost: cost, userId });
    prod[name] = p;
  }

  // Clientes e equipamentos
  const cust = [];
  for (const [kind, name, doc, phone, email, eq] of [
    ['pj', 'Metalúrgica Horizonte Ltda', '12.345.678/0001-90', '(19) 3241-5500', 'compras@horizonte.ind.br',
      ['Máquina de solda', 'Máquina MIG 250A', 'Esab', 'Smashweld 266', 'SW266-88123']],
    ['pf', 'Marcos Antônio Ribeiro', '123.456.789-09', '(19) 99812-3344', 'marcos.ribeiro@email.com',
      ['Portão / Grade', 'Portão basculante garagem 3x2,4m', null, null, null]],
    ['pj', 'Transportadora Rota Sul', '98.765.432/0001-10', '(19) 3033-7788', 'frota@rotasul.com.br',
      ['Veículo / Implemento', 'Carroceria baú — longarina trincada', 'Randon', 'SR BA', 'RND2019-4471']],
    ['pf', 'Ana Paula Ferreira', '987.654.321-00', '(19) 98877-6655', 'anapaula.f@email.com',
      ['Móvel / Mobiliário metálico', 'Mesa de inox para cozinha', null, null, null]],
    ['pj', 'Fazenda Santa Luzia', '45.678.901/0001-23', '(19) 99701-2233', 'adm@fazendasantaluzia.com',
      ['Equipamento agrícola', 'Grade aradora — disco e eixo', 'Baldan', 'GAPCR', null]],
    ['pf', 'Roberto Carlos Nunes', '321.654.987-11', '(19) 99123-4567', null,
      ['Peça / Componente', 'Cabeçote motor diesel (trinca)', 'MWM', '229', null]],
  ]) {
    const c = await ins(
      `insert into customers (company_id, kind, name, document, phone, email, cep, street, number, district, city, uf, city_code)
       values ($1,$2,$3,$4,$5,$6,'13010-000','Av. Francisco Glicério',$7,'Centro','Campinas','SP','3509502') returning *`,
      [companyId, kind, name, doc, phone, email, String(100 + cust.length * 37)]);
    const e = await ins(
      `insert into equipment (company_id, customer_id, category, description, brand, model, serial) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [companyId, c.id, ...eq]);
    cust.push({ ...c, equipment: e });
  }

  const S = (n, qty = 1) => ({ kind: 'servico', service_id: svc[n].id, description: n, qty, unit_price: Number(svc[n].price), discount: 0 });
  const M = (n, qty = 1) => ({ kind: 'material', product_id: prod[n].id, description: n, qty, unit_price: Number(prod[n].price), discount: 0 });
  const settings = DEFAULT_SETTINGS;
  let number = 0;

  async function order({ c, tech, status, items = [], daysAgo, promise = 3, problem, diagnosis, solution, priority = 'normal', pay = [], later = [], discount = 0, kind = 'os', location = 'oficina' }) {
    number += 1;
    const { items: prepared, subtotal } = await prepareItems(db, companyId, items, { defaultTechnician: tech?.id });
    const total = round2(subtotal - discount);
    const received = ago(daysAgo, 9);
    const delivered = status === 'entregue' ? new Date(received.getTime() + Math.max(1, promise - 1) * DAY + 7 * 3600000) : null;
    const o = await ins(
      `insert into orders (company_id, number, kind, customer_id, equipment_id, technician_id, status, priority, service_location,
              received_at, promised_at, finished_at, delivered_at, problem, diagnosis, solution, subtotal, discount, total,
              warranty_days, warranty_until, public_token, created_by, started_at, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$10) returning *`,
      [companyId, number, kind, c?.id || null, kind === 'os' ? c?.equipment.id : null, tech?.id || null, status, priority, location,
        received, kind === 'os' ? new Date(received.getTime() + promise * DAY) : null,
        ['pronta', 'entregue'].includes(status) ? delivered || ago(0, 8) : null, delivered,
        problem || null, diagnosis || null, solution || null, subtotal, discount, total, kind === 'os' ? 90 : 0,
        delivered ? new Date(delivered.getTime() + 90 * DAY) : null, publicToken(), userId,
        ['em_execucao', 'pronta', 'entregue'].includes(status) ? received : null]);
    await insertItems(db, 'order_items', 'order_id', o.id, prepared);
    await syncOrderStock(db, o, userId, settings);
    await logEvent(db, o.id, { type: 'criacao', to: 'aberta', message: kind === 'venda' ? 'Venda de balcão' : 'OS aberta', isPublic: true, userId });
    if (status !== 'aberta') await logEvent(db, o.id, { type: 'status', from: 'aberta', to: status, isPublic: true, userId });
    const label = kind === 'venda' ? `Venda nº ${number}` : `OS nº ${number}`;
    const cat = kind === 'venda' ? 'Venda de materiais' : 'Ordens de serviço';
    const when = delivered || received;
    for (const [method, amount] of pay) {
      await db.query(
        `insert into transactions (company_id, type, category, description, amount, method, due_date, paid_at, order_id, customer_id, auto, created_by, created_at)
         values ($1,'entrada',$2,$3,$4,$5,$6::date,$6,$7,$8,true,$9,$6)`, [companyId, cat, label, amount, method, when, o.id, c?.id || null, userId]);
      const fee = settings.paymentMethods.find((m) => m.id === method)?.fee || 0;
      if (fee) {
        await db.query(
          `insert into transactions (company_id, type, category, description, amount, method, due_date, paid_at, order_id, auto, created_by, created_at)
           values ($1,'saida','Taxas de cartão',$2,$3,$4,$5::date,$5,$6,true,$7,$5)`,
          [companyId, `Taxa — ${label}`, round2(amount * fee / 100), method, when, o.id, userId]);
      }
    }
    for (const [days, amount] of later) {
      await db.query(
        `insert into transactions (company_id, type, category, description, amount, method, due_date, order_id, customer_id, auto, created_by)
         values ($1,'entrada',$2,$3,$4,'boleto',current_date + $5::int,$6,$7,true,$8)`,
        [companyId, cat, `${label} — a receber`, amount, days, o.id, c?.id || null, userId]);
    }
    return o;
  }

  const [horizonte, marcos, rotasul, ana, fazenda, roberto] = cust;
  const [carlos, rafael, joao] = techs;

  // Entregues (histórico dos últimos 30 dias)
  await order({ c: horizonte, tech: joao, status: 'entregue', daysAgo: 26, promise: 4, problem: 'Máquina não abre arco, ventilador não liga.',
    diagnosis: 'Placa de controle com trilha rompida e ventilador queimado.', solution: 'Recuperada a placa, trocado ventilador e feita preventiva.',
    items: [S('Diagnóstico técnico'), S('Manutenção preventiva de máquina de solda'), M('Tocha TIG WP-26 (reposição)')], pay: [['pix', 750]] });
  await order({ c: ana, tech: carlos, status: 'entregue', daysAgo: 21, promise: 2, problem: 'Pé da mesa de inox soltou.',
    items: [S('Solda TIG em inox (hora)', 1.5), M('Vareta TIG ER308L inox 2,4mm', 0.2), M('Gás argônio puro (m³)', 1)], pay: [['credito', 346]] });
  await order({ c: fazenda, tech: carlos, status: 'entregue', daysAgo: 18, promise: 5, priority: 'alta', location: 'externo',
    problem: 'Eixo da grade aradora quebrado — atendimento na fazenda.',
    items: [S('Visita técnica / deslocamento'), S('Solda com eletrodo revestido (hora)', 3), M('Eletrodo 7018 3,25mm', 2)],
    pay: [['pix', 300]], later: [[12, 200]] });
  await order({ c: rotasul, tech: rafael, status: 'entregue', daysAgo: 12, promise: 3, problem: 'Longarina do baú trincada.',
    items: [S('Solda MIG/MAG em aço carbono (hora)', 4), M('Chapa aço carbono 1/8" (kg)', 18), M('Gás mistura Ar/CO2 (m³)', 2), M('Fundo zarcão (galão 3,6L)')],
    pay: [['boleto', 500]], later: [[-3, 474], [27, 400]], discount: 18 });
  await order({ c: null, status: 'entregue', kind: 'venda', daysAgo: 9, items: [M('Disco de corte 7"', 10), M('Eletrodo 6013 2,5mm', 2)], pay: [['dinheiro', 230]] });
  await order({ c: marcos, tech: rafael, status: 'entregue', daysAgo: 6, promise: 2, problem: 'Portão arrastando, roldanas gastas.',
    items: [S('Conserto de portão (roldanas, trilho, solda)'), M('Roldana para portão 2" canal V', 4)], pay: [['dinheiro', 460]] });
  await order({ c: null, status: 'entregue', kind: 'venda', daysAgo: 2, items: [M('Metalon 30x30 #18 (barra 6m)', 4), M('Disco flap 4.1/2" grão 80', 2)], pay: [['debito', 416]] });

  // Em andamento
  await order({ c: roberto, tech: carlos, status: 'em_execucao', daysAgo: 3, promise: 5, priority: 'alta',
    problem: 'Cabeçote com trinca entre sede de válvula e câmara de água.', diagnosis: 'Trinca de 4 cm, recuperável com solda a quente em ferro fundido.',
    items: [S('Recuperação de trinca em bloco/cabeçote')] });
  await order({ c: horizonte, tech: carlos, status: 'aguardando_aprovacao', daysAgo: 2, promise: 4,
    problem: 'Reforma de 3 bancadas de inox da linha de produção.', diagnosis: 'Soldas trincadas e pés desalinhados.',
    items: [S('Solda TIG em inox (hora)', 6), M('Vareta TIG ER308L inox 2,4mm', 0.8), M('Gás argônio puro (m³)', 3)] });
  await order({ c: fazenda, tech: joao, status: 'aguardando_material', daysAgo: 4, promise: 7,
    problem: 'Máquina MIG da fazenda sem alimentação de arame.', diagnosis: 'Motor do alimentador queimado — peça encomendada.',
    items: [S('Diagnóstico técnico')] });
  await order({ c: marcos, tech: rafael, status: 'pronta', daysAgo: 5, promise: 4,
    problem: 'Fabricação de grade para janela 1,2 x 1,0 m.',
    items: [S('Grade de proteção sob medida (m²)', 1.2), M('Tubo redondo 1" #18 (barra 6m)', 2), M('Fundo zarcão (galão 3,6L)')], pay: [['pix', 250]] });
  await order({ c: rotasul, tech: null, status: 'aberta', daysAgo: 0, promise: 3, priority: 'urgente',
    problem: 'Suporte do para-choque traseiro soltou — veículo parado.' });

  // Orçamentos
  async function quote(c, title, items, status, daysAgo) {
    const { items: prepared, subtotal } = await prepareItems(db, companyId, items);
    const n = (await db.query('select coalesce(max(number),0)+1 as n from quotes where company_id=$1', [companyId])).rows[0].n;
    const qt = await ins(
      `insert into quotes (company_id, number, customer_id, equipment_id, title, status, valid_until, subtotal, total, warranty_days,
              delivery_days, payment_terms, terms, public_token, created_by, created_at)
       values ($1,$2,$3,$4,$5,$6,current_date + 15 - $7::int,$8,$8,90,7,'50% na aprovação, 50% na entrega',$9,$10,$11, now() - ($7::text || ' days')::interval) returning *`,
      [companyId, n, c.id, c.equipment.id, title, status, daysAgo, subtotal, settings.orders.termsQuote, publicToken(), userId]);
    await insertItems(db, 'quote_items', 'quote_id', qt.id, prepared);
    if (status === 'enviado') await db.query("update quotes set revision = 1, sent_at = created_at, sent_via = 'whatsapp' where id = $1", [qt.id]);
    return qt;
  }
  const qPortao = await quote(marcos, 'Portão basculante novo 3,0 x 2,4 m', [
    S('Fabricação de portão basculante (m²)', 7.2), S('Instalação de portão/grade'),
    M('Metalon 50x30 #18 (barra 6m)', 8), M('Chapa aço carbono 1/8" (kg)', 30), M('Esmalte sintético preto (galão 3,6L)', 2),
  ], 'enviado', 1);
  await quote(ana, 'Bancada de inox 2,0 m com cuba', [S('Solda TIG em inox (hora)', 8), M('Chapa inox 304 1,5mm (kg)', 35)], 'rascunho', 0);

  // Solicitações de atendimento (entrada → triagem/visita → orçamento)
  const unitId = (await db.query('select id from units where company_id = $1 and is_default', [companyId])).rows[0]?.id || null;
  async function request(n, data) {
    const r = await ins(
      `insert into service_requests (company_id, number, unit_id, customer_id, contact_name, contact_phone, channel, equipment_id, title, description,
              service_location, address, priority, status, visit_at, visit_technician_id, diagnosis, quote_id, created_by, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19, now() - ($20::text || ' hours')::interval) returning *`,
      [companyId, n, unitId, data.c?.id || null, data.contact || null, data.phone || null, data.channel, data.c?.equipment?.id || null, data.title,
        data.description || null, data.location || 'oficina', data.address || null, data.priority || 'normal', data.status, data.visit || null,
        data.tech?.id || null, data.diagnosis || null, data.quote?.id || null, userId, data.hoursAgo || 1]);
    await db.query('insert into request_events (request_id, to_status, message, user_id, created_at) values ($1,$2,$3,$4,$5)',
      [r.id, 'nova', `Solicitação registrada (${data.channel})`, userId, r.created_at]);
    if (data.status !== 'nova') await db.query('insert into request_events (request_id, from_status, to_status, user_id) values ($1,$2,$3,$4)', [r.id, 'nova', data.status, userId]);
    if (data.quote) await db.query('update quotes set request_id = $2 where id = $1', [data.quote.id, r.id]);
  }
  await request(1, { c: marcos, channel: 'whatsapp', title: 'Portão basculante novo para garagem', status: 'orcada', quote: qPortao, location: 'externo',
    address: 'Endereço do cliente', diagnosis: 'Vão de 3,0 x 2,4 m; estrutura existente aproveitável.', hoursAgo: 30 });
  await request(2, { c: fazenda, channel: 'telefone', title: 'Implemento com chassi trincado', status: 'visita_agendada', location: 'externo', tech: joao,
    visit: brAt(1, 14).toISOString(), description: 'Trinca na longarina da plantadeira; precisa avaliar no local.', priority: 'alta', hoursAgo: 5 });
  await request(3, { contact: 'Cláudio Moreira', phone: '(19) 99876-1122', channel: 'presencial', title: 'Soldar suporte de ar-condicionado', status: 'nova', hoursAgo: 2 });

  // Operação técnica: agenda, apontamentos, inspeção e garantia
  await ensureCompanyDefaults(db, companyId);
  const byStatus = async (st) => (await db.query('select * from orders where company_id = $1 and status = $2 and kind = $3 order by number', [companyId, st, 'os'])).rows;
  const hourAt = brAt;
  const sched = (kind, title, o, tech, start, hours, status = 'agendado', extra = {}) => db.query(
    `insert into schedule_entries (company_id, unit_id, kind, title, order_id, request_id, technician_id, starts_at, ends_at, location, status, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [companyId, unitId, kind, title, o?.id || null, extra.request_id || null, tech?.id || null, start, new Date(start.getTime() + hours * 3600000),
      extra.location || null, status, userId]);
  const tlog = (o, tech, startsAt, minutes, activity = 'execucao', open = false) => db.query(
    `insert into order_time_logs (company_id, order_id, technician_id, user_id, activity, started_at, ended_at, minutes, hourly_cost, cost)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [companyId, o.id, tech.id, userId, activity, startsAt, open ? null : new Date(startsAt.getTime() + minutes * 60000), open ? null : minutes,
      tech.hourly_cost || 45, open ? null : round2(minutes / 60 * Number(tech.hourly_cost || 45))]);
  const [emExec] = await byStatus('em_execucao');
  const [pronta] = await byStatus('pronta');
  const [aprovadaMat] = await byStatus('aguardando_material');
  const entregues = await byStatus('entregue');
  const visitReq = (await db.query("select * from service_requests where company_id = $1 and status = 'visita_agendada' limit 1", [companyId])).rows[0];
  if (visitReq) await sched('visita', `Visita — ${visitReq.title}`, null, joao, new Date(visitReq.visit_at), 1, 'agendado', { request_id: visitReq.id, location: visitReq.address });
  if (emExec) {
    const tech = techs.find((t) => t.id === emExec.technician_id) || carlos;
    await sched('execucao', `Execução OS nº ${emExec.number}`, emExec, tech, hourAt(0, 8), 8, 'em_andamento');
    await tlog(emExec, tech, hourAt(-1, 13), 150);
    await tlog(emExec, tech, new Date(Date.now() - 40 * 60000), 0, 'execucao', true);
    await refreshLabor(db, emExec.id);
  }
  if (pronta) {
    const tech = techs.find((t) => t.id === pronta.technician_id) || rafael;
    await tlog(pronta, tech, hourAt(-2, 8), 210);
    await refreshLabor(db, pronta.id);
    const tpl = (await db.query("select * from checklist_templates where company_id = $1 and kind = 'inspecao' limit 1", [companyId])).rows[0];
    if (tpl) {
      await db.query(
        `insert into order_inspections (company_id, order_id, kind, template_id, items, result, notes, inspector_id) values ($1,$2,'inspecao',$3,$4,'aprovado',null,$5)`,
        [companyId, pronta.id, tpl.id, JSON.stringify(tpl.items.map((label) => ({ label, result: 'ok' }))), userId]);
      await db.query("update orders set inspection_result = 'aprovado' where id = $1", [pronta.id]);
    }
    await sched('entrega', `Entrega OS nº ${pronta.number}`, pronta, tech, hourAt(1, 10), 1);
  }
  if (aprovadaMat) await sched('execucao', `Execução OS nº ${aprovadaMat.number} (após chegada do material)`, aprovadaMat, joao, hourAt(2, 8), 6);
  if (entregues[0]) {
    await db.query(
      `insert into warranty_claims (company_id, number, order_id, customer_id, within_warranty, description, opened_by)
       values ($1, 1, $2, $3, true, 'Cliente relata que a máquina voltou a desarmar após 2 semanas de uso.', $4)`,
      [companyId, entregues[0].id, entregues[0].customer_id, userId]);
  }

  // Entrada de materiais recebida
  const pu = await ins(
    `insert into purchases (company_id, number, supplier_id, invoice_number, issue_date, received_at, status, subtotal, total, created_by, created_at)
     values ($1,1,$2,'45872',current_date - 8, now() - interval '8 days','recebida',1240,1240,$3, now() - interval '8 days') returning *`,
    [companyId, sup[1].id, userId]);
  await db.query(
    `insert into purchase_items (purchase_id, product_id, description, unit, qty, unit_cost, total, position) values
      ($1,$2,'Metalon 30x30 #18 (barra 6m)','br',10,62,620,0), ($1,$3,'Chapa aço carbono 1/8" (kg)','kg',72.94,8.5,620,1)`,
    [pu.id, prod['Metalon 30x30 #18 (barra 6m)'].id, prod['Chapa aço carbono 1/8" (kg)'].id]);
  await db.query(
    `insert into transactions (company_id, type, category, description, amount, method, due_date, paid_at, purchase_id, supplier_id, document, auto, created_by) values
      ($1,'saida','Compra de materiais','Entrada nº 1 (1/2)',620,'boleto',current_date - 8, now() - interval '8 days',$2,$3,'45872',true,$4),
      ($1,'saida','Compra de materiais','Entrada nº 1 (2/2)',620,'boleto',current_date + 22, null,$2,$3,'45872',true,$4)`,
    [companyId, pu.id, sup[1].id, userId]);

  // Despesas do mês
  for (const [cat, desc, amount, d, paid] of [
    ['Aluguel', 'Aluguel do galpão', 3800, 20, true],
    ['Energia elétrica', 'Conta de energia (trifásico)', 1460, 15, true],
    ['Gases e consumíveis', 'Recarga cilindros argônio', 520, 11, true],
    ['Água/Internet/Telefone', 'Internet + telefone', 189.9, 10, true],
    ['Ferramentas e EPI', 'Máscaras de solda automáticas (2)', 598, 7, true],
    ['Salários', 'Folha — ajudante', 2300, -5, false],
    ['Impostos', 'DAS Simples Nacional', 980, -12, false],
  ]) {
    await db.query(
      `insert into transactions (company_id, type, category, description, amount, method, due_date, paid_at, created_by)
       values ($1,'saida',$2,$3,$4,'pix',current_date - $5::int, case when $6 then now() - ($5::text || ' days')::interval end, $7)`,
      [companyId, cat, desc, amount, d, paid, userId]);
  }
}
