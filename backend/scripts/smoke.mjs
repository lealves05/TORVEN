// Teste de fumaça ponta a ponta da API.
// Uso: API=http://localhost:3333 node scripts/smoke.mjs
// Com MOCK_FOCUS=4999 sobe um simulador da Focus NFe (a API deve rodar com FOCUS_URL_HOMOLOGACAO=http://localhost:4999).
import http from 'node:http';

const API = process.env.API || 'http://localhost:3333';
let token = '';
const call = async (method, path, body, expect = [200, 201, 204]) => {
  const res = await fetch(`${API}/api${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json();
  if (!expect.includes(res.status)) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
};
const ok = (cond, msg) => { if (!cond) throw new Error('FALHOU: ' + msg); console.log('✓', msg); };
const near = (a, b) => Math.abs(a - b) < 0.011;

// ---------- simulador Focus NFe ----------
let mock;
const focusCalls = [];
if (process.env.MOCK_FOCUS) {
  const notes = {};
  const empresas = {};
  mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; }).on('end', () => {
      const url = new URL(req.url, 'http://x');
      focusCalls.push({ method: req.method, path: url.pathname, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
      const [, , kind, refPath] = url.pathname.split('/');
      const ref = url.searchParams.get('ref') || refPath;
      res.setHeader('Content-Type', 'application/json');
      const user = Buffer.from((req.headers.authorization || '').replace('Basic ', ''), 'base64').toString().replace(/:$/, '');
      if (kind === 'empresas') {
        if (user !== 'CONTA-PRINCIPAL-TOKEN') { res.statusCode = 401; return res.end('HTTP Basic: Access denied'); }
        const b = body ? JSON.parse(body) : {};
        if (req.method === 'GET' && !refPath) return res.end(JSON.stringify(Object.values(empresas).filter((e) => !url.searchParams.get('cnpj') || e.cnpj === url.searchParams.get('cnpj'))));
        if (req.method === 'GET') { const e = empresas[refPath]; res.statusCode = e ? 200 : 404; return res.end(JSON.stringify(e || { codigo: 'nao_encontrado' })); }
        if (req.method === 'POST' && (!b.cnpj || !b.arquivo_certificado_base64)) {
          res.statusCode = 422; return res.end(JSON.stringify({ codigo: 'erro_validacao', erros: [{ campo: 'arquivo_certificado_base64', mensagem: 'obrigatório' }] }));
        }
        if (b.senha_certificado === 'errada') { res.statusCode = 422; return res.end(JSON.stringify({ codigo: 'erro_validacao', erros: [{ mensagem: 'Houve um erro ao instalar o certificado, verifique se a senha está correto' }] })); }
        const id = refPath || String(100 + Object.keys(empresas).length);
        const e = { ...(empresas[id] || {}), ...b, id: Number(id), token_producao: 'PROD-TOKEN-XYZ9', token_homologacao: 'HOM-TOKEN-XYZ9',
          certificado_valido_ate: '2027-06-30T23:59:59-03:00', certificado_valido_de: '2026-06-30T00:00:00-03:00', certificado_cnpj: b.cnpj || empresas[id]?.cnpj };
        delete e.arquivo_certificado_base64; delete e.senha_certificado;
        if (url.searchParams.get('dry_run') !== '1') empresas[id] = e;
        return res.end(JSON.stringify(e));
      }
      if (user === 'INVALIDO') { res.statusCode = 401; return res.end('HTTP Basic: Access denied'); }
      if (req.method === 'POST') {
        notes[ref] = { kind, status: 'processando_autorizacao' };
        res.statusCode = 202; return res.end(JSON.stringify({ ref, status: 'processando_autorizacao' }));
      }
      if (req.method === 'GET') {
        const n = notes[ref];
        if (!n) { res.statusCode = 404; return res.end(JSON.stringify({ codigo: 'nao_encontrado', mensagem: 'Nota não encontrada' })); }
        if (n.status !== 'cancelado') n.status = 'autorizado';
        return res.end(JSON.stringify(kind === 'nfe'
          ? { status: n.status, numero: '101', serie: '1', chave_nfe: 'NFe35260911222333000144550010000001011000000010', caminho_danfe: `/arquivos/${ref}.pdf`, caminho_xml_nota_fiscal: `/arquivos/${ref}.xml` }
          : { status: n.status, numero: '2026000001', codigo_verificacao: 'AB12CD34', url_danfse: `https://nfse.gov.br/danfse/${ref}`, caminho_xml_nota_fiscal: `/arquivos/${ref}.xml` }));
      }
      if (req.method === 'DELETE') {
        notes[ref].status = 'cancelado';
        return res.end(JSON.stringify({ status: 'cancelado' }));
      }
      res.statusCode = 405; res.end('{}');
    });
  }).listen(Number(process.env.MOCK_FOCUS));
}

try {
  const email = `teste${Date.now()}@torven.app`;
  const reg = await call('POST', '/auth/register', { companyName: 'Serralheria Teste', name: 'Dono', email, password: '123456', demo: true });
  token = reg.token;
  ok(reg.company.slug && reg.user.role === 'owner', 'cadastro da empresa + proprietário');

  const [techs, svcs, prods, custs, sups] = await Promise.all(['/technicians', '/services', '/products', '/customers', '/suppliers'].map((p) => call('GET', p)));
  ok(techs.length === 3 && svcs.length === 14 && prods.length === 20 && custs.length === 6 && sups.length === 3, 'dados de exemplo criados');

  const dash = await call('GET', '/dashboard');
  ok(dash.open >= 5 && dash.finance.series.length === 30 && dash.quotes.n === 2, `dashboard (abertas ${dash.open}, prontas ${dash.ready})`);

  // ---------- cliente + equipamento ----------
  const c = await call('POST', '/customers', { kind: 'pj', name: 'Cliente Novo Ltda', document: '11.444.777/0001-61', phone: '(19) 98888-0000',
    cep: '13010-000', street: 'Rua A', number: '10', district: 'Centro', city: 'Campinas', uf: 'SP', city_code: '3509502', email: 'c@x.com' });
  const eq = await call('POST', `/customers/${c.id}/equipment`, { category: 'Máquina de solda', description: 'Inversora TIG 200A', brand: 'Sumig', serial: 'X1' });
  ok(eq.customer_id === c.id, 'cliente e equipamento cadastrados');

  // ---------- orçamento → OS ----------
  const svTig = svcs.find((s) => s.name.startsWith('Solda TIG em inox'));
  const vareta = prods.find((p) => p.name.startsWith('Vareta TIG ER308L'));
  const stock0 = vareta.stock;
  const qt = await call('POST', '/quotes', {
    customer_id: c.id, equipment_id: eq.id, title: 'Reparo carcaça inox',
    items: [
      { kind: 'servico', service_id: svTig.id, description: svTig.name, qty: 2, unit_price: 160 },
      { kind: 'material', product_id: vareta.id, description: vareta.name, qty: 0.5, unit_price: 190 },
      { kind: 'avulso', description: 'Polimento', qty: 1, unit_price: 50, discount: 10 },
      { kind: 'deslocamento', description: 'Retirada no cliente', qty: 1, unit_price: 80, optional: true },
    ], discount: 5,
  });
  ok(qt.total === 320 + 95 + 40 - 5 && qt.number === 3 && qt.public_token, `orçamento nº ${qt.number} total ${qt.total} (opcional fora do total)`);
  ok(qt.cost_total > 0 && qt.margin != null, `custo ${qt.cost_total} e margem ${qt.margin} calculados`);

  token = '';
  await call('GET', `/public/quote/${qt.public_token}`, null, [404]);
  ok(true, 'rascunho não aparece no link público');
  token = reg.token;
  const sent = await call('POST', `/quotes/${qt.id}/send`, { via: 'link' });
  ok(sent.status === 'enviado' && sent.revision === 1 && sent.versions.length === 1, 'envio registra a revisão 1');
  token = '';
  const pub = await call('GET', `/public/quote/${qt.public_token}`);
  ok(pub.quote.items.length === 4 && pub.company.name && pub.quote.status === 'aguardando_decisao', 'link público abre e marca "aguardando decisão"');
  await call('POST', `/public/quote/${qt.public_token}/approve`, { name: 'Cliente' });
  token = reg.token;
  const qt2 = await call('GET', `/quotes/${qt.id}`);
  ok(qt2.status === 'aprovado' && qt2.approved_total === 450 && qt2.approvals[0].via === 'link', 'cliente aprovou pelo link (registro de aprovação)');

  const conv = await call('POST', `/quotes/${qt.id}/convert`, { technician_id: techs[0].id });
  let os = await call('GET', `/orders/${conv.order_id}`);
  ok(os.status === 'aprovada' && os.total === 450 && os.items.length === 3, `orçamento convertido em OS nº ${os.number}`);
  ok(os.items[0].commission_value === 32, `comissão calculada (${os.items[0].commission_value})`);
  let p = (await call('GET', '/products')).find((x) => x.id === vareta.id);
  ok(near(p.stock, stock0 - 0.5), `estoque baixou ao lançar material (${stock0} → ${p.stock})`);

  // edita itens: aumenta material → estoque acompanha
  os = await call('PUT', `/orders/${os.id}`, { ...os, items: os.items.map((i) => (i.kind === 'material' ? { ...i, qty: 1 } : i)) });
  p = (await call('GET', '/products')).find((x) => x.id === vareta.id);
  ok(near(p.stock, stock0 - 1) && os.total === 545, 'edição da OS sincroniza estoque e total');

  os = await call('POST', `/orders/${os.id}/status`, { status: 'em_execucao', message: 'Iniciado' });
  ok(os.started_at && os.events.some((e) => e.to_status === 'em_execucao'), 'mudança de status registrada no histórico');
  os = await call('POST', `/orders/${os.id}/status`, { status: 'pronta' });

  // pagamentos: sinal pix + parcela a receber + dinheiro com troco na entrega
  let pay = await call('POST', `/orders/${os.id}/payments`, { payments: [{ method: 'pix', amount: 200 }] });
  ok(pay.order.paid === 200 && pay.order.balance === 345, 'sinal recebido');
  os = await call('POST', `/orders/${os.id}/deliver`, {
    payments: [{ method: 'dinheiro', amount: 200 }], installments: [{ due_date: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10), amount: 150 }],
  });
  ok(os.status === 'entregue' && os.paid === 395 && os.receivable === 150 && near(os.balance, 0) && os.warranty_until, 'entrega com troco, parcela a receber e garantia');
  const extra = await call('POST', `/orders/${os.id}/payments`, { payments: [{ method: 'pix', amount: 10 }] }, [400]);
  ok(extra.error, 'bloqueia pagamento acima do saldo');

  // público: acompanhamento da OS
  token = '';
  const track = await call('GET', `/public/order/${os.public_token}`);
  ok(track.order.status === 'entregue' && track.order.events.length >= 3, 'acompanhamento público da OS');
  token = reg.token;

  // ---------- venda de balcão ----------
  const disco = prods.find((x) => x.name.startsWith('Disco de corte'));
  const sale = await call('POST', '/orders/quick-sale', { items: [{ kind: 'material', product_id: disco.id, description: disco.name, qty: 3, unit_price: 14 }],
    payments: [{ method: 'dinheiro', amount: 50 }] });
  ok(sale.order.kind === 'venda' && sale.order.status === 'entregue' && sale.change === 8, `venda de balcão com troco ${sale.change}`);

  // ---------- caixa ----------
  await call('POST', '/cash/session/open', { opening_amount: 100 });
  const s2 = await call('POST', '/orders/quick-sale', { items: [{ kind: 'material', product_id: disco.id, description: disco.name, qty: 1, unit_price: 14 }],
    payments: [{ method: 'dinheiro', amount: 20 }] });
  await call('POST', '/cash/transactions', { type: 'saida', category: 'Sangria', description: 'Sangria', amount: 30, method: 'dinheiro' });
  let sess = await call('GET', '/cash/session');
  ok(sess.expected_cash === 100 + 14 - 30 && sess.sales_count === 1, `caixa: esperado ${sess.expected_cash}`);
  const closed = await call('POST', '/cash/session/close', { closing_amount: 84 });
  ok(closed.difference === 0, 'fechamento de caixa conferido');
  ok(s2.change === 6, 'troco no caixa');

  // ---------- cancelamento de OS devolve estoque e estorna ----------
  const chapa = prods.find((x) => x.name.startsWith('Chapa aço carbono'));
  const st1 = (await call('GET', '/products')).find((x) => x.id === chapa.id).stock;
  let o2 = await call('POST', '/orders', { customer_id: c.id, equipment: { description: 'Portão lateral' }, problem: 'Portão empenado',
    items: [{ kind: 'material', product_id: chapa.id, description: chapa.name, qty: 10, unit_price: 14 }] });
  ok(o2.equipment_id && o2.number > 0, `OS nº ${o2.number} com equipamento novo`);
  await call('POST', `/orders/${o2.id}/payments`, { payments: [{ method: 'pix', amount: 50 }] });
  o2 = await call('POST', `/orders/${o2.id}/cancel`, { reason: 'Cliente desistiu' });
  const st2 = (await call('GET', '/products')).find((x) => x.id === chapa.id).stock;
  ok(o2.status === 'cancelada' && near(st1, st2) && o2.paid === 0, 'cancelamento devolve estoque e estorna pagamento');

  // ---------- entrada de materiais ----------
  const metalon = prods.find((x) => x.name.startsWith('Metalon 50x30'));
  const pur = await call('POST', '/purchases', {
    supplier_id: sups[1].id, invoice_number: '9988', issue_date: new Date().toISOString().slice(0, 10), freight: 20,
    items: [
      { product_id: metalon.id, description: metalon.name, qty: 10, unit_cost: 90 },
      { description: 'Barra chata 1"x1/4" (6m)', unit: 'br', qty: 5, unit_cost: 36, category: 'Cantoneiras e barras', sale_price: 60 },
    ],
    receive: true,
    installments: [{ due_date: new Date().toISOString().slice(0, 10), amount: 500, method: 'pix', paid: true }, { due_date: '2026-12-01', amount: 600 }],
  });
  ok(pur.status === 'recebida' && pur.total === 1100 && pur.payables.length === 2, `entrada de materiais nº ${pur.number} (${pur.total})`);
  const prods2 = await call('GET', '/products');
  const m2 = prods2.find((x) => x.id === metalon.id);
  ok(near(m2.stock, metalon.stock + 10), 'estoque aumentou com a entrada');
  ok(prods2.some((x) => x.name.startsWith('Barra chata') && x.stock === 5 && x.price === 60), 'material novo criado na entrada');
  const mov = await call('GET', `/products/${metalon.id}/movements`);
  ok(mov[0].purchase_number === pur.number, 'movimentação de estoque registrada');
  const bad1 = await call('POST', '/purchases', { items: [{ description: 'x', qty: 1, unit_cost: 10 }], receive: true,
    installments: [{ due_date: '2026-12-01', amount: 5 }] }, [400]);
  ok(bad1.error.includes('parcelas'), 'valida soma das parcelas');
  await call('POST', `/purchases/${pur.id}/cancel`, {}, [400]);
  ok(true, 'bloqueia cancelar entrada com parcela paga');

  await call('POST', `/products/${m2.id}/adjust`, { type: 'inventario', qty: 3, reason: 'Contagem física' });
  ok((await call('GET', '/products')).find((x) => x.id === m2.id).stock === 3, 'ajuste de inventário');

  // ---------- notas fiscais ----------
  const inv0 = await call('POST', '/invoices', { order_id: os.id, kind: 'nfse' });
  ok(inv0.status === 'preparada' && inv0.number === null && inv0.message.includes('Emissão indisponível'), 'sem integração fiscal: só prepara, sem número simulado');
  if (process.env.MOCK_FOCUS) {
    await call('PUT', '/company', { document: '11.222.333/0001-81', municipal_registration: '123456', state_registration: '244.555.666.777', phone: '(19) 3232-0000' });
    const f = await call('PUT', '/company/fiscal', { provider: 'focus', environment: 'homologacao', token_homologacao: 'TOKEN-TESTE-123' });
    ok(f.token_homologacao.endsWith('123') && f.token_homologacao.includes('•'), 'token fiscal salvo e mascarado');
    const prev = await call('GET', `/invoices/preview?order_id=${os.id}&kind=nfse`);
    ok(prev.warnings.length === 0 && prev.amount > 0, `prévia NFS-e (${prev.amount})`);
    let nf = await call('POST', '/invoices', { order_id: os.id, kind: 'nfse' });
    ok(nf.status === 'processando' && focusCalls.at(-1).path === '/v2/nfsen', 'NFS-e nacional enviada à Focus');
    await call('POST', '/invoices', { order_id: os.id, kind: 'nfse' }, [400]);
    ok(true, 'bloqueia segunda NFS-e em processamento para a mesma OS');
    ok(focusCalls.at(-1).auth === `Basic ${Buffer.from('TOKEN-TESTE-123:').toString('base64')}`, 'autenticação Basic com token');
    ok(focusCalls.at(-1).body.cnpj_tomador === '11444777000161' && focusCalls.at(-1).body.numero_dps === 1, 'payload DPS com tomador e numeração');
    nf = await call('POST', `/invoices/${nf.id}/refresh`);
    ok(nf.status === 'autorizada' && nf.number === '2026000001' && nf.pdf_url, 'consulta: NFS-e autorizada');
    const nfe = await call('POST', '/invoices', { order_id: os.id, kind: 'nfe' });
    ok(focusCalls.at(-1).path === '/v2/nfe' && focusCalls.at(-1).body.items[0].codigo_ncm === '72230000', 'NF-e de materiais enviada com NCM');
    const nfe2 = await call('POST', `/invoices/${nfe.id}/refresh`);
    ok(nfe2.access_key && nfe2.pdf_url.startsWith('http://localhost'), 'NF-e autorizada com chave e DANFE');
    await call('POST', `/invoices/${nf.id}/cancel`, { reason: 'curta' }, [400]);
    const canc = await call('POST', `/invoices/${nf.id}/cancel`, { reason: 'Nota emitida em duplicidade para o cliente' });
    ok(canc.status === 'cancelada', 'cancelamento de NFS-e');

    // ---------- configuração fiscal guiada (cadastro na Focus) ----------
    let st = await call('GET', '/company/fiscal/status');
    ok(st.steps.length === 6 && st.steps[0].ok, `checklist fiscal (${st.steps.filter((x) => x.ok).length}/6 ok)`);
    const badAcc = await call('POST', '/company/fiscal/account', { account_token: 'TOKEN-ERRADO-000' }, [400]);
    ok(badAcc.error.includes('recusado'), 'token principal inválido é recusado');
    const acc = await call('POST', '/company/fiscal/account', { account_token: 'CONTA-PRINCIPAL-TOKEN' });
    ok(acc.found === false && acc.fiscal.account_token.includes('•'), 'conta Focus conectada (token mascarado)');
    const noCert = await call('POST', '/company/fiscal/register', {}, [400]);
    ok(noCert.error.includes('certificado'), 'exige certificado no primeiro cadastro');
    const wrong = await call('POST', '/company/fiscal/register', { certificate_base64: 'MIIQ', certificate_password: 'errada' }, [400]);
    ok(wrong.error.includes('senha'), 'erro de senha do certificado repassado');
    const dry = await call('POST', '/company/fiscal/register', { certificate_base64: 'data:application/x-pkcs12;base64,MIIQ', certificate_password: '1234', dry_run: true });
    ok(dry.dry_run && dry.action === 'criar', 'validação (dry run) do cadastro');
    const reg2 = await call('POST', '/company/fiscal/register', { certificate_base64: 'data:application/x-pkcs12;base64,MIIQ', certificate_password: '1234', next_dps_number: 57 });
    ok(reg2.action === 'criada' && reg2.fiscal.has_token_producao && reg2.fiscal.certificate.valid_until && reg2.fiscal.nextDpsNumber === 57, 'empresa + certificado cadastrados, tokens importados');
    const emp = focusCalls.filter((x) => x.path === '/v2/empresas').at(-1).body;
    ok(emp.cnpj === '11222333000181' && emp.habilita_nfsen_homologacao && emp.habilita_nfe && emp.regime_tributario === 1, 'payload da empresa (CNPJ, regime, documentos)');
    const upd = await call('POST', '/company/fiscal/register', {});
    ok(upd.action === 'atualizada', 'atualização do cadastro sem reenviar certificado');
    const conn = await call('POST', '/company/fiscal/test-connection');
    ok(conn.homologacao.ok && conn.producao.ok, 'teste de conexão nos dois ambientes');
    const ti = await call('POST', '/company/fiscal/test-invoice', { kind: 'nfse', customer_id: c.id });
    ok(ti.test && ti.environment === 'homologacao' && focusCalls.at(-1).auth.includes(Buffer.from('HOM-TOKEN-XYZ9:').toString('base64')), 'nota de teste enviada com o token de homologação importado');
    await call('POST', `/invoices/${ti.id}/refresh`);
    const tn = await call('POST', '/company/fiscal/test-invoice', { kind: 'nfe', customer_id: c.id });
    await call('POST', `/invoices/${tn.id}/refresh`);
    st = await call('GET', '/company/fiscal/status');
    ok(st.steps.find((x) => x.key === 'teste').ok && st.certificate.days_left > 0, 'checklist: testes autorizados e certificado válido');
    const prod = await call('PUT', '/company/fiscal', { environment: 'producao' });
    ok(prod.environment === 'producao', 'ambiente de produção ativado');
    await call('PUT', '/company/fiscal', { environment: 'homologacao' });
  }

  // ---------- financeiro / relatórios ----------
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + '01';
  const fin = await call('GET', `/reports/finance?from=${monthStart}&to=${today}`);
  ok(fin.totals.income > 0 && fin.dre.cmv >= 0, `relatório financeiro (receita ${fin.totals.income})`);
  const prodRep = await call('GET', `/reports/production?from=${new Date(Date.now() - 40 * 864e5).toISOString().slice(0, 10)}&to=${today}`);
  ok(prodRep.summary.n >= 7 && prodRep.technicians.length >= 2, `relatório de produção (${prodRep.summary.n} entregues)`);
  const tx = await call('GET', '/cash/transactions?status=vencido');
  ok(tx.items.length >= 1, 'contas vencidas listadas');
  const recv = tx.items.find((t) => t.type === 'entrada');
  if (recv) {
    await call('POST', `/cash/transactions/${recv.id}/pay`, { method: 'pix' });
    ok(true, 'baixa de conta a receber');
  }

  // ---------- perfis de acesso ----------
  await call('POST', '/users', { name: 'Técnico', email: `tec${Date.now()}@torven.app`, password: '123456', role: 'technician', technician_id: techs[0].id })
    .then(async (u) => {
      const login = await call('POST', '/auth/login', { email: u.email, password: '123456' });
      const ownerToken = token;
      token = login.token;
      const mine = await call('GET', '/orders');
      ok(mine.every((o) => o.total === null), 'técnico não vê valores');
      ok(mine.length > 0 && mine.length < (await (async () => { token = ownerToken; const all = await call('GET', '/orders'); token = login.token; return all.length; })()), `técnico vê só as próprias OS (${mine.length})`);
      await call('GET', '/cash/transactions', null, [403]);
      ok(true, 'técnico bloqueado no financeiro');
      token = ownerToken;
    });

  // ================= FASE 1 — base comercial =================
  const units = await call('GET', '/units');
  ok(units.length === 1 && units[0].is_default && units[0].name === 'Matriz', 'unidade principal criada');
  const un2 = await call('POST', '/units', { name: 'Oficina Sul', city: 'Campinas', uf: 'SP' });
  ok(un2.id && !un2.is_default, 'nova unidade cadastrada');

  const ct = await call('POST', `/customers/${c.id}/contacts`, { name: 'João Compras', role: 'Comprador', phone: '(19) 97777-1111', is_primary: true });
  const ad = await call('POST', `/customers/${c.id}/addresses`, { kind: 'execucao', label: 'Fábrica', street: 'Av. Industrial', number: '500', city: 'Paulínia', uf: 'SP' });
  const eq2 = await call('POST', `/customers/${c.id}/equipment`, { category: 'Estrutura', description: 'Portão basculante 4x3 m', material: 'Aço carbono', dimensions: '4000 x 3000 mm', quantity: 1, condition: 'Dobradiças quebradas' });
  const cdet = await call('GET', `/customers/${c.id}`);
  ok(cdet.contacts[0].id === ct.id && cdet.addresses[0].id === ad.id && cdet.equipment.some((x) => x.material === 'Aço carbono'), 'contatos, endereços e objetos com dimensões/material');

  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await call('POST', '/attachments', { entity: 'equipment', entity_id: eq2.id, filename: 'foto.png', mime: 'image/png', data: png, authorized: false }, [400]);
  const att = await call('POST', '/attachments', { entity: 'equipment', entity_id: eq2.id, filename: 'foto.png', mime: 'image/png', data: `data:image/png;base64,${png}`, caption: 'Recebimento' });
  const attList = await call('GET', `/attachments?entity=equipment&entity_id=${eq2.id}`);
  ok(attList.length === 1 && !attList[0].data && (await call('GET', `/attachments/${att.id}`)).data === png, 'foto autorizada anexada ao objeto');
  await call('POST', '/attachments', { entity: 'equipment', entity_id: eq2.id, filename: 'x.exe', mime: 'application/x-msdownload', data: png }, [400]);
  ok(true, 'bloqueia formato de arquivo não permitido');

  // solicitação → visita → diagnóstico → orçamento → aprovação parcial → OS
  let rq = await call('POST', '/requests', { customer_id: c.id, channel: 'whatsapp', equipment_id: eq2.id, title: 'Portão não fecha',
    description: 'Cliente relata portão arrastando', service_location: 'externo', address: 'Av. Industrial, 500 — Paulínia', priority: 'alta' });
  ok(rq.number === 4 && rq.status === 'nova' && rq.events.length === 1, `solicitação nº ${rq.number} registrada`);
  await call('POST', `/requests/${rq.id}/status`, { status: 'perdida' }, [400]);
  ok(true, 'perda exige motivo');
  rq = await call('POST', `/requests/${rq.id}/visit`, { visit_at: new Date(Date.now() + 86400000).toISOString(), visit_technician_id: techs[1].id });
  ok(rq.status === 'visita_agendada' && rq.visit_technician_name, 'visita técnica agendada');
  rq = await call('POST', `/requests/${rq.id}/diagnosis`, { diagnosis: 'Dobradiças rompidas e trilho empenado; soldar reforço.' });
  ok(rq.status === 'diagnosticada', 'diagnóstico registrado');
  const fromReq = await call('POST', `/requests/${rq.id}/quote`);
  rq = await call('GET', `/requests/${rq.id}`);
  ok(rq.status === 'em_orcamento' && rq.quote_id === fromReq.quote_id, `orçamento nº ${fromReq.number} iniciado pela solicitação`);
  let q3 = await call('GET', `/quotes/${fromReq.quote_id}`);
  ok(q3.scope?.includes('Dobradiças') && q3.request_id === rq.id && q3.total === 0, 'orçamento herda escopo/diagnóstico');
  const q3body = (items, extra = {}) => ({ customer_id: c.id, equipment_id: eq2.id, title: q3.title, scope: q3.scope, assumptions: 'Acesso livre ao local',
    exclusions: 'Pintura final', tax_rate: 6, surcharge: 20, items, ...extra });
  q3 = await call('PUT', `/quotes/${q3.id}`, q3body([
    { kind: 'servico', service_id: svTig.id, description: 'Solda de reforço nas dobradiças', qty: 3, unit_price: 150, group_label: 'Reparo' },
    { kind: 'deslocamento', description: 'Deslocamento', qty: 1, unit_price: 60 },
    { kind: 'terceiro', description: 'Guincho para retirada', qty: 1, unit_price: 300, group_label: 'Alternativa', optional: true },
  ]));
  ok(q3.total === 450 + 60 + 20 && q3.tax_amount === 31.8, `totais com acréscimo e tributo estimado (${q3.total} / ${q3.tax_amount})`);
  q3 = await call('POST', `/quotes/${q3.id}/send`, { via: 'whatsapp' });
  rq = await call('GET', `/requests/${rq.id}`);
  ok(q3.revision === 1 && rq.status === 'orcada', 'envio marca solicitação como orçada');
  q3 = await call('PUT', `/quotes/${q3.id}`, q3body(q3.items.map((i) => ({ ...i, unit_price: i.kind === 'servico' ? 140 : i.unit_price }))));
  ok(q3.status === 'rascunho' && q3.total === 420 + 60 + 20, 'alteração após envio volta a rascunho');
  q3 = await call('POST', `/quotes/${q3.id}/send`, { via: 'email' });
  ok(q3.revision === 2 && q3.versions.length === 2, 'nova revisão versionada (rev. 2)');
  const v1 = await call('GET', `/quotes/${q3.id}/versions/1`);
  ok(v1.snapshot.total === 530 && v1.snapshot.items.length === 3, 'revisão 1 preservada com valores originais');
  await call('POST', `/quotes/${q3.id}/convert`, {}, [400]);
  ok(true, 'OS só é gerada após aprovação');
  const svcItem = q3.items.find((i) => i.kind === 'servico');
  const optItem = q3.items.find((i) => i.optional);
  q3 = await call('POST', `/quotes/${q3.id}/decision`, { decision: 'parcialmente_aprovado', decided_by: 'João Compras', via: 'telefone',
    approved_item_ids: [svcItem.id, optItem.id], notes: 'Deslocamento por conta do cliente' });
  ok(q3.status === 'parcialmente_aprovado' && q3.approvals[0].revision === 2 && near(q3.approved_total, 420 + 300 + 20 * (420 / 480)), `aprovação parcial registrada (${q3.approved_total})`);
  await call('PUT', `/quotes/${q3.id}`, q3body(q3.items), [400]);
  ok(true, 'orçamento aprovado bloqueado para edição');
  const conv3 = await call('POST', `/quotes/${q3.id}/convert`, {});
  const os3 = await call('GET', `/orders/${conv3.order_id}`);
  ok(os3.items.filter((i) => i.description !== 'Acréscimos do orçamento').length === 2 && near(os3.total, q3.approved_total) && os3.quote_id === q3.id, `OS nº ${os3.number} só com itens aprovados (${os3.total})`);
  rq = await call('GET', `/requests/${rq.id}`);
  ok(rq.status === 'convertida' && rq.order_id === os3.id, 'solicitação concluída como convertida');
  await call('POST', `/requests/${rq.id}/status`, { status: 'em_triagem' }, [400]);
  ok(true, 'transição inválida bloqueada');

  // solicitação simples → OS direta; recusa → perdida
  const rq2 = await call('POST', '/requests', { contact_name: 'Pedro Avulso', contact_phone: '(19) 90000-0000', channel: 'presencial', title: 'Soldar suporte' });
  await call('POST', `/requests/${rq2.id}/order`, {}, [400]);
  ok(true, 'OS exige cliente cadastrado');
  const rq3 = await call('POST', '/requests', { customer_id: c.id, title: 'Grade de janela' });
  const o3 = await call('POST', `/requests/${rq3.id}/order`);
  ok(o3.number > 0 && (await call('GET', `/requests/${rq3.id}`)).status === 'convertida', 'OS direta a partir da solicitação');
  const rq4 = await call('POST', '/requests', { customer_id: c.id, title: 'Corrimão' });
  const q4 = await call('POST', `/requests/${rq4.id}/quote`);
  await call('PUT', `/quotes/${q4.quote_id}`, { customer_id: c.id, title: 'Corrimão', items: [{ kind: 'avulso', description: 'Corrimão inox', qty: 1, unit_price: 900 }] });
  await call('POST', `/quotes/${q4.quote_id}/decision`, { decision: 'recusado', decided_by: 'Cliente', via: 'presencial', notes: 'Preço' });
  const rq4b = await call('GET', `/requests/${rq4.id}`);
  ok(rq4b.status === 'perdida' && rq4b.lost_reason.includes('recusado'), 'recusa marca solicitação como perdida com motivo');

  const found = await call('GET', `/search?q=${encodeURIComponent('Portão')}`);
  ok(found.some((x) => x.type === 'equipment') && found.some((x) => x.type === 'request'), `busca global (${found.length} resultados)`);
  const byNum = await call('GET', `/search?q=${os3.number}`);
  ok(byNum.some((x) => x.type === 'order' && x.id === os3.id), 'busca por número da OS');
  const notif = await call('GET', '/notifications');
  ok(Array.isArray(notif.items) && notif.items.every((n) => n.link && n.count > 0), `notificações (${notif.items.length} alertas)`);

  const aud = await call('GET', '/audit?entity=quote');
  ok(aud.rows.some((x) => x.action === 'decision' && x.summary.includes('Parcialmente')) && aud.rows.some((x) => x.action === 'send'), `auditoria de orçamentos (${aud.total})`);
  const audAll = await call('GET', '/audit');
  ok(audAll.rows.some((x) => x.entity === 'invoice') && audAll.rows.some((x) => x.entity === 'unit'), 'auditoria de fiscal e unidades');
  const audPay = await call('GET', '/audit?entity=payment,stock,fiscal,cash');
  ok(audPay.rows.some((x) => x.entity === 'payment') && audPay.rows.some((x) => x.entity === 'stock') && audPay.rows.some((x) => x.entity === 'fiscal') && !JSON.stringify(audPay.rows).includes('CONTA-PRINCIPAL-TOKEN'), 'auditoria de pagamentos, estoque e fiscal (sem segredos)');

  // perfis
  const mk = async (role) => {
    const u = await call('POST', '/users', { name: `U ${role}`, email: `${role}${Date.now()}@torven.app`, password: '123456', role });
    return (await call('POST', '/auth/login', { email: u.email, password: '123456' })).token;
  };
  const ownerTok = token;
  const tEst = await mk('estimator');
  const tView = await mk('viewer');
  const tFin = await mk('finance');
  token = tEst;
  const qe = await call('POST', '/quotes', { customer_id: c.id, title: 'Orçamentista', items: [{ kind: 'avulso', description: 'X', qty: 1, unit_price: 10 }] });
  await call('POST', `/quotes/${qe.id}/decision`, { decision: 'aprovado', decided_by: 'X', via: 'presencial' }, [403]);
  await call('GET', '/cash/transactions', null, [403]);
  await call('GET', '/audit', null, [403]);
  ok(true, 'orçamentista: orça, mas não aprova, não vê caixa nem auditoria');
  token = tView;
  await call('POST', '/requests', { customer_id: c.id, title: 'x' }, [403]);
  ok((await call('GET', '/requests')).length >= 4, 'consulta: lê solicitações, não cria');
  await call('POST', '/users', { name: 'x', email: 'x@x.com', password: '123456', role: 'admin' }, [403]);
  token = tFin;
  await call('POST', '/requests', { customer_id: c.id, title: 'x' }, [403]);
  ok((await call('GET', '/cash/transactions')).items, 'financeiro: acessa caixa, não cria solicitação');
  token = ownerTok;
  await call('POST', '/users', { name: 'x', email: `own${Date.now()}@x.com`, password: '123456', role: 'owner' }, [400]);
  ok(true, 'não cria segundo proprietário');

  // ================= FASE 2 — operação técnica =================
  const tpls = await call('GET', '/quality/templates');
  ok(tpls.some((t) => t.kind === 'inspecao') && tpls.some((t) => t.kind === 'entrega'), 'checklists padrão criados');
  ok((await call('GET', '/schedule?kind=visita')).length >= 1, 'visita da solicitação aparece na agenda');
  const tomorrow = (h) => { const d = new Date(Date.now() + 86400000); d.setHours(h, 0, 0, 0); return d.toISOString(); };
  const ag = await call('POST', '/schedule', { kind: 'execucao', title: `Execução OS ${os3.number}`, order_id: os3.id, technician_id: techs[0].id, starts_at: tomorrow(8), ends_at: tomorrow(12) });
  const clash = await call('POST', '/schedule', { kind: 'entrega', title: 'Outra', technician_id: techs[0].id, starts_at: tomorrow(10), ends_at: tomorrow(11) }, [409]);
  ok(ag.technician_name && clash.conflicts?.length === 1, 'agenda com verificação de conflito por técnico');
  const forced = await call('POST', '/schedule', { kind: 'entrega', title: 'Outra', technician_id: techs[0].id, starts_at: tomorrow(10), ends_at: tomorrow(11), force: true });
  await call('DELETE', `/schedule/${forced.id}`);
  await call('POST', '/schedule', { kind: 'outro', title: 'x', starts_at: tomorrow(10), ends_at: tomorrow(9) }, [400]);
  ok(true, 'conflito confirmado grava; intervalo inválido bloqueado');

  let tl = await call('POST', `/production/orders/${os3.id}/time/start`, { technician_id: techs[0].id });
  let x3 = await call('GET', `/orders/${os3.id}`);
  ok(tl.id && x3.status === 'em_execucao' && x3.open_logs.length === 1, 'cronômetro iniciado e OS passa a "em execução"');
  await call('POST', `/orders/${os3.id}/status`, { status: 'pronta' }, [400]);
  ok(true, 'não marca pronta com cronômetro aberto');
  tl = await call('POST', `/production/time/${tl.id}/stop`, { notes: 'Soldagem das dobradiças' });
  ok(tl.ended_at && tl.minutes >= 1, `cronômetro encerrado (${tl.minutes} min)`);
  const y = (h) => { const d = new Date(Date.now() - 86400000); d.setHours(h, 0, 0, 0); return d.toISOString(); };
  await call('POST', `/production/orders/${os3.id}/time`, { technician_id: techs[0].id, started_at: y(8), ended_at: y(10), notes: 'Esqueci o cronômetro' });
  await call('POST', `/production/orders/${os3.id}/time`, { technician_id: techs[0].id, started_at: y(9), ended_at: y(11), notes: 'Sobreposto' }, [400]);
  await call('POST', `/production/orders/${os3.id}/time`, { technician_id: techs[0].id, started_at: tomorrow(8), ended_at: tomorrow(9), notes: 'Futuro' }, [400]);
  x3 = await call('GET', `/orders/${os3.id}`);
  ok(x3.labor_minutes >= 121 && x3.labor_cost > 0 && x3.time_logs.length === 2, `mão de obra real: ${x3.labor_minutes} min / R$ ${x3.labor_cost}`);
  ok(true, 'apontamento manual justificado; sobreposição e futuro bloqueados');

  const co = await call('GET', '/company');
  await call('PUT', '/company', { settings: { orders: { ...co.settings.orders, requireInspection: true, requireReceiver: true } } });
  await call('POST', `/orders/${os3.id}/status`, { status: 'pronta' }, [400]);
  ok(true, 'com inspeção obrigatória, não marca pronta sem inspeção aprovada');
  const tpl = tpls.find((t) => t.kind === 'inspecao');
  const itemsOk = tpl.items.map((label) => ({ label, result: 'ok' }));
  const itemsNok = tpl.items.map((label, i) => ({ label, result: i === 0 ? 'nok' : 'ok', note: i === 0 ? 'Porosidade no cordão' : null }));
  await call('POST', `/quality/orders/${os3.id}/inspections`, { kind: 'inspecao', template_id: tpl.id, items: itemsNok, result: 'aprovado' }, [400]);
  await call('POST', `/quality/orders/${os3.id}/inspections`, { kind: 'inspecao', template_id: tpl.id, items: itemsNok, result: 'reprovado' });
  x3 = await call('GET', `/orders/${os3.id}`);
  ok(x3.inspection_result === 'reprovado' && x3.inspections.length === 1, 'inspeção reprovada registrada');
  await call('POST', `/quality/orders/${os3.id}/inspections`, { kind: 'inspecao', template_id: tpl.id, items: itemsOk, result: 'aprovado' });
  x3 = await call('POST', `/orders/${os3.id}/status`, { status: 'pronta' });
  ok(x3.status === 'pronta', 'aprovada na inspeção → pronta');
  await call('POST', `/quality/orders/${os3.id}/inspections`, { kind: 'inspecao', items: itemsNok, result: 'reprovado', notes: 'Cliente apontou rebarba' });
  x3 = await call('GET', `/orders/${os3.id}`);
  ok(x3.status === 'em_execucao', 'reprovação após "pronta" devolve a OS para execução');
  await call('POST', `/quality/orders/${os3.id}/inspections`, { kind: 'inspecao', items: itemsOk, result: 'aprovado' });
  await call('POST', `/orders/${os3.id}/status`, { status: 'pronta' });
  await call('POST', `/orders/${os3.id}/deliver`, {}, [400]);
  ok(true, 'entrega exige quem recebeu (quando configurado)');
  x3 = await call('POST', `/orders/${os3.id}/deliver`, { received_by: 'João Compras', received_document: 'RG 12.345.678-9' });
  ok(x3.status === 'entregue' && x3.delivered_to === 'João Compras' && x3.warranty_until, 'entrega com recebedor e garantia calculada');
  await call('PUT', '/company', { settings: { orders: { ...co.settings.orders, requireInspection: false, requireReceiver: false } } });

  const wc = await call('POST', '/warranty', { order_id: os3.id, description: 'Dobradiça voltou a trincar' });
  ok(wc.within_warranty && wc.status === 'aberta', `garantia nº ${wc.number} aberta dentro do prazo`);
  await call('POST', '/warranty', { order_id: os3.id, description: 'Duplicada aqui' }, [400]);
  await call('POST', `/warranty/${wc.id}/status`, { status: 'improcedente' }, [400]);
  ok(true, 'garantia duplicada e parecer sem análise bloqueados');
  const rw = await call('POST', `/warranty/${wc.id}/rework`);
  const rwo = await call('GET', `/orders/${rw.order_id}`);
  ok(rwo.warranty_of === os3.id && rwo.total === 0 && rwo.priority === 'alta', `OS de retrabalho nº ${rw.number} sem custo ao cliente`);
  await call('POST', `/warranty/${wc.id}/status`, { status: 'concluida', resolution: 'Refeito' }, [400]);
  ok(true, 'garantia só conclui depois da entrega do retrabalho');
  const board = await call('GET', '/production/board');
  ok(board.technicians.length >= 3 && board.queue.length > 0 && Array.isArray(board.today), 'painel de produção (técnicos, fila e agenda do dia)');
  const ts = await call('GET', `/production/timesheet?from=${new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10)}`);
  ok(ts.totals.some((t) => t.technician_id === techs[0].id && t.minutes >= 121 && t.manual === 1), 'folha de horas por técnico');
  const aud2 = await call('GET', '/audit?entity=time,inspection,warranty,schedule');
  ok(['time', 'inspection', 'warranty', 'schedule'].every((e) => aud2.rows.some((x) => x.entity === e)), 'auditoria de agenda, apontamentos, inspeções e garantias');

  // técnico: só as próprias horas e a própria agenda
  const tecUser = await call('POST', '/users', { name: 'Téc 2', email: `tec2${Date.now()}@torven.app`, password: '123456', role: 'technician', technician_id: techs[1].id });
  const tecTok = (await call('POST', '/auth/login', { email: tecUser.email, password: '123456' })).token;
  token = tecTok;
  await call('POST', `/production/orders/${rw.order_id}/time/start`, { technician_id: techs[0].id }, [403, 404]);
  const tb = await call('GET', '/production/board');
  ok(tb.technicians.length === 1 && tb.technicians[0].id === techs[1].id, 'técnico vê só o próprio painel e não aponta por outro');
  await call('POST', '/schedule', { kind: 'outro', title: 'x', starts_at: tomorrow(14), ends_at: tomorrow(15) }, [403]);
  ok((await call('GET', '/schedule')).every((e) => e.technician_id === techs[1].id), 'técnico vê só a própria agenda e não programa');
  token = ownerTok;

  // ================= FASE 3 — materiais =================
  const sug = await call('GET', '/procurement/suggestions');
  ok(sug.length > 0 && sug.every((x) => x.suggested > 0), `sugestão de compra (${sug.length} materiais abaixo do mínimo)`);
  const prodsNow = await call('GET', '/products');
  const pA = prodsNow.find((x) => x.id === sug[0].id);
  const pB = prodsNow.find((x) => x.id === vareta.id);
  const cot = await call('POST', '/procurement/quotations', { title: 'Reposição semanal', supplier_ids: [sups[0].id, sups[1].id],
    items: [{ product_id: pA.id, description: pA.name, unit: pA.unit, qty: 10 }, { product_id: pB.id, description: pB.name, unit: pB.unit, qty: 2, order_id: os3.id }] });
  ok(cot.number >= 1 && cot.items.length === 2 && cot.suppliers.length === 2, `cotação nº ${cot.number} com 2 fornecedores`);
  const [ci1, ci2] = cot.items;
  const cot2 = await call('POST', `/procurement/quotations/${cot.id}/prices`, { prices: [
    { item_id: ci1.id, supplier_id: sups[0].id, unit_cost: 10, lead_days: 2 }, { item_id: ci1.id, supplier_id: sups[1].id, unit_cost: 9.5, lead_days: 5 },
    { item_id: ci2.id, supplier_id: sups[0].id, unit_cost: 150 }, { item_id: ci2.id, supplier_id: sups[1].id, unit_cost: 170 },
  ] });
  ok(cot2.items[0].best_supplier_id === sups[1].id && cot2.items[1].best_supplier_id === sups[0].id, 'mapa de preços aponta o menor preço por item');
  await call('POST', `/procurement/quotations/${cot.id}/close`, { choices: [{ item_id: ci1.id, supplier_id: sups[1].id }, { item_id: ci2.id, supplier_id: sups[2].id }] }, [400]);
  const cotClosed = await call('POST', `/procurement/quotations/${cot.id}/close`, { choices: [{ item_id: ci1.id, supplier_id: sups[1].id }, { item_id: ci2.id, supplier_id: sups[0].id }] });
  ok(cotClosed.purchase_orders.length === 2 && cotClosed.quotation.status === 'fechada', 'cotação fechada gera 1 pedido por fornecedor');
  const poA = await call('GET', `/procurement/orders/${cotClosed.purchase_orders.find((x) => x).id}`);
  const po1 = [poA, await call('GET', `/procurement/orders/${cotClosed.purchase_orders[1].id}`)].find((x) => x.items[0].product_id === pA.id);
  ok(po1.total === 95 && po1.status === 'rascunho', `pedido nº ${po1.number} (${po1.total})`);
  await call('POST', `/procurement/orders/${po1.id}/send`, { via: 'email' });
  const stockA0 = pA.stock;
  await call('POST', `/procurement/orders/${po1.id}/receive`, { items: [{ po_item_id: po1.items[0].id, qty: 12 }] }, [400]);
  ok(true, 'recebimento acima do pedido exige confirmação');
  let rec = await call('POST', `/procurement/orders/${po1.id}/receive`, { invoice_number: '9001', items: [{ po_item_id: po1.items[0].id, qty: 6, unit_cost: 9.8, lot: 'L-2231', certificate: 'CQ-778' }],
    installments: [{ due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), amount: 58.8 }] });
  let pA1 = (await call('GET', '/products')).find((x) => x.id === pA.id);
  ok(rec.status === 'parcial' && rec.items[0].qty_received === 6 && near(pA1.stock, stockA0 + 6) && rec.divergences.length === 2, 'recebimento parcial conferido (estoque, divergências de qtd/custo)');
  const ent = await call('GET', `/purchases/${rec.purchase_id}`);
  ok(ent.items[0].lot === 'L-2231' && ent.items[0].certificate === 'CQ-778' && ent.payables.length === 1 && ent.purchase_order_id === po1.id, 'entrada com lote, certificado e conta a pagar');
  await call('POST', `/purchases/${rec.purchase_id}/cancel`);
  rec = await call('GET', `/procurement/orders/${po1.id}`);
  ok(rec.items[0].qty_received === 0 && rec.status === 'enviado', 'cancelar a entrada devolve o pedido para pendente');
  rec = await call('POST', `/procurement/orders/${po1.id}/receive`, { invoice_number: '9002', items: [{ po_item_id: po1.items[0].id, qty: 10 }] });
  ok(rec.status === 'recebido', 'pedido recebido por completo');
  await call('POST', `/procurement/orders/${po1.id}/cancel`, { reason: 'teste' }, [400]);
  const poM = await call('POST', '/procurement/orders', { supplier_id: sups[2].id, items: [{ description: 'Disco de corte 7"', unit: 'un', qty: 20, unit_cost: 6.5 }] });
  const poMc = await call('POST', `/procurement/orders/${poM.id}/cancel`, { reason: 'Comprado no balcão' });
  ok(poM.total === 130 && poMc.status === 'cancelado', 'pedido manual criado e cancelado com motivo');

  const osPick = await call('POST', '/orders', { kind: 'os', customer_id: c.id, status: 'aprovada', problem: 'Separação',
    items: [{ kind: 'material', product_id: vareta.id, description: vareta.name, qty: 1, unit_price: 190 }] });
  let pick = await call('GET', '/procurement/picking');
  const pItem = pick.find((x) => x.order_id === osPick.id);
  ok(pItem && pItem.picked_qty === 0, 'material da OS aprovada aparece na separação');
  await call('POST', `/procurement/picking/${pItem.id}`, { qty: 2 }, [400]);
  await call('POST', `/procurement/picking/${pItem.id}`, { qty: 1 });
  const osPick2 = await call('GET', `/orders/${osPick.id}`);
  await call('PUT', `/orders/${osPick.id}`, { ...osPick2, items: osPick2.items.map((i) => ({ ...i, qty: Number(i.qty), unit_price: Number(i.unit_price), discount: Number(i.discount) })) });
  ok((await call('GET', `/orders/${osPick.id}`)).items[0].picked_qty === 1 && !(await call('GET', '/procurement/picking')).some((x) => x.order_id === osPick.id), 'separação confirmada e preservada ao editar a OS');

  // ================= FASE 4 — financeiro =================
  const today4 = new Date().toISOString().slice(0, 10);
  let accs = await call('GET', '/finance/accounts');
  const accCash = accs.find((a) => a.is_default_cash);
  const accBank = accs.find((a) => a.is_default_bank);
  ok(accCash && accBank, 'contas padrão (caixa e banco) criadas');
  const fin0 = await call('GET', `/reports/finance?from=${today4.slice(0, 8)}01&to=${today4}`);
  const accX = await call('POST', '/finance/accounts', { name: 'Banco Cooperativa', kind: 'banco', bank_name: 'Coop', opening_balance: 1000 });
  await call('POST', '/finance/transfers', { from_id: accBank.id, to_id: accX.id, amount: 300 });
  accs = await call('GET', '/finance/accounts');
  const fin1 = await call('GET', `/reports/finance?from=${today4.slice(0, 8)}01&to=${today4}`);
  ok(near(accs.find((a) => a.id === accX.id).balance, 1300) && near(accs.find((a) => a.id === accBank.id).balance, accBank.balance - 300) && near(fin1.totals.income, fin0.totals.income),
    'transferência entre contas não mexe na receita');
  const [recv4] = await call('POST', '/cash/transactions', { type: 'entrada', category: 'Ordens de serviço', description: 'Cliente pagou por depósito', amount: 777.77, paid: false, due_date: today4 });
  const ofx = `OFXHEADER:100\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>${today4.replace(/-/g, '')}120000<TRNAMT>777.77<FITID>A1<MEMO>DEP CLIENTE</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>${today4.replace(/-/g, '')}<TRNAMT>-50.00<FITID>A2<NAME>TARIFA PACOTE</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  const stOfx = await call('POST', '/finance/statements', { account_id: accX.id, filename: 'extrato.ofx', content: ofx });
  const stDup = await call('POST', '/finance/statements', { account_id: accX.id, filename: 'extrato.ofx', content: ofx });
  ok(stOfx.lines_count === 2 && stDup.lines_count === 0 && stDup.duplicates === 2, 'extrato OFX importado sem duplicar');
  let std = await call('GET', `/finance/statements/${stOfx.id}`);
  const lCred = std.lines.find((l) => l.amount > 0);
  const lDeb = std.lines.find((l) => l.amount < 0);
  ok(lCred.candidates.some((c) => c.id === recv4.id), 'sugestão de conciliação encontra o recebimento pendente');
  await call('POST', `/finance/lines/${lDeb.id}/match`, { transaction_id: recv4.id }, [400]);
  await call('POST', `/finance/lines/${lCred.id}/match`, { transaction_id: recv4.id });
  let txs = (await call('GET', '/cash/transactions?status=pago')).items;
  const rec4 = txs.find((t) => t.id === recv4.id);
  ok(rec4.paid_at && rec4.reconciled_at && rec4.account_id === accX.id, 'conciliação dá baixa na data do banco e na conta do extrato');
  await call('DELETE', `/cash/transactions/${recv4.id}`, null, [400]);
  await call('POST', `/cash/transactions/${recv4.id}/unpay`, null, [400]);
  ok(true, 'lançamento conciliado não pode ser excluído nem ter a baixa desfeita');
  await call('POST', `/finance/lines/${lDeb.id}/create`, { category: 'Tarifas bancárias' });
  std = await call('GET', `/finance/statements/${stOfx.id}`);
  ok(std.lines.every((l) => l.status === 'conciliado'), 'tarifa do extrato lançada e conciliada');
  await call('POST', `/finance/lines/${lCred.id}/undo`);
  txs = (await call('GET', '/cash/transactions?status=pago')).items;
  ok(!txs.find((t) => t.id === recv4.id).reconciled_at, 'conciliação desfeita');
  await call('POST', '/cash/transactions', { type: 'entrada', category: 'Outras receitas', description: 'Pix avulso', amount: 88.88, method: 'pix', paid: true, account_id: accX.id });
  const stc = await call('POST', '/finance/statements', { account_id: accX.id, filename: 'extrato.csv', content: `data;descrição;valor\n${today4.split('-').reverse().join('/')};Pix recebido;88,88\n${today4.split('-').reverse().join('/')};Venda grande;1.234,56` });
  const auto = await call('POST', `/finance/statements/${stc.id}/auto`);
  const stcd = await call('GET', `/finance/statements/${stc.id}`);
  ok(stc.lines_count === 2 && auto.reconciled === 1 && stcd.lines.find((l) => l.amount === 1234.56).status === 'pendente', 'CSV brasileiro importado e conciliação automática segura');
  const cf = await call('GET', '/finance/cashflow?days=90');
  ok(typeof cf.current === 'number' && Array.isArray(cf.weeks) && cf.overdue, `fluxo de caixa projetado (saldo ${cf.current} → ${cf.projected})`);
  const dre = await call('GET', `/finance/dre?year=${today4.slice(0, 4)}`);
  ok(dre.months.length === 12 && near(dre.total.resultado, dre.total.lucro_bruto - dre.total.despesas) && dre.total.receita > 0, `DRE gerencial (receita ${dre.total.receita}, resultado ${dre.total.resultado})`);

  // ================= FASE 5 — relacionamento, gestão, fiscal e exportação =================
  const fups = await call('GET', '/relationship/followups');
  ok(fups.some((f) => f.kind === 'pos_venda') && fups.some((f) => f.kind === 'orcamento'), `retornos gerados automaticamente (${fups.length})`);
  const fups2 = await call('GET', '/relationship/followups');
  ok(fups2.length === fups.length, 'geração de retornos é idempotente');
  const pv = fups.find((f) => f.kind === 'pos_venda');
  await call('POST', `/relationship/followups/${pv.id}/done`, { result: 'ok', channel: 'telefone' }, [400]);
  const pvDone = await call('POST', `/relationship/followups/${pv.id}/done`, { result: 'Cliente satisfeito com o reparo', channel: 'telefone', rating: 10 });
  ok(pvDone.status === 'feito' && pvDone.rating === 10, 'contato de pós-venda registrado com nota');
  const summ = await call('GET', '/relationship/summary');
  ok(summ.nps.answers >= 1 && summ.nps.score === 100, `NPS calculado (${summ.nps.score})`);
  const manual = await call('POST', '/relationship/followups', { customer_id: c.id, kind: 'outro', title: 'Ligar sobre novo projeto', due_date: today4 });
  await call('POST', `/relationship/followups/${manual.id}/cancel`, { reason: 'Cliente pediu para não ligar' });
  ok(true, 'retorno manual criado e cancelado com motivo');
  const mgmt = await call('GET', `/reports/management?from=${today4.slice(0, 8)}01&to=${today4}`);
  ok(mgmt.funnel.requests >= 4 && mgmt.funnel.quotes_sent >= 2 && mgmt.margin.orders >= 1 && Array.isArray(mgmt.technicians), `indicadores de gestão (conversão ${mgmt.funnel.quote_approval_pct}%, margem ${mgmt.margin.margin_pct}%)`);
  const osm = mgmt.margin.lowest.find((m) => m.id === os3.id);
  ok(!osm || near(osm.cost, Number(osm.material_cost) + Number(osm.other_cost) + Number(osm.labor_cost) + Number(osm.commissions)), 'margem real considera materiais, mão de obra apontada e comissões');
  const fis = await call('GET', `/reports/fiscal?from=${today4.slice(0, 8)}01&to=${today4}`);
  ok(Array.isArray(fis.pending) && fis.by_status.length > 0, `painel fiscal (${fis.pending.length} OS entregues a faturar)`);
  const exps = await call('GET', '/export');
  ok(exps.length > 20, 'catálogo de exportação');
  const csvRes = await fetch(`${API}/api/export/clientes.csv`, { headers: { Authorization: `Bearer ${token}` } });
  const csvTxt = await csvRes.text();
  ok(csvRes.status === 200 && csvTxt.includes('Cliente Novo Ltda'), 'exportação CSV de clientes');
  const bk = await call('GET', '/export/backup.json');
  const bkTxt = JSON.stringify(bk);
  ok(bk.tables.os.length > 0 && !bkTxt.includes('password_hash') && !bkTxt.includes('TOKEN-TESTE-123') && !bkTxt.includes('CONTA-PRINCIPAL-TOKEN'), 'backup JSON completo sem senhas nem tokens');
  token = tEst;
  await call('GET', '/export/backup.json', null, [403]);
  token = ownerTok;
  ok(true, 'exportação restrita ao perfil autorizado');

  // custo do serviço informado na abertura da OS e editável depois
  let osCost = await call('POST', '/orders', { kind: 'os', customer_id: c.id, problem: 'Custo informado',
    items: [{ kind: 'servico', service_id: svTig.id, description: svTig.name, qty: 2, unit_price: 160, unit_cost: 55 }, { kind: 'avulso', description: 'Frete', qty: 1, unit_price: 40, unit_cost: 30 }] });
  ok(osCost.items[0].unit_cost === 55 && osCost.items[1].unit_cost === 30, 'custo do serviço gravado na abertura da OS');
  osCost = await call('PUT', `/orders/${osCost.id}`, { ...osCost, items: osCost.items.map((i) => ({ ...i, qty: Number(i.qty), unit_price: Number(i.unit_price), discount: Number(i.discount), unit_cost: i.kind === 'servico' ? 62.5 : Number(i.unit_cost) })) });
  ok(osCost.items[0].unit_cost === 62.5, 'custo do serviço editado na OS');
  token = tView;
  const osCostV = await call('GET', `/orders/${osCost.id}`);
  ok(osCostV.total === null && osCostV.items.every((i) => i.unit_cost == null || i.unit_cost === undefined), 'perfil sem acesso a valores não vê o custo');
  token = ownerTok;

  // isolamento entre empresas
  const other = await call('POST', '/auth/register', { companyName: 'Outra Serralheria', name: 'Outro', email: `outro${Date.now()}@torven.app`, password: '123456' });
  token = other.token;
  await call('GET', `/quotes/${q3.id}`, null, [404]);
  await call('GET', `/requests/${rq.id}`, null, [404]);
  await call('GET', `/customers/${c.id}`, null, [404]);
  await call('GET', `/attachments/${att.id}`, null, [404]);
  await call('POST', '/attachments', { entity: 'equipment', entity_id: eq2.id, filename: 'a.png', mime: 'image/png', data: png }, [404]);
  await call('POST', '/requests', { customer_id: c.id, title: 'Invasão' }, [404]);
  await call('POST', '/quotes', { customer_id: c.id, title: 'Invasão', items: [{ kind: 'avulso', description: 'X', qty: 1, unit_price: 1 }] }, [404]);
  await call('GET', `/warranty/${wc.id}`, null, [404]);
  await call('POST', `/production/orders/${os3.id}/time/start`, {}, [400, 404]);
  await call('POST', `/quality/orders/${os3.id}/inspections`, { kind: 'inspecao', items: [{ label: 'x', result: 'ok' }], result: 'aprovado' }, [404]);
  ok((await call('GET', '/schedule')).every((e) => e.order_id !== os3.id), 'isolamento: garantia, apontamento, inspeção e agenda de outra empresa');
  await call('GET', `/procurement/orders/${po1.id}`, null, [404]);
  await call('GET', `/procurement/quotations/${cot.id}`, null, [404]);
  await call('POST', `/procurement/picking/${pItem.id}`, { qty: 0 }, [404]);
  await call('POST', '/procurement/orders', { supplier_id: sups[0].id, items: [{ description: 'x', qty: 1, unit_cost: 1 }] }, [404]);
  ok(!(await call('GET', '/procurement/picking')).some((x) => x.order_id === osPick.id), 'isolamento: cotações, pedidos e separação');
  await call('GET', `/finance/statements/${stOfx.id}`, null, [404]);
  await call('POST', `/finance/lines/${lCred.id}/match`, { transaction_id: recv4.id }, [404]);
  await call('POST', '/finance/transfers', { from_id: accBank.id, to_id: accX.id, amount: 1 }, [404]);
  ok((await call('GET', '/finance/accounts')).every((a) => a.id !== accX.id), 'isolamento: contas, extratos e conciliação');
  await call('POST', `/relationship/followups/${manual.id}/reschedule`, { due_date: today4 }, [404]);
  const bkOther = await call('GET', '/export/backup.json');
  ok(!JSON.stringify(bkOther).includes('Cliente Novo Ltda') && (await call('GET', '/relationship/followups')).every((f) => f.customer_id !== c.id), 'isolamento: relacionamento e exportação');
  const srch = await call('GET', `/search?q=${encodeURIComponent('Cliente Novo')}`);
  ok(srch.length === 0 && (await call('GET', '/audit')).rows.every((x) => !x.summary?.includes('Cliente Novo')), 'isolamento entre empresas (leitura, escrita, busca e auditoria)');
  token = ownerTok;

  // ---------- versão de demonstração ----------
  token = '';
  const demo = await call('POST', '/auth/demo', {});
  ok(demo.company.is_demo && demo.token, 'demonstração criada com um clique');
  token = demo.token;
  ok((await call('GET', '/orders')).length >= 10 && (await call('GET', '/requests?status=')).length === 3, 'demonstração já vem com dados de exemplo (OS e solicitações)');
  const act = await call('POST', '/auth/activate', { companyName: 'Serralheria Real', name: 'Dono Real', email: `real${Date.now()}@torven.app`, password: 'segredo1', keepData: false });
  token = act.token;
  ok(!act.company.is_demo && act.company.name === 'Serralheria Real', 'demonstração ativada para uso normal');
  ok((await call('GET', '/orders')).length === 0 && (await call('GET', '/customers')).length === 0, 'dados de exemplo apagados na ativação');
  const relog = await call('POST', '/auth/login', { email: act.user.email, password: 'segredo1' });
  ok(relog.token, 'login com as credenciais definidas na ativação');
  await call('POST', '/auth/activate', { companyName: 'X', name: 'Y', email: `z${Date.now()}@x.com`, password: '123456' }, [400]);
  ok(true, 'não reativa empresa normal');

  console.log('\nTodos os testes passaram.');
} finally {
  mock?.close();
}
