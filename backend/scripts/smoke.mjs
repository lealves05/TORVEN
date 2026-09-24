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
    ], discount: 5,
  });
  ok(qt.total === 320 + 95 + 40 - 5 && qt.number === 3 && qt.public_token, `orçamento nº ${qt.number} total ${qt.total}`);

  token = '';
  const pub = await call('GET', `/public/quote/${qt.public_token}`);
  ok(pub.quote.items.length === 3 && pub.company.name, 'orçamento visível pelo link público');
  await call('POST', `/public/quote/${qt.public_token}/approve`, { name: 'Cliente' });
  token = reg.token;
  const qt2 = await call('GET', `/quotes/${qt.id}`);
  ok(qt2.status === 'aprovado', 'cliente aprovou pelo link');

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
  ok(inv0.status === 'interna' && inv0.number === '1', 'sem Focus configurada: documento interno');
  if (process.env.MOCK_FOCUS) {
    await call('PUT', '/company', { document: '11.222.333/0001-81', municipal_registration: '123456', state_registration: '244.555.666.777', phone: '(19) 3232-0000' });
    const f = await call('PUT', '/company/fiscal', { provider: 'focus', environment: 'homologacao', token_homologacao: 'TOKEN-TESTE-123' });
    ok(f.token_homologacao.endsWith('123') && f.token_homologacao.includes('•'), 'token fiscal salvo e mascarado');
    const prev = await call('GET', `/invoices/preview?order_id=${os.id}&kind=nfse`);
    ok(prev.warnings.length === 0 && prev.amount > 0, `prévia NFS-e (${prev.amount})`);
    await call('POST', '/invoices', { order_id: os.id, kind: 'nfse' }, [400]);
    let nf = await call('POST', '/invoices', { order_id: os.id, kind: 'nfse', force: true });
    ok(nf.status === 'processando' && focusCalls.at(-1).path === '/v2/nfsen', 'NFS-e nacional enviada à Focus');
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

  console.log('\nTodos os testes passaram.');
} finally {
  mock?.close();
}
