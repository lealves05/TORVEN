import { Router } from 'express';
import { z } from 'zod';
import { one } from '../db.js';
import { need, granted } from '../auth.js';
import { parse, withDefaults, HttpError } from '../util.js';
import { COMPANY_COLS } from './auth.js';
import { audit } from '../audit.js';

const r = Router();

const load = async (id) => {
  const c = await one(COMPANY_COLS, [id]);
  c.settings = withDefaults(c.settings);
  return c;
};

r.get('/', async (req, res) => res.json(await load(req.companyId)));

const opt = z.string().trim().nullable().optional();
const schema = z.object({
  name: z.string().trim().min(2).optional(),
  trade_name: opt, document: opt, state_registration: opt, municipal_registration: opt,
  phone: opt, email: opt, cep: opt, street: opt, number: opt, complement: opt, district: opt, city: opt,
  uf: z.string().trim().max(2).nullable().optional(), city_code: opt,
  logo_url: z.string().max(700000, 'logo muito grande (máx. ~500KB)').nullable().optional(),
  settings: z.record(z.any()).optional(),
});
const FIELDS = ['name', 'trade_name', 'document', 'state_registration', 'municipal_registration', 'phone', 'email',
  'cep', 'street', 'number', 'complement', 'district', 'city', 'uf', 'city_code', 'logo_url'];

r.put('/', need('settings', 'users'), async (req, res) => {
  const d = parse(schema, req.body);
  if (!granted(req.perms.settings)) {
    const keys = Object.keys(d.settings || {});
    if (Object.keys(d).some((k) => k !== 'settings') || keys.some((k) => k !== 'permissions')) {
      throw new HttpError(403, 'Seu perfil só permite alterar os perfis de acesso.');
    }
  }
  if (d.settings?.permissions && !granted(req.perms.users)) throw new HttpError(403, 'Seu perfil não permite alterar perfis de acesso.');
  const cur = await one('select * from companies where id = $1', [req.companyId]);
  const vals = FIELDS.map((f) => (d[f] !== undefined ? d[f] : cur[f]));
  const settings = d.settings ? withDefaults({ ...cur.settings, ...d.settings }) : cur.settings;
  await one(
    `update companies set ${FIELDS.map((f, i) => `${f} = $${i + 1}`).join(', ')}, settings = $${FIELDS.length + 1}
      where id = $${FIELDS.length + 2} returning id`, [...vals, settings, req.companyId]);
  const changed = [...FIELDS.filter((f) => d[f] !== undefined && d[f] !== cur[f]), ...Object.keys(d.settings || {}).map((k) => `settings.${k}`)];
  if (changed.length) {
    await audit(null, req, {
      entity: d.settings?.permissions ? 'permissions' : 'settings', entityId: req.companyId, action: 'update',
      summary: `Configurações alteradas: ${changed.filter((f) => f !== 'logo_url').join(', ') || 'logotipo'}`,
      data: d.settings?.permissions ? { permissions: d.settings.permissions } : null,
    });
  }
  res.json(await load(req.companyId));
});

export default r;
