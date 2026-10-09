// Módulos e extensões que a PRÓPRIA empresa liga ou desliga (Configurações › Módulos e extensões).
// Dois níveis: o plano (central) decide o que está disponível; a empresa decide o que usa.
// Módulo desligado pela empresa: some do menu e as rotas dele respondem 403 (como fora do plano). Os dados ficam guardados.
import { HttpError } from './util.js';
import { compileModuleRules, moduleForRoute } from './moduleRules.js';
import { FEATURES, MODULE_RULES } from './platform.js';

/** Extensões: recursos extras que não são módulos de plano (ou ficam dentro de um). */
export const EXTENSIONS = {
  leitura_nota: { label: 'Leitura da nota do fornecedor (XML, PDF ou foto)', routes: ['POST /purchases/read-invoice'] },
  importacao_planilhas: { label: 'Importar planilhas (clientes, veículos, OS, serviços e materiais)', routes: ['POST /data'] },
  assistente: { label: 'Assistente (texto e voz)', routes: ['/agent'] },
  consulta_cnpj: { label: 'Consulta de CNPJ na Receita (preenche o cadastro)', routes: ['/lookup/cnpj'] },
};
const EXT_RULES = compileModuleRules(EXTENSIONS);
const LABELS = { ...Object.fromEntries(Object.entries(FEATURES).map(([k, v]) => [k, v.label])), ...Object.fromEntries(Object.entries(EXTENSIONS).map(([k, v]) => [k, v.label])) };
/** Chaves que a empresa pode ligar/desligar (as de plano + extensões; as 4 antigas continuam em settings.modules). */
export const TOGGLE_KEYS = [...Object.keys(FEATURES), ...Object.keys(EXTENSIONS)];

/** Portão da empresa (depois do portão do plano). */
export function companyModuleGate(req, _res, next) {
  const mods = req.settings?.modules || {};
  for (const rules of [MODULE_RULES, EXT_RULES]) {
    const key = moduleForRoute(rules, req.method, req.path);
    if (key && mods[key] === false) {
      return next(new HttpError(403, `O módulo "${LABELS[key]}" está desligado nesta empresa. Quem administra pode ligar em Configurações › Módulos e extensões.`, { code: 'MODULE_OFF', feature: key }));
    }
  }
  next();
}
