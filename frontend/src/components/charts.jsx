import { useState } from 'react';
import { startOfMonth, endOfMonth, subMonths, subDays, startOfYear, format, parseISO } from 'date-fns';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { money, num, ymd } from '../lib/format';
import { cx } from './ui';

// Paleta categórica validada (claro / escuro): entradas azul, saídas laranja-avermelhado
const SERIES = { light: ['#2a78d6', '#eb6834'], dark: ['#3987e5', '#d95926'] };
const cssVar = (name) => `rgb(${getComputedStyle(document.documentElement).getPropertyValue(name).trim()})`;
export const useChartTheme = () => {
  const dark = document.documentElement.classList.contains('dark');
  return { s: dark ? SERIES.dark : SERIES.light, grid: cssVar('--line'), ink: cssVar('--ink-faint'), text: cssVar('--ink') };
};

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

export const ChartTip = ({ active, payload, label, labelFmt, fmtValue = money }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="card px-3 py-2 text-xs">
      <div className="mb-1 font-medium">{labelFmt ? labelFmt(label) : label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-ink-soft">
          <span className="h-2 w-2 rounded-sm" style={{ background: p.color || p.fill }} />{p.name}: <b className="tabular-nums text-ink">{fmtValue(p.value)}</b>
        </div>
      ))}
    </div>
  );
};

export function HBar({ rows, label, value, color, height, fmtValue }) {
  const t = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={height || Math.max(120, rows.length * 38)}>
      <BarChart data={rows} layout="vertical" margin={{ left: 0, right: 16, top: 4, bottom: 4 }} barCategoryGap={8}>
        <CartesianGrid horizontal={false} stroke={t.grid} />
        <XAxis type="number" tick={{ fill: t.ink, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => num(v)} />
        <YAxis type="category" dataKey={label} width={150} tick={{ fill: t.text, fontSize: 12 }} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ fill: t.grid, opacity: 0.4 }} content={<ChartTip fmtValue={fmtValue} />} />
        <Bar dataKey={value} name="Valor" fill={color || t.s[0]} radius={[0, 4, 4, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Entradas × saídas por dia. */
export function InOutChart({ data, height = 240 }) {
  const t = useChartTheme();
  return (
    <>
      <div className="mb-2 flex gap-4 text-xs text-ink-soft">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: t.s[0] }} />Entradas</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: t.s[1] }} />Saídas</span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ left: 0, right: 8, top: 4, bottom: 0 }} barGap={2}>
          <CartesianGrid vertical={false} stroke={t.grid} />
          <XAxis dataKey="day" tick={{ fill: t.ink, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(d) => format(parseISO(d), 'dd/MM')} minTickGap={16} />
          <YAxis tick={{ fill: t.ink, fontSize: 11 }} axisLine={false} tickLine={false} width={56} tickFormatter={(v) => num(v)} />
          <Tooltip cursor={{ fill: t.grid, opacity: 0.4 }} content={<ChartTip labelFmt={(d) => format(parseISO(d), 'dd/MM/yyyy')} />} />
          <Bar dataKey="entradas" name="Entradas" fill={t.s[0]} radius={[4, 4, 0, 0]} maxBarSize={16} />
          <Bar dataKey="saidas" name="Saídas" fill={t.s[1]} radius={[4, 4, 0, 0]} maxBarSize={16} />
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}
