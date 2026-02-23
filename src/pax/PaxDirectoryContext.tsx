import { createContext, useContext, useMemo, useState } from "react";

type PaxDirectoryContextValue = {
  version: number;
  bumpVersion: () => void;
};

const PaxDirectoryContext = createContext<PaxDirectoryContextValue | null>(null);

export const PaxDirectoryProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [version, setVersion] = useState(0);

  const value = useMemo(
    () => ({
      version,
      bumpVersion: () => setVersion((v) => v + 1),
    }),
    [version]
  );

  return (
    <PaxDirectoryContext.Provider value={value}>
      {children}
    </PaxDirectoryContext.Provider>
  );
};

const usePaxDirectoryContext = () => {
  const ctx = useContext(PaxDirectoryContext);
  if (!ctx) {
    throw new Error("usePaxDirectoryContext must be used within PaxDirectoryProvider");
  }
  return ctx;
};

export const usePaxDirectoryVersion = () => usePaxDirectoryContext().version;
export const useBumpPaxDirectoryVersion = () =>
  usePaxDirectoryContext().bumpVersion;
