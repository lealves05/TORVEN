import { format, parseISO } from 'date-fns';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { money, num } from '../lib/format';

// Paleta categórica validada (claro / escuro): entradas azul, saídas laranja-avermelhado
const SERIES = { light: ['#2a78d6', '#eb6834'], dark: ['#3987e5', '#d95926'] };
const cssVar = (name) => `rgb(${getComputedStyle(document.documentElement).getPropertyValue(name).trim()})`;
export const useChartTheme = () => {
  const dark = document.documentElement.classList.contains('dark');
  return { s: dark ? SERIES.dark : SERIES.light, grid: cssVar('--line'), ink: cssVar('--ink-faint'), text: cssVar('--ink') };
};

export { PeriodPicker, monthRange } from './period';

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
