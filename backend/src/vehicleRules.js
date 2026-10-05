// Regras de cadastro de veículos (placa): um veículo por cadastro, desligável em Configurações › OS (orders.uniqueVehicle).
import { bad, HttpError, withDefaults } from './util.js';
import { normalizePlate, formatPlate } from './integrations/plates.js';

const PLATE_SQL = "upper(regexp_replace(coalesce(e.plate, ''), '[^A-Za-z0-9]', '', 'g'))";

/** A empresa exige uma única ficha por placa? (padrão: sim) */
export const uniqueVehicleOn = (settings) => withDefaults(settings || {}).orders.uniqueVehicle !== false;

/**
 * Valida a placa e, com a restrição ligada, garante que nenhum outro cadastro ativo já tem o veículo.
 * Usa trava de transação por empresa+placa para dois cadastros simultâneos não passarem juntos.
 * @returns {Promise<string|null>} placa formatada (ABC1D23 / ABC-1234) ou null quando vazia
 */
export async function checkVehiclePlate(db, { companyId, settings }, plate, exceptId = null) {
  if (plate == null || String(plate).trim() === '') return null;
  const n = normalizePlate(plate);
  if (!n) throw bad(`Placa "${plate}" inválida. Use o formato ABC1D23 (Mercosul) ou ABC-1234.`);
  if (uniqueVehicleOn(settings)) {
    await db.query('select pg_advisory_xact_lock(hashtext($1))', [`placa:${companyId}:${n}`]);
    const { rows: [dup] } = await db.query(
      `select e.id, e.customer_id, c.name as customer_name from equipment e join customers c on c.id = e.customer_id
        where e.company_id = $1 and e.active and ${PLATE_SQL} = $2 and ($3::uuid is null or e.id <> $3::uuid) limit 1`,
      [companyId, n, exceptId]);
    if (dup) {
      throw new HttpError(409, `O veículo de placa ${formatPlate(n)} já está cadastrado (cliente ${dup.customer_name}). `
        + 'Cada veículo pode ter um único cadastro — use o cadastro existente ou desligue a restrição em Configurações › Ordens de serviço.',
      { equipment_id: dup.id, customer_id: dup.customer_id });
    }
  }
  return formatPlate(n);
}

/** Placas repetidas dentro da mesma lista enviada (ex.: dois veículos iguais no formulário). */
export function assertNoRepeatedPlates(list, settings) {
  if (!uniqueVehicleOn(settings)) return;
  const seen = new Set();
  for (const v of list) {
    const n = normalizePlate(v.plate);
    if (!n) continue;
    if (seen.has(n)) throw bad(`A placa ${formatPlate(n)} aparece duas vezes no cadastro.`);
    seen.add(n);
  }
}
