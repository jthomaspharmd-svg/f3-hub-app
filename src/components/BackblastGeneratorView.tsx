import React, { useState, useEffect, useMemo, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import type {
  WorkoutSession,
  PaxAttendance,
  Exercise,
  WorkoutRound,
  PlannerData,
} from "../types";
import { generateBackblast } from "../services/geminiService";
import {
  DocumentTextIcon,
  UserGroupIcon,
  PlusCircleIcon,
  TrashIcon,
  FireIcon,
  ExternalLinkIcon,
  ClipboardCopyIcon,
} from "./icons";
import {
  getPaxListByAo,
  getBandNameForF3Name,
  WARMUP_EXERCISES,
  THANG_EXERCISES,
} from "../constants";
import { usePaxDirectoryVersion } from "../pax/PaxDirectoryContext";

// ✅ AO
import { useAo } from "../ao/AoContext";
import { AoSelector } from "../ao/AoSelector";
import type { AoId } from "../ao/aoConfig";

/* ---------- DND-KIT (same behavior as Workout Planner) ---------- */
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import {
  restrictToVerticalAxis,
  restrictToParentElement,
} from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";

interface BackblastGeneratorViewProps {
  addLoggedWorkout: (session: WorkoutSession) => void;
  planToImport: PlannerData | null;
  clearImportedPlan: () => void;
}

/* -------------------------------------------------
   Helpers: date/time + hashtags
------------------------------------------------- */
const pad2 = (n: number) => String(n).padStart(2, "0");

/* -------------------------------------------------
   Backblast emoji helpers (variability)
------------------------------------------------- */
const EMOJI_USE_PERCENT = 40; // default: lower = fewer emoji posts
const EMOJI_USE_PERCENT_COMPASS = 70;
const EMOJI_ROTATION = {
  ao: ["📍", "🧭", "🗺️", "📌"],
  date: ["📅", "🗓️", "⏰", "⌚"],
  q: ["🎩", "💪", "🧢", "🛡️"],
  pax: ["👥", "🫶", "🤝", "🏋️"],
  disclaimer: ["🚨", "⚠️", "🚧"],
  count: ["🔢", "🧮", "📊"],
};

const hashSeed = (seed: string) => {
  let h = 0;
  const s = String(seed || "");
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
};

const pickFrom = (options: string[], seed: string, salt: string) => {
  if (!options.length) return "";
  const idx = hashSeed(`${seed}:${salt}`) % options.length;
  return options[idx];
};

const buildStyleSeed = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const shouldUseEmojis = (
  seed: string,
  forceNoEmojis: boolean,
  minimalEmojis: boolean,
  aoId?: string
) => {
  if (forceNoEmojis || minimalEmojis) return false;
  const n = hashSeed(`${seed}:emoji`) % 100;
  const pct = aoId === "compass" ? EMOJI_USE_PERCENT_COMPASS : EMOJI_USE_PERCENT;
  return n < pct;
};

const buildEmojiMap = (seed: string, useEmojis: boolean) => {
  if (!useEmojis) {
    return {
      ao: "",
      date: "",
      q: "",
      pax: "",
      disclaimer: "",
      count: "",
    };
  }
  return {
    ao: pickFrom(EMOJI_ROTATION.ao, seed, "ao"),
    date: pickFrom(EMOJI_ROTATION.date, seed, "date"),
    q: pickFrom(EMOJI_ROTATION.q, seed, "q"),
    pax: pickFrom(EMOJI_ROTATION.pax, seed, "pax"),
    disclaimer: pickFrom(EMOJI_ROTATION.disclaimer, seed, "disclaimer"),
    count: pickFrom(EMOJI_ROTATION.count, seed, "count"),
  };
};

const stripEmojis = (text: string) =>
  String(text || "").replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "");

const normalizeBackblastEmojis = (
  text: string,
  seed: string,
  useEmojis: boolean
) => {
  let out = String(text || "");
  if (!useEmojis) return stripEmojis(out);

  const e = buildEmojiMap(seed, true);
  const ao = e.ao ? `${e.ao} ` : "";
  const date = e.date ? `${e.date} ` : "";
  const q = e.q ? `${e.q} ` : "";
  const pax = e.pax ? `${e.pax} ` : "";
  const disclaimer = e.disclaimer ? `${e.disclaimer} ` : "";
  const count = e.count ? `${e.count} ` : "";

  out = out.replace(/^\s*[\p{So}\uFE0F]*\s*AO\s*:/gim, `${ao}AO:`);
  out = out.replace(
    /^\s*[\p{So}\uFE0F]*\s*Date\/Time\s*:/gim,
    `${date}Date/Time:`
  );
  out = out.replace(/^\s*[\p{So}\uFE0F]*\s*Q\s*:/gim, `${q}Q:`);
  out = out.replace(/^\s*[\p{So}\uFE0F]*\s*PAX\s*:/gim, `${pax}PAX:`);
  out = out.replace(
    /^\s*[\p{So}\uFE0F]*\s*Disclaimer\s*/gim,
    `${disclaimer}Disclaimer`
  );
  out = out.replace(
    /^\s*[\p{So}\uFE0F]*\s*Count O Rama\s*:/gim,
    `${count}Count O Rama:`
  );

  return out;
};

const formatTime12 = (time24: string) => {
  const [hhStr, mmStr] = time24.split(":");
  const hh = Number(hhStr);
  const mm = Number(mmStr);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return time24;

  const ampm = hh >= 12 ? "PM" : "AM";
  const hour12 = ((hh + 11) % 12) + 1;
  return `${hour12}:${pad2(mm)} ${ampm}`;
};

const formatDateLong = (d: Date) => {
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  return `${weekday}, ${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
};

const toIsoDate = (longDateStr: string): string => {
  const parsed = new Date(longDateStr);
  if (Number.isNaN(parsed.getTime())) return "";
  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const buildWorkoutTimeRange = (start24: string, end24: string) => {
  return `${formatTime12(start24)} - ${formatTime12(end24)}`;
};

const isFridayFromDateString = (dateStr: string): boolean => {
  const raw = String(dateStr || "").trim();
  if (!raw) return false;

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.getDay() === 5;

  const m = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const mm = Number(m[1]);
    const dd = Number(m[2]);
    const yy = m[3].length === 2 ? Number(`20${m[3]}`) : Number(m[3]);
    const d = new Date(yy, mm - 1, dd);
    if (!Number.isNaN(d.getTime())) return d.getDay() === 5;
  }

  return /fri/i.test(raw);
};

const buildHashtags = (
  aoHashtags: string[],
  kind: "preblast" | "backblast",
  opts?: { aoId?: string; workoutDate?: string }
) => {
  const extra = kind === "preblast" ? ["#preblast"] : ["#backblast"];
  const extraAoTags: string[] = [];
  if (
    opts?.aoId === "thehill" &&
    isFridayFromDateString(opts?.workoutDate || "")
  ) {
    extraAoTags.push("#hillybillyshuffle");
  }
  if (opts?.aoId === "theshadows" && kind === "backblast") {
    extraAoTags.push("#backblastshadows");
  }
  const seen = new Set<string>();

  return [...(aoHashtags || []), ...extra, ...extraAoTags].filter((t) => {
    const key = String(t || "").toLowerCase().trim();
    if (!key) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

// Given an AO with scheduleBlocks, find the most recent workout (in the past)
// scanning back up to 14 days.
const getMostRecentWorkoutDetailsForAo = (ao: {
  scheduleBlocks: {
    daysOfWeek: number[];
    startTime24: string;
    endTime24: string;
  }[];
}) => {
  const now = new Date();

  const parseStart = (d: Date, start24: string) => {
    const [hh, mm] = start24.split(":").map(Number);
    const x = new Date(d);
    x.setHours(hh || 0, mm || 0, 0, 0);
    return x;
  };

  let best: {
    start: Date;
    startTime24: string;
    endTime24: string;
  } | null = null;

  // Look back 14 days for the latest scheduled workout start that is <= now
  for (let back = 0; back <= 14; back++) {
    const day = new Date(now);
    day.setDate(now.getDate() - back);

    for (const block of ao.scheduleBlocks || []) {
      if (!block.daysOfWeek.includes(day.getDay())) continue;

      const start = parseStart(day, block.startTime24);
      if (start.getTime() > now.getTime()) continue;

      if (!best || start.getTime() > best.start.getTime()) {
        best = {
          start,
          startTime24: block.startTime24,
          endTime24: block.endTime24,
        };
      }
    }
  }

  const fallbackBlock = (ao.scheduleBlocks && ao.scheduleBlocks[0]) || {
    daysOfWeek: [now.getDay()],
    startTime24: "05:30",
    endTime24: "06:15",
  };

  const chosen = best ?? {
    start: parseStart(now, fallbackBlock.startTime24),
    startTime24: fallbackBlock.startTime24,
    endTime24: fallbackBlock.endTime24,
  };

  return {
    longDate: formatDateLong(chosen.start),
    time: buildWorkoutTimeRange(chosen.startTime24, chosen.endTime24),
    startTime24: chosen.startTime24,
  };
};

/* ------------ Convert long date → "M/D/YY (Day)" format ----------- */
const formatLongDateToQSheetDate = (longDateStr: string): string => {
  try {
    const datePart = longDateStr.split(", ")[1];
    const date = new Date(datePart);
    if (isNaN(date.getTime())) return longDateStr;

    const month = date.getMonth() + 1;
    const day = date.getDate();
    const year = String(date.getFullYear()).slice(-2);
    const dayOfWeek = date.toLocaleDateString("en-US", { weekday: "short" });

    return `${month}/${day}/${year} (${dayOfWeek})`;
  } catch {
    return longDateStr;
  }
};

const parseTimeRangeTo24 = (range: string): { start: string; end: string } => {
  const matches = String(range || "").match(
    /(\d{1,2}):(\d{2})\s*(AM|PM)?/gi
  );
  if (!matches || matches.length < 2) return { start: "", end: "" };

  const to24 = (t: string) => {
    const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!m) return "";
    let hh = Number(m[1]);
    const mm = Number(m[2]);
    const ap = m[3]?.toUpperCase();
    if (Number.isNaN(hh) || Number.isNaN(mm)) return "";
    if (ap) {
      if (ap === "AM") {
        if (hh === 12) hh = 0;
      } else if (hh !== 12) {
        hh += 12;
      }
    }
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  };

  return { start: to24(matches[0]), end: to24(matches[1]) };
};

/* -------------------- Helper: Renumber round names -------------------- */
const renumberRounds = (rounds: WorkoutRound[]) =>
  rounds.map((r, idx) => ({ ...r, name: `Round ${idx + 1}` }));

/* -------------------- Helper: compact optional string -------------------- */
const compactOptionalString = (s?: string) => (s ?? "").trim();

/* -------------------- Helpers: normalize pax names (UI vs output) -------------------- */
/** UI/storage should be WITHOUT "@", but generated output should INCLUDE "@". */
const stripAt = (name: string) => String(name || "").trim().replace(/^@+/, "");
const addAt = (name: string) => {
  const n = stripAt(name);
  const band = getBandNameForF3Name(n) || n;
  return band ? `@${band}` : "";
};
const formatPaxNameWithExtras = (p: {
  name: string;
  bigfoot?: boolean;
  starsky?: boolean;
}) => {
  const tags: string[] = [];
  if (p.bigfoot) tags.push("Bigfoot");
  const base = addAt(p.name);
  return tags.length ? `${base} [${tags.join(", ")}]` : base;
};

/* -------------------------------------------------
   Jurassic Park detection
------------------------------------------------- */
const isJurassicParkAo = (ao: {
  id?: string;
  shortName?: string;
  displayName?: string;
  whereName?: string;
}) => {
  const hay = `${ao.id || ""} ${ao.shortName || ""} ${ao.displayName || ""} ${
    ao.whereName || ""
  }`.toLowerCase();
  return hay.includes("jurassic");
};

/* -------------------------------------------------
   JP pax models (split lists)
------------------------------------------------- */
type JpPaxRunRuck = {
  id: string;
  name: string; // stored without "@"
  bd: boolean;
  dd: boolean;
  td: boolean;
  bigfoot: boolean;
  starsky: boolean;
  lead: boolean;
};

type JpPaxMpc = {
  id: string;
  name: string; // stored without "@"
  dd: boolean;
  td: boolean;
  bigfoot: boolean;
  starsky: boolean;
};

const normalizeRunRuck = (p: Partial<JpPaxRunRuck>): JpPaxRunRuck => ({
  id: String(p.id || uuidv4()),
  name: stripAt(String(p.name || "")),
  bd: p.starsky ? false : !!p.bd,
  dd: p.starsky ? false : !!p.dd,
  td: p.starsky ? false : !!p.td,
  bigfoot: p.starsky ? false : !!p.bigfoot,
  starsky: !!p.starsky,
  lead: p.starsky ? false : !!p.lead,
});

const normalizeMpc = (p: Partial<JpPaxMpc>): JpPaxMpc => ({
  id: String(p.id || uuidv4()),
  name: stripAt(String(p.name || "")),
  dd: p.starsky ? false : !!p.dd,
  td: p.starsky ? false : !!p.td,
  bigfoot: p.starsky ? false : !!p.bigfoot,
  starsky: !!p.starsky,
});

/* -------------------------------------------------
   Exercise Row (sortable)
------------------------------------------------- */
const ExerciseRow: React.FC<{
  exercise: Exercise;
  updateExercise: (id: string, field: keyof Exercise, value: string) => void;
  removeExercise: (id: string) => void;
  exerciseList: string[];
}> = ({ exercise, updateExercise, removeExercise, exerciseList }) => {
  const [isCustom, setIsCustom] = useState(
    !exerciseList.includes(exercise.name) && exercise.name !== ""
  );

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: exercise.id });

  const style: React.CSSProperties = {
    transform: transform ? CSS.Transform.toString(transform) : undefined,
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === "custom") {
      setIsCustom(true);
      updateExercise(exercise.id, "name", "");
    } else {
      setIsCustom(false);
      updateExercise(exercise.id, "name", value);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="w-full flex items-center gap-2 bg-slate-700/50 p-2 rounded-md"
    >
      <div className="flex-1 flex items-center gap-2">
        {isCustom ? (
          <input
            type="text"
            value={exercise.name}
            onChange={(e) => updateExercise(exercise.id, "name", e.target.value)}
            placeholder="Custom Exercise"
            className="flex-grow bg-slate-800 border border-slate-600 rounded-md py-1 px-2 text-white text-xs sm:text-sm"
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          />
        ) : (
          <select
            value={exercise.name}
            onChange={handleSelectChange}
            className="flex-grow bg-slate-800 border border-slate-600 rounded-md py-1 px-2 text-white text-xs sm:text-sm"
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <option value="" disabled>
              Select Exercise
            </option>
            {exerciseList.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
            <option value="custom">-- Custom --</option>
          </select>
        )}

        <input
          type="text"
          value={(exercise as any).reps || ""}
          onChange={(e) =>
            updateExercise(exercise.id, "reps" as any, e.target.value)
          }
          placeholder="Details (Reps, IC/On Q)"
          className="w-28 sm:w-40 bg-slate-800 border border-slate-600 rounded-md py-1 px-2 text-[10px] sm:text-sm"
          onKeyDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        />

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            removeExercise(exercise.id);
          }}
          className="text-slate-500 hover:text-red-500"
        >
          <TrashIcon />
        </button>
      </div>
    </div>
  );
};

/* -------------------- Sortable wrapper for rounds -------------------- */
const SortableRoundCard: React.FC<{
  id: string;
  children: React.ReactNode;
}> = ({ id, children }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  const style: React.CSSProperties = {
    transform: transform ? CSS.Transform.toString(transform) : undefined,
    transition,
    opacity: isDragging ? 0.85 : 1,
    cursor: "grab",
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
};

/* -------------------------------------------------
   Standard Pax Row (non-JP)
------------------------------------------------- */
const PaxRowStandard: React.FC<{
  pax: PaxAttendance;
  updatePax: (
    id: string,
    field: keyof PaxAttendance,
    value: string | boolean
  ) => void;
  removePax: (id: string) => void;
  paxList: readonly string[];
  usedNames: Set<string>;
}> = ({ pax, updatePax, removePax, paxList, usedNames }) => {
  const [isCustom, setIsCustom] = useState(
    pax.name !== "" && !paxList.includes(stripAt(pax.name))
  );
  const [showExtras, setShowExtras] = useState(!!pax.bigfoot || !!pax.starsky);

  useEffect(() => {
    const clean = stripAt(pax.name);
    setIsCustom(clean !== "" && !paxList.includes(clean));
  }, [pax.name, paxList]);
  useEffect(() => {
    if (pax.bigfoot || pax.starsky) setShowExtras(true);
  }, [pax.bigfoot, pax.starsky]);

  const handleChoose = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === "custom") {
      setIsCustom(true);
      updatePax(pax.id, "name", "");
    } else {
      setIsCustom(false);
      updatePax(pax.id, "name", stripAt(value));
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {isCustom ? (
          <input
            type="text"
            value={pax.name}
            onChange={(e) => updatePax(pax.id, "name", stripAt(e.target.value))}
            placeholder="Custom PAX"
            className="w-28 sm:w-32 md:w-36 lg:w-40 min-w-0 bg-slate-700 border border-slate-600 rounded-md py-1 px-2 text-white text-xs sm:text-sm"
          />
        ) : (
          <select
            value={stripAt(pax.name)}
            onChange={handleChoose}
            className="w-28 sm:w-32 md:w-36 lg:w-40 min-w-0 bg-slate-700 border border-slate-600 rounded-md py-1 px-2 text-white text-xs sm:text-sm"
          >
            <option value="" disabled>
              Select PAX
            </option>
            {paxList.map((name) => {
              const normalized = stripAt(name).toLowerCase();
              const current = stripAt(pax.name).toLowerCase();
              const isUsed = usedNames.has(normalized) && normalized !== current;
              return (
                <option key={name} value={name} disabled={isUsed}>
                  {name}
                </option>
              );
            })}
            <option value="custom">-- Custom --</option>
          </select>
        )}

        <div className="flex gap-1 sm:gap-2 items-center text-xs sm:text-xs whitespace-nowrap flex-wrap">
          {(["bd", "dd", "td"] as const).map((flag) => (
            <label key={flag} className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={pax[flag] as boolean}
                onChange={(e) => updatePax(pax.id, flag, e.target.checked)}
                disabled={!!pax.starsky}
                className="h-4 w-4 sm:h-5 sm:w-5 lg:h-4 lg:w-4 rounded bg-slate-800 border-slate-600 text-red-600 focus:ring-red-500"
              />
              {flag.toUpperCase()}
            </label>
          ))}
          <button
            type="button"
            onClick={() => setShowExtras((v) => !v)}
            className="text-slate-300 hover:text-white text-xs px-1 sm:hidden"
            title="More attendance options"
          >
            ...
          </button>
          <div className="hidden sm:flex items-center gap-2 sm:text-xs whitespace-nowrap">
            <label className="flex items-center gap-1 cursor-pointer" title="Left Early">
              <input
                type="checkbox"
                checked={!!pax.bigfoot}
                onChange={(e) => updatePax(pax.id, "bigfoot", e.target.checked)}
                disabled={!!pax.starsky}
                className="h-5 w-5 rounded bg-slate-800 border-slate-600 text-amber-400 focus:ring-amber-400"
              />
              <span>Bigfoot</span>
            </label>
            <label className="flex items-center gap-1 cursor-pointer" title="Coffeteria Only">
              <input
                type="checkbox"
                checked={!!pax.starsky}
                onChange={(e) => updatePax(pax.id, "starsky", e.target.checked)}
                className="h-5 w-5 rounded bg-slate-800 border-slate-600 text-yellow-400 focus:ring-yellow-400"
              />
              <span>Starsky</span>
            </label>
          </div>
        </div>

        <button
          onClick={() => removePax(pax.id)}
          className="text-slate-500 hover:text-red-500"
        >
          <TrashIcon />
        </button>
      </div>

      {showExtras && (
        <div className="flex sm:hidden flex-wrap items-center gap-3 text-[10px] sm:text-xs text-slate-200 pl-2">
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={!!pax.bigfoot}
              onChange={(e) => updatePax(pax.id, "bigfoot", e.target.checked)}
              disabled={!!pax.starsky}
              className="h-5 w-5 rounded bg-slate-800 border-slate-600 text-amber-400 focus:ring-amber-400"
            />
            <span>Bigfoot (Left Early)</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={!!pax.starsky}
              onChange={(e) => updatePax(pax.id, "starsky", e.target.checked)}
              className="h-5 w-5 rounded bg-slate-800 border-slate-600 text-yellow-400 focus:ring-yellow-400"
            />
            <span>Starsky (Coffeteria Only)</span>
          </label>
        </div>
      )}
    </div>
  );
};

/* -------------------------------------------------
   JP Pax Row: Run/Ruck (BD/DD/TD/Lead)
------------------------------------------------- */
const JpPaxRowRunRuck: React.FC<{
  pax: JpPaxRunRuck;
  updatePax: (
    id: string,
    field: keyof JpPaxRunRuck,
    value: string | boolean
  ) => void;
  removePax: (id: string) => void;
  paxList: readonly string[];
  usedNames: readonly string[];
}> = ({ pax, updatePax, removePax, paxList, usedNames }) => {
  const [isCustom, setIsCustom] = useState(
    pax.name !== "" && !paxList.includes(stripAt(pax.name))
  );
  const [showExtras, setShowExtras] = useState(!!pax.bigfoot || !!pax.starsky);

  useEffect(() => {
    const clean = stripAt(pax.name);
    setIsCustom(clean !== "" && !paxList.includes(clean));
  }, [pax.name, paxList]);
  useEffect(() => {
    if (pax.bigfoot || pax.starsky) setShowExtras(true);
  }, [pax.bigfoot, pax.starsky]);

  const handleChoose = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === "custom") {
      setIsCustom(true);
      updatePax(pax.id, "name", "");
    } else {
      setIsCustom(false);
      updatePax(pax.id, "name", stripAt(value));
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {isCustom ? (
          <input
            type="text"
            value={pax.name}
            onChange={(e) => updatePax(pax.id, "name", stripAt(e.target.value))}
            placeholder="Custom PAX"
            className="w-24 sm:w-24 md:w-28 lg:w-32 min-w-0 bg-slate-700 border border-slate-600 rounded-md py-1 px-2 text-white text-xs sm:text-sm"
          />
        ) : (
          <select
            value={stripAt(pax.name)}
            onChange={handleChoose}
            className="w-24 sm:w-24 md:w-28 lg:w-32 min-w-0 bg-slate-700 border border-slate-600 rounded-md py-1 px-2 text-white text-xs sm:text-sm"
          >
            <option value="" disabled>
              Select PAX
            </option>
            {paxList.map((name) => {
              const lower = name.toLowerCase();
              const current = stripAt(pax.name).toLowerCase();
              const isUsed = usedNames.some((n) => n.toLowerCase() === lower);
              const disabled = isUsed && lower !== current;
              return (
                <option key={name} value={name} disabled={disabled}>
                  {name}
                </option>
              );
            })}
            <option value="custom">-- Custom --</option>
          </select>
        )}

        <div className="flex gap-1 items-center text-xs sm:text-xs whitespace-nowrap flex-wrap">
          {(["bd", "dd", "td"] as const).map((flag) => (
            <label key={flag} className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={(pax as any)[flag] as boolean}
                onChange={(e) => updatePax(pax.id, flag, e.target.checked)}
                disabled={!!pax.starsky}
                className="h-4 w-4 sm:h-5 sm:w-5 lg:h-4 lg:w-4 rounded bg-slate-800 border-slate-600 text-red-600 focus:ring-red-500"
              />
              {flag.toUpperCase()}
            </label>
          ))}
          <button
            type="button"
            onClick={() => setShowExtras((v) => !v)}
            className="text-slate-300 hover:text-white text-xs px-1 sm:hidden"
            title="More attendance options"
          >
            ...
          </button>
          <div className="hidden sm:flex items-center gap-2 sm:text-xs whitespace-nowrap">
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={pax.lead}
                onChange={(e) => updatePax(pax.id, "lead", e.target.checked)}
                disabled={!!pax.starsky}
                className="h-4 w-4 sm:h-5 sm:w-5 lg:h-4 lg:w-4 rounded bg-slate-800 border-slate-600 text-blue-500 focus:ring-blue-500"
              />
              <span>Lead</span>
            </label>
            <label className="flex items-center gap-1 cursor-pointer" title="Left Early">
              <input
                type="checkbox"
                checked={!!pax.bigfoot}
                onChange={(e) => updatePax(pax.id, "bigfoot", e.target.checked)}
                disabled={!!pax.starsky}
                className="h-4 w-4 sm:h-5 sm:w-5 lg:h-4 lg:w-4 rounded bg-slate-800 border-slate-600 text-amber-400 focus:ring-amber-400"
              />
              <span>Bigfoot</span>
            </label>
            <label className="flex items-center gap-1 cursor-pointer" title="Coffeteria Only">
              <input
                type="checkbox"
                checked={!!pax.starsky}
                onChange={(e) => updatePax(pax.id, "starsky", e.target.checked)}
                className="h-4 w-4 sm:h-5 sm:w-5 lg:h-4 lg:w-4 rounded bg-slate-800 border-slate-600 text-yellow-400 focus:ring-yellow-400"
              />
              <span>Starsky</span>
            </label>
          </div>
        </div>

        <button
          onClick={() => removePax(pax.id)}
          className="text-slate-500 hover:text-red-500"
        >
          <TrashIcon />
        </button>
      </div>

      {showExtras && (
        <div className="flex sm:hidden flex-wrap items-center gap-3 text-xs sm:text-xs text-slate-200 pl-2">
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={pax.lead}
              onChange={(e) => updatePax(pax.id, "lead", e.target.checked)}
              disabled={!!pax.starsky}
              className="h-5 w-5 rounded bg-slate-800 border-slate-600 text-blue-500 focus:ring-blue-500"
            />
            <span>Lead</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={!!pax.bigfoot}
              onChange={(e) => updatePax(pax.id, "bigfoot", e.target.checked)}
              disabled={!!pax.starsky}
              className="h-5 w-5 rounded bg-slate-800 border-slate-600 text-amber-400 focus:ring-amber-400"
            />
            <span>Bigfoot</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={!!pax.starsky}
              onChange={(e) => updatePax(pax.id, "starsky", e.target.checked)}
              className="h-5 w-5 rounded bg-slate-800 border-slate-600 text-yellow-400 focus:ring-yellow-400"
            />
            <span>Starsky</span>
          </label>
        </div>
      )}
    </div>
  );
};

/* -------------------------------------------------
   JP Pax Row: MPC (DD/TD only)
------------------------------------------------- */
const JpPaxRowMpc: React.FC<{
  pax: JpPaxMpc;
  updatePax: (id: string, field: keyof JpPaxMpc, value: string | boolean) => void;
  removePax: (id: string) => void;
  paxList: readonly string[];
  usedNames: readonly string[];
}> = ({ pax, updatePax, removePax, paxList, usedNames }) => {
  const [isCustom, setIsCustom] = useState(
    pax.name !== "" && !paxList.includes(stripAt(pax.name))
  );
  const [showExtras, setShowExtras] = useState(!!pax.bigfoot || !!pax.starsky);

  useEffect(() => {
    const clean = stripAt(pax.name);
    setIsCustom(clean !== "" && !paxList.includes(clean));
  }, [pax.name, paxList]);
  useEffect(() => {
    if (pax.bigfoot || pax.starsky) setShowExtras(true);
  }, [pax.bigfoot, pax.starsky]);

  const handleChoose = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === "custom") {
      setIsCustom(true);
      updatePax(pax.id, "name", "");
    } else {
      setIsCustom(false);
      updatePax(pax.id, "name", stripAt(value));
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {isCustom ? (
          <input
            type="text"
            value={pax.name}
            onChange={(e) => updatePax(pax.id, "name", stripAt(e.target.value))}
            placeholder="Custom PAX"
            className="w-28 sm:w-24 md:w-28 lg:w-32 min-w-0 bg-slate-700 border border-slate-600 rounded-md py-1 px-2 text-white text-xs sm:text-sm"
          />
        ) : (
          <select
            value={stripAt(pax.name)}
            onChange={handleChoose}
            className="w-28 sm:w-24 md:w-28 lg:w-32 min-w-0 bg-slate-700 border border-slate-600 rounded-md py-1 px-2 text-white text-xs sm:text-sm"
          >
            <option value="" disabled>
              Select PAX
            </option>
            {paxList.map((name) => {
              const lower = name.toLowerCase();
              const current = stripAt(pax.name).toLowerCase();
              const isUsed = usedNames.some((n) => n.toLowerCase() === lower);
              const disabled = isUsed && lower !== current;
              return (
                <option key={name} value={name} disabled={disabled}>
                  {name}
                </option>
              );
            })}
            <option value="custom">-- Custom --</option>
          </select>
        )}

        <div className="flex gap-1 items-center text-xs sm:text-xs whitespace-nowrap flex-wrap">
          {(["dd", "td"] as const).map((flag) => (
            <label key={flag} className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={(pax as any)[flag] as boolean}
                onChange={(e) => updatePax(pax.id, flag, e.target.checked)}
                disabled={!!pax.starsky}
                className="h-5 w-5 rounded bg-slate-800 border-slate-600 text-red-600 focus:ring-red-500"
              />
              {flag.toUpperCase()}
            </label>
          ))}
          <button
            type="button"
            onClick={() => setShowExtras((v) => !v)}
            className="text-slate-300 hover:text-white text-xs px-1 sm:hidden"
            title="More attendance options"
          >
            ...
          </button>
          <div className="hidden sm:flex items-center gap-2 sm:text-xs whitespace-nowrap">
            <label className="flex items-center gap-1 cursor-pointer" title="Left Early">
              <input
                type="checkbox"
                checked={!!pax.bigfoot}
                onChange={(e) => updatePax(pax.id, "bigfoot", e.target.checked)}
                disabled={!!pax.starsky}
                className="h-4 w-4 sm:h-5 sm:w-5 lg:h-4 lg:w-4 rounded bg-slate-800 border-slate-600 text-amber-400 focus:ring-amber-400"
              />
              <span>Bigfoot</span>
            </label>
            <label className="flex items-center gap-1 cursor-pointer" title="Coffeteria Only">
              <input
                type="checkbox"
                checked={!!pax.starsky}
                onChange={(e) => updatePax(pax.id, "starsky", e.target.checked)}
                className="h-4 w-4 sm:h-5 sm:w-5 lg:h-4 lg:w-4 rounded bg-slate-800 border-slate-600 text-yellow-400 focus:ring-yellow-400"
              />
              <span>Starsky</span>
            </label>
          </div>
        </div>

        <button
          onClick={() => removePax(pax.id)}
          className="text-slate-500 hover:text-red-500"
        >
          <TrashIcon />
        </button>
      </div>

      {showExtras && (
        <div className="flex sm:hidden flex-wrap items-center gap-3 text-xs sm:text-xs text-slate-200 pl-2">
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={!!pax.bigfoot}
              onChange={(e) => updatePax(pax.id, "bigfoot", e.target.checked)}
              disabled={!!pax.starsky}
              className="h-5 w-5 rounded bg-slate-800 border-slate-600 text-amber-400 focus:ring-amber-400"
            />
            <span>Bigfoot</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={!!pax.starsky}
              onChange={(e) => updatePax(pax.id, "starsky", e.target.checked)}
              className="h-5 w-5 rounded bg-slate-800 border-slate-600 text-yellow-400 focus:ring-yellow-400"
            />
            <span>Starsky</span>
          </label>
        </div>
      )}
    </div>
  );
};

/* ===================================================================
   BACKBLAST GENERATOR COMPONENT
=================================================================== */
export const BackblastGeneratorView: React.FC<BackblastGeneratorViewProps> = ({
  addLoggedWorkout,
  planToImport,
  clearImportedPlan,
  }) => {
    const { activeAo } = useAo();

    const isJP = useMemo(
      () =>
      isJurassicParkAo({
        id: activeAo.id,
        shortName: activeAo.shortName,
        displayName: activeAo.displayName,
        whereName: activeAo.whereName,
        }),
      [activeAo.id, activeAo.shortName, activeAo.displayName, activeAo.whereName]
    );

  const backblastAoLabel = useMemo(() => {
    if (activeAo.id === "theshadows") return "Shadows";
    return activeAo.shortName || activeAo.displayName;
  }, [activeAo.id, activeAo.shortName, activeAo.displayName]);

  const forceNoEmojis = activeAo.id === "theshadows";

    // ✅ AO-specific PAX list (always stored/displayed WITHOUT "@")
  const paxDirectoryVersion = usePaxDirectoryVersion();
  const paxList = useMemo(
    () => getPaxListByAo(activeAo.id),
    [activeAo.id, paxDirectoryVersion]
  );

  const forceNoAiAo = [
    "thehill",
    "phoenixrising",
    "gatorbay",
    "theshadows",
  ].includes(activeAo.id);

  // ✅ AO-based default most recent workout
  const defaultWorkout = useMemo(
    () => getMostRecentWorkoutDetailsForAo(activeAo),
    [activeAo]
  );

  const [qName, setQName] = useState("");
  const [committedQName, setCommittedQName] = useState("");
  const [isCustomQ, setIsCustomQ] = useState(false);
  const [longDate, setLongDate] = useState(defaultWorkout.longDate);
  const [workoutTime, setWorkoutTime] = useState(defaultWorkout.time);
  const [dateInputValue, setDateInputValue] = useState(() =>
    toIsoDate(defaultWorkout.longDate)
  );
  const { start: parsedStart, end: parsedEnd } = useMemo(
    () => parseTimeRangeTo24(defaultWorkout.time),
    [defaultWorkout.time]
  );
  const [startTime24, setStartTime24] = useState(parsedStart || "06:00");
  const [endTime24, setEndTime24] = useState(parsedEnd || "07:00");

  // Standard (non-JP) pax
  const [paxAttendance, setPaxAttendance] = useState<PaxAttendance[]>([
    { id: uuidv4(), name: "", bd: true, dd: false, td: false, bigfoot: false, starsky: false },
  ]);

  // JP split pax
  const [jpRunPax, setJpRunPax] = useState<JpPaxRunRuck[]>([
    normalizeRunRuck({
      id: uuidv4(),
      name: "",
      bd: true,
      dd: false,
      td: false,
      bigfoot: false,
      starsky: false,
      lead: false,
    }),
  ]);
  const [jpRuckPax, setJpRuckPax] = useState<JpPaxRunRuck[]>([
    normalizeRunRuck({
      id: uuidv4(),
      name: "",
      bd: true,
      dd: false,
      td: false,
      bigfoot: false,
      starsky: false,
      lead: false,
    }),
  ]);
  const [jpMpcPax, setJpMpcPax] = useState<JpPaxMpc[]>([
    normalizeMpc({ id: uuidv4(), name: "", dd: true, td: false, bigfoot: false, starsky: false }),
  ]);

  const [warmup, setWarmup] = useState<Exercise[]>([]);
  const [warmupDescription, setWarmupDescription] = useState("");

  const [theThang, setTheThang] = useState<WorkoutRound[]>([
    { id: uuidv4(), name: "Round 1", exercises: [] },
  ]);

  const [announcements, setAnnouncements] = useState("");
  const [taps, setTaps] = useState("");
  const [notes, setNotes] = useState("");
  const [generateMode, setGenerateMode] = useState<"AI" | "NO_AI" | null>(null);
  const [outputLabel, setOutputLabel] = useState("");
  const [outputTimestamp, setOutputTimestamp] = useState("");
  const [outputMode, setOutputMode] = useState<"AI" | "NO_AI" | "">("");
  const [aiOptions, setAiOptions] = useState({
    gratitude: false,
    missionValues: false,
    funny: false,
    highEnergy: false,
    minimalEmojis: false,
    ironSharpensIron: false,
  });
  const [selectedPax, setSelectedPax] = useState<string[]>([]);
  const [isMultiAddOpen, setIsMultiAddOpen] = useState(false);
  const [jpRunSelected, setJpRunSelected] = useState<string[]>([]);
  const [jpRuckSelected, setJpRuckSelected] = useState<string[]>([]);
  const [jpMpcSelected, setJpMpcSelected] = useState<string[]>([]);
  const [isJpRunMultiAddOpen, setIsJpRunMultiAddOpen] = useState(false);
  const [isJpRuckMultiAddOpen, setIsJpRuckMultiAddOpen] = useState(false);
  const [isJpMpcMultiAddOpen, setIsJpMpcMultiAddOpen] = useState(false);
  const [isWarmupMultiOpen, setIsWarmupMultiOpen] = useState(false);
  const [warmupSelected, setWarmupSelected] = useState<string[]>([]);
  const [thangMultiOpen, setThangMultiOpen] = useState<Record<string, boolean>>({});
  const [thangSelected, setThangSelected] = useState<Record<string, string[]>>({});
  const [generatedText, setGeneratedText] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState("");

  useEffect(() => {
    if (forceNoAiAo && generateMode !== "NO_AI") {
      setGenerateMode("NO_AI");
    }
  }, [forceNoAiAo, generateMode]);
  const [loadingSeconds, setLoadingSeconds] = useState(0);

  const [error, setError] = useState("");
  const [copySuccess, setCopySuccess] = useState(false);

  const isQNameFromList = paxList.includes(stripAt(qName));
  const outputRef = useRef<HTMLDivElement | null>(null);
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const startTimeInputRef = useRef<HTMLInputElement | null>(null);
  const endTimeInputRef = useRef<HTMLInputElement | null>(null);
  const usedJpRunNames = useMemo(
    () => jpRunPax.map((p) => stripAt(p.name)).filter(Boolean),
    [jpRunPax]
  );
  const usedJpRuckNames = useMemo(
    () => jpRuckPax.map((p) => stripAt(p.name)).filter(Boolean),
    [jpRuckPax]
  );
  const usedJpMpcNames = useMemo(
    () => jpMpcPax.map((p) => stripAt(p.name)).filter(Boolean),
    [jpMpcPax]
  );
  const usedJpRunSet = useMemo(
    () => new Set(usedJpRunNames.map((n) => n.toLowerCase())),
    [usedJpRunNames]
  );
  const usedJpRuckSet = useMemo(
    () => new Set(usedJpRuckNames.map((n) => n.toLowerCase())),
    [usedJpRuckNames]
  );
  const usedJpMpcSet = useMemo(
    () => new Set(usedJpMpcNames.map((n) => n.toLowerCase())),
    [usedJpMpcNames]
  );

  // Auto-add Q to PAX list for standard backblast (commit-only)
  useEffect(() => {
    if (isJP) return;
    const cleaned = stripAt(committedQName).trim();
    if (!cleaned) return;

    const exists = paxAttendance.some(
      (p: any) => stripAt(p.name).toLowerCase() === cleaned.toLowerCase()
    );
    if (exists) return;

    setPaxAttendance((prev) => {
      const onlyEmpty =
        prev.length === 1 && !stripAt(prev[0]?.name || "").trim();
      const base = onlyEmpty ? [] : prev;
      return [
        ...base,
        {
          id: uuidv4(),
          name: cleaned,
          bd: true,
          dd: false,
          td: false,
          bigfoot: false,
          starsky: false,
        } as any,
      ];
    });
  }, [committedQName, isJP, paxAttendance]);

  // ✅ Draft key per AO
  const BACKBLAST_DRAFT_KEY = useMemo(
    () => `f3BackblastDraft_${activeAo.id}`,
    [activeAo.id]
  );

  // Prevent overwriting restored state on first mount
    const didRestoreRef = useRef(false);
    const [hydrated, setHydrated] = useState(false);
    const lastAoIdRef = useRef<string | null>(null);

  // Description panel open states (mirror Planner behavior)
  const [isWarmupDescOpen, setIsWarmupDescOpen] = useState(false);
  const [openDescRounds, setOpenDescRounds] = useState<Record<string, boolean>>(
    {}
  );

  /* ----- DND sensors (same as Planner) ----- */
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  /* ---------------- Loading seconds ticker ---------------- */
  useEffect(() => {
    if (!isLoading) {
      setLoadingSeconds(0);
      return;
    }

    const t = window.setInterval(() => {
      setLoadingSeconds((s) => s + 1);
    }, 1000);

    return () => window.clearInterval(t);
  }, [isLoading]);

  /* ---------------- Restore draft on mount (same most-recent workout only) ---------------- */
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(BACKBLAST_DRAFT_KEY);
      if (!raw) {
        setHydrated(true);
        return;
      }

      const saved = JSON.parse(raw);

      // Only restore if it matches the CURRENT default "most recent" date for this AO
      if (saved?.draftForDate !== defaultWorkout.longDate) {
        sessionStorage.removeItem(BACKBLAST_DRAFT_KEY);
        setHydrated(true);
        return;
      }

      if (typeof saved.qName === "string") {
        const restored = stripAt(saved.qName);
        setQName(restored);
        setCommittedQName(restored);
      }
      if (typeof saved.isCustomQ === "boolean") setIsCustomQ(saved.isCustomQ);
      if (typeof saved.longDate === "string") setLongDate(saved.longDate);
      if (typeof saved.workoutTime === "string") setWorkoutTime(saved.workoutTime);

      if (Array.isArray(saved.paxAttendance)) {
        setPaxAttendance(
          saved.paxAttendance.map((p: PaxAttendance) => ({
            ...p,
            name: stripAt((p as any).name),
            bigfoot: (p as any).starsky ? false : !!(p as any).bigfoot,
            starsky: !!(p as any).starsky,
            bd: (p as any).starsky ? false : !!(p as any).bd,
            dd: (p as any).starsky ? false : !!(p as any).dd,
            td: (p as any).starsky ? false : !!(p as any).td,
          }))
        );
      }

      if (Array.isArray(saved.jpRunPax)) {
        setJpRunPax(saved.jpRunPax.map((p: any) => normalizeRunRuck(p)));
      }
      if (Array.isArray(saved.jpRuckPax)) {
        setJpRuckPax(saved.jpRuckPax.map((p: any) => normalizeRunRuck(p)));
      }
      if (Array.isArray(saved.jpMpcPax)) {
        setJpMpcPax(saved.jpMpcPax.map((p: any) => normalizeMpc(p)));
      }

      if (Array.isArray(saved.warmup)) setWarmup(saved.warmup);

      if (typeof saved.warmupDescription === "string") {
        setWarmupDescription(saved.warmupDescription);
      }

      if (Array.isArray(saved.theThang)) {
        setTheThang(
          renumberRounds(
            saved.theThang.map((r: WorkoutRound, idx: number) => ({
              ...r,
              id: (r as any).id || `round-${idx}-${uuidv4()}`,
              timerSeconds: (r as any).timerSeconds ?? undefined,
              timerRepeatCount: (r as any).timerRepeatCount ?? 1,
              description: (r as any).description ?? "",
            }))
          )
        );
      }

      if (typeof saved.announcements === "string") setAnnouncements(saved.announcements);
      if (typeof saved.taps === "string") setTaps(saved.taps);
      if (typeof saved.notes === "string") setNotes(saved.notes);
      if (saved?.aiOptions && typeof saved.aiOptions === "object") {
        setAiOptions((prev) => ({
          ...prev,
          ...saved.aiOptions,
        }));
      }
      if (Array.isArray(saved.jpRunSelected)) setJpRunSelected(saved.jpRunSelected);
      if (Array.isArray(saved.jpRuckSelected)) setJpRuckSelected(saved.jpRuckSelected);
      if (Array.isArray(saved.jpMpcSelected)) setJpMpcSelected(saved.jpMpcSelected);
      if (typeof saved.isJpRunMultiAddOpen === "boolean")
        setIsJpRunMultiAddOpen(saved.isJpRunMultiAddOpen);
      if (typeof saved.isJpRuckMultiAddOpen === "boolean")
        setIsJpRuckMultiAddOpen(saved.isJpRuckMultiAddOpen);
      if (typeof saved.isJpMpcMultiAddOpen === "boolean")
        setIsJpMpcMultiAddOpen(saved.isJpMpcMultiAddOpen);
      if (typeof saved.generatedText === "string") setGeneratedText(saved.generatedText);

      didRestoreRef.current = true;
      setHydrated(true);
    } catch {
      sessionStorage.removeItem(BACKBLAST_DRAFT_KEY);
      setHydrated(true);
    }
  }, [BACKBLAST_DRAFT_KEY, defaultWorkout.longDate]);

  /* ---------------- Keep date/time in sync unless restored ---------------- */
    useEffect(() => {
      if (didRestoreRef.current) return;
      setLongDate(defaultWorkout.longDate);
      setWorkoutTime(defaultWorkout.time);
    }, [defaultWorkout.longDate, defaultWorkout.time]);

    useEffect(() => {
      if (lastAoIdRef.current === activeAo.id) return;
      lastAoIdRef.current = activeAo.id;
      didRestoreRef.current = false;
      setLongDate(defaultWorkout.longDate);
      setWorkoutTime(defaultWorkout.time);
      setDateInputValue(toIsoDate(defaultWorkout.longDate));
      const parsed = parseTimeRangeTo24(defaultWorkout.time);
      setStartTime24(parsed.start || "06:00");
      setEndTime24(parsed.end || "07:00");
    }, [activeAo.id, defaultWorkout.longDate, defaultWorkout.time]);

  useEffect(() => {
    setDateInputValue(toIsoDate(longDate));
  }, [longDate]);

  useEffect(() => {
    const parsed = parseTimeRangeTo24(workoutTime);
    if (parsed.start) setStartTime24(parsed.start);
    if (parsed.end) setEndTime24(parsed.end);
  }, [workoutTime]);

  /* ---------------- Save draft while on this screen; clear when leaving (unmount) ---------------- */
  useEffect(() => {
    if (!hydrated) return;

    const payload = {
      draftForDate: defaultWorkout.longDate,
      qName: stripAt(qName),
      isCustomQ,
      longDate,
      workoutTime,
      paxAttendance: paxAttendance.map((p: any) => ({ ...p, name: stripAt(p.name) })),
      jpRunPax: jpRunPax.map((p) => normalizeRunRuck(p)),
      jpRuckPax: jpRuckPax.map((p) => normalizeRunRuck(p)),
      jpMpcPax: jpMpcPax.map((p) => normalizeMpc(p)),
      warmup,
      warmupDescription,
      theThang,
      announcements,
      taps,
      notes,
      aiOptions,
      jpRunSelected,
      jpRuckSelected,
      jpMpcSelected,
      isJpRunMultiAddOpen,
      isJpRuckMultiAddOpen,
      isJpMpcMultiAddOpen,
      generatedText,
    };

    sessionStorage.setItem(BACKBLAST_DRAFT_KEY, JSON.stringify(payload));

    return () => {
      sessionStorage.removeItem(BACKBLAST_DRAFT_KEY);
    };
  }, [
    hydrated,
    BACKBLAST_DRAFT_KEY,
    defaultWorkout.longDate,
    qName,
    isCustomQ,
    longDate,
    workoutTime,
    paxAttendance,
    jpRunPax,
    jpRuckPax,
    jpMpcPax,
    warmup,
    warmupDescription,
    theThang,
    announcements,
    taps,
    notes,
    aiOptions,
    jpRunSelected,
    jpRuckSelected,
    jpMpcSelected,
    isJpRunMultiAddOpen,
    isJpRuckMultiAddOpen,
    isJpMpcMultiAddOpen,
    generatedText,
  ]);

  // Auto-scroll to generated output when it appears (mobile-friendly)
  useEffect(() => {
    if (!generatedText) return;

    const t = setTimeout(() => {
      outputRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 100);

    return () => clearTimeout(t);
  }, [generatedText]);

  // Auto-scroll to output when generation starts
  useEffect(() => {
    if (!isLoading) return;
    const t = setTimeout(() => {
      outputRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 100);
    return () => clearTimeout(t);
  }, [isLoading]);

  /* ----- IMPORT PLANNER DATA (Option A behavior) ----- */
  useEffect(() => {
    if (!planToImport) return;

    const importedQ = stripAt((planToImport as any).q || "");

    setQName(importedQ);
    setCommittedQName(importedQ);
    setIsCustomQ(!paxList.includes(importedQ));

    // Do NOT try to auto-fill JP lists from planner; keep them as-is.
    // Standard behavior remains.
    setPaxAttendance([
      {
        id: uuidv4(),
        name: importedQ,
        bd: true,
        dd: false,
        td: false,
        bigfoot: false,
        starsky: false,
      } as any,
    ]);

    setWarmup((planToImport as any).warmup);
    setWarmupDescription((planToImport as any).warmupDescription || "");

    setTheThang(
      renumberRounds(
        (planToImport as any).theThang.map((r: any, idx: number) => ({
          ...r,
          id: r.id || `round-${idx}-${uuidv4()}`,
          timerSeconds: r.timerSeconds ?? undefined,
          timerRepeatCount: r.timerRepeatCount ?? 1,
          description: r.description ?? "",
        }))
      )
    );

    clearImportedPlan();
  }, [planToImport, clearImportedPlan, paxList]);

  /* ----------------- Add/Remove/Modify Handlers ----------------- */
  // Standard (non-JP)
  const addPax = () =>
    setPaxAttendance((prev) => [
      ...prev,
      { id: uuidv4(), name: "", bd: true, dd: false, td: false, bigfoot: false, starsky: false } as any,
    ]);

  const addPaxByName = (nameRaw: string) => {
    const cleaned = stripAt(nameRaw).trim();
    if (!cleaned) return;

    const exists = paxAttendance.some(
      (p: any) => stripAt(p.name).toLowerCase() === cleaned.toLowerCase()
    );
    if (exists) return;

    setPaxAttendance((prev) => [
      ...prev,
      { id: uuidv4(), name: cleaned, bd: true, dd: false, td: false, bigfoot: false, starsky: false } as any,
    ]);

    setSelectedPax((prev) => prev.filter((p) => p.toLowerCase() !== cleaned.toLowerCase()));
  };

  const toggleSelectedPax = (nameRaw: string) => {
    const cleaned = stripAt(nameRaw).trim();
    if (!cleaned) return;
    setSelectedPax((prev) =>
      prev.some((p) => p.toLowerCase() === cleaned.toLowerCase())
        ? prev.filter((p) => p.toLowerCase() !== cleaned.toLowerCase())
        : [...prev, cleaned]
    );
  };

  const addSelectedPax = () => {
    if (!selectedPax.length) return;
    if (paxAttendance.length === 1 && !stripAt(paxAttendance[0]?.name || "")) {
      setPaxAttendance([]);
    }
    selectedPax.forEach((name) => addPaxByName(name));
    setSelectedPax([]);
    setIsMultiAddOpen(false);
  };

  const removePax = (id: string) =>
    setPaxAttendance((prev) => prev.filter((p: any) => p.id !== id));

  const updatePax = (id: string, field: keyof PaxAttendance, value: any) => {
    setPaxAttendance((prev) =>
      prev.map((p: any) =>
        p.id === id
          ? (() => {
              const next = { ...p };
              if (field === "name") {
                next.name = stripAt(String(value ?? ""));
                return next;
              }
              if (field === "starsky") {
                const checked = !!value;
                next.starsky = checked;
                if (checked) {
                  next.bd = false;
                  next.dd = false;
                  next.td = false;
                  next.bigfoot = false;
                }
                return next;
              }
              if (field === "bigfoot") {
                const checked = !!value;
                next.bigfoot = checked;
                if (checked && next.starsky) next.starsky = false;
                return next;
              }
              if (field === "bd" || field === "dd" || field === "td") {
                next[field] = !!value;
                if (value && next.starsky) next.starsky = false;
                return next;
              }
              (next as any)[field] = value;
              return next;
            })()
          : p
      )
    );
  };

  // JP lists
  const addJpRun = () =>
    setJpRunPax((prev) => [
      ...prev,
      normalizeRunRuck({
        id: uuidv4(),
        name: "",
        bd: true,
        dd: false,
        td: false,
        bigfoot: false,
        starsky: false,
        lead: false,
      }),
    ]);

  const addJpRuck = () =>
    setJpRuckPax((prev) => [
      ...prev,
      normalizeRunRuck({
        id: uuidv4(),
        name: "",
        bd: true,
        dd: false,
        td: false,
        bigfoot: false,
        starsky: false,
        lead: false,
      }),
    ]);

  const addJpMpc = () =>
    setJpMpcPax((prev) => [
      ...prev,
      normalizeMpc({ id: uuidv4(), name: "", dd: true, td: false, bigfoot: false, starsky: false }),
    ]);

  const addJpRunByName = (nameRaw: string) => {
    const cleaned = stripAt(nameRaw).trim();
    if (!cleaned) return;
    const exists = jpRunPax.some(
      (p) => stripAt(p.name).toLowerCase() === cleaned.toLowerCase()
    );
    if (exists) return;
    setJpRunPax((prev) => {
      const base =
        prev.length === 1 && !stripAt(prev[0]?.name || "") ? [] : prev;
      return [
        ...base,
        normalizeRunRuck({
          id: uuidv4(),
          name: cleaned,
          bd: true,
          dd: false,
          td: false,
          bigfoot: false,
          starsky: false,
          lead: false,
        }),
      ];
    });
    setJpRunSelected((prev) =>
      prev.filter((p) => p.toLowerCase() !== cleaned.toLowerCase())
    );
  };

  const addJpRuckByName = (nameRaw: string) => {
    const cleaned = stripAt(nameRaw).trim();
    if (!cleaned) return;
    const exists = jpRuckPax.some(
      (p) => stripAt(p.name).toLowerCase() === cleaned.toLowerCase()
    );
    if (exists) return;
    setJpRuckPax((prev) => {
      const base =
        prev.length === 1 && !stripAt(prev[0]?.name || "") ? [] : prev;
      return [
        ...base,
        normalizeRunRuck({
          id: uuidv4(),
          name: cleaned,
          bd: true,
          dd: false,
          td: false,
          bigfoot: false,
          starsky: false,
          lead: false,
        }),
      ];
    });
    setJpRuckSelected((prev) =>
      prev.filter((p) => p.toLowerCase() !== cleaned.toLowerCase())
    );
  };

  const addJpMpcByName = (nameRaw: string) => {
    const cleaned = stripAt(nameRaw).trim();
    if (!cleaned) return;
    const exists = jpMpcPax.some(
      (p) => stripAt(p.name).toLowerCase() === cleaned.toLowerCase()
    );
    if (exists) return;
    setJpMpcPax((prev) => {
      const base =
        prev.length === 1 && !stripAt(prev[0]?.name || "") ? [] : prev;
      return [
        ...base,
        normalizeMpc({
          id: uuidv4(),
          name: cleaned,
          dd: true,
          td: false,
          bigfoot: false,
          starsky: false,
        }),
      ];
    });
    setJpMpcSelected((prev) =>
      prev.filter((p) => p.toLowerCase() !== cleaned.toLowerCase())
    );
  };

  const toggleSelectedJpRun = (nameRaw: string) => {
    const cleaned = stripAt(nameRaw).trim();
    if (!cleaned) return;
    setJpRunSelected((prev) =>
      prev.some((p) => p.toLowerCase() === cleaned.toLowerCase())
        ? prev.filter((p) => p.toLowerCase() !== cleaned.toLowerCase())
        : [...prev, cleaned]
    );
  };

  const toggleSelectedJpRuck = (nameRaw: string) => {
    const cleaned = stripAt(nameRaw).trim();
    if (!cleaned) return;
    setJpRuckSelected((prev) =>
      prev.some((p) => p.toLowerCase() === cleaned.toLowerCase())
        ? prev.filter((p) => p.toLowerCase() !== cleaned.toLowerCase())
        : [...prev, cleaned]
    );
  };

  const toggleSelectedJpMpc = (nameRaw: string) => {
    const cleaned = stripAt(nameRaw).trim();
    if (!cleaned) return;
    setJpMpcSelected((prev) =>
      prev.some((p) => p.toLowerCase() === cleaned.toLowerCase())
        ? prev.filter((p) => p.toLowerCase() !== cleaned.toLowerCase())
        : [...prev, cleaned]
    );
  };

  const addSelectedJpRun = () => {
    if (!jpRunSelected.length) return;
    const selectedSet = new Set(jpRunSelected.map((n) => n.toLowerCase()));
    const keepCustom = jpRunPax.filter((p) => {
      const name = stripAt(p.name);
      if (!name) return false;
      return !paxList.some((n) => n.toLowerCase() === name.toLowerCase());
    });
    const keepFromSelected = jpRunPax.filter((p) =>
      selectedSet.has(stripAt(p.name).toLowerCase())
    );
    const base = [...keepCustom, ...keepFromSelected].filter(
      (p, i, arr) =>
        arr.findIndex(
          (x) => stripAt(x.name).toLowerCase() === stripAt(p.name).toLowerCase()
        ) === i
    );
    const missing = jpRunSelected.filter(
      (name) => !base.some((p) => stripAt(p.name).toLowerCase() === name.toLowerCase())
    );
    const next = [
      ...base,
      ...missing.map((name) =>
        normalizeRunRuck({
          id: uuidv4(),
          name: stripAt(name),
          bd: true,
          dd: false,
          td: false,
          bigfoot: false,
          starsky: false,
          lead: false,
        })
      ),
    ];
    setJpRunPax(next.length ? next : [normalizeRunRuck({ id: uuidv4(), name: "", bd: true, dd: false, td: false, bigfoot: false, starsky: false, lead: false })]);
    setJpRunSelected([]);
    setIsJpRunMultiAddOpen(false);
  };

  const addSelectedJpRuck = () => {
    if (!jpRuckSelected.length) return;
    const selectedSet = new Set(jpRuckSelected.map((n) => n.toLowerCase()));
    const keepCustom = jpRuckPax.filter((p) => {
      const name = stripAt(p.name);
      if (!name) return false;
      return !paxList.some((n) => n.toLowerCase() === name.toLowerCase());
    });
    const keepFromSelected = jpRuckPax.filter((p) =>
      selectedSet.has(stripAt(p.name).toLowerCase())
    );
    const base = [...keepCustom, ...keepFromSelected].filter(
      (p, i, arr) =>
        arr.findIndex(
          (x) => stripAt(x.name).toLowerCase() === stripAt(p.name).toLowerCase()
        ) === i
    );
    const missing = jpRuckSelected.filter(
      (name) => !base.some((p) => stripAt(p.name).toLowerCase() === name.toLowerCase())
    );
    const next = [
      ...base,
      ...missing.map((name) =>
        normalizeRunRuck({
          id: uuidv4(),
          name: stripAt(name),
          bd: true,
          dd: false,
          td: false,
          bigfoot: false,
          starsky: false,
          lead: false,
        })
      ),
    ];
    setJpRuckPax(next.length ? next : [normalizeRunRuck({ id: uuidv4(), name: "", bd: true, dd: false, td: false, bigfoot: false, starsky: false, lead: false })]);
    setJpRuckSelected([]);
    setIsJpRuckMultiAddOpen(false);
  };

  const addSelectedJpMpc = () => {
    if (!jpMpcSelected.length) return;
    const selectedSet = new Set(jpMpcSelected.map((n) => n.toLowerCase()));
    const keepCustom = jpMpcPax.filter((p) => {
      const name = stripAt(p.name);
      if (!name) return false;
      return !paxList.some((n) => n.toLowerCase() === name.toLowerCase());
    });
    const keepFromSelected = jpMpcPax.filter((p) =>
      selectedSet.has(stripAt(p.name).toLowerCase())
    );
    const base = [...keepCustom, ...keepFromSelected].filter(
      (p, i, arr) =>
        arr.findIndex(
          (x) => stripAt(x.name).toLowerCase() === stripAt(p.name).toLowerCase()
        ) === i
    );
    const missing = jpMpcSelected.filter(
      (name) => !base.some((p) => stripAt(p.name).toLowerCase() === name.toLowerCase())
    );
    const next = [
      ...base,
      ...missing.map((name) =>
        normalizeMpc({
          id: uuidv4(),
          name: stripAt(name),
          dd: true,
          td: false,
          bigfoot: false,
          starsky: false,
        })
      ),
    ];
    setJpMpcPax(next.length ? next : [normalizeMpc({ id: uuidv4(), name: "", dd: true, td: false, bigfoot: false, starsky: false })]);
    setJpMpcSelected([]);
    setIsJpMpcMultiAddOpen(false);
  };

  const removeJpRun = (id: string) =>
    setJpRunPax((prev) => prev.filter((p) => p.id !== id));
  const removeJpRuck = (id: string) =>
    setJpRuckPax((prev) => prev.filter((p) => p.id !== id));
  const removeJpMpc = (id: string) =>
    setJpMpcPax((prev) => prev.filter((p) => p.id !== id));

  const updateJpRun = (id: string, field: keyof JpPaxRunRuck, value: any) => {
    setJpRunPax((prev) =>
      prev.map((p) =>
        p.id === id
          ? (() => {
              const next = { ...p };
              if (field === "name") {
                next.name = stripAt(String(value ?? ""));
                return next;
              }
              if (field === "starsky") {
                const checked = !!value;
                next.starsky = checked;
                if (checked) {
                  next.bd = false;
                  next.dd = false;
                  next.td = false;
                  next.bigfoot = false;
                  next.lead = false;
                }
                return next;
              }
              if (field === "bigfoot") {
                const checked = !!value;
                next.bigfoot = checked;
                if (checked && next.starsky) next.starsky = false;
                return next;
              }
              if (field === "bd" || field === "dd" || field === "td") {
                (next as any)[field] = !!value;
                if (value && next.starsky) next.starsky = false;
                return next;
              }
              if (field === "lead") {
                next.lead = !!value;
                if (value && next.starsky) next.starsky = false;
                return next;
              }
              (next as any)[field] = value;
              return next;
            })()
          : p
      )
    );
  };

  const updateJpRuck = (id: string, field: keyof JpPaxRunRuck, value: any) => {
    setJpRuckPax((prev) =>
      prev.map((p) =>
        p.id === id
          ? (() => {
              const next = { ...p };
              if (field === "name") {
                next.name = stripAt(String(value ?? ""));
                return next;
              }
              if (field === "starsky") {
                const checked = !!value;
                next.starsky = checked;
                if (checked) {
                  next.bd = false;
                  next.dd = false;
                  next.td = false;
                  next.bigfoot = false;
                  next.lead = false;
                }
                return next;
              }
              if (field === "bigfoot") {
                const checked = !!value;
                next.bigfoot = checked;
                if (checked && next.starsky) next.starsky = false;
                return next;
              }
              if (field === "bd" || field === "dd" || field === "td") {
                (next as any)[field] = !!value;
                if (value && next.starsky) next.starsky = false;
                return next;
              }
              if (field === "lead") {
                next.lead = !!value;
                if (value && next.starsky) next.starsky = false;
                return next;
              }
              (next as any)[field] = value;
              return next;
            })()
          : p
      )
    );
  };

  const updateJpMpc = (id: string, field: keyof JpPaxMpc, value: any) => {
    setJpMpcPax((prev) =>
      prev.map((p) =>
        p.id === id
          ? (() => {
              const next = { ...p };
              if (field === "name") {
                next.name = stripAt(String(value ?? ""));
                return next;
              }
              if (field === "starsky") {
                const checked = !!value;
                next.starsky = checked;
                if (checked) {
                  next.dd = false;
                  next.td = false;
                  next.bigfoot = false;
                }
                return next;
              }
              if (field === "bigfoot") {
                const checked = !!value;
                next.bigfoot = checked;
                if (checked && next.starsky) next.starsky = false;
                return next;
              }
              if (field === "dd" || field === "td") {
                (next as any)[field] = !!value;
                if (value && next.starsky) next.starsky = false;
                return next;
              }
              (next as any)[field] = value;
              return next;
            })()
          : p
      )
    );
  };

  // Warmup / Thang handlers (unchanged)
  const addWarmupExercise = () => {
    setIsWarmupDescOpen(false);
    setWarmup((prev) => [
      ...prev,
      { id: uuidv4(), name: "", reps: "", cadence: "" } as any,
    ]);
  };

  const addWarmupExerciseByName = (nameRaw: string) => {
    const cleaned = String(nameRaw || "").trim();
    if (!cleaned) return;
    setIsWarmupDescOpen(false);
    setWarmup((prev) => [
      ...prev,
      { id: uuidv4(), name: cleaned, reps: "", cadence: "" } as any,
    ]);
  };

  const toggleWarmupSelected = (nameRaw: string) => {
    const cleaned = String(nameRaw || "").trim();
    if (!cleaned) return;
    setWarmupSelected((prev) =>
      prev.includes(cleaned) ? prev.filter((p) => p !== cleaned) : [...prev, cleaned]
    );
  };

  const addSelectedWarmup = () => {
    if (!warmupSelected.length) return;
    warmupSelected.forEach((name) => addWarmupExerciseByName(name));
    setWarmupSelected([]);
    setIsWarmupMultiOpen(false);
  };

  const removeWarmupExercise = (id: string) =>
    setWarmup((prev) => prev.filter((ex: any) => ex.id !== id));

  const updateWarmupExercise = (
    id: string,
    field: keyof Exercise,
    value: string
  ) => {
    setWarmup((prev) =>
      prev.map((ex: any) => (ex.id === id ? { ...ex, [field]: value } : ex))
    );
  };

  const addRound = () =>
    setTheThang((prev) =>
      renumberRounds([
        ...prev,
        {
          id: uuidv4(),
          name: `Round ${prev.length + 1}`,
          exercises: [],
          description: "",
        } as any,
      ])
    );

  const removeRound = (id: string) =>
    setTheThang((prev) => renumberRounds(prev.filter((r: any) => r.id !== id)));

  const copyRound = (roundId: string) => {
    const source = (theThang as any[]).find((r: any) => r.id === roundId);
    if (!source) return;

    setTheThang((prev: any) =>
      renumberRounds([
        ...prev,
        {
          id: uuidv4(),
          name: `Round ${prev.length + 1}`,
          description: source.description || "",
          exercises: (source.exercises || []).map((ex: any) => ({
            id: uuidv4(),
            name: ex.name,
            reps: ex.reps,
            cadence: ex.cadence,
          })),
          timerSeconds: source.timerSeconds,
          timerRepeatCount: source.timerRepeatCount,
        } as any,
      ])
    );
  };

  const addExerciseToRound = (roundId: string) => {
    setOpenDescRounds((prev) => ({ ...prev, [roundId]: false }));

    setTheThang((prev: any) =>
      prev.map((r: any) =>
        r.id === roundId
          ? {
              ...r,
              exercises: [
                ...(r.exercises || []),
                { id: uuidv4(), name: "", reps: "", cadence: "" } as any,
              ],
            }
          : r
      )
    );
  };

  const addExerciseToRoundByName = (roundId: string, nameRaw: string) => {
    const cleaned = String(nameRaw || "").trim();
    if (!cleaned) return;
    setOpenDescRounds((prev) => ({ ...prev, [roundId]: false }));

    setTheThang((prev: any) =>
      prev.map((r: any) =>
        r.id === roundId
          ? {
              ...r,
              exercises: [
                ...(r.exercises || []),
                { id: uuidv4(), name: cleaned, reps: "", cadence: "" } as any,
              ],
            }
          : r
      )
    );
  };

  const toggleThangSelected = (roundId: string, nameRaw: string) => {
    const cleaned = String(nameRaw || "").trim();
    if (!cleaned) return;
    setThangSelected((prev) => {
      const current = prev[roundId] || [];
      const next = current.includes(cleaned)
        ? current.filter((p) => p !== cleaned)
        : [...current, cleaned];
      return { ...prev, [roundId]: next };
    });
  };

  const addSelectedToRound = (roundId: string) => {
    const selected = thangSelected[roundId] || [];
    if (!selected.length) return;
    selected.forEach((name) => addExerciseToRoundByName(roundId, name));
    setThangSelected((prev) => ({ ...prev, [roundId]: [] }));
    setThangMultiOpen((prev) => ({ ...prev, [roundId]: false }));
  };

  const removeExerciseFromRound = (roundId: string, exId: string) =>
    setTheThang((prev: any) =>
      prev.map((r: any) =>
        r.id === roundId
          ? {
              ...r,
              exercises: (r.exercises || []).filter((ex: any) => ex.id !== exId),
            }
          : r
      )
    );

  const updateExerciseInRound = (
    roundId: string,
    exId: string,
    field: keyof Exercise,
    value: string
  ) =>
    setTheThang((prev: any) =>
      prev.map((r: any) =>
        r.id === roundId
          ? {
              ...r,
              exercises: (r.exercises || []).map((ex: any) =>
                ex.id === exId ? { ...ex, [field]: value } : ex
              ),
            }
          : r
      )
    );

  /* ----------------- Round Description helpers ----------------- */
  const toggleDescPanel = (roundId: string) => {
    setOpenDescRounds((prev) => ({ ...prev, [roundId]: !prev[roundId] }));
  };

  const updateRoundDescription = (roundId: string, value: string) => {
    setTheThang((prev: any) =>
      prev.map((r: any) => (r.id === roundId ? ({ ...r, description: value } as any) : r))
    );
  };

  /* ---------- DND handlers (mirror planner behavior) ---------- */
  const handleWarmupDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setWarmup((prev: any) => {
      const oldIndex = prev.findIndex((ex: any) => ex.id === active.id);
      const newIndex = prev.findIndex((ex: any) => ex.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  const handleRoundDragEnd = (roundId: string, event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setTheThang((prev: any) =>
      prev.map((r: any) => {
        if (r.id !== roundId) return r;
        const oldIndex = (r.exercises || []).findIndex((ex: any) => ex.id === active.id);
        const newIndex = (r.exercises || []).findIndex((ex: any) => ex.id === over.id);
        if (oldIndex === -1 || newIndex === -1) return r;
        return {
          ...r,
          exercises: arrayMove(r.exercises || [], oldIndex, newIndex),
        };
      })
    );
  };

  /* ---------- DND handler for REORDERING ROUNDS ---------- */
  const handleThangRoundsDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setTheThang((prev: any[]) => {
      const oldIndex = prev.findIndex((r) => r.id === active.id);
      const newIndex = prev.findIndex((r) => r.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;

      return renumberRounds(arrayMove(prev, oldIndex, newIndex));
    });
  };

  /* ----------------- Helpers: format No-AI output ----------------- */
  const formatExercise = (e: Exercise) => {
    let line = `• ${(e as any).name || "TBD"}`;
    if ((e as any).reps) line += ` x${(e as any).reps}`;
    if ((e as any).cadence) line += ` (${(e as any).cadence})`;
    return line;
  };

  const formatThang = (rounds: WorkoutRound[]) => {
    const cleaned = rounds.filter((r: any) => {
      const hasExercises = ((r.exercises || []) as any[]).length > 0;
      const hasDesc = compactOptionalString(r.description);
      return hasExercises || hasDesc;
    });
    if (!cleaned.length) return "A glorious beatdown ensued.";

    return cleaned
      .map((round: any, i: number) => {
        const totalSeconds = round.timerSeconds ?? 0;
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;

        let timeLabel = "";
        if (totalSeconds > 0) {
          timeLabel = `${mins} minutes`;
          if (secs > 0) timeLabel += ` ${secs} seconds`;
          if (round.timerRepeatCount && round.timerRepeatCount > 1) {
            timeLabel += ` × ${round.timerRepeatCount} rounds`;
          }
        }

        const title = timeLabel
          ? `**${round.name || `Round ${i + 1}`}** — ${timeLabel}`
          : `**${round.name || `Round ${i + 1}`}**`;

        const descRaw = compactOptionalString(round.description)
          ? String(round.description).trim()
          : "";

        const exercises = (round.exercises || []).map(formatExercise).join("\n");

        // If only a description was provided, output it without a round header.
        if (!exercises && descRaw) return descRaw;

        const desc = descRaw ? `${descRaw}\n` : "";
        const body = exercises || "As called by the Q.";
        return `${title}\n${desc}${body}`;
      })
      .join("\n\n");
  };

  // Standard non-JP pax formatting
  const formatPaxSectionStandard = (pax: PaxAttendance[]) => {
    const starsky = pax
      .filter((p: any) => p.starsky)
      .map((p: any) => addAt(p.name));
    const td = pax
      .filter((p: any) => p.td && !p.starsky)
      .map((p: any) => formatPaxNameWithExtras(p));
    const dd = pax
      .filter((p: any) => p.dd && !p.td && !p.starsky)
      .map((p: any) => formatPaxNameWithExtras(p));
    const bd = pax
      .filter((p: any) => p.bd && !p.dd && !p.td && !p.starsky)
      .map((p: any) => formatPaxNameWithExtras(p));

    const lines: string[] = [];
    if (td.length) lines.push(...td.map((n) => `${n} [TD]`));
    if (dd.length) lines.push(...dd.map((n) => `${n} [DD]`));
    if (bd.length) lines.push(...bd);
    if (starsky.length) lines.push(...starsky.map((n) => `${n} [Starsky]`));
    return lines.join("\n");
  };

  /* -------------------------------------------------
     JP Pax formatting (UPDATED):
     - De-dupe across TD/DD/BD with precedence (TD > DD > BD)
     - Still keeps (Run/Ruck/MPC) and (Run Lead/Ruck Lead)
  ------------------------------------------------- */
  const formatPaxSectionJP = (args: {
    run: JpPaxRunRuck[];
    ruck: JpPaxRunRuck[];
    mpc: JpPaxMpc[];
  }) => {
    const runValid = args.run.filter((p) => stripAt(p.name));
    const ruckValid = args.ruck.filter((p) => stripAt(p.name));
    const mpcValid = args.mpc.filter((p) => stripAt(p.name));

    const starskyNames = Array.from(
      new Set(
        [...runValid, ...ruckValid, ...mpcValid]
          .filter((p) => p.starsky)
          .map((p) => addAt(p.name))
      )
    );

    type Tier = "bd" | "dd" | "td";
    const tierRank: Record<Tier, number> = { bd: 1, dd: 2, td: 3 };

    type Entry = {
      name: string; // stripped
      detailMap: Map<string, Set<Tier>>; // suffix -> tiers
      bigfoot: boolean;
      starsky: boolean;
    };

    // Keyed by name only (dedupe across Run/Ruck/MPC) and keep highest tier
    const best = new Map<string, Entry>();

    const upsert = (
      nameRaw: string,
      suffix: string,
      tier: Tier,
      extras?: { bigfoot?: boolean; starsky?: boolean }
    ) => {
      const n = stripAt(nameRaw);
      if (!n) return;
      const key = n.toLowerCase();

      const curr = best.get(key);
      const nextFlags = {
        bigfoot: !!(curr?.bigfoot || extras?.bigfoot),
        starsky: !!(curr?.starsky || extras?.starsky),
      };

      const detailMap = curr?.detailMap || new Map<string, Set<Tier>>();
      const tiers = detailMap.get(suffix) || new Set<Tier>();
      tiers.add(tier);
      detailMap.set(suffix, tiers);

      best.set(key, {
        name: n,
        detailMap,
        ...nextFlags,
      });
    };

    // RUN
    for (const p of runValid.filter((x) => !x.starsky)) {
      const suffix = p.lead ? "Run Lead" : "Run";
      if (p.td) upsert(p.name, suffix, "td", p);
      if (p.dd) upsert(p.name, suffix, "dd", p);
      if (p.bd) upsert(p.name, suffix, "bd", p);
    }

    // RUCK
    for (const p of ruckValid.filter((x) => !x.starsky)) {
      const suffix = p.lead ? "Ruck Lead" : "Ruck";
      if (p.td) upsert(p.name, suffix, "td", p);
      if (p.dd) upsert(p.name, suffix, "dd", p);
      if (p.bd) upsert(p.name, suffix, "bd", p);
    }

    // MPC
    for (const p of mpcValid.filter((x) => !x.starsky)) {
      const suffix = "MPC";
      if (p.td) upsert(p.name, suffix, "td", p);
      if (p.dd) upsert(p.name, suffix, "dd", p);
    }

    const tdLines: string[] = [];
    const ddLines: string[] = [];
    const bdLines: string[] = [];

    const joinDetails = (parts: string[]) => {
      if (parts.length <= 1) return parts.join("");
      if (parts.length === 2) return `${parts[0]} & ${parts[1]}`;
      return `${parts.slice(0, -1).join(", ")} & ${parts[parts.length - 1]}`;
    };

    for (const e of best.values()) {
      const extraTags: string[] = [];
      if (e.bigfoot) extraTags.push("Bigfoot");
      const extras = extraTags.length ? ` [${extraTags.join(", ")}]` : "";

      const allTiers: Tier[] = [];
      const detailParts: string[] = [];
      const suffixes = Array.from(e.detailMap.keys()).sort((a, b) => a.localeCompare(b));
      for (const suffix of suffixes) {
        const tiers = Array.from(e.detailMap.get(suffix) || []).sort(
          (a, b) => tierRank[b] - tierRank[a]
        );
        tiers.forEach((t) => allTiers.push(t));
        const tierLabel = tiers
          .map((t) => t.toUpperCase())
          .join("/");
        detailParts.push(`${suffix} ${tierLabel}`);
      }

      let detailText = joinDetails(detailParts);

      const topTier =
        allTiers.length === 0
          ? "bd"
          : allTiers.sort((a, b) => tierRank[b] - tierRank[a])[0];

      // In BD section, drop the "BD" suffix since the section already implies it.
      if (topTier === "bd") {
        detailText = detailText
          .replace(/\sBD\b/g, "")
          .replace(/\s{2,}/g, " ")
          .trim();
      }

      const line = `${addAt(e.name)} (${detailText})${extras}`;

      if (topTier === "td") tdLines.push(line);
      else if (topTier === "dd") ddLines.push(line);
      else bdLines.push(line);
    }

    // Sort for stable output (optional, keeps list neat)
    tdLines.sort((a, b) => a.localeCompare(b));
    ddLines.sort((a, b) => a.localeCompare(b));
    bdLines.sort((a, b) => a.localeCompare(b));

    const lines: string[] = [];

    if (tdLines.length) {
      lines.push("TD:");
      lines.push(...tdLines);
      lines.push("");
    }

    if (ddLines.length) {
      lines.push("DD:");
      lines.push(...ddLines);
      lines.push("");
    }

    if (bdLines.length) {
      const hasUpper = tdLines.length > 0 || ddLines.length > 0;
      lines.push(hasUpper ? "BD (all above plus):" : "BD:");
      lines.push(...bdLines);
      lines.push("");
    }

    if (starskyNames.length) {
      lines.push("⭐ Starsky:");
      lines.push(...starskyNames.map((n) => `${n} [Starsky]`));
      lines.push("");
    }

    return lines.join("\n").trim();
  };

  const countJpTotal = () => {
    const names = new Set<string>();
    const add = (n: string) => {
      const cleaned = stripAt(n).trim().toLowerCase();
      if (cleaned) names.add(cleaned);
    };
    jpRunPax.filter((p) => !p.starsky).forEach((p) => add(p.name));
    jpRuckPax.filter((p) => !p.starsky).forEach((p) => add(p.name));
    jpMpcPax.filter((p) => !p.starsky).forEach((p) => add(p.name));
    return names.size;
  };

  const countStandardTotal = () =>
    paxAttendance.filter((p: any) => stripAt(p.name) && !p.starsky).length;

  const formatBackblastNoAI_Standard = (args: {
    qName: string;
    longDate: string;
    workoutTime: string;
    pax: PaxAttendance[];
    warmup: Exercise[];
    warmupDescription: string;
    thang: WorkoutRound[];
    announcements: string;
    taps: string;
    styleSeed: string;
    useEmojis: boolean;
  }) => {
    const totalPax = args.pax.filter((p: any) => !p.starsky).length;
    const cleanQName = stripAt(args.qName);
    const paxSection = formatPaxSectionStandard(args.pax);
    const thangSection = formatThang(args.thang);
    const emoji = buildEmojiMap(args.styleSeed, args.useEmojis);
    const aoLabel = emoji.ao ? `${emoji.ao}AO` : "AO";
    const dateLabel = emoji.date ? `${emoji.date}Date/Time` : "Date/Time";
    const qLabel = emoji.q ? `${emoji.q}Q` : "Q";
    const paxLabel = emoji.pax ? `${emoji.pax}PAX` : "PAX";
    const disclaimerLabel = emoji.disclaimer
      ? `${emoji.disclaimer}Disclaimer`
      : "Disclaimer";
    const countLabel = emoji.count
      ? `${emoji.count}Count O Rama`
      : "Count O Rama";

    const warmupLines: string[] = [];
    if (compactOptionalString(args.warmupDescription)) {
      warmupLines.push(`${args.warmupDescription.trim()}`);
      warmupLines.push("");
    }
    const warmupExercises = args.warmup.map(formatExercise).join("\n");
    if (warmupExercises) warmupLines.push(warmupExercises);
    const warmupSection = warmupLines.join("\n");

    const styleSeed = buildStyleSeed();
    const useEmojis = shouldUseEmojis(
      styleSeed,
      forceNoEmojis,
      aiOptions.minimalEmojis,
      activeAo.id
    );

    const hashtags = buildHashtags(activeAo.hashtags || [], "backblast", {
      aoId: activeAo.id,
      workoutDate: longDate,
    }).join(" ");

    const lines: string[] = [];
    lines.push(hashtags);
    lines.push("");
    lines.push(
      '***Q — CLICK “COPY & START POST IN BAND”, THEN REPLACE THIS WITH YOUR MESSAGE***'
    );
    lines.push("");
    lines.push(`${aoLabel}: ${backblastAoLabel}`);
    lines.push(`${dateLabel}: ${args.longDate} (${args.workoutTime})`);
    lines.push(`${qLabel}: ${cleanQName}`);
    lines.push(`${paxLabel}: ${totalPax} Total`);
    lines.push("");
    if (paxSection) {
      lines.push(paxSection);
      lines.push("");
    }
    lines.push(`${disclaimerLabel} (Standard disclaimer)`);
    lines.push(`${countLabel}: ${totalPax}`);
    lines.push("");
    lines.push("Warmup:");
    lines.push(warmupSection);
    lines.push("");
    lines.push("The Thang:");
    lines.push(thangSection);
    lines.push("");
    lines.push(`Announcements: ${args.announcements || "None."}`);
    lines.push(`TAPS: ${args.taps || "None."}`);
    return lines.join("\n");
  };

  const formatBackblastNoAI_JP = (args: {
    qName: string;
    longDate: string;
    workoutTime: string;
    run: JpPaxRunRuck[];
    ruck: JpPaxRunRuck[];
    mpc: JpPaxMpc[];
    announcements: string;
    taps: string;
    styleSeed: string;
    useEmojis: boolean;
  }) => {
    const names = new Set<string>();
    const add = (n: string) => {
      const cleaned = stripAt(n).trim().toLowerCase();
      if (cleaned) names.add(cleaned);
    };
    args.run.filter((p) => !p.starsky).forEach((p) => add(p.name));
    args.ruck.filter((p) => !p.starsky).forEach((p) => add(p.name));
    args.mpc.filter((p) => !p.starsky).forEach((p) => add(p.name));
    const totalPax = names.size;

    const cleanQName = stripAt(args.qName);
    const hashtags = buildHashtags(activeAo.hashtags || [], "backblast", {
      aoId: activeAo.id,
      workoutDate: longDate,
    }).join(" ");
    const paxSection = formatPaxSectionJP({
      run: args.run,
      ruck: args.ruck,
      mpc: args.mpc,
    });

    const emoji = buildEmojiMap(args.styleSeed, args.useEmojis);
    const aoLabel = emoji.ao ? `${emoji.ao}AO` : "AO";
    const dateLabel = emoji.date ? `${emoji.date}Date/Time` : "Date/Time";
    const qLabel = emoji.q ? `${emoji.q}Q` : "Q";
    const paxLabel = emoji.pax ? `${emoji.pax}PAX` : "PAX";

    const lines: string[] = [];
    lines.push(hashtags);
    lines.push("");
    lines.push(
      '***Q — CLICK “COPY & START POST IN BAND”, THEN REPLACE THIS WITH YOUR MESSAGE***'
    );
    lines.push("");
    lines.push(`${aoLabel}: ${backblastAoLabel}`);
    lines.push(`${dateLabel}: ${args.longDate} (${args.workoutTime})`);
    lines.push(`${qLabel}: ${cleanQName}`);
    lines.push(`${paxLabel}: ${totalPax} Total`);
    lines.push("");
    if (paxSection) {
      lines.push(paxSection);
      lines.push("");
    }
    // JP: no disclaimer / no count / no warmup / no thang
    lines.push(`Announcements: ${args.announcements || "None."}`);
    lines.push(`TAPS: ${args.taps || "None."}`);
    return lines.join("\n");
  };

  /* -------------------------------------------------
     JP AI: extract only narrative + Appreciation; then we format
     IMPORTANT FIX:
     - geminiService ALWAYS outputs hashtag first, so we must SKIP that,
       not treat it as a stop condition.
------------------------------------------------- */
  const extractBackblastNarrative = (raw: string): string => {
    const text = String(raw || "").replace(/\r\n/g, "\n").trim();
    if (!text) return "";

    const lines = text.split("\n");

    // Stop when the structured template begins
    const stopMatchers = [
      /^Backblast\b/i,
      /^📍\s*AO\b/i,
      /^📅\s*Date\/Time\b/i,
      /^🎩\s*Q\b/i,
      /^👥\s*PAX\b/i,
      /^🚨\s*Disclaimer/i,
      /^🔢\s*Count/i,
      /^Warmup\b/i,
      /^The Thang\b/i,
      /^Announcements\b/i,
      /^TAPS\b/i,
      /^TD:/i,
      /^DD:/i,
      /^BD:/i,
      /^TD MPC:/i,
      /^DD MPC:/i,
    ];

    const out: string[] = [];
    let started = false;

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      const trimmed = line.trim();

      // Skip leading boilerplate from service output
      if (!started) {
        if (!trimmed) continue;

        // Hashtags first line (e.g., "#backblast #f3...")
        if (trimmed.startsWith("#")) continue;

        // Optional old placeholder line
        if (/^\*\*\*Q\b/i.test(trimmed)) continue;

        started = true;
      }

      if (!trimmed) {
        if (out.length && out[out.length - 1] !== "") out.push("");
        continue;
      }

      // Stop once the structured block begins
      if (stopMatchers.some((rx) => rx.test(trimmed))) break;

      out.push(trimmed);
    }

    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  };

  /* -------------------------------------------------
     JP Narrative Sanitizer:
     Removes structured-workout language that slips through:
     - "beatdown", "shovel flag", "planned workout", "lead a session", etc.
     Also removes "regardless of who else shows up"/solo-implying lines.
  ------------------------------------------------- */
  const sanitizeJpNarrative = (raw: string, totalPax: number): string => {
    const text = String(raw || "").replace(/\r\n/g, "\n").trim();
    if (!text) return "";

    // Split into sentences conservatively (keeps Band-style writing intact)
    const sentences = text
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const forbidden = [
      /\bbeatdown\b/i,
      /\bthe thang\b/i,
      /\bwarmup\b/i,
      /\bplanned workout\b/i,
      /\bworkout\b/i,
      /\bsession\b/i,
      /\bled a\b/i,
      /\bi led\b/i,
      /\bq led\b/i,
      /\bbring the gloom\b/i,
      /\bshovel flag\b/i,
      /\bflag was planted\b/i,
      /\bplanted\b.*\bflag\b/i,
      /\bdisclaimer\b/i,
      /\bcount[- ]?o[- ]?rama\b/i,
      /\bit's a privilege to post\b/i,
      /\bregardless of who else shows up\b/i,
      /\bwhether anyone shows up\b/i,
      /\beven if nobody\b/i,
      /\bno one\b.*\bshow(ed|s)\b/i,
      /\bnobody\b.*\bshow(ed|s)\b/i,
      /\bjust me\b/i,
      /\bsolo\b/i,
      /\balone\b/i,
      /\bby myself\b/i,
    ];

    // For totals > 1, we should be stricter about solo vibes.
    const strictForbidden =
      totalPax > 1
        ? forbidden
        : forbidden.filter((rx) => !/\bsolo\b|\balone\b|\bby myself\b|\bjust me\b/i.test(String(rx)));

    const kept = sentences.filter((s) => !strictForbidden.some((rx) => rx.test(s)));

    // Rebuild. If we stripped too much, return empty and let ensureJpNarrative rebuild safely.
    const rebuilt = kept.join(" ").trim();
    return rebuilt.length >= 40 ? rebuilt : "";
  };

  /* -------------------------------------------------
     JP Narrative Enforcer:
     - Guarantees 2 paragraphs
     - Ensures first sentence includes TOTAL + YHC (if missing)
     - Pads with a grounded appreciation paragraph when Gemini is too short
  ------------------------------------------------- */
  const ensureJpNarrative = (args: {
    narrative: string;
    totalPax: number;
    runCount: number;
    ruckCount: number;
    mpcCount: number;
  }) => {
    const total = args.totalPax;

    const baseFirst = `${total} Pax, including YHC, gathered for a run/ruck at Jurassic Park.`;

    const raw = String(args.narrative || "").trim();
    const cleaned = raw.replace(/\n{3,}/g, "\n\n").trim();

    // Split into paragraphs
    const parts = cleaned
      ? cleaned.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
      : [];

    // Build a safe recap paragraph
    const recap = parts[0] || "";
    const recapHasTotal = new RegExp(`\\b${total}\\b`).test(recap);
    const recapHasYhc = /\bYHC\b/i.test(recap);

    let recapFixed = recap || baseFirst;

    // Enforce TOTAL + YHC on first sentence.
    if (!recapHasTotal || !recapHasYhc) {
      // Replace the first paragraph entirely to avoid contradictions.
      recapFixed = baseFirst + (recap ? ` ${recap}` : "");
      recapFixed = recapFixed.replace(/\s+/g, " ").trim();
    }

    // Ensure at least 2 sentences in recap if Gemini gave basically nothing.
    if (recapFixed.split(/[.!?]\s+/).filter(Boolean).length < 2) {
      const second = `We logged miles in good company—some running, some rucking, all staying consistent.`;
      recapFixed = `${recapFixed} ${second}`.replace(/\s+/g, " ").trim();
    }

    // Appreciation paragraph (use Gemini if present, else pad)
    let appreciation = parts.slice(1).join("\n\n").trim();

    if (!appreciation) {
      const breakdown = [
        args.runCount ? `${args.runCount} runners` : "",
        args.ruckCount ? `${args.ruckCount} ruckers` : "",
        args.mpcCount ? `${args.mpcCount} MPC` : "",
      ]
        .filter(Boolean)
        .join(", ");

      const breakdownLine = breakdown ? ` (${breakdown})` : "";

      appreciation = [
        `Solid showing from the crew${breakdownLine}—appreciate everyone choosing the early alarm and the work.`,
        `If you’ve been meaning to get back out, JP is a great way to start Sunday with miles, accountability, and fellowship.`,
        `Bring a friend next week and let’s keep building it.`,
      ].join(" ");
    }

    // Final: exactly 2 paragraphs (recap + appreciation)
    return `${recapFixed.trim()}\n\n${appreciation.trim()}`.trim();
  };

  const formatBackblastAI_JP = (args: {
    narrative: string;
    qName: string;
    longDate: string;
    workoutTime: string;
    run: JpPaxRunRuck[];
    ruck: JpPaxRunRuck[];
    mpc: JpPaxMpc[];
    announcements: string;
    taps: string;
    minimalEmojis?: boolean;
    styleSeed: string;
    useEmojis: boolean;
  }) => {
    const names = new Set<string>();
    const add = (n: string) => {
      const cleaned = stripAt(n).trim().toLowerCase();
      if (cleaned) names.add(cleaned);
    };
    args.run.filter((p) => !p.starsky).forEach((p) => add(p.name));
    args.ruck.filter((p) => !p.starsky).forEach((p) => add(p.name));
    args.mpc.filter((p) => !p.starsky).forEach((p) => add(p.name));
    const totalPax = names.size;

    const cleanQName = stripAt(args.qName);
    const hashtags = buildHashtags(activeAo.hashtags || [], "backblast", {
      aoId: activeAo.id,
      workoutDate: longDate,
    }).join(" ");
    const paxSection = formatPaxSectionJP({
      run: args.run,
      ruck: args.ruck,
      mpc: args.mpc,
    });

    const lines: string[] = [];
    lines.push(hashtags);
    lines.push("");

    // ✅ JP narrative goes immediately after hashtags (before the structured block)
    if (args.narrative) {
      lines.push(args.narrative.trim());
      lines.push("");
    }

    const useEmojiLabels =
      args.useEmojis && !args.minimalEmojis ? true : false;
    const emoji = buildEmojiMap(args.styleSeed, useEmojiLabels);
    const aoLabel = emoji.ao ? `${emoji.ao}AO` : "AO";
    const dateLabel = emoji.date ? `${emoji.date}Date/Time` : "Date/Time";
    const qLabel = emoji.q ? `${emoji.q}Q` : "Q";
    const paxLabel = emoji.pax ? `${emoji.pax}PAX` : "PAX";

    lines.push(`${dateLabel}: ${args.longDate} (${args.workoutTime})`);
    lines.push(`${qLabel}: ${cleanQName}`);
    lines.push(`${paxLabel}: ${totalPax} Total`);
    lines.push("");
    if (paxSection) {
      lines.push(paxSection);
      lines.push("");
    }

    lines.push(`Announcements: ${args.announcements || "None."}`);
    lines.push(`TAPS: ${args.taps || "None."}`);

    return lines.join("\n").trim();
  };

  const logWorkoutToHistory = (validStandardPax: PaxAttendance[]) => {
    const qSheetDate = formatLongDateToQSheetDate(longDate);

    const norm = (workoutTime || "").toLowerCase().replace(/\s+/g, "");
    const is0630 =
      norm.includes("6:30am") || norm.includes("6:30") || norm.includes("06:30");
    const timeCode = is0630 ? "0630" : "0530";

    // For JP, we store the split lists in notes (so you still have a record),
    // and store a flattened pax list in paxAttendance for compatibility.
    const flattenedJp: any[] = [];
    if (isJP) {
        for (const p of jpRunPax.filter((x) => stripAt(x.name))) {
          flattenedJp.push({
            id: p.id,
            name: stripAt(p.name),
            bd: p.bd,
            dd: p.dd,
            td: p.td,
            bigfoot: p.bigfoot,
            starsky: p.starsky,
            jpGroup: "run",
            lead: p.lead,
          });
        }
        for (const p of jpRuckPax.filter((x) => stripAt(x.name))) {
          flattenedJp.push({
            id: p.id,
            name: stripAt(p.name),
            bd: p.bd,
            dd: p.dd,
            td: p.td,
            bigfoot: p.bigfoot,
            starsky: p.starsky,
            jpGroup: "ruck",
            lead: p.lead,
          });
        }
        for (const p of jpMpcPax.filter((x) => stripAt(x.name))) {
          flattenedJp.push({
            id: p.id,
            name: stripAt(p.name),
            bd: false,
            dd: p.dd,
            td: p.td,
            bigfoot: p.bigfoot,
            starsky: p.starsky,
            jpGroup: "mpc",
            lead: false,
          });
        }
    }

    addLoggedWorkout({
      id: uuidv4(),
      date: qSheetDate,
      time: timeCode,
      q: stripAt(qName),
      paxAttendance: (isJP ? (flattenedJp as any) : validStandardPax).map((p: any) => ({
        ...p,
        name: stripAt(p.name),
      })),
      paxCount: isJP ? flattenedJp.length : validStandardPax.length,
      warmup,
      theThang,
      announcements,
      taps,
      notes,
      plan: { q: stripAt(qName), warmup, warmupDescription, theThang },
      dbj: "",
      food: "",
    } as any);
  };

  /* ----------------- Error classification (Gemini) ----------------- */
  const classifyGeminiError = (e: any) => {
    const raw =
      String(e?.message || e || "").toLowerCase() +
      " " +
      String(e?.status || e?.response?.status || "").toLowerCase();

    const status = e?.status ?? e?.response?.status;

    const isRate =
      status === 429 ||
      raw.includes("429") ||
      raw.includes("rate") ||
      raw.includes("too many") ||
      raw.includes("quota") ||
      raw.includes("resource exhausted");

    const isOverload =
      status === 503 ||
      raw.includes("503") ||
      raw.includes("overload") ||
      raw.includes("unavailable") ||
      raw.includes("temporarily");

    return {
      isRate,
      isOverload,
    };
  };

  /* ----------------- Backblast AI call with retries + status ----------------- */
  const generateWithRetry = async (
    backblastData: any,
    onStatus?: (msg: string) => void
  ): Promise<string> => {
    const maxRetries = 10;
    const baseDelayMs = 1000;
    const maxTotalMs = 60000;
    const startedAt = Date.now();

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (attempt === 1) onStatus?.("Contacting Gemini… (up to 60s max)");
        else onStatus?.(`Retrying Gemini… (${attempt}/${maxRetries})`);

        const result = await generateBackblast(backblastData);
        return result;
      } catch (e: any) {
        const msg = (e?.message || "").toLowerCase();
        const transient =
          msg.includes("overload") ||
          msg.includes("quota") ||
          msg.includes("429") ||
          msg.includes("503") ||
          e?.status === 429 ||
          e?.status === 503 ||
          e?.response?.status === 429 ||
          e?.response?.status === 503;

        const elapsed = Date.now() - startedAt;
        if (!transient || attempt === maxRetries || elapsed >= maxTotalMs) throw e;

        const delay = Math.min(baseDelayMs * Math.pow(2, attempt), 20000);
        const remaining = maxTotalMs - elapsed;
        const waitMs = Math.min(delay, remaining);
        onStatus?.(`Gemini is busy. Waiting ${Math.round(waitMs / 1000)}s…`);
        await new Promise((res) => setTimeout(res, waitMs));
      }
    }

    throw new Error("Unexpected retry failure");
  };

  const updateWorkoutTimeRange = (nextStart: string, nextEnd: string) => {
    if (nextStart && nextEnd) {
      setWorkoutTime(buildWorkoutTimeRange(nextStart, nextEnd));
    }
  };

  const markOutput = (label: string, mode: "AI" | "NO_AI") => {
    setOutputLabel(label);
    setOutputMode(mode);
    setOutputTimestamp(
      new Date().toLocaleString("en-US", {
        month: "numeric",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    );
  };

  const buildAiOptionsNotes = () => {
    const lines: string[] = [];
    if (aiOptions.gratitude) lines.push("Include a short appreciation line.");
    if (aiOptions.missionValues)
      lines.push("Include a short F3 values line (fitness, fellowship, faith).");
    if (aiOptions.funny) lines.push("Add a light funny line (PG-13, no vulgar).");
    if (aiOptions.highEnergy) lines.push("Tone: high-energy.");
    if (aiOptions.minimalEmojis) lines.push("Do not use emojis.");
    if (aiOptions.ironSharpensIron)
      lines.push('Include a short "iron sharpens iron" fellowship line.');
    return lines.join("\n");
  };

  const handleClearDraft = () => {
    sessionStorage.removeItem(BACKBLAST_DRAFT_KEY);
    didRestoreRef.current = false;
    setQName("");
    setCommittedQName("");
    setIsCustomQ(false);
    setLongDate(defaultWorkout.longDate);
    setWorkoutTime(defaultWorkout.time);
    setDateInputValue(toIsoDate(defaultWorkout.longDate));
    const parsed = parseTimeRangeTo24(defaultWorkout.time);
    setStartTime24(parsed.start || "06:00");
    setEndTime24(parsed.end || "07:00");
    setPaxAttendance([
      { id: uuidv4(), name: "", bd: true, dd: false, td: false, bigfoot: false, starsky: false },
    ]);
    setJpRunPax([
      normalizeRunRuck({
        id: uuidv4(),
        name: "",
        bd: true,
        dd: false,
        td: false,
        bigfoot: false,
        starsky: false,
        lead: false,
      }),
    ]);
    setJpRuckPax([
      normalizeRunRuck({
        id: uuidv4(),
        name: "",
        bd: true,
        dd: false,
        td: false,
        bigfoot: false,
        starsky: false,
        lead: false,
      }),
    ]);
    setJpMpcPax([
      normalizeMpc({ id: uuidv4(), name: "", dd: true, td: false, bigfoot: false, starsky: false }),
    ]);
    setWarmup([]);
    setWarmupDescription("");
    setTheThang([{ id: uuidv4(), name: "Round 1", exercises: [] }]);
    setAnnouncements("");
    setTaps("");
    setNotes("");
    setGenerateMode(null);
    setOutputLabel("");
    setOutputTimestamp("");
    setOutputMode("");
    setAiOptions({
      gratitude: false,
      missionValues: false,
      funny: false,
      highEnergy: false,
      minimalEmojis: false,
      ironSharpensIron: false,
    });
    setSelectedPax([]);
    setIsMultiAddOpen(false);
    setJpRunSelected([]);
    setJpRuckSelected([]);
    setJpMpcSelected([]);
    setIsJpRunMultiAddOpen(false);
    setIsJpRuckMultiAddOpen(false);
    setIsJpMpcMultiAddOpen(false);
    setIsWarmupMultiOpen(false);
    setWarmupSelected([]);
    setThangMultiOpen({});
    setThangSelected({});
    setGeneratedText("");
    setIsLoading(false);
    setLoadingStatus("");
    setLoadingSeconds(0);
    setError("");
    setCopySuccess(false);
  };

  /* ---------------------- Generate AI Handler ---------------------- */
  const handleGenerateAI = async () => {
    if (forceNoAiAo) {
      handleFormatNoAI();
      return;
    }
    if (!qName) {
      setError("Q Name is required.");
      return;
    }
    if (!longDate) {
      setError("Workout Date is required.");
      return;
    }

    setIsLoading(true);
    setError("");
    setLoadingStatus("Generating backblast…");
    setGeneratedText(
      "Generating backblast… (We’ll try for up to 60 seconds, then fall back to a non-AI template if needed.)"
    );

    const hashtags = buildHashtags(activeAo.hashtags || [], "backblast", {
      aoId: activeAo.id,
      workoutDate: longDate,
    }).join(" ");

    // Standard valid pax for non-JP
    const validStandardPax = paxAttendance
      .map((p: any) => ({ ...p, name: stripAt(p.name) }))
      .filter((p: any) => p.name.trim() !== "");

    const qDisplayName = stripAt(qName);

    // JP counts (we pass these to Gemini so it can write a grounded appreciation)
    const jpRunCount = jpRunPax.filter((p) => stripAt(p.name)).length;
    const jpRuckCount = jpRuckPax.filter((p) => stripAt(p.name)).length;
    const jpMpcCount = jpMpcPax.filter((p) => stripAt(p.name)).length;
    const jpTotalPax = countJpTotal();

    const jpInstructions = isJP
      ? [
          "JP_MODE: TRUE",
          "TASK: Write ONLY the narrative paragraphs for a Jurassic Park run/ruck backblast.",
          "DO NOT write or include any template/sections/labels (no Backblast/AO/Date/Q/PAX/TD/DD/BD/Announcements/TAPS/etc.).",
          "DO NOT say: beatdown, Q led, I led, I planned a workout, shovel flag, planted the flag, session, workout, or anything implying a structured workout.",
          "",
          "JP FACTS (YOU MUST OBEY THESE NUMBERS):",
          `TOTAL_PAX=${jpTotalPax}`,
          `RUNNERS=${jpRunCount}`,
          `RUCKERS=${jpRuckCount}`,
          `MPC=${jpMpcCount}`,
          "",
          "NON-NEGOTIABLE RULES:",
          `1) FIRST sentence MUST explicitly include TOTAL_PAX (${jpTotalPax}) AND the word 'YHC'.`,
          "2) You MUST NOT imply 'solo', 'no one joined', 'just me', 'quiet AO', etc. unless TOTAL_PAX == 1.",
          "3) If TOTAL_PAX > 1, you MUST reference 'we' / 'the PAX' / fellowship in the recap.",
          "4) If using 'X HIMs + YHC', X MUST equal TOTAL_PAX - 1.",
          "",
          "OUTPUT:",
          "- 2 paragraphs total.",
          "- Paragraph 1: recap (1–3 sentences).",
          "- Paragraph 2: appreciation/inspiration (2–4 sentences).",
          "- Tone: grounded, like a real Band post. Avoid cheesy lines like 'privilege to post regardless of who shows'.",
          "- Emojis: 0–1 max.",
        ].join("\n")
      : "";

    const aoContextLines = [
      `AO: ${backblastAoLabel}`,
      `WHERE: ${activeAo.whereName}`,
      `HASHTAGS: ${hashtags}`,
      "",
      "IMPORTANT: In the final post, all PAX mentions must include '@' (e.g., @Hardwood).",
    ].filter(Boolean);

    const aiOptionsNotes = buildAiOptionsNotes();
    const notesWithAoContext = [
      ...aoContextLines,
      "",
      isJP ? jpInstructions : "",
      aiOptionsNotes ? `OPTIONS:\n${aiOptionsNotes}` : "",
      "",
      notes?.trim() || "",
    ]
      .filter(Boolean)
      .join("\n");

    // ✅ IMPORTANT:
    // geminiService.generateBackblast REQUIRES aoId.
    const backblastData = {
      aoId: activeAo.id as AoId,
      qName: qDisplayName,
      workoutDate: longDate,
      workoutTime,
      minimalEmojis: aiOptions.minimalEmojis,
      paxAttendance: isJP
        ? [] // JP narrative-only (we format pax ourselves)
        : validStandardPax.map((p: any) => ({ ...p, name: addAt(p.name) })),
      warmup,
      warmupDescription,
      theThang,
      announcements,
      taps,
      notes: notesWithAoContext,
    };

    try {
      const result = await generateWithRetry(backblastData, setLoadingStatus);

      if (isJP) {
        const narrativeRaw = extractBackblastNarrative(result);

        // If Gemini tries to imply "solo" when total > 1, sanitize.
        const jpSoloSignals =
          /(no one|nobody|just me|solo|alone|by myself|didn't show|never materialized|quiet ao)/i;

        let narrativeSafe = narrativeRaw;

        if (jpTotalPax > 1 && jpSoloSignals.test(narrativeRaw)) {
          const parts = narrativeRaw
            .split(/\n\s*\n/)
            .map((p) => p.trim())
            .filter(Boolean);
          const tail = parts.length > 1 ? parts.slice(1).join("\n\n") : "";
          narrativeSafe = [
            `${jpTotalPax} Pax, including YHC, gathered for a run/ruck at Jurassic Park.`,
            tail,
          ]
            .filter(Boolean)
            .join("\n\n")
            .trim();
        }

        // ✅ NEW: strip structured-workout language that sneaks in
        const narrativeSanitized = sanitizeJpNarrative(narrativeSafe, jpTotalPax);

        // ✅ Enforce 2-paragraph narrative even if Gemini returns junk/too short
        const finalNarrative = ensureJpNarrative({
          narrative: narrativeSanitized,
          totalPax: jpTotalPax,
          runCount: jpRunCount,
          ruckCount: jpRuckCount,
          mpcCount: jpMpcCount,
        });

      const formatted = formatBackblastAI_JP({
        narrative: finalNarrative,
        qName: qDisplayName,
        longDate,
        workoutTime,
        run: jpRunPax,
        ruck: jpRuckPax,
        mpc: jpMpcPax,
        announcements,
        taps,
        minimalEmojis: aiOptions.minimalEmojis,
        styleSeed,
        useEmojis,
      });
        const finalText =
          forceNoEmojis || !useEmojis ? stripEmojis(formatted) : formatted;
        setGeneratedText(finalText);
        markOutput("Generated by AI", "AI");

        // Log with JP flattening
        logWorkoutToHistory([]);
      } else {
        const normalized = normalizeBackblastEmojis(result, styleSeed, useEmojis);
        setGeneratedText(normalized);
        markOutput("Generated by AI", "AI");
        logWorkoutToHistory(validStandardPax);
      }
    } catch (e: any) {
      const { isOverload, isRate } = classifyGeminiError(e);

      const msg = isRate
        ? "Gemini hit its daily token wall. I generated a non-AI template instead—copy to BAND and add your own intro."
        : isOverload
        ? "Gemini is overloaded right now. I generated a non-AI template instead—copy to BAND and add your own intro."
        : "Gemini didn’t respond. I generated a non-AI template instead—copy to BAND and add your own intro.";

      setError(msg);
      setLoadingStatus("Falling back to non-AI template…");

      if (isJP) {
        const formatted = formatBackblastNoAI_JP({
          qName: stripAt(qName),
          longDate,
          workoutTime,
          run: jpRunPax,
          ruck: jpRuckPax,
          mpc: jpMpcPax,
          announcements,
          taps,
          styleSeed,
          useEmojis: useEmojis && !forceNoEmojis,
        });
        const finalText =
          forceNoEmojis || !useEmojis ? stripEmojis(formatted) : formatted;
        setGeneratedText(finalText);
        markOutput("Generated (No AI)", "NO_AI");
        logWorkoutToHistory([]);
      } else {
        const formatted = formatBackblastNoAI_Standard({
          qName: stripAt(qName),
          longDate,
          workoutTime,
          pax: validStandardPax,
          warmup,
          warmupDescription,
          thang: theThang,
          announcements,
          taps,
          styleSeed,
          useEmojis: useEmojis && !forceNoEmojis,
        });
        const finalText =
          forceNoEmojis || !useEmojis ? stripEmojis(formatted) : formatted;
        setGeneratedText(finalText);
        markOutput("Generated (No AI)", "NO_AI");
        logWorkoutToHistory(validStandardPax);
      }
    } finally {
      setIsLoading(false);
      setLoadingStatus("");
    }
  };

  /* ---------------------- Format No-AI Handler ---------------------- */
  const handleFormatNoAI = () => {
    if (!qName) {
      setError("Q Name is required.");
      return;
    }
    if (!longDate) {
      setError("Workout Date is required.");
      return;
    }

    setError("");
    setIsLoading(false);
    setLoadingStatus("");

    const validStandardPax = paxAttendance
      .map((p: any) => ({ ...p, name: stripAt(p.name) }))
      .filter((p: any) => p.name.trim() !== "");

    const styleSeed = buildStyleSeed();
    const useEmojis = shouldUseEmojis(
      styleSeed,
      forceNoEmojis,
      false,
      activeAo.id
    );

    const formatted = isJP
      ? formatBackblastNoAI_JP({
          qName: stripAt(qName),
          longDate,
          workoutTime,
          run: jpRunPax,
          ruck: jpRuckPax,
          mpc: jpMpcPax,
          announcements,
          taps,
          styleSeed,
          useEmojis,
        })
      : formatBackblastNoAI_Standard({
          qName: stripAt(qName),
          longDate,
          workoutTime,
          pax: validStandardPax,
          warmup,
          warmupDescription,
          thang: theThang,
          announcements,
          taps,
          styleSeed,
          useEmojis,
        });

    const finalText =
      forceNoEmojis || !useEmojis ? stripEmojis(formatted) : formatted;
    setGeneratedText(finalText);
    markOutput("Generated (No AI)", "NO_AI");

    // Log
    if (isJP) logWorkoutToHistory([]);
    else logWorkoutToHistory(validStandardPax);
  };

  /* ---------------------- Clipboard helper (mobile-safe) ---------------------- */
  const copyTextToClipboard = async (text: string): Promise<boolean> => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {}

    try {
      const ta = document.createElement("textarea");
      ta.value = text;

      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.left = "0";
      ta.style.width = "1px";
      ta.style.height = "1px";
      ta.style.opacity = "0";
      ta.style.pointerEvents = "none";

      document.body.appendChild(ta);
      ta.focus();
      ta.select();

      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  };

  /* ---------------------- Copy + Start Post Button (copy-first) ---------------------- */
  const handleCopyAndPost = async () => {
    if (!generatedText) return;

    const bandUrl = (activeAo as any).bandPostUrl || "https://www.band.us";
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    const copied = await copyTextToClipboard(generatedText);

    if (!copied) {
      setError(
        "Could not copy to clipboard on this device/browser. BAND will open—tap and hold in the post box and choose Paste. If Paste still doesn’t appear, use the preview below: long-press → Select All → Copy."
      );
    } else {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }

    const newWin = window.open("", "_blank");

    if (newWin) {
      newWin.opener = null;
      newWin.location.href = bandUrl;

      if (isMobile) {
        setTimeout(() => {
          try {
            newWin.close();
          } catch {}
        }, 800);
      }
    } else {
      console.warn("Popup blocked. BAND was not opened.");
    }
  };

  /* ===================================================================
     COMPONENT RENDER
  ==================================================================== */
  const totalPaxDisplay = isJP ? countJpTotal() : countStandardTotal();

  return (
    <div className="animate-fade-in">
      <div className="flex items-center gap-2 mb-4">
        <DocumentTextIcon className="h-6 w-6 text-red-500 shrink-0" />
        <h2 className="text-lg sm:text-xl font-display text-white tracking-wide truncate">
          Backblast Generator{" "}
          <span className="text-slate-300">— {backblastAoLabel}</span>
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* ---------------- INPUT FORM ---------------- */}
        <div className="bg-slate-800/50 rounded-lg shadow-2xl p-6 border border-slate-700 space-y-4">
          {/* AO DETAILS */}
          <div className="bg-slate-900/60 border border-slate-700 rounded-md p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="font-semibold text-sm text-slate-200 truncate">
                {backblastAoLabel}
              </div>
              <div className="flex items-center gap-2 whitespace-nowrap">
                <span className="text-xs text-slate-400">Change AO:</span>
                <AoSelector />
                <button
                  type="button"
                  onClick={handleClearDraft}
                  className="text-sm font-semibold text-slate-200 bg-slate-700/70 border border-slate-600 rounded-md px-2 py-1 hover:bg-slate-600/70"
                >
                  Clear Draft
                </button>
              </div>
            </div>
          </div>

          {/* Q NAME */}
          <div>
            <div className="flex items-center gap-4">
              <label className="block text-sm font-bold text-slate-300 self-end">
                Q <span className="text-red-400">*</span>
              </label>

              <select
                value={
                  isCustomQ ? "custom" : qName && isQNameFromList ? stripAt(qName) : ""
                }
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "custom") {
                    setIsCustomQ(true);
                    if (!qName) setQName("");
                    return;
                  }
                  const next = stripAt(v);
                  setIsCustomQ(false);
                  setQName(next);
                  setCommittedQName(next);
                }}
                className="flex-1 min-h-[44px] bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-white text-sm"
              >
                <option value="">Select Q</option>
                {paxList.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
                <option value="custom">-- Custom --</option>
              </select>
            </div>

            {isCustomQ && (
              <input
                type="text"
                value={qName}
                onChange={(e) => setQName(stripAt(e.target.value))}
                onBlur={() => setCommittedQName(stripAt(qName))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setCommittedQName(stripAt(qName));
                  }
                }}
                placeholder="Enter Custom Q Name"
                className="mt-2 w-full min-h-[44px] bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-white text-sm"
              />
            )}
            <p className="mt-1 text-xs text-slate-400">Must fill in Q.</p>
          </div>

          {/* DATE + TIME */}
          <div className="pt-4 border-t border-slate-700/60">
            <label className="block text-sm font-bold text-slate-300 mb-2">
              Workout Date & Time
            </label>

            <div className="grid grid-cols-[1.6fr_0.7fr_0.7fr] gap-3">
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Workout Date
                </label>
                <div
                  className="relative"
                  onClick={() => {
                    dateInputRef.current?.showPicker?.();
                    dateInputRef.current?.focus();
                  }}
                >
                    <input
                      type="text"
                      value={longDate}
                      readOnly
                      placeholder="e.g. Tuesday, 10/29/2024"
                      className="w-full min-h-[44px] bg-slate-700 border border-slate-600 rounded-md py-1 px-2 text-xs sm:text-sm pointer-events-none"
                    />
                  <input
                    ref={dateInputRef}
                    type="date"
                    value={dateInputValue}
                    onChange={(e) => {
                      const iso = e.target.value;
                      setDateInputValue(iso);
                      if (iso) {
                        setLongDate(formatDateLong(new Date(`${iso}T00:00:00`)));
                      }
                    }}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    aria-label="Workout date"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">
                  Start Time
                </label>
                <div
                  className="relative"
                  onClick={() => {
                    startTimeInputRef.current?.showPicker?.();
                    startTimeInputRef.current?.focus();
                  }}
                >
                    <input
                      type="text"
                      value={startTime24 ? formatTime12(startTime24) : ""}
                      readOnly
                      className="w-full min-h-[44px] bg-slate-700 border border-slate-600 rounded-md py-1 px-2 text-xs sm:text-sm pointer-events-none"
                    />
                  <input
                    ref={startTimeInputRef}
                    type="time"
                    value={startTime24}
                    onChange={(e) => {
                      const v = e.target.value;
                      setStartTime24(v);
                      updateWorkoutTimeRange(v, endTime24);
                    }}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    aria-label="Start time"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-slate-400 mb-1">End Time</label>
                <div
                  className="relative"
                  onClick={() => {
                    endTimeInputRef.current?.showPicker?.();
                    endTimeInputRef.current?.focus();
                  }}
                >
                    <input
                      type="text"
                      value={endTime24 ? formatTime12(endTime24) : ""}
                      readOnly
                      className="w-full min-h-[44px] bg-slate-700 border border-slate-600 rounded-md py-1 px-2 text-xs sm:text-sm pointer-events-none"
                    />
                  <input
                    ref={endTimeInputRef}
                    type="time"
                    value={endTime24}
                    onChange={(e) => {
                      const v = e.target.value;
                      setEndTime24(v);
                      updateWorkoutTimeRange(startTime24, v);
                    }}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    aria-label="End time"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* PAX */}
          <div className="pt-4 border-t border-slate-700/60">
            <h3 className="text-sm font-bold text-slate-300 mb-2 flex items-center gap-2">
              <UserGroupIcon /> PAX Attendance ({totalPaxDisplay})
            </h3>

            {!isJP ? (
              <>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsMultiAddOpen(true)}
                    className="text-sm text-slate-300 hover:text-white flex items-center gap-1"
                  >
                    <PlusCircleIcon /> Quick Add Multiple PAX
                  </button>
                </div>

                {isMultiAddOpen && (
                  <div className="mt-2 rounded-md border border-slate-700 bg-slate-900/40 p-3 space-y-3">
                    <div className="text-xs text-slate-400 flex items-center justify-between">
                      <span>Select multiple PAX</span>
                      <span>Selected: {selectedPax.length}</span>
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {paxList.map((name) => {
                          const active = selectedPax.some(
                            (p) => p.toLowerCase() === name.toLowerCase()
                          );
                          const alreadyAdded = paxAttendance.some(
                            (p: any) =>
                              stripAt(p.name).toLowerCase() === name.toLowerCase()
                          );
                          return (
                            <button
                              key={name}
                              type="button"
                              onClick={() => {
                                if (!alreadyAdded) toggleSelectedPax(name);
                              }}
                              disabled={alreadyAdded}
                              className={`px-2 py-1.5 rounded-md text-xs text-left border transition-colors ${
                                alreadyAdded
                                  ? "bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed"
                                  : active
                                  ? "bg-blue-600 text-white border-blue-500"
                                  : "bg-slate-700/60 text-slate-200 border-slate-600 hover:bg-slate-600/60"
                              }`}
                            >
                              {name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={addSelectedPax}
                        disabled={selectedPax.length === 0}
                        className="flex-1 bg-blue-600 text-white font-semibold py-2 px-3 rounded-md hover:bg-blue-700 disabled:bg-slate-600"
                      >
                        Add PAX
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedPax([]);
                          setIsMultiAddOpen(false);
                        }}
                        className="flex-1 bg-slate-700 text-white font-semibold py-2 px-3 rounded-md hover:bg-slate-600"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                <div className="space-y-2 pr-2">
                  {(() => {
                    const used = new Set(
                      paxAttendance
                        .map((p: any) => stripAt(p.name).toLowerCase())
                        .filter(Boolean)
                    );
                    return paxAttendance.map((pax: any) => (
                      <PaxRowStandard
                        key={pax.id}
                        pax={pax}
                        updatePax={updatePax}
                        removePax={removePax}
                        paxList={paxList}
                        usedNames={used}
                      />
                    ));
                  })()}
                </div>

                <button
                  onClick={addPax}
                  className="text-sm text-red-400 hover:text-red-300 mt-2 flex items-center gap-1"
                >
                  <PlusCircleIcon /> Add Individual PAX
                </button>
              </>
            ) : (
              <div className="space-y-5">
                {/* RUN */}
                <div className="bg-slate-900/40 border border-slate-700 rounded-md p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-bold text-slate-200">Run</div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setJpRunSelected(
                          paxList.filter((n) => usedJpRunSet.has(n.toLowerCase()))
                        );
                        setIsJpRunMultiAddOpen(true);
                      }}
                      className="text-sm text-slate-300 hover:text-white flex items-center gap-1"
                    >
                      <PlusCircleIcon /> Quick Add Multiple Runners
                    </button>
                  </div>

                  {isJpRunMultiAddOpen && (
                    <div className="mt-2 rounded-md border border-slate-700 bg-slate-900/40 p-3 space-y-3">
                      <div className="text-xs text-slate-400 flex items-center justify-between">
                        <span>Select multiple PAX</span>
                        <span>Selected: {jpRunSelected.length}</span>
                      </div>
                      <div className="max-h-48 overflow-y-auto">
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {paxList.map((name) => {
                            const active = jpRunSelected.some(
                              (p) => p.toLowerCase() === name.toLowerCase()
                            );
                            return (
                              <button
                                key={name}
                                type="button"
                                onClick={() => toggleSelectedJpRun(name)}
                                className={`px-2 py-1.5 rounded-md text-xs text-left border transition-colors ${
                                  active
                                    ? "bg-blue-600 text-white border-blue-500"
                                    : "bg-slate-700/60 text-slate-200 border-slate-600 hover:bg-slate-600/60"
                                }`}
                              >
                                {name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={addSelectedJpRun}
                          disabled={jpRunSelected.length === 0}
                          className="flex-1 bg-blue-600 text-white font-semibold py-2 px-3 rounded-md hover:bg-blue-700 disabled:bg-slate-600"
                        >
                          Add Runners
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setJpRunSelected([]);
                            setIsJpRunMultiAddOpen(false);
                          }}
                          className="flex-1 bg-slate-700 text-white font-semibold py-2 px-3 rounded-md hover:bg-slate-600"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2 pr-2">
                    {jpRunPax.map((p) => (
                      <JpPaxRowRunRuck
                        key={p.id}
                        pax={p}
                        updatePax={updateJpRun}
                        removePax={removeJpRun}
                        paxList={paxList}
                        usedNames={usedJpRunNames}
                      />
                    ))}
                  </div>
                  <button
                    onClick={addJpRun}
                    className="text-sm text-red-400 hover:text-red-300 mt-2 flex items-center gap-1"
                  >
                    <PlusCircleIcon /> Add Individual Run PAX
                  </button>
                </div>

                {/* RUCK */}
                <div className="bg-slate-900/40 border border-slate-700 rounded-md p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-bold text-slate-200">Ruck</div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setJpRuckSelected(
                          paxList.filter((n) => usedJpRuckSet.has(n.toLowerCase()))
                        );
                        setIsJpRuckMultiAddOpen(true);
                      }}
                      className="text-sm text-slate-300 hover:text-white flex items-center gap-1"
                    >
                      <PlusCircleIcon /> Quick Add Multiple Ruckers
                    </button>
                  </div>

                  {isJpRuckMultiAddOpen && (
                    <div className="mt-2 rounded-md border border-slate-700 bg-slate-900/40 p-3 space-y-3">
                      <div className="text-xs text-slate-400 flex items-center justify-between">
                        <span>Select multiple PAX</span>
                        <span>Selected: {jpRuckSelected.length}</span>
                      </div>
                      <div className="max-h-48 overflow-y-auto">
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {paxList.map((name) => {
                            const active = jpRuckSelected.some(
                              (p) => p.toLowerCase() === name.toLowerCase()
                            );
                            return (
                              <button
                                key={name}
                                type="button"
                                onClick={() => toggleSelectedJpRuck(name)}
                                className={`px-2 py-1.5 rounded-md text-xs text-left border transition-colors ${
                                  active
                                    ? "bg-blue-600 text-white border-blue-500"
                                    : "bg-slate-700/60 text-slate-200 border-slate-600 hover:bg-slate-600/60"
                                }`}
                              >
                                {name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={addSelectedJpRuck}
                          disabled={jpRuckSelected.length === 0}
                          className="flex-1 bg-blue-600 text-white font-semibold py-2 px-3 rounded-md hover:bg-blue-700 disabled:bg-slate-600"
                        >
                          Add Ruckers
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setJpRuckSelected([]);
                            setIsJpRuckMultiAddOpen(false);
                          }}
                          className="flex-1 bg-slate-700 text-white font-semibold py-2 px-3 rounded-md hover:bg-slate-600"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2 pr-2">
                    {jpRuckPax.map((p) => (
                      <JpPaxRowRunRuck
                        key={p.id}
                        pax={p}
                        updatePax={updateJpRuck}
                        removePax={removeJpRuck}
                        paxList={paxList}
                        usedNames={usedJpRuckNames}
                      />
                    ))}
                  </div>
                  <button
                    onClick={addJpRuck}
                    className="text-sm text-red-400 hover:text-red-300 mt-2 flex items-center gap-1"
                  >
                    <PlusCircleIcon /> Add Individual Ruck PAX
                  </button>
                </div>

                {/* MPC */}
                <div className="bg-slate-900/40 border border-slate-700 rounded-md p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-bold text-slate-200">
                      MPC{" "}
                      <span className="text-xs text-slate-400 font-normal">
                        (Monthly PAX Challenge)
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setJpMpcSelected(
                          paxList.filter((n) => usedJpMpcSet.has(n.toLowerCase()))
                        );
                        setIsJpMpcMultiAddOpen(true);
                      }}
                      className="text-sm text-slate-300 hover:text-white flex items-center gap-1"
                    >
                      <PlusCircleIcon /> Quick Add Multiple MPC
                    </button>
                  </div>

                  {isJpMpcMultiAddOpen && (
                    <div className="mt-2 rounded-md border border-slate-700 bg-slate-900/40 p-3 space-y-3">
                      <div className="text-xs text-slate-400 flex items-center justify-between">
                        <span>Select multiple PAX</span>
                        <span>Selected: {jpMpcSelected.length}</span>
                      </div>
                      <div className="max-h-48 overflow-y-auto">
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {paxList.map((name) => {
                            const active = jpMpcSelected.some(
                              (p) => p.toLowerCase() === name.toLowerCase()
                            );
                            return (
                              <button
                                key={name}
                                type="button"
                                onClick={() => toggleSelectedJpMpc(name)}
                                className={`px-2 py-1.5 rounded-md text-xs text-left border transition-colors ${
                                  active
                                    ? "bg-blue-600 text-white border-blue-500"
                                    : "bg-slate-700/60 text-slate-200 border-slate-600 hover:bg-slate-600/60"
                                }`}
                              >
                                {name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={addSelectedJpMpc}
                          disabled={jpMpcSelected.length === 0}
                          className="flex-1 bg-blue-600 text-white font-semibold py-2 px-3 rounded-md hover:bg-blue-700 disabled:bg-slate-600"
                        >
                          Add MPC
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setJpMpcSelected([]);
                            setIsJpMpcMultiAddOpen(false);
                          }}
                          className="flex-1 bg-slate-700 text-white font-semibold py-2 px-3 rounded-md hover:bg-slate-600"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2 pr-2">
                    {jpMpcPax.map((p) => (
                      <JpPaxRowMpc
                        key={p.id}
                        pax={p}
                        updatePax={updateJpMpc}
                        removePax={removeJpMpc}
                        paxList={paxList}
                        usedNames={usedJpMpcNames}
                      />
                    ))}
                  </div>
                  <button
                    onClick={addJpMpc}
                    className="text-sm text-red-400 hover:text-red-300 mt-2 flex items-center gap-1"
                  >
                    <PlusCircleIcon /> Add Individual MPC PAX
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* WARMUP + THANG (hidden for Jurassic Park) */}
          {!isJP && (
            <div className="pt-4 border-t border-slate-700/60 space-y-4">
              {/* WARMUP */}
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <h3 className="text-sm font-bold text-slate-300">Warmup</h3>

                  <button
                    type="button"
                    onClick={() => setIsWarmupDescOpen((v) => !v)}
                    className="flex items-center gap-0 px-1 py-1 rounded transition-colors text-xs text-slate-300 hover:text-sky-400 whitespace-nowrap"
                    title="Add warmup description (optional)"
                  >
                    <span className="text-base leading-none">📝</span>
                    <span className="leading-none">
                      {compactOptionalString(warmupDescription)
                        ? "Edit Description"
                        : "Add Description"}
                    </span>
                  </button>
                </div>

                {isWarmupDescOpen && (
                  <div className="bg-slate-800/60 border border-slate-700 rounded-md p-2 mb-2">
                    <textarea
                      rows={2}
                      value={warmupDescription}
                      onChange={(e) => setWarmupDescription(e.target.value)}
                      placeholder="Optional warmup description (e.g., mosey to the flag, dynamic stretches, etc.)"
                      className="w-full bg-slate-900 border border-slate-700 rounded-md py-2 px-3 text-white text-sm"
                      onKeyDown={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                    />
                    <div className="flex justify-end mt-2">
                      <button
                        type="button"
                        onClick={() => setIsWarmupDescOpen(false)}
                        className="text-xs text-slate-300 hover:text-white"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                )}

                {compactOptionalString(warmupDescription) && !isWarmupDescOpen && (
                  <button
                    type="button"
                    onClick={() => setIsWarmupDescOpen(true)}
                    className="w-full text-left bg-slate-800/60 border border-slate-700 rounded-md px-3 py-2 mb-2 text-sm text-slate-200 hover:border-sky-500/60"
                    title="Click to edit warmup description"
                  >
                    <span className="text-slate-400 mr-2">📝</span>
                    {warmupDescription}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setIsWarmupMultiOpen((v) => !v)}
                  className="text-sm text-slate-300 hover:text-white mt-2 flex items-center gap-1"
                >
                  <PlusCircleIcon /> Quick Add Multiple Exercises
                </button>

                {isWarmupMultiOpen && (
                  <div className="mt-2 rounded-md border border-slate-700 bg-slate-900/40 p-3 space-y-3">
                    <div className="text-xs text-slate-400 flex items-center justify-between">
                      <span>Select multiple exercises</span>
                      <span>Selected: {warmupSelected.length}</span>
                    </div>
                    <div className="max-h-48 overflow-y-auto">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {WARMUP_EXERCISES.map((name) => {
                          const active = warmupSelected.includes(name);
                          return (
                            <button
                              key={name}
                              type="button"
                              onClick={() => toggleWarmupSelected(name)}
                              className={`px-2 py-1.5 rounded-md text-xs text-left border transition-colors ${
                                active
                                  ? "bg-blue-600 text-white border-blue-500"
                                  : "bg-slate-700/60 text-slate-200 border-slate-600 hover:bg-slate-600/60"
                              }`}
                            >
                              {name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={addSelectedWarmup}
                        disabled={warmupSelected.length === 0}
                        className="flex-1 bg-blue-600 text-white font-semibold py-2 px-3 rounded-md hover:bg-blue-700 disabled:bg-slate-600"
                      >
                        Add Exercises
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setWarmupSelected([]);
                          setIsWarmupMultiOpen(false);
                        }}
                        className="flex-1 bg-slate-700 text-white font-semibold py-2 px-3 rounded-md hover:bg-slate-600"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                <DndContext
                  sensors={sensors}
                  modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                  onDragEnd={handleWarmupDragEnd}
                >
                  <SortableContext
                    items={warmup.map((ex: any) => ex.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-2">
                      {warmup.map((ex: any) => (
                        <ExerciseRow
                          key={ex.id}
                          exercise={ex}
                          updateExercise={updateWarmupExercise as any}
                          removeExercise={removeWarmupExercise}
                          exerciseList={WARMUP_EXERCISES}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>

                <button
                  onClick={addWarmupExercise}
                  className="text-sm text-red-400 hover:text-red-300 mt-2 flex items-center gap-1"
                >
                  <PlusCircleIcon /> Add Individual Exercise
                </button>
              </div>

              {/* THE THANG */}
              <div>
                <h3 className="text-sm font-bold text-slate-300 mb-2">The Thang</h3>

                <DndContext
                  sensors={sensors}
                  modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                  onDragEnd={handleThangRoundsDragEnd}
                >
                  <SortableContext
                    items={theThang.map((r: any) => r.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-4">
                      {theThang.map((round: any) => (
                        <SortableRoundCard key={round.id} id={round.id}>
                          <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700">
                            <div className="flex justify-between items-center mb-2 gap-2">
                              <div>
                                <h4 className="font-bold text-red-400">{round.name}</h4>

                                <div className="flex items-center gap-1 mt-1">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggleDescPanel(round.id);
                                    }}
                                    className="flex items-center gap-0 px-1 py-1 rounded transition-colors text-xs text-slate-300 hover:text-sky-400 whitespace-nowrap"
                                    title="Add round description (optional)"
                                  >
                                    <span className="text-base leading-none">📝</span>
                                    <span className="leading-none">
                                      {compactOptionalString(round.description)
                                        ? "Edit Description"
                                        : "Add Description"}
                                    </span>
                                  </button>
                                </div>

                                {round.timerSeconds && round.timerSeconds > 0 && (
                                  <div className="text-xs text-slate-300 italic mt-1">
                                    ⏱️ {Math.floor(round.timerSeconds / 60)}m{" "}
                                    {round.timerSeconds % 60}s{" "}
                                    {round.timerRepeatCount && round.timerRepeatCount > 1
                                      ? `× ${round.timerRepeatCount}`
                                      : ""}
                                  </div>
                                )}
                              </div>

                              <div className="flex items-center gap-2">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    copyRound(round.id);
                                  }}
                                  className="text-slate-400 hover:text-slate-200 flex items-center gap-1 text-xs"
                                >
                                  <ClipboardCopyIcon /> Copy Round
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    removeRound(round.id);
                                  }}
                                  className="text-slate-500 hover:text-red-500"
                                >
                                  <TrashIcon />
                                </button>
                              </div>
                            </div>

                            {openDescRounds[round.id] && (
                              <div
                                className="bg-slate-800/60 border border-slate-700 rounded-md p-2 mb-2"
                                onMouseDown={(e) => e.stopPropagation()}
                                onPointerDown={(e) => e.stopPropagation()}
                              >
                                <textarea
                                  rows={2}
                                  value={round.description || ""}
                                  onChange={(e) =>
                                    updateRoundDescription(round.id, e.target.value)
                                  }
                                  placeholder="Optional round description (e.g., partner up, rotate stations, lap instructions, etc.)"
                                  className="w-full bg-slate-900 border border-slate-700 rounded-md py-2 px-3 text-white text-sm"
                                  onKeyDown={(e) => e.stopPropagation()}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onPointerDown={(e) => e.stopPropagation()}
                                />
                                <div className="flex justify-end mt-2">
                                  <button
                                    type="button"
                                    onClick={() => toggleDescPanel(round.id)}
                                    className="text-xs text-slate-300 hover:text-white"
                                  >
                                    Close
                                  </button>
                                </div>
                              </div>
                            )}

                            {compactOptionalString(round.description) &&
                              !openDescRounds[round.id] && (
                                <button
                                  type="button"
                                  onClick={() => toggleDescPanel(round.id)}
                                  className="w-full text-left bg-slate-800/60 border border-slate-700 rounded-md px-3 py-2 mb-2 text-sm text-slate-200 hover:border-sky-500/60"
                                  title="Click to edit description"
                                >
                                  <span className="text-slate-400 mr-2">📝</span>
                                  {round.description}
                                </button>
                              )}

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setThangMultiOpen((prev) => ({
                                  ...prev,
                                  [round.id]: !prev[round.id],
                                }));
                              }}
                              className="text-xs text-slate-300 hover:text-white mt-2 flex items-center gap-1"
                            >
                              <PlusCircleIcon /> Quick Add Multiple Exercises
                            </button>

                            {thangMultiOpen[round.id] && (
                              <div
                                className="mt-2 rounded-md border border-slate-700 bg-slate-900/40 p-3 space-y-3"
                                onMouseDown={(e) => e.stopPropagation()}
                                onPointerDown={(e) => e.stopPropagation()}
                              >
                                <div className="text-xs text-slate-400 flex items-center justify-between">
                                  <span>Select multiple exercises</span>
                                  <span>Selected: {(thangSelected[round.id] || []).length}</span>
                                </div>
                                <div className="max-h-48 overflow-y-auto">
                                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                    {THANG_EXERCISES.map((name) => {
                                      const selected = thangSelected[round.id] || [];
                                      const active = selected.includes(name);
                                      return (
                                        <button
                                          key={`${round.id}-${name}`}
                                          type="button"
                                          onClick={() => toggleThangSelected(round.id, name)}
                                          className={`px-2 py-1.5 rounded-md text-xs text-left border transition-colors ${
                                            active
                                              ? "bg-blue-600 text-white border-blue-500"
                                              : "bg-slate-700/60 text-slate-200 border-slate-600 hover:bg-slate-600/60"
                                          }`}
                                        >
                                          {name}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    onClick={() => addSelectedToRound(round.id)}
                                    disabled={!thangSelected[round.id]?.length}
                                    className="flex-1 bg-blue-600 text-white font-semibold py-2 px-3 rounded-md hover:bg-blue-700 disabled:bg-slate-600"
                                  >
                                    Add Exercises
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setThangSelected((prev) => ({ ...prev, [round.id]: [] }));
                                      setThangMultiOpen((prev) => ({ ...prev, [round.id]: false }));
                                    }}
                                    className="flex-1 bg-slate-700 text-white font-semibold py-2 px-3 rounded-md hover:bg-slate-600"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}

                            <DndContext
                              sensors={sensors}
                              modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                              onDragEnd={(event) => handleRoundDragEnd(round.id, event)}
                            >
                              <SortableContext
                                items={(round.exercises || []).map((ex: any) => ex.id)}
                                strategy={verticalListSortingStrategy}
                              >
                                <div className="space-y-2">
                                  {(round.exercises || []).map((ex: any) => (
                                    <ExerciseRow
                                      key={ex.id}
                                      exercise={ex}
                                      updateExercise={(exId: any, field: any, value: any) =>
                                        updateExerciseInRound(round.id, exId, field, value)
                                      }
                                      removeExercise={(exId: any) =>
                                        removeExerciseFromRound(round.id, exId)
                                      }
                                      exerciseList={THANG_EXERCISES}
                                    />
                                  ))}
                                </div>
                              </SortableContext>
                            </DndContext>

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                addExerciseToRound(round.id);
                              }}
                              className="text-xs text-red-400 hover:text-red-300 mt-2 flex items-center gap-1"
                            >
                              <PlusCircleIcon /> Add Individual Exercise
                            </button>
                          </div>
                        </SortableRoundCard>
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>

                <button
                  onClick={addRound}
                  className="text-sm text-red-400 hover:text-red-300 mt-3 flex items-center gap-1 font-bold"
                >
                  <PlusCircleIcon /> Add Next Round
                </button>
              </div>
            </div>
          )}

          {/* ANNOUNCEMENTS */}
          <div className="pt-4 border-t border-slate-700/60">
            <label className="block text-sm font-bold text-slate-300 mb-2">
              Announcements
            </label>
            <textarea
              rows={2}
              value={announcements}
              onChange={(e) => setAnnouncements(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-white text-sm"
            />
          </div>

          {/* TAPS */}
          <div className="pt-4 border-t border-slate-700/60">
            <label className="block text-sm font-bold text-slate-300 mb-2">
              TAPS
            </label>
            <textarea
              rows={2}
              value={taps}
              onChange={(e) => setTaps(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-white text-sm"
            />
          </div>

          {/* GENERATE MODE */}
          <div className="pt-4 border-t border-slate-700/60 space-y-3">
            {!forceNoAiAo && (
              <>
                <div className="text-sm font-bold text-slate-300">
                  Include AI Written Commentary?{" "}
                  <span className="text-red-400">*</span>
                </div>
                {!generateMode && (
                  <div className="text-xs text-slate-400">Must choose one.</div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setGenerateMode("NO_AI")}
                    className={`w-full rounded-md border px-3 py-3 text-center transition-colors ${
                      generateMode === "NO_AI"
                        ? "bg-blue-600 text-white border-blue-500"
                        : "bg-slate-700/60 text-slate-200 border-slate-600 hover:bg-slate-600/60"
                    }`}
                  >
                    <div className="text-sm sm:text-base font-semibold">No</div>
                    <div className="text-xs sm:text-sm opacity-80">
                      (I'll write my own)
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setGenerateMode("AI")}
                    className={`w-full rounded-md border px-3 py-3 text-center transition-colors ${
                      generateMode === "AI"
                        ? "bg-red-600 text-white border-red-500"
                        : "bg-slate-700/60 text-slate-200 border-slate-600 hover:bg-slate-600/60"
                    }`}
                  >
                    <div className="text-sm sm:text-base font-semibold">Yes</div>
                    <div className="text-xs sm:text-sm opacity-80">
                      (Release the bots)
                    </div>
                  </button>
                </div>
                {generateMode === "AI" && <div className="h-px bg-slate-700/70" />}
                {generateMode === "AI" && (
                  <div className="space-y-2">
                    <div className="text-sm font-bold text-slate-300">
                      AI Options
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { key: "gratitude", label: "Appreciation" },
                        { key: "missionValues", label: "F3 Mission/Values" },
                        { key: "funny", label: "Funny" },
                        { key: "highEnergy", label: "High-Energy" },
                        { key: "ironSharpensIron", label: "Iron Sharpens Iron" },
                        { key: "minimalEmojis", label: "Minimal Emojis" },
                      ].map(({ key, label }) => (
                        <label
                          key={key}
                          className="flex items-center gap-2 text-xs text-slate-200 bg-slate-700/60 border border-slate-600 rounded-md px-2 py-2"
                        >
                          <input
                            type="checkbox"
                            checked={(aiOptions as any)[key]}
                            onChange={() =>
                              setAiOptions((prev) => ({
                                ...prev,
                                [key]: !(prev as any)[key],
                              }))
                            }
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {/* NOTES (AI only) */}
                {generateMode === "AI" && (
                  <div>
                    <label className="block text-sm font-bold text-slate-300 mb-2">
                      Notes for AI
                    </label>
                    <textarea
                      rows={3}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-white text-xs sm:text-sm"
                      placeholder="Add notes such as AQ, BQ, mood, weather, tone to use, etc."
                    />
                  </div>
                )}
              </>
            )}
            <button
              onClick={() => (generateMode === "AI" ? handleGenerateAI() : handleFormatNoAI())}
              disabled={!generateMode || (generateMode === "AI" && isLoading) || !qName}
              className={`w-full text-white font-bold py-3 px-4 rounded-md transition-colors disabled:bg-slate-600 ${
                generateMode === "AI" ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              {generateMode === "AI" && isLoading ? "Generating…" : "Generate Backblast"}
            </button>
            {!forceNoAiAo && generateMode === "AI" && !isLoading && (
              <div className="text-xs text-slate-400 mt-2">
                Gemini will try for up to 60 seconds before falling back to the formatted
                version.
              </div>
            )}
          </div>

          {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
        </div>

        {/* ---------------- OUTPUT PANEL ---------------- */}
        <div
          ref={outputRef}
          className="bg-slate-800/50 rounded-lg shadow-2xl p-6 border border-slate-700 flex flex-col"
        >
          <div className="mb-4">
            <div className="flex items-center gap-2">
              <h3 className="text-2xl sm:text-3xl font-display text-white tracking-wide">
                Generated Backblast
              </h3>
              {outputMode && (
                <span
                  className={`text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-full ${
                    outputMode === "AI"
                      ? "bg-red-600/20 text-red-200 border border-red-500/40"
                      : "bg-blue-600/20 text-blue-200 border border-blue-500/40"
                  }`}
                >
                  {outputMode === "AI" ? "AI" : "No AI"}
                </span>
              )}
            </div>
            {outputLabel && (
              <div className="text-xs text-slate-400 mt-1">
                {outputLabel} {outputTimestamp ? `• ${outputTimestamp}` : ""}
              </div>
            )}
          </div>

          {isLoading && (
            <div className="mb-3 text-sm text-slate-300">
              <div className="flex items-center justify-between gap-2">
                <span>{loadingStatus || "Generating…"}</span>
                <span className="text-slate-400">{loadingSeconds}s</span>
              </div>
              {loadingSeconds >= 12 && (
                <div className="text-slate-400 mt-1">
                  Still working. If this exceeds ~60 seconds, Gemini is likely
                  overloaded.
                </div>
              )}
            </div>
          )}

          <div className="bg-slate-900 p-4 rounded-md flex-grow min-h-[300px] whitespace-pre-wrap text-slate-300 font-mono overflow-y-auto">
            {generatedText}
          </div>

          {generatedText && (
            <div className="mt-4">
              <button
                onClick={handleCopyAndPost}
                className="w-full bg-green-600 text-white font-bold py-2 px-4 rounded-md hover:bg-green-700 flex items-center justify-center gap-2"
              >
                <ExternalLinkIcon />
                {copySuccess ? "Copied! Opening BAND..." : "Copy & Start Post in BAND"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};





