// Cifra de segredos das integrações (tokens da consulta de placa e das maquininhas), guardados em integration_configs.
// AES-256-GCM com chave derivada (HKDF) do segredo do servidor: INTEGRATIONS_KEY quando definido; senão o JWT_SECRET.
// Atenção: trocar a chave exige cadastrar os tokens de novo (são poucos e ficam na tela de Integrações).
import crypto from 'node:crypto';
import { secret } from './auth.js';
import { HttpError } from './util.js';

const key = () => Buffer.from(crypto.hkdfSync('sha256', process.env.INTEGRATIONS_KEY || secret(), 'torven', 'torven:integrations', 32));

/** Objeto → texto cifrado "v1.iv.tag.dados" (base64url). */
export function seal(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj ?? {}), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

/** Texto cifrado → objeto. Falha de chave vira mensagem clara (sem expor nada). */
export function unseal(text) {
  if (!text) return {};
  try {
    const [v, iv, tag, data] = String(text).split('.');
    if (v !== 'v1') throw new Error('versão');
    const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8'));
  } catch {
    throw new HttpError(409, 'Não foi possível ler o token salvo desta integração (a chave do servidor mudou). Cadastre o token de novo.');
  }
}

/** Mostra só o final do segredo (ex.: ••••a1b2). */
export const mask = (v) => (v ? `••••${String(v).slice(-4)}` : '');
