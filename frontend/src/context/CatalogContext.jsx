import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from './AuthContext';

const Ctx = createContext(null);

/** Técnicos e serviços ativos, compartilhados entre as telas. */
export function CatalogProvider({ children }) {
  const { user } = useAuth();
  const [data, setData] = useState({ technicians: [], services: [], loaded: false });

  const reload = useCallback(async () => {
    if (!user) return;
    const [technicians, services] = await Promise.all([api.get('/technicians'), api.get('/services')]);
    setData({ technicians, services, loaded: true });
  }, [user]);

  useEffect(() => { reload().catch(() => {}); }, [reload]);

  return <Ctx.Provider value={{ ...data, reload }}>{children}</Ctx.Provider>;
}

export const useCatalog = () => useContext(Ctx);
