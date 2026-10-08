// Abertura da OS pela placa: foto (leitura no aparelho) ou digitação → busca automática no cadastro →
// achou: mostra os dados do veículo e o proprietário, que já entra como cliente da OS;
// não achou: consulta o serviço de placas (quando configurado) e oferece o cadastro simples de proprietário + veículo.
import { useEffect, useRef, useState } from 'react';
import { Camera, Search, Car, UserPlus, Loader2, Check, RotateCcw, X, User } from 'lucide-react';
import { api } from '../lib/api';
import { normalizePlate, formatPlate } from '../lib/plate';
import { maskPhone, maskDoc } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { Input, Modal, useAction, FAIL, cx } from './ui';
import FipePicker from './FipePicker';

const yearOf = (v) => [v?.year, v?.model_year].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join('/');

/** Ficha do veículo: placa, marca/modelo, ano, cor e cidade. */
function VehicleFacts({ v, plate }) {
  const facts = [
    ['Placa', plate],
    ['Marca / modelo', [v?.brand, v?.model].filter(Boolean).join(' ') || v?.description],
    ['Ano', yearOf(v)],
    ['Cor', v?.color],
    ['Combustível', v?.fuel],
    ['Valor FIPE', v?.fipe_price ? `${v.fipe_price}${v.fipe_reference ? ` (${v.fipe_reference})` : ''}` : null],
    ['Cidade', v?.city ? `${v.city}${v.uf ? `/${v.uf}` : ''}` : null],
  ].filter(([, x]) => x);
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-3">
      {facts.map(([k, x]) => (
        <div key={k} className="min-w-0"><dt className="text-[11px] uppercase tracking-wide text-ink-faint">{k}</dt><dd className="truncate font-medium">{x}</dd></div>
      ))}
    </dl>
  );
}

/**
 * @param {{
 *   onSelect: (r: { customer_id: string, equipment_id: string, match?: object }) => void,
 *   onClear?: () => void, customer?: { id: string, name: string } | null, initialPlate?: string, autoLookup?: boolean,
 * }} p
 */
export default function PlateCapture({ onSelect, onClear, customer, initialPlate, autoLookup = false, autoFocus }) {
  const { can } = useAuth();
  const [plate, setPlate] = useState(initialPlate || '');
  const [reading, setReading] = useState('');
  const [result, setResult] = useState(null);
  const [chosen, setChosen] = useState(null);       // veículo do cadastro já aplicado à OS
  const [candidates, setCandidates] = useState([]);
  const [form, setForm] = useState(null);
  const [run, busy] = useAction();
  const fileRef = useRef(null);
  const last = useRef('');                           // última placa pesquisada (evita repetir a busca automática)
  const canRegister = can('customers_edit') || can('orders_create');

  const choose = (m) => {
    setChosen(m); setResult(null); setCandidates([]);
    onSelect({ customer_id: m.customer_id, equipment_id: m.id, match: m });
  };

  const search = async (p = plate, consult = false) => {
    const n = normalizePlate(p);
    if (!n) { setResult({ error: 'Placa incompleta. Formato ABC1D23 ou ABC-1234.' }); return; }
    last.current = n;
    setPlate(formatPlate(n));
    setChosen(null);
    const r = await run(() => api.get(`/vehicles/plate/${n}${consult ? '?consultar=1' : ''}`));
    if (r === FAIL) return;
    if (r.found && r.matches.length === 1) { choose(r.matches[0]); return; }
    setResult(r);
    if (!r.found && !consult && r.lookup_available && autoLookup) await search(n, true);
  };

  // busca sozinha assim que a placa digitada fica completa
  useEffect(() => {
    const n = normalizePlate(plate);
    if (!n || n === last.current) return undefined;
    const t = setTimeout(() => search(n), 450);
    return () => clearTimeout(t);
  }, [plate]); // eslint-disable-line react-hooks/exhaustive-deps

  // trocou o cliente da OS para outra pessoa: o veículo identificado deixa de valer
  useEffect(() => {
    if (chosen && customer && customer.id !== chosen.customer_id) setChosen(null);
  }, [customer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => {
    setChosen(null); setResult(null); setCandidates([]); setPlate(''); last.current = '';
    onClear?.();
  };

  const openForm = (r) => setForm({
    owner: customer ? 'current' : 'new',
    name: '', phone: '', document: '',
    plate: r.plate, brand: r.vehicle?.brand || '', model: r.vehicle?.model || '', year: r.vehicle?.model_year || r.vehicle?.year || '',
    color: r.vehicle?.color || '', data: r.vehicle || null, fipe: !r.vehicle,
  });
  const fromFipe = (v) => setForm((f) => ({ ...f, brand: v.brand || f.brand, model: v.model || f.model, year: v.model_year || '', data: { ...(f.data || {}), ...v } }));

  const onPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setResult(null); setCandidates([]); setChosen(null);
    try {
      const { readPlateFromImage } = await import('../lib/ocr');
      const { plates } = await readPlateFromImage(file, setReading);
      setReading('');
      if (!plates.length) { setResult({ error: 'Não consegui ler a placa na foto. Tente mais perto e de frente, ou digite a placa.' }); return; }
      setCandidates(plates.slice(0, 3));
      await search(plates[0]);
    } catch {
      setReading('');
      setResult({ error: 'Não foi possível ler a foto neste aparelho. Digite a placa.' });
    }
  };

  const saveQuick = async () => {
    const useCurrent = form.owner === 'current' && customer;
    const body = {
      ...(useCurrent ? { customer_id: customer.id } : { customer: { name: form.name, phone: form.phone || null, document: form.document || null } }),
      vehicle: { plate: form.plate, brand: form.brand || null, model: form.model || null, year: form.year || null, color: form.color || null, data: form.data },
    };
    const r = await run(() => api.post('/vehicles/quick', body), 'Proprietário e veículo cadastrados');
    if (r === FAIL) return;
    const n = normalizePlate(form.plate);
    setForm(null); setResult(null);
    const m = {
      id: r.equipment_id, customer_id: r.customer_id, plate: formatPlate(n), brand: form.brand, model: form.model, year: form.year, color: form.color,
      vehicle_data: form.data, customer_name: useCurrent ? customer.name : form.name, customer_phone: useCurrent ? customer.phone : form.phone,
      customer_document: useCurrent ? customer.document : form.document,
    };
    last.current = n;
    choose(m);
  };

  const formValid = form && normalizePlate(form.plate) && (form.owner === 'current' ? !!customer : form.name.trim().length >= 2);

  return (
    <div className="rounded-app-sm border border-line bg-muted/30 p-3">
      {chosen ? (
        <div aria-label="Veículo identificado">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Car className="h-5 w-5 text-primary" />
            <span className="font-semibold">Veículo identificado</span>
            <span className="chip bg-emerald-500/10 text-emerald-700">cadastrado</span>
            <button type="button" className="btn-ghost ml-auto h-8 px-2 text-xs" onClick={reset}><RotateCcw className="h-3.5 w-3.5" /> Outra placa</button>
          </div>
          <VehicleFacts v={{ ...(chosen.vehicle_data || {}), ...Object.fromEntries(Object.entries(chosen).filter(([, x]) => x)) }} plate={chosen.plate} />
          <div className="mt-3 flex items-start gap-3 rounded-app-sm border border-line bg-surface p-3">
            <User className="mt-0.5 h-4 w-4 text-ink-faint" />
            <div className="min-w-0 text-sm">
              <div className="text-[11px] uppercase tracking-wide text-ink-faint">Proprietário — cliente da OS</div>
              <div className="font-medium">{chosen.customer_name}</div>
              <div className="text-ink-soft">{[chosen.customer_phone, chosen.customer_document, chosen.customer_email].filter(Boolean).join(' · ')}</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <button type="button" className="btn-primary" onClick={() => fileRef.current?.click()} disabled={!!reading}>
            {reading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />} {reading || 'Foto da placa'}
          </button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPhoto} />
          <Input label="Placa" className="w-36" value={plate} maxLength={8} placeholder="ABC1D23" aria-label="Placa do veículo" autoComplete="off" autoFocus={autoFocus}
            autoCapitalize="characters" enterKeyHint="search"
            onChange={(e) => setPlate(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } }} />
          <button type="button" className="btn-ghost border border-line" onClick={() => search()} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Buscar
          </button>
          {plate && <button type="button" className="btn-ghost btn-icon" title="Limpar" aria-label="Limpar placa" onClick={reset}><X className="h-4 w-4" /></button>}
          <p className="w-full text-xs text-ink-faint">Digite a placa: a busca é automática e o proprietário entra como cliente.</p>
        </div>
      )}
      {candidates.length > 1 && !chosen && (
        <p className="mt-2 text-xs text-ink-soft">Leituras possíveis: {candidates.map((c) => (
          <button key={c} type="button" className="mx-1 rounded bg-muted px-1.5 py-0.5 font-mono hover:bg-primary/10" onClick={() => search(c)}>{formatPlate(c)}</button>
        ))}</p>
      )}
      {result?.error && <p className="mt-2 text-sm text-red-600">{result.error}</p>}
      {result?.found && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-ink-soft">Mais de um veículo com esta placa — escolha:</p>
          {result.matches.map((m) => (
            <button key={m.id} type="button" onClick={() => choose(m)}
              className="flex w-full items-center gap-3 rounded-app-sm border border-line bg-surface p-3 text-left hover:border-primary">
              <Car className="h-5 w-5 text-primary" />
              <span className="min-w-0 flex-1"><b>{m.plate}</b> · {m.description}{m.color ? ` · ${m.color}` : ''}
                <span className="block text-sm text-ink-soft">{m.customer_name}{m.customer_phone ? ` · ${m.customer_phone}` : ''}</span></span>
              <Check className="h-4 w-4 text-ink-faint" />
            </button>
          ))}
        </div>
      )}
      {result && !result.error && !result.found && !form && (
        <div className="mt-3 space-y-3">
          {result.vehicle ? (
            <div className="rounded-app-sm border border-line bg-surface p-3">
              <div className="mb-2 flex items-center gap-2 text-sm"><Car className="h-4 w-4 text-primary" /><b>Dados do veículo</b>
                <span className="text-xs text-ink-faint">({result.source === 'cache' ? 'consulta anterior' : result.provider})</span></div>
              <VehicleFacts v={result.vehicle} plate={result.plate} />
              <p className="mt-2 text-xs text-ink-faint">A consulta não traz o dono do veículo (LGPD): cadastre o proprietário para usar na OS.</p>
            </div>
          ) : (
            <p className="text-sm text-ink-soft">Placa {result.plate} não está no cadastro.{result.message ? ` ${result.message}` : ''}
              {canRegister && <span className="block text-xs">Cadastre o proprietário e escolha marca, modelo e ano na <b>Tabela FIPE</b> (grátis).</span>}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {result.lookup_available && !result.vehicle && (
              <button type="button" className="btn-primary" disabled={busy} onClick={() => search(result.plate, true)}>
                <Search className="h-4 w-4" /> Buscar dados do veículo ({result.provider})
              </button>
            )}
            {canRegister && (
              <button type="button" className={result.vehicle || !result.lookup_available ? 'btn-primary' : 'btn-ghost border border-line'} onClick={() => openForm(result)}>
                <UserPlus className="h-4 w-4" /> Cadastrar proprietário e veículo
              </button>
            )}
          </div>
        </div>
      )}
      <Modal open={!!form} onClose={() => setForm(null)} title="Proprietário e veículo" subtitle={form?.data && form.data.source !== 'fipe' ? 'Dados do veículo trazidos pela consulta — confira antes de salvar.' : 'Preencha o proprietário e escolha o veículo na Tabela FIPE.'}
        footer={<>
          <button className="btn-ghost" onClick={() => setForm(null)}><RotateCcw className="h-4 w-4" /> Voltar</button>
          <button className="btn-primary" disabled={busy || !formValid} onClick={saveQuick}><Check className="h-4 w-4" /> Salvar e usar na OS</button>
        </>}>
        {form && (
          <div className="space-y-4">
            {customer && (
              <div className="flex flex-wrap gap-2">
                {[['current', `Cliente já escolhido: ${customer.name}`], ['new', 'Outro proprietário']].map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setForm({ ...form, owner: k })}
                    className={cx('btn border text-sm', form.owner === k ? 'border-primary bg-primary/10 text-primary' : 'border-line')}>{l}</button>
                ))}
              </div>
            )}
            {form.owner === 'new' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Nome do proprietário *" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                <Input label="Telefone / WhatsApp" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: maskPhone(e.target.value) })} />
                <Input label="CPF/CNPJ (opcional)" inputMode="numeric" value={form.document} onChange={(e) => setForm({ ...form, document: maskDoc(e.target.value) })} />
              </div>
            )}
            {form.fipe ? <FipePicker onPick={fromFipe} /> : (
              <button type="button" className="btn-ghost h-8 border border-line text-xs" onClick={() => setForm({ ...form, fipe: true })}>Escolher na Tabela FIPE (grátis)</button>
            )}
            <div className={cx('grid gap-3 rounded-app-sm border border-line p-3 sm:grid-cols-3', form.data && 'bg-primary/5')}>
              <Input label="Placa *" value={form.plate} onChange={(e) => setForm({ ...form, plate: e.target.value.toUpperCase() })} />
              <Input label="Marca" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} />
              <Input label="Modelo" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
              <Input label="Ano" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} />
              <Input label="Cor" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
              {form.data?.city && <p className="self-end pb-2 text-xs text-ink-faint">{form.data.city}{form.data.uf ? `/${form.data.uf}` : ''}</p>}
            </div>
            <p className="text-xs text-ink-faint">Os dados do dono do veículo não são consultados (LGPD): nome e telefone são informados pelo cliente.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
