// Auditoria de layout: percorre as telas em 1440/1024/768/390 px e aponta o que sai da tela ou fica cortado.
// Uso (com API na 3333 e preview na 4173): node tools/layout-audit.mjs <pasta-saida> [larguras] [filtro]
import { chromium } from 'playwright';
import fs from 'node:fs';
const OUT = process.argv[2]; const WIDTHS = (process.argv[3] || '1440,1024,768,390').split(',').map(Number);
const ONLY = process.argv[4] ? process.argv[4].split(',') : null;
const B = 'http://localhost:4173'; const API = 'http://localhost:3333/api';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
// conta de demonstração
const ctx0 = await b.newContext(); const p0 = await ctx0.newPage();
await p0.goto(B + '/demonstracao');
await p0.getByLabel('Seu nome').fill('Layout');
await p0.getByLabel('E-mail (será o seu login)').fill(`lay${Date.now()}@teste.dev`);
await p0.locator('input[autocomplete="new-password"]').nth(0).fill('Oficina2026xy');
await p0.locator('input[autocomplete="new-password"]').nth(1).fill('Oficina2026xy');
await p0.getByRole('button', { name: /Criar acesso e entrar/ }).click();
await p0.waitForURL((u) => !u.pathname.includes('demonstracao'), { timeout: 30000 });
const token = await p0.evaluate(() => localStorage.getItem('torven.token'));
await ctx0.close();
const api = async (path) => (await fetch(API + path, { headers: { authorization: 'Bearer ' + token } })).json();
const first = (x) => (x?.items || x || [])[0]?.id;
const ids = {
  os: first(await api('/orders?limit=5')), orc: first(await api('/quotes')), sol: first(await api('/requests')), cli: first(await api('/customers?limit=5')),
  ent: first(await api('/purchases')),
};
const tabs = ['empresa', 'aparencia', 'os', 'tipos-os', 'checklists', 'documentos', 'financeiro', 'categorias', 'fiscal', 'integracoes', 'modulos', 'perfis', 'equipe', 'dados'];
let routes = ['/', '/os', '/os/nova', `/os/${ids.os}`, '/venda', '/whatsapp', '/solicitacoes', '/solicitacoes/nova', `/solicitacoes/${ids.sol}`, '/orcamentos', '/orcamentos/novo',
  `/orcamentos/${ids.orc}`, '/clientes', `/clientes/${ids.cli}`, '/estoque', '/estoque/entradas', '/estoque/entradas/nova', ids.ent && `/estoque/entradas/${ids.ent}`, '/fornecedores', '/servicos',
  '/tecnicos', '/financeiro', '/financeiro/receber', '/financeiro/pagar', '/financeiro/lancamentos', '/financeiro/transferencia', '/financeiro/fechados', '/financeiro/alertas', '/dados', '/financeiro/gestao', '/notas', '/relatorios', '/comissoes', '/configuracoes/unidades', '/agenda', '/meu-trabalho', '/producao', '/garantias',
  '/compras', '/separacao', '/relacionamento', '/auditoria', '/conta', '/suporte', '/assinatura', `/imprimir/os/${ids.os}`, `/imprimir/orcamento/${ids.orc}`,
  ...tabs.map((t) => `/configuracoes?tab=${t}`)].filter(Boolean);
if (ONLY) routes = routes.filter((r) => ONLY.some((o) => r.includes(o)));
const report = [];
for (const w of WIDTHS) {
  const mobile = w < 600;
  const ctx = await b.newContext({ viewport: { width: w, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
  await ctx.addInitScript(([t]) => { localStorage.setItem('torven.token', t); window.print = () => {}; }, [token]);
  await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  const p = await ctx.newPage();
  for (const r of routes) {
    const errs = []; const onErr = (e) => errs.push(e.message); p.on('pageerror', onErr);
    try { await p.goto(B + r, { waitUntil: 'networkidle', timeout: 20000 }); } catch { /* segue */ }
    await p.waitForTimeout(700);
    const res = await p.evaluate(() => {
      const W = document.documentElement.clientWidth;
      const pageOverflow = document.documentElement.scrollWidth - W;
      const scrollAncestor = (el) => { for (let x = el.parentElement; x && x !== document.body; x = x.parentElement) { const s = getComputedStyle(x); if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) return x; } return null; };
      const desc = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className || '').toString().split(' ').filter(Boolean).slice(0, 4).join('.')} «${(el.innerText || el.getAttribute('aria-label') || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 50)}»`;
      const out = []; const clip = []; const cut = [];
      const clipAncestor = (el) => { for (let x = el.parentElement; x && x !== document.body; x = x.parentElement) { const s = getComputedStyle(x); if (/(auto|scroll)/.test(s.overflowX)) return null; if (/(hidden|clip)/.test(s.overflowX)) return x; } return null; };
      for (const el of document.querySelectorAll('body *')) {
        if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
        const rc = el.getBoundingClientRect();
        if (!rc.width || !rc.height) continue;
        if ((rc.right > W + 1 || rc.left < -1) && !scrollAncestor(el)) out.push({ d: desc(el), right: Math.round(rc.right), left: Math.round(rc.left) });
        const ca = (el.children.length === 0 || ['BUTTON', 'TD', 'INPUT', 'SELECT', 'TABLE'].includes(el.tagName)) && clipAncestor(el);
        if (ca) { const ar = ca.getBoundingClientRect(); const st = getComputedStyle(el); if (rc.right > ar.right + 2 && rc.left < ar.right && !st.textOverflow.includes('ellipsis') && !getComputedStyle(el.parentElement).textOverflow.includes('ellipsis')) cut.push({ d: desc(el), by: Math.round(rc.right - ar.right) }); }
        const s = getComputedStyle(el);
        if (['BUTTON', 'A', 'SPAN', 'LABEL', 'TD', 'TH', 'DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'DT', 'DD', 'LI'].includes(el.tagName) && el.children.length <= 3
          && s.overflowX === 'visible' && el.scrollWidth > el.clientWidth + 3 && el.clientWidth > 0 && !s.textOverflow.includes('ellipsis') && s.whiteSpace !== 'nowrap') {
          clip.push({ d: desc(el), over: el.scrollWidth - el.clientWidth });
        }
      }
      // fica só com o mais externo de cada ramo
      const outer = out.filter((x, i) => i === out.findIndex((y) => y.d === x.d));
      return { pageOverflow, out: outer.slice(0, 15), clip: clip.slice(0, 15), cut: cut.slice(0, 15) };
    });
    p.off('pageerror', onErr);
    if (res.pageOverflow > 1 || res.out.length || res.cut.length || errs.length) {
      const name = `${w}-${r.replace(/[^a-z0-9]+/gi, '_')}`.slice(0, 80);
      await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
      report.push({ w, r, ...res, errs, shot: name });
    }
  }
  await ctx.close();
}
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
console.log(`${report.length} páginas com achados`);
for (const x of report) console.log(`${x.w} ${x.r} overflow=${x.pageOverflow} fora=${x.out.length} cortado=${x.cut.length} erros=${x.errs.length}`, x.cut.slice(0, 4).map((c) => `${c.d.slice(0, 70)} +${c.by}`).join(' | '));
await b.close();
