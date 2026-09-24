import jwt from 'jsonwebtoken';
import { one } from './db.js';
import { HttpError, permissionsFor, withDefaults } from './util.js';

const secret = () => process.env.JWT_SECRET || 'torven-dev-secret-troque-em-producao';
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.warn('[auth] ATENÇÃO: defina JWT_SECRET em produção.');
}

export const signToken = (user) =>
  jwt.sign({ uid: user.id, cid: user.company_id }, secret(), { expiresIn: '7d' });

export function verifyToken(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  try { return jwt.verify(token, secret()); } catch { return null; }
}

/** true para permissão booleana ligada ou escopo 'all'/'own'. */
export const granted = (v) => v === true || v === 'all' || v === 'own';

export async function requireAuth(req, _res, next) {
  const payload = verifyToken(req);
  if (!payload) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
  const user = await one(
    `select u.id, u.company_id, u.name, u.email, u.role, u.technician_id, u.active, u.preferences, c.settings
       from users u join companies c on c.id = u.company_id where u.id = $1`,
    [payload.uid],
  );
  if (!user || !user.active) throw new HttpError(401, 'Usuário inativo ou removido.');
  req.settings = withDefaults(user.settings);
  delete user.settings;
  req.user = user;
  req.companyId = user.company_id;
  req.perms = permissionsFor(user.role, req.settings);
  req.ownTechnician = user.technician_id || null;
  next();
}

/** Exige uma ou mais permissões (qualquer uma delas basta). */
export const need = (...keys) => (req, _res, next) => {
  if (keys.some((k) => granted(req.perms[k]))) return next();
  throw new HttpError(403, 'Seu perfil de acesso não permite esta ação.');
};

export const can = (req, key) => granted(req.perms[key]);
