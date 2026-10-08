// Escolha do veículo pela Tabela FIPE (gratuita): tipo → marca → modelo → ano. Preenche marca, modelo, ano e combustível
// sem consulta paga. A FIPE não pesquisa pela placa: a pessoa escolhe o modelo numa lista curta, digitando parte do nome.
import { useEffect, useState } from 'react';
import { Loader2, Search, Check, RotateCcw, BadgeDollarSign } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { cx } from './ui';

const TYPES = [['cars', 'Carro / utilitário'], ['motorcycles', 'Moto'], ['trucks', 'Caminhão / ônibus']];
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Todas as palavras digitadas precisam aparecer (ex.: "strada 1.4" acha "STRADA Working 1.4 Flex"). */
const matches = (name, text) => norm(text).split(/\s+/).filter(Boolean).every((w) => norm(name).includes(w));

function Finder({ label, placeholder, items, onPick, loading, autoFocus }) {
  const [text, setText] = useState('');
  const id = `fipe-${norm(label).replace(/[^a-z]/g, '')}`;
  const list = (items || []).filter((x) => matches(x.name, text)).slice(0, text ? 12 : 8);
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
        <input id={id} className="input pl-9" placeholder={placeholder} value={text} autoFocus={autoFocus} autoComplete="off"
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && list[0]) { e.preventDefault(); onPick(list[0]); } }} />
      </div>
      {loading ? <p className="mt-2 flex items-center gap-2 text-xs text-ink-faint"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando a lista…</p> : (
        <div className="mt-2 flex flex-wrap gap-1.5" role="listbox" aria-label={`Opções — ${label}`}>
          {list.map((x) => (
            <button key={x.code} type="button" role="option" aria-selected="false" onClick={() => onPick(x)}
              className="rounded-app-sm border border-line bg-surface px-2.5 py-1.5 text-left text-sm hover:border-primary hover:bg-primary/5">{x.name}</button>
          ))}
          {items && !list.length && <p className="text-xs text-ink-faint">Nada encontrado. Digite só uma parte do nome.</p>}
          {items && list.length < (items || []).filter((x) => matches(x.name, text)).length && <p className="w-full text-[11px] text-ink-faint">Digite mais para ver outros.</p>}
        </div>
      )}
    </div>
  );
}

/** @param {{ onPick: (v: object) => void, compact?: boolean }} p */
/** Some quando o plano não inclui a Tabela FIPE (a API também recusa). */
export default function FipePicker(props) {
  const { feature } = useAuth();
  return feature('tabela_fipe') ? <FipePickerInner {...props} /> : null;
}

function FipePickerInner({ onPick, compact }) {
  const { company } = useAuth();
  // oficina só de motos (Configurações › Tipos de OS › Ramo da oficina) já abre em "Moto"
  const [type, setType] = useState(company?.settings?.fipeDefaultType === 'motorcycles' ? 'motorcycles' : 'cars');
  const [brands, setBrands] = useState(null);
  const [brand, setBrand] = useState(null);
  const [models, setModels] = useState(null);
  const [model, setModel] = useState(null);
  const [years, setYears] = useState(null);
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const fail = (e) => { setError(e.message || 'A Tabela FIPE não respondeu. Preencha à mão.'); setBusy(false); };
  useEffect(() => {
    setBrands(null); setBrand(null); setModels(null); setModel(null); setYears(null); setInfo(null); setError('');
    api.get(`/vehicles/fipe/${type}/brands`).then(setBrands).catch(fail);
  }, [type]);

  const pickBrand = (b) => {
    setBrand(b); setModels(null); setModel(null); setYears(null); setInfo(null); setError('');
    api.get(`/vehicles/fipe/${type}/brands/${b.code}/models`).then(setModels).catch(fail);
  };
  const pickModel = (m) => {
    setModel(m); setYears(null); setInfo(null); setError('');
    api.get(`/vehicles/fipe/${type}/brands/${brand.code}/models/${m.code}/years`).then(setYears).catch(fail);
  };
  const pickYear = async (y) => {
    setBusy(true); setError('');
    try {
      const v = await api.get(`/vehicles/fipe/${type}/brands/${brand.code}/models/${model.code}/years/${y.code}`);
      setInfo(v); setBusy(false);
      onPick(v);
    } catch (e) { fail(e); }
  };
  const restart = () => { setBrand(null); setModels(null); setModel(null); setYears(null); setInfo(null); setError(''); };

  return (
    <div className={cx('space-y-3 rounded-app-sm border border-primary/30 bg-primary/5 p-3', compact && 'text-sm')} aria-label="Tabela FIPE">
      <div className="flex flex-wrap items-center gap-2">
        <b className="text-sm">Escolher na Tabela FIPE</b><span className="chip bg-emerald-500/10 text-emerald-700">grátis</span>
        {(brand || info) && <button type="button" className="btn-ghost ml-auto h-7 px-2 text-xs" onClick={restart}><RotateCcw className="h-3.5 w-3.5" /> Recomeçar</button>}
      </div>
      {!brand && (
        <div className="flex flex-wrap gap-1.5">
          {TYPES.map(([k, l]) => (
            <button key={k} type="button" onClick={() => setType(k)}
              className={cx('rounded-app-sm border px-3 py-1.5 text-sm', type === k ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-line bg-surface')}>{l}</button>
          ))}
        </div>
      )}
      {!brand && <Finder key={`b-${type}`} label="1. Marca" placeholder="Digite a marca (ex.: Fiat, Honda)" items={brands} loading={!brands && !error} onPick={pickBrand} />}
      {brand && !model && (
        <>
          <p className="text-sm">Marca: <b>{brand.name}</b></p>
          <Finder key={`m-${brand.code}`} label="2. Modelo" placeholder="Digite parte do modelo (ex.: strada 1.4)" items={models} loading={!models && !error} onPick={pickModel} autoFocus />
        </>
      )}
      {model && !info && (
        <div>
          <p className="text-sm">{brand.name} · <b>{model.name}</b></p>
          <span className="label mt-2">3. Ano e combustível</span>
          {!years ? <p className="flex items-center gap-2 text-xs text-ink-faint"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando…</p> : (
            <div className="flex flex-wrap gap-1.5">
              {years.map((y) => (
                <button key={y.code} type="button" disabled={busy} onClick={() => pickYear(y)}
                  className="rounded-app-sm border border-line bg-surface px-2.5 py-1.5 text-sm hover:border-primary hover:bg-primary/5">{y.name.replace(/^32000/, 'Zero km')}</button>
              ))}
            </div>
          )}
        </div>
      )}
      {info && (
        <div className="flex items-start gap-2 text-sm">
          <Check className="mt-0.5 h-4 w-4 text-emerald-600" />
          <div>
            <b>{info.brand} {info.model}</b> · {info.model_year || 'zero km'}{info.fuel ? ` · ${info.fuel}` : ''}
            {info.fipe_price && <span className="block text-xs text-ink-soft"><BadgeDollarSign className="inline h-3.5 w-3.5" /> Valor FIPE {info.fipe_price} ({info.fipe_reference}) · código {info.fipe_code}</span>}
            <span className="block text-xs text-ink-faint">Marca, modelo e ano foram preenchidos. Confira e complete a cor.</span>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
