// src/ao/AoContext.tsx
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { AO_CONFIG, type AoConfig, type AoId } from "./aoConfig";

type AoContextValue = {
  activeAoId: AoId;
  activeAo: AoConfig;
  setActiveAoId: (id: AoId) => void;
};

const AoContext = createContext<AoContextValue | null>(null);

const STORAGE_KEY = "f3_active_ao";

export const AoProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeAoId, setActiveAoIdState] = useState<AoId>(() => {
    const urlAo = new URLSearchParams(window.location.search).get("ao") as AoId | null;
    if (urlAo && AO_CONFIG[urlAo]) return urlAo;

    const saved = localStorage.getItem(STORAGE_KEY) as AoId | null;
    return saved && AO_CONFIG[saved] ? saved : "compass";
  });

  // Keep localStorage and the shareable `?ao=` URL in sync.
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, activeAoId);

    const url = new URL(window.location.href);
    url.searchParams.set("ao", activeAoId);
    window.history.replaceState({}, "", url);
  }, [activeAoId]);

  const setActiveAoId = (id: AoId) => {
    if (!AO_CONFIG[id]) return;
    setActiveAoIdState(id);
  };

  const activeAo = useMemo(() => AO_CONFIG[activeAoId], [activeAoId]);

  const value = useMemo(
    () => ({ activeAoId, activeAo, setActiveAoId }),
    [activeAoId, activeAo]
  );

  return <AoContext.Provider value={value}>{children}</AoContext.Provider>;
};

export const useAo = (): AoContextValue => {
  const ctx = useContext(AoContext);
  if (!ctx) throw new Error("useAo must be used inside <AoProvider>");
  return ctx;
};
