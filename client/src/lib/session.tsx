// Shared session context: who is logged in, and for which tenant.
// The dashboard layout fills this in; any page can read it with useSession().
'use client';
import { createContext, useContext } from 'react';

export interface Session {
  user: { id: string; name: string; email: string; role: string };
  tenant: { id: string; businessName: string; riskThreshold: number };
}

export const SessionContext = createContext<Session | null>(null);
export const useSession = () => useContext(SessionContext)!;
