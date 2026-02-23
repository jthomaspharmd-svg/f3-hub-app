// src/ao/AoSelector.tsx
import React from "react";
import { AO_LIST, type AoId } from "./aoConfig";
import { useAo } from "./AoContext";

export const AoSelector: React.FC = () => {
  const { activeAoId, setActiveAoId } = useAo();

  const labelFor = (ao: (typeof AO_LIST)[number]) => {
    // Show "Jurassic Park (JP)" in dropdown, others just shortName
    if (ao.id === "jurassicpark") return `${ao.displayName} (${ao.shortName})`;
    return ao.shortName; // "Compass", "Colosseum"
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-300 hidden sm:inline">AO:</span>
      <select
  value={activeAoId}
  onChange={(e) => setActiveAoId(e.target.value as AoId)}
  className="
    bg-slate-700 border border-slate-600 rounded-md
    py-1 px-2 text-white text-sm
    hover:bg-slate-600
    max-w-[110px] sm:max-w-[150px]
    truncate
  "
>
  {AO_LIST.map((ao) => (
    <option key={ao.id} value={ao.id}>
      {labelFor(ao)}
    </option>
  ))}
</select>

    </div>
  );
};
