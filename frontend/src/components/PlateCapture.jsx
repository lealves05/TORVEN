// Abertura da OS pela placa: foto (leitura no aparelho) ou digitação → busca no cadastro →
// se não houver, consulta o serviço de placas (quando configurado) e oferece o cadastro simples de cliente + veículo.
import { useEffect, useRef, useState } from 'react';
import { Camera, Search, Car, UserPlus, Loader2, Check, RotateCcw } from 'lucide-react';
import { api } from '../lib/api';
import { normalizePlate, formatPlate } from '../lib/plate';
import { maskPhone, maskDoc } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { Input, Modal, useAction, FAIL, cx } from './ui';

/**
 * @param {{ onSelect: (r: { customer_id: string, equipment_id: string }) => void, initialPlate?: string }} p
 */
export default function PlateCapture({ onSelect, initialPlate }) {
  const { can } = useAuth();
  const [plate, setPlate] = useState(initialPlate || '');
  const [reading, setReading] = useState('');
  const [result, setResult] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [form, setForm] = useState(null);
  const [run, busy] = useAction();
  const fileRef = useRef(null);
  const ran = useRef(false);

  const search = async (p = plate, consult = false) => {
    const n = normalizePlate(p);
    if (!n) { setResult({ error: 'Placa incompleta. Formato ABC1D23 ou ABC-1234.' }); return; }
    setPlate(formatPlate(n));
    const r = await run(() => api.get(`/vehicles/plate/${n}${consult ? '?consultar=1' : ''}`));
    if (r === FAIL) return;
    setResult(r);
    if (!r.found && (consult || !r.lookup_available)) openForm(r);
  };

  useEffect(() => {
    if (initialPlate && !ran.current) { ran.current = true; search(initialPlate); }
  }, [initialPlate]); // eslint-disable-line react-hooks/exhaustive-deps

  const openForm = (r) => setForm({
    name: '', phone: '', document: '',
    plate: r.plate, brand: r.vehicle?.brand || '', model: r.vehicle?.model || '', year: r.vehicle?.model_year || r.vehicle?.year || '',
    color: r.vehicle?.color || '', data: r.vehicle || null,
  });

  const onPhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setResult(null); setCandidates([]);
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
    const body = { customer: { name: form.name, phone: form.phone || null, document: form.document || null },
      vehicle: { plate: form.plate, brand: form.brand || null, model: form.model || null, year: form.year || null, color: form.color || null, data: form.data } };
    const r = await run(() => api.post('/vehicles/quick', body), 'Cliente e veículo cadastrados');
    if (r !== FAIL) { setForm(null); setResult(null); onSelect(r); }
  };

  return (
    <div className="rounded-app-sm border border-line bg-muted/30 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <button type="button" className="btn-primary" onClick={() => fileRef.current?.click()} disabled={!!reading}>
          {reading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />} {reading || 'Foto da placa'}
        </button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPhoto} />
        <Input label="Placa" className="w-36" value={plate} maxLength={8} placeholder="ABC1D23" aria-label="Placa do veículo"
          onChange={(e) => setPlate(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } }} />
        <button type="button" className="btn-ghost border border-line" onClick={() => search()} disabled={busy}><Search className="h-4 w-4" /> Buscar</button>
      </div>
      {candidates.length > 1 && (
        <p className="mt-2 text-xs text-ink-soft">Leituras possíveis: {candidates.map((c) => (
          <button key={c} type="button" className="mx-1 rounded bg-muted px-1.5 py-0.5 font-mono hover:bg-primary/10" onClick={() => search(c)}>{formatPlate(c)}</button>
        ))}</p>
      )}
      {result?.error && <p className="mt-2 text-sm text-red-600">{result.error}</p>}
      {result?.found && (
        <div className="mt-3 space-y-2">
          {result.matches.map((m) => (
            <button key={m.id} type="button" onClick={() => { onSelect({ customer_id: m.customer_id, equipment_id: m.id }); setResult(null); }}
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
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-soft">Placa {result.plate} não cadastrada.</span>
          {result.lookup_available && (
            <button type="button" className="btn-primary" disabled={busy} onClick={() => search(result.plate, true)}>
              <Search className="h-4 w-4" /> Buscar dados do veículo ({result.provider})
            </button>
          )}
          {can('customers_edit') || can('orders_create') ? (
            <button type="button" className="btn-ghost border border-line" onClick={() => openForm(result)}><UserPlus className="h-4 w-4" /> Cadastro simples</button>
          ) : null}
        </div>
      )}
      <Modal open={!!form} onClose={() => setForm(null)} title="Cadastro simples" subtitle={form?.data ? 'Dados do veículo trazidos pela consulta — confira antes de salvar.' : 'Preencha o cliente e o veículo.'}
        footer={<>
          <button className="btn-ghost" onClick={() => setForm(null)}><RotateCcw className="h-4 w-4" /> Voltar</button>
          <button className="btn-primary" disabled={busy || !form?.name?.trim() || !normalizePlate(form?.plate)} onClick={saveQuick}><Check className="h-4 w-4" /> Salvar e usar na OS</button>
        </>}>
        {form && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Nome do cliente *" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <Input label="Telefone / WhatsApp" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: maskPhone(e.target.value) })} />
              <Input label="CPF/CNPJ (opcional)" inputMode="numeric" value={form.document} onChange={(e) => setForm({ ...form, document: maskDoc(e.target.value) })} />
            </div>
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
