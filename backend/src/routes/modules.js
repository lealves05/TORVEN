// Configurações › Módulos e extensões: o que o plano libera, o que a empresa usa e o que ainda falta configurar.
import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db.js';
import { need } from '../auth.js';
import { parse, bad } from '../util.js';
import { audit } from '../audit.js';
import { FEATURES } from '../platform.js';
import { EXTENSIONS, TOGGLE_KEYS } from '../companyModules.js';
import { listIntegrations } from '../integrations/store.js';

const r = Router();
const LEGACY = ['purchases', 'invoices', 'commissions', 'publicLinks']; // chaves antigas (só escondem do menu)

async function status(companyId) {
  const [wa, ia, plates, terms, { rows: [fiscal] }] = await Promise.all([
    listIntegrations(companyId, 'whatsapp'), listIntegrations(companyId, 'ia'), listIntegrations(companyId, 'placa'), listIntegrations(companyId, 'maquininha'),
    q('select count(*) filter (where active)::int as n from fiscal_emitters where company_id = $1', [companyId]),
  ]);
  const on = (l) => l.find((x) => x.enabled);
  const aiOn = on(ia);
  return {
    whatsapp: { configured: !!on(wa), text: on(wa) ? 'Conectado ao WhatsApp Business (Meta)' : 'Falta conectar o número do WhatsApp Business' },
    ia: { configured: !!aiOn, text: aiOn ? 'Chave da Anthropic cadastrada e ligada' : 'Falta cadastrar a chave da IA (Anthropic)' },
    leitura_nota: { configured: true, text: aiOn && aiOn.config?.invoices !== false ? 'XML, PDF e foto prontos' : 'XML pronto · para PDF e foto, ligue a IA' },
    consulta_placa: { configured: !!on(plates), text: on(plates) ? `Provedor: ${on(plates).provider}` : 'Falta escolher o provedor e a chave da consulta' },
    maquininha: { configured: !!on(terms), text: on(terms) ? `Maquininha: ${terms.filter((x) => x.enabled).map((x) => x.provider).join(', ')}` : 'Falta configurar a maquininha' },
    fiscal: { configured: (fiscal?.n || 0) > 0, text: fiscal?.n ? `${fiscal.n} emitente(s) fiscal(is) cadastrado(s)` : 'Falta cadastrar o emitente (certificado e provedor)' },
  };
}

r.get('/', need('settings'), async (req, res) => {
  const plan = req.access?.features || {};
  const mods = req.settings.modules || {};
  res.json({
    keys: [...TOGGLE_KEYS, ...LEGACY].map((key) => ({
      key, label: FEATURES[key]?.label || EXTENSIONS[key]?.label || key,
      in_plan: FEATURES[key] ? plan[key] !== false : true,
      enabled: mods[key] !== false,
    })),
    status: await status(req.companyId),
  });
});

r.put('/:key', need('settings'), async (req, res) => {
  const { key } = req.params;
  if (![...TOGGLE_KEYS, ...LEGACY].includes(key)) throw bad('Módulo desconhecido.');
  const { enabled } = parse(z.object({ enabled: z.boolean() }), req.body);
  if (enabled && FEATURES[key] && req.access?.features?.[key] === false) throw bad('Este módulo não faz parte do seu plano. Fale com o suporte para incluir.');
  await q(`update companies set settings = coalesce(settings, '{}'::jsonb)
             || jsonb_build_object('modules', coalesce(settings->'modules', '{}'::jsonb) || jsonb_build_object($2::text, $3::boolean)) where id = $1`,
  [req.companyId, key, enabled]);
  const label = FEATURES[key]?.label || EXTENSIONS[key]?.label || key;
  await audit(null, req, { entity: 'settings', entityId: req.companyId, action: 'update', summary: `Módulo "${label}" ${enabled ? 'ligado' : 'desligado'}` });
  res.json({ key, enabled });
});

export default r;
