import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from '../lib/api';
import { applyTheme } from '../lib/theme';

const Ctx = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: !!getToken(), user: null, company: null, permissions: {}, permissionCatalog: [] });

  const load = useCallback(async () => {
    if (!getToken()) return setState({ loading: false, user: null, company: null });
    try {
      const s = await api.get('/auth/me');
      setState({ loading: false, ...s });
    } catch {
      setState({ loading: false, user: null, company: null });
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const out = () => setState({ loading: false, user: null, company: null });
    window.addEventListener('torven:logout', out);
    return () => window.removeEventListener('torven:logout', out);
  }, []);

  // tema segue as configurações da empresa + preferências do usuário
  useEffect(() => {
    applyTheme(state.company?.settings, state.user?.preferences);
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const h = () => applyTheme(state.company?.settings, state.user?.preferences);
    mq?.addEventListener?.('change', h);
    return () => mq?.removeEventListener?.('change', h);
  }, [state.company, state.user]);

  const value = useMemo(() => ({
    ...state,
    async login(email, password) {
      const s = await api.post('/auth/login', { email, password });
      setToken(s.token);
      setState({ loading: false, ...s });
    },
    async register(data) {
      const s = await api.post('/auth/register', data);
      setToken(s.token);
      setState({ loading: false, ...s });
    },
    async demo() {
      const s = await api.post('/auth/demo', {});
      setToken(s.token);
      setState({ loading: false, ...s });
    },
    async activate(data) {
      const s = await api.post('/auth/activate', data);
      setToken(s.token);
      setState({ loading: false, ...s });
    },
    logout() {
      setToken(null);
      setState({ loading: false, user: null, company: null });
    },
    setCompany(company) { setState((s) => ({ ...s, company })); load(); },
    async savePrefs(preferences) {
      setState((s) => ({ ...s, user: { ...s.user, preferences: { ...s.user.preferences, ...preferences } } }));
      const r = await api.put('/auth/me', { preferences });
      setState((s) => ({ ...s, ...r }));
    },
    refresh: load,
    /** true se o perfil tem QUALQUER uma das permissões (escopo 'all'/'own' conta como sim). */
    can(...keys) {
      if (!state.user) return false;
      if (state.user.role === 'owner') return true;
      return keys.some((k) => { const v = state.permissions?.[k]; return v === true || v === 'all' || v === 'own'; });
    },
    scope(key) { return state.user?.role === 'owner' ? 'all' : state.permissions?.[key] || 'none'; },
  }), [state, load]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
export const useSettings = () => useContext(Ctx).company?.settings || {};
