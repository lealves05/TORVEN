import { useState } from 'react';
import { Sun, Moon, Monitor, Check, Plus, RotateCcw } from 'lucide-react';
import { COLOR_THEMES, PRESET_COLORS } from '../lib/theme';
import { api } from '../lib/api';
import { ROLES } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { PageHeader, Input, Avatar, useAction, FAIL, cx } from '../components/ui';

export default function Account() {
  const { user, savePrefs, refresh, company } = useAuth();
  const mine = user.preferences?.primaryColor;
  const [run, busy] = useAction();
  const [name, setName] = useState(user.name);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const theme = user.preferences?.theme || 'system';

  const saveName = async () => { if ((await run(() => api.put('/auth/me', { name }), 'Nome atualizado')) !== FAIL) refresh(); };
  const savePw = async () => {
    const r = await run(() => api.put('/auth/me', { currentPassword: pw.currentPassword, newPassword: pw.newPassword }), 'Senha alterada');
    if (r !== FAIL) setPw({ currentPassword: '', newPassword: '', confirm: '' });
  };

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Minha conta" />
      <div className="card flex items-center gap-4 p-6">
        <Avatar name={user.name} size="h-14 w-14" />
        <div><div className="text-lg font-semibold">{user.name}</div><div className="text-sm text-ink-faint">{user.email} · {ROLES[user.role]}</div></div>
      </div>
      <div className="card space-y-4 p-6">
        <h3 className="font-semibold">Preferências pessoais</h3>
        <div className="grid grid-cols-3 gap-2">
          {[['light', 'Claro', Sun], ['dark', 'Escuro', Moon], ['system', 'Automático', Monitor]].map(([k, l, I]) => (
            <button key={k} onClick={() => savePrefs({ theme: k })} className={cx('btn border', theme === k ? 'border-primary bg-primary/10 text-primary' : 'border-line')}><I className="h-4 w-4" />{l}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[['comfortable', 'Confortável'], ['compact', 'Compacta']].map(([k, l]) => (
            <button key={k} onClick={() => savePrefs({ density: k })} className={cx('btn border', (user.preferences?.density || 'comfortable') === k ? 'border-primary bg-primary/10 text-primary' : 'border-line')}>{l}</button>
          ))}
        </div>
      </div>
      <div className="card space-y-4 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">Cor do sistema</h3>
            <p className="text-sm text-ink-faint">Vale só para você. {mine ? 'Você está usando uma cor própria.' : 'Você está usando a cor da empresa.'}</p>
          </div>
          {mine && <button className="btn-ghost h-8 text-xs" onClick={() => savePrefs({ primaryColor: null })}><RotateCcw className="h-3.5 w-3.5" /> Usar cor da empresa</button>}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {COLOR_THEMES.map(([name, c]) => (
            <button key={c} onClick={() => savePrefs({ primaryColor: c })}
              className={cx('flex items-center gap-2.5 rounded-app-sm border p-2 text-left text-sm transition', mine === c ? 'border-primary bg-primary/10' : 'border-line hover:bg-muted')}>
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full" style={{ background: c }}>{mine === c && <Check className="h-4 w-4 text-white" />}</span>
              {name}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {PRESET_COLORS.map((c) => (
            <button key={c} title={c} onClick={() => savePrefs({ primaryColor: c })} className={cx('h-7 w-7 rounded-full ring-offset-2 ring-offset-surface', mine === c && 'ring-2 ring-ink')} style={{ background: c }} />
          ))}
          <label className="relative grid h-7 w-7 cursor-pointer place-items-center overflow-hidden rounded-full border border-dashed border-line" title="Cor personalizada">
            <input type="color" value={mine || company?.settings?.primaryColor || '#ea580c'} onChange={(e) => savePrefs({ primaryColor: e.target.value })} className="absolute -inset-2 h-12 w-12 cursor-pointer opacity-0" />
            <Plus className="h-3.5 w-3.5 text-ink-faint" />
          </label>
        </div>
      </div>
      <div className="card space-y-4 p-6">
        <h3 className="font-semibold">Dados</h3>
        <div className="flex gap-2"><Input className="flex-1" label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn-outline self-end" disabled={busy || name === user.name} onClick={saveName}>Salvar</button></div>
      </div>
      <div className="card space-y-4 p-6">
        <h3 className="font-semibold">Alterar senha</h3>
        <Input label="Senha atual" type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Nova senha" type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
          <Input label="Confirmar nova senha" type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
        </div>
        {pw.confirm && pw.confirm !== pw.newPassword && <p className="text-xs text-red-600">As senhas não conferem.</p>}
        <button className="btn-primary" disabled={busy || pw.newPassword.length < 6 || pw.newPassword !== pw.confirm} onClick={savePw}>Alterar senha</button>
      </div>
    </div>
  );
}
