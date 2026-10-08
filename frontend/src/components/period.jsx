// Seletor de período (sem gráficos: não carrega a biblioteca de gráficos nas telas que só precisam de datas).
import { useState } from 'react';
import { startOfMonth, endOfMonth, subMonths, subDays, startOfYear } from 'date-fns';
import { ymd } from '../lib/format';
import { cx } from './ui';

const PRESETS = [
  ['hoje', 'Hoje', () => [new Date(), new Date()]],
  ['7d', '7 dias', () => [subDays(new Date(), 6), new Date()]],
  ['30d', '30 dias', () => [subDays(new Date(), 29), new Date()]],
  ['mes', 'Este mês', () => [startOfMonth(new Date()), endOfMonth(new Date())]],
  ['mesant', 'Mês anterior', () => { const d = subMonths(new Date(), 1); return [startOfMonth(d), endOfMonth(d)]; }],
  ['ano', 'Este ano', () => [startOfYear(new Date()), new Date()]],
];

export const monthRange = () => ({ from: ymd(startOfMonth(new Date())), to: ymd(endOfMonth(new Date())) });

export function PeriodPicker({ value, onChange, initial = 'mes' }) {
  const [preset, setPreset] = useState(initial);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1 rounded-app-sm bg-muted p-1">
        {PRESETS.map(([k, label, fn]) => (
          <button key={k} onClick={() => { setPreset(k); const [a, b] = fn(); onChange({ from: ymd(a), to: ymd(b) }); }}
            className={cx('rounded-[calc(var(--radius)*0.45)] px-3 py-1.5 text-xs font-medium', preset === k ? 'bg-surface shadow-soft' : 'text-ink-soft hover:text-ink')}>{label}</button>
        ))}
      </div>
      <input type="date" className="input w-auto" value={value.from} onChange={(e) => { setPreset(''); onChange({ ...value, from: e.target.value }); }} />
      <span className="text-ink-faint">–</span>
      <input type="date" className="input w-auto" value={value.to} onChange={(e) => { setPreset(''); onChange({ ...value, to: e.target.value }); }} />
    </div>
  );
}

