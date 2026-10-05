import jwt from 'jsonwebtoken';
import { one } from './db.js';
import { HttpError, permissionsFor, withDefaults } from './util.js';

// ---------------- Segredo do JWT (F01) ----------------
// Produção exige um segredo forte (≥ 32 bytes, gerado aleatoriamente). Ausente, conhecido, curto ou repetitivo
// impede o serviço de atender — o valor nunca é registrado em log. Fora de produção há um padrão só para desenvolvimento.
const DEV_SECRET = 'torven-dev-secret-troque-em-producao';
const KNOWN = new Set([DEV_SECRET, 'changeme', 'secret', 'jwt_secret', 'troque-este-segredo', 'video-local-secret-1234567890']);
const isProd = () => process.env.NODE_ENV === 'production';
export function secretProblem(v) {
  if (!v) return 'JWT_SECRET ausente';
  if (KNOWN.has(v)) return 'JWT_SECRET é um valor de exemplo conhecido';
  if (Buffer.byteLength(v, 'utf8') < 32) return 'JWT_SECRET curto (mínimo de 32 bytes aleatórios; ex.: 64 caracteres hexadecimais)';
  if (new Set(v).size < 10) return 'JWT_SECRET com pouca variação de caracteres';
  return null;
}
/** Chamado depois de montar as variáveis (inclusive as lidas do banco na Edge Function), antes de atender. */
export function assertSecret() {
  const m = secretProblem(process.env.JWT_SECRET);
  if (m && isProd()) throw new Error(`[auth] configuração insegura: ${m}`);
  if (m) console.warn(`[auth] desenvolvimento: ${m} — usando segredo local`);
}
export const secret = () => {
  const v = process.env.JWT_SECRET;
  if (secretProblem(v)) { if (isProd()) throw new HttpError(503, 'Serviço indisponível: configuração de segurança incompleta.'); return v || DEV_SECRET; }
  return v;
};
const JWT_OPTS = { algorithm: 'HS256', issuer: 'torven-api', audience: 'torven-app' };

// Token de acesso: usuário, empresa e versão de autenticação (muda a cada troca de senha — F02)
export const signToken = (user) =>
  jwt.sign({ uid: user.id, cid: user.company_id, av: Number(user.auth_version ?? 0), typ: 'access' }, secret(), { ...JWT_OPTS, expiresIn: '7d' });

export function verifyToken(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  try {
    const p = jwt.verify(token, secret(), { algorithms: ['HS256'], issuer: JWT_OPTS.issuer, audience: JWT_OPTS.audience });
    // tokens anteriores a esta versão (sem av/typ) não são mais aceitos: o usuário entra de novo uma vez
    return p.typ === 'access' && Number.isInteger(p.av) ? p : null;
  } catch { return null; }
}

/** true para permissão booleana ligada ou escopo 'all'/'own'. */
export const granted = (v) => v === true || v === 'all' || v === 'own';

export async function requireAuth(req, _res, next) {
  const payload = verifyToken(req);
  if (!payload) throw new HttpError(401, 'Sessão expirada. Entre novamente.');
  const user = await one(
    `select u.id, u.company_id, u.name, u.email, u.role, u.technician_id, u.unit_id, u.active, u.preferences, u.auth_version, c.settings
       from users u join companies c on c.id = u.company_id where u.id = $1`,
    [payload.uid],
  );
  if (!user || !user.active) throw new HttpError(401, 'Usuário inativo ou removido.');
  // empresa e versão de autenticação conferidas no banco: troca de senha derruba os tokens anteriores sem depender do relógio
  if (user.company_id !== payload.cid || Number(user.auth_version) !== payload.av) throw new HttpError(401, 'Sessão encerrada. Entre novamente.');
  delete user.auth_version;
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
