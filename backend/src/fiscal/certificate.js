// Leitura do certificado digital A1 (.pfx/.p12): confere a senha e extrai titular, CNPJ e validade.
// Só leitura dos campos do certificado (sem verificação de assinatura); o arquivo e a senha são guardados cifrados.
import forge from 'node-forge';
import { HttpError, onlyDigits } from '../util.js';

const MAX = 60_000; // A1 típico tem 3–10 KB

/** Lê o .pfx (base64, com ou sem "data:...,") e devolve { cnpj, cpf, name, valid_from, valid_until, fingerprint }. */
export function readCertificate(base64, password) {
  const b64 = String(base64 || '').replace(/^data:[^,]*,/, '').replace(/\s/g, '');
  if (!b64 || !/^[A-Za-z0-9+/=]+$/.test(b64)) throw new HttpError(400, 'Arquivo do certificado inválido.');
  const raw = Buffer.from(b64, 'base64');
  if (raw.length > MAX) throw new HttpError(400, 'Arquivo grande demais para um certificado A1.');
  let p12;
  try {
    const asn1 = forge.asn1.fromDer(raw.toString('binary'));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, String(password ?? ''));
  } catch (e) {
    if (/mac|password|invalid/i.test(String(e?.message))) throw new HttpError(400, 'Senha do certificado incorreta.');
    throw new HttpError(400, 'Não foi possível ler o certificado. Envie o arquivo A1 (.pfx ou .p12).');
  }
  const bags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  const keys = (p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [])
    .concat(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || []);
  if (!keys.length) throw new HttpError(400, 'O arquivo não traz a chave privada. Exporte o certificado A1 completo (com a chave).');
  // o certificado do titular é o que não é autoridade certificadora
  const certs = bags.map((b) => b.cert).filter(Boolean);
  const cert = certs.find((c) => !c.getExtension('basicConstraints')?.cA) || certs[0];
  if (!cert) throw new HttpError(400, 'Nenhum certificado encontrado no arquivo.');
  const cn = cert.subject.getField('CN')?.value || '';
  // padrão ICP-Brasil: "RAZAO SOCIAL:CNPJ" no CN; também vem no subjectAltName (OID 2.16.76.1.3.3)
  const fromCn = (cn.match(/:(\d{14})$/) || [])[1] || (cn.match(/:(\d{11})$/) || [])[1] || null;
  let fromAlt = null;
  try {
    const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
    const m = der.match(/\x06\x05\x60\x4c\x01\x03\x03[\s\S]{2,8}?(\d{14})/);
    if (m) fromAlt = m[1];
  } catch { /* opcional */ }
  const doc = onlyDigits(fromAlt || fromCn || '');
  const md = forge.md.sha1.create();
  md.update(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes());
  return {
    name: cn.replace(/:\d{11,14}$/, '') || null,
    cnpj: doc.length === 14 ? doc : null,
    cpf: doc.length === 11 ? doc : null,
    valid_from: cert.validity.notBefore.toISOString(),
    valid_until: cert.validity.notAfter.toISOString(),
    fingerprint: md.digest().toHex().toUpperCase(),
    issuer: cert.issuer.getField('CN')?.value || null,
  };
}

/** Dias até vencer (negativo = vencido). */
export const certDaysLeft = (info) => (info?.valid_until ? Math.floor((new Date(info.valid_until) - Date.now()) / 86400000) : null);
