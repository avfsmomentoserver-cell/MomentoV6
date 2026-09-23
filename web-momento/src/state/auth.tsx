import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { api, getToken, setToken } from "@/lib/api";

interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isOperator: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface MeResponse {
  user: { id: number; email: string; name: string; role: string } | null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!getToken()) {
        setIsLoading(false);
        return;
      }
      try {
        const me = await api.get<MeResponse>("/api/v1/auth/me");
        if (!cancelled) setUser(me.user);
      } catch {
        setToken(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<AuthUser> => {
    const res = await api.post<{ token: string; user: AuthUser }>("/api/v1/auth/login", { email, password });
    setToken(res.token);
    setUser(res.user);
    queryClient.invalidateQueries();
    return res.user;
  }, [queryClient]);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    queryClient.invalidateQueries();
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, isOperator: user?.role === "operator" || user?.role === "admin", isLoading, login, logout }),
    [user, isLoading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
