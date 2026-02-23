import React, { useState, useEffect, useRef, useMemo } from "react";
import { createId } from "../utils/ids";
import { db } from "../firebase";
import {
  collection,
  doc,
  onSnapshot,
  addDoc,
  setDoc,
  deleteDoc,
} from "firebase/firestore";
import type { PlannerData, Exercise, WorkoutRound, SavedPlan } from "../types";
import {
  ClipboardListIcon,
  SunIcon,
  ClipboardCopyIcon,
  TrashIcon,
  PlusCircleIcon,
  FireIcon,
  FolderOpenIcon,
  PencilIcon,
  EyeIcon,
} from "./icons";
import {
  PAX_LIST,
  WARMUP_EXERCISES,
  THANG_EXERCISES,
  getPaxListByAo,
} from "../constants";
import { usePaxDirectoryVersion } from "../pax/PaxDirectoryContext";
import { RoundTimerControl } from "./RoundTimerControl";

/* AO Context */
import { useAo } from "../ao/AoContext";
import { AoSelector } from "../ao/AoSelector";

/* ---------------- Drag & Drop imports ---------------- */
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/* -------------------------------------------------
   AO helpers: normalize + canonical key
------------------------------------------------- */
const normalizeAoName = (raw: any): string => {
  if (!raw) return "";

  if (typeof raw === "object") {
    const name =
      raw.displayName ??
      raw.shortName ??
      raw.whereName ??
      raw.name ??
      raw.label ??
      raw.title ??
      raw.value ??
      raw.ao ??
      raw.aoName ??
      raw.currentAo ??
      raw.selectedAo ??
      raw.location ??
      raw.id;

    if (typeof name === "string") return name.trim();
    return String(name ?? "").trim();
  }

  if (typeof raw === "string") return raw.trim();
  return String(raw).trim();
};

/**
 * Defensive display name extractor (legacy-safe).
 * NOTE: We will still prefer activeAo.shortName for the UI/storage to match other views.
 */
const getAoDisplayName = (aoCtx: any): string => {
  if (!aoCtx) return "";

  const active = aoCtx?.activeAo;

  if (active && typeof active === "object") {
    const direct =
      active.displayName ??
      active.shortName ??
      active.name ??
      active.label ??
      active.title ??
      active.id;

    const v = normalizeAoName(direct);
    if (v) return v;
  }

  const candidates = [
    aoCtx?.activeAoName,
    aoCtx?.selectedAoName,
    aoCtx?.currentAoName,
    aoCtx?.aoName,
    aoCtx?.location,
    aoCtx?.selectedAo,
    aoCtx?.currentAo,
    aoCtx?.ao,
    aoCtx?.activeAo,
    aoCtx?.activeAoLabel,
    aoCtx?.selectedAoLabel,
  ];

  for (const c of candidates) {
    const v = normalizeAoName(c);
    if (v) return v;
  }

  return "";
};

/**
 * UI label normalization:
 * - Ensures "Compass" instead of "compass"
 * - Collapses common variants like "Compass at Lost Creek" to "Compass"
 */
const formatAoShortLabel = (raw: string): string => {
  const t = String(raw || "").trim();
  if (!t) return "";

  const low = t.toLowerCase();

  // Standardize known AOs
  if (low.includes("compass")) return "Compass";
  if (low.includes("colosseum")) return "Colosseum";
  if (low.includes("jurassic")) return "Jurassic Park";
  if (low.includes("the hill") || low === "thehill") return "The Hill";
  if (low.includes("the shadows") || low === "theshadows") return "Shadows";
  if (low.includes("gator bay") || low === "gatorbay") return "Gator Bay";
  if (low.includes("phoenix rising") || low === "phoenixrising")
    return "Phoenix Rising";

  // Title-case fallback (simple, readable)
  return t
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
};

/**
 * Canonical key for getPaxListByAo.
 * Prefer AO id (lowercase) when available; fall back to name mapping.
 */
const canonicalAoKey = (args: { id?: string; name?: string }): string => {
  const id = (args.id || "").trim().toLowerCase();
  if (id) return id;

  const n = (args.name || "").trim().toLowerCase();
  if (n.includes("compass")) return "compass";
  if (n.includes("colosseum")) return "colosseum";
  if (n.includes("jurassic")) return "jurassicpark";
  if (n.includes("the hill") || n === "thehill") return "thehill";
  if (n.includes("the shadows") || n === "theshadows") return "theshadows";
  if (n.includes("gator bay") || n === "gatorbay") return "gatorbay";
  if (n.includes("phoenix rising") || n === "phoenixrising")
    return "phoenixrising";

  return (args.name || "").trim();
};

/* -------------------------------------------------
   Helper: Next AO date (T/Th/Sat pattern)
------------------------------------------------- */
const getUpcomingWorkoutDetails = () => {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  let daysToAdd = 0;

  // Sunday, Monday -> Tuesday
  if (dayOfWeek === 0 || dayOfWeek === 1) {
    daysToAdd = (2 - dayOfWeek + 7) % 7;
  }
  // Tuesday, Wednesday -> Thursday
  else if (dayOfWeek === 2 || dayOfWeek === 3) {
    daysToAdd = (4 - dayOfWeek + 7) % 7;
  }
  // Thursday, Friday -> Saturday
  else if (dayOfWeek === 4 || dayOfWeek === 5) {
    daysToAdd = (6 - dayOfWeek + 7) % 7;
  }
  // Saturday -> next Tuesday
  else {
    daysToAdd = 3;
  }

  const workoutDate = new Date();
  workoutDate.setDate(now.getDate() + daysToAdd);

  const dateString = `${workoutDate.getMonth() + 1}/${workoutDate.getDate()}/${String(
    workoutDate.getFullYear()
  ).slice(-2)}`;

  return { date: dateString };
};

/* -------------------------------------------------
   Helper: Renumber round names based on position
------------------------------------------------- */
const renumberRounds = (rounds: WorkoutRound[]) =>
  rounds.map((r, idx) => ({ ...r, name: `Round ${idx + 1}` }));

/* -------------------------------------------------
   Helper: compact optional strings for storage
------------------------------------------------- */
const compactOptionalString = (v?: string) => {
  const t = (v ?? "").trim();
  return t.length ? t : undefined;
};

/* -------------------------------------------------
   Helper: Remove undefined values before sending to Firestore
   (Firestore rejects undefined anywhere in the payload)
------------------------------------------------- */
const stripUndefined = (obj: any): any => {
  if (Array.isArray(obj)) return obj.map(stripUndefined);
  if (obj && typeof obj === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) continue;
      out[k] = stripUndefined(v);
    }
    return out;
  }
  return obj;
};

/* -------------------------------------------------
   Reusable ExerciseRow
------------------------------------------------- */
const ExerciseRow: React.FC<{
  exercise: Exercise;
  updateExercise: (id: string, field: keyof Exercise, value: string) => void;
  removeExercise: (id: string) => void;
  exerciseList: string[];
  isViewMode: boolean;
}> = ({ exercise, updateExercise, removeExercise, exerciseList, isViewMode }) => {
  const [isCustom, setIsCustom] = useState(
    !exerciseList.includes(exercise.name) && exercise.name !== ""
  );

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
    <div className="flex items-center gap-2 bg-slate-700/50 p-2 rounded-md">
      {isCustom ? (
        <input
          type="text"
          value={exercise.name}
          onChange={(e) => updateExercise(exercise.id, "name", e.target.value)}
          placeholder="Custom Exercise"
          className="flex-grow bg-slate-800 border border-slate-600 rounded-md py-1 px-2 text-white text-xs sm:text-sm disabled:bg-slate-700"
          disabled={isViewMode}
          onKeyDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        />
      ) : (
        <select
          value={exercise.name}
          onChange={handleSelectChange}
          className="flex-grow bg-slate-800 border border-slate-600 rounded-md py-1 px-2 text-white text-xs sm:text-sm disabled:bg-slate-700"
          disabled={isViewMode}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <option value="" disabled>
            Select Exercise
          </option>

          {/* IMPORTANT: key uses name+index so duplicate names in constants won't throw React key warnings */}
          {exerciseList.map((name, idx) => (
            <option key={`${name}-${idx}`} value={name}>
              {name}
            </option>
          ))}

          <option value="custom">-- Custom --</option>
        </select>
      )}

      <input
        type="text"
        value={exercise.reps || ""}
        onChange={(e) => updateExercise(exercise.id, "reps", e.target.value)}
        placeholder="Details (Reps, IC/On Q)"
        className="w-28 sm:w-40 bg-slate-800 border border-slate-600 rounded-md py-1 px-2 text-white text-xs sm:text-sm disabled:bg-slate-700"
        disabled={isViewMode}
        onKeyDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      />

      <button
        onClick={() => removeExercise(exercise.id)}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className="text-slate-500 hover:text-red-500 disabled:hidden"
        disabled={isViewMode}
      >
        <TrashIcon />
      </button>
    </div>
  );
};

/* -------------------------------------------------
   Sortable wrapper for exercises (drag handle = entire row)
------------------------------------------------- */
const SortableExerciseRow: React.FC<{
  id: string;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ id, disabled, children }) => {
  if (disabled) return <div>{children}</div>;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    cursor: "grab",
    opacity: isDragging ? 0.8 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
};

/* -------------------------------------------------
   Sortable wrapper for rounds (drag handle = entire card)
------------------------------------------------- */
const SortableRoundCard: React.FC<{
  id: string;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ id, disabled, children }) => {
  if (disabled) return <div>{children}</div>;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    cursor: "grab",
    opacity: isDragging ? 0.85 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
};

interface WorkoutPlannerViewProps {
  onImportPlan: (plan: PlannerData) => void;
}

/* -------------------------------------------------
   QName selector (list is injected, can vary by AO/location)
------------------------------------------------- */
const QNameSelect: React.FC<{
  value?: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  paxList: string[];
}> = ({ value = "", onChange, disabled, paxList }) => {
  const [isCustomEditing, setIsCustomEditing] = useState(false);
  const [text, setText] = useState(value);

  const isCustomValue = value !== "" && !paxList.includes(value);

  const saveCustom = () => {
    const trimmed = text.trim();
    onChange(trimmed);
    setIsCustomEditing(false);
  };

  useEffect(() => {
    if (!isCustomEditing) setText(value);
  }, [value, isCustomEditing]);

  if (isCustomEditing) {
    return (
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={saveCustom}
        onKeyDown={(e) => e.key === "Enter" && saveCustom()}
        className="min-h-[44px] bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-white text-sm w-full"
        autoFocus
      />
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "custom") {
          setText(value);
          setIsCustomEditing(true);
        } else {
          onChange(v);
        }
      }}
      disabled={disabled}
      className="min-h-[44px] bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-white text-sm w-full disabled:bg-slate-700"
    >
      <option value="">Select Q</option>
      {isCustomValue && <option value={value}>{value}</option>}

      {/* IMPORTANT: key uses value+index so duplicates won't throw React key warnings */}
      {paxList.map((p, idx) => (
        <option key={`${p}-${idx}`} value={p}>
          {p}
        </option>
      ))}

      <option value="custom">-- Custom --</option>
    </select>
  );
};

/* -------------------------------------------------
   Timer State
------------------------------------------------- */
interface TimerState {
  activeRoundId: string | null;
  isRunning: boolean;
  remainingSeconds: number;
  remainingRepeats: number;
}

const defaultTimerState: TimerState = {
  activeRoundId: null,
  isRunning: false,
  remainingSeconds: 0,
  remainingRepeats: 0,
};

/* -------------------------------------------------
   Local augmentation: plans can carry AO/location metadata
------------------------------------------------- */
type SavedPlanWithAo = SavedPlan & { ao?: string };

/* -------------------------------------------------
   MAIN COMPONENT
------------------------------------------------- */
export const WorkoutPlannerView: React.FC<WorkoutPlannerViewProps> = ({
  onImportPlan,
}) => {
  /* AO / Location */
  const aoCtx = useAo() as any;

  const activeAo = aoCtx?.activeAo;

  // Prefer the same source as Pre-Blast: activeAo.shortName (e.g., "Compass")
  const uiAoShortNameRaw =
    (typeof activeAo === "object" ? activeAo?.shortName : undefined) ?? "";

  // Fallback (legacy-safe) if shortName isn't present for some reason
  const aoDisplayNameLegacy = getAoDisplayName(aoCtx);

  // Final, standardized AO label for UI + storage
  const aoShortLabel = useMemo(() => {
    const best = normalizeAoName(uiAoShortNameRaw) || normalizeAoName(aoDisplayNameLegacy);
    return formatAoShortLabel(best);
  }, [uiAoShortNameRaw, aoDisplayNameLegacy]);

  // ID helps canonical mapping (if available)
  const activeAoId =
    (typeof activeAo === "object" ? activeAo?.id : undefined) ??
    aoCtx?.activeAoId ??
    aoCtx?.selectedAoId ??
    aoCtx?.currentAoId ??
    "";

  const aoKey = canonicalAoKey({
    id: String(activeAoId || ""),
    name: aoShortLabel,
  });

  // Q list varies by location
  const paxDirectoryVersion = usePaxDirectoryVersion();
  const paxListForThisAo = useMemo(() => {
    if (!aoKey) return PAX_LIST;
    const list = (getPaxListByAo as any)?.(aoKey);
    return Array.isArray(list) && list.length ? list : PAX_LIST;
  }, [aoKey, paxDirectoryVersion]);

  const [qName, setQName] = useState("");
  const [warmup, setWarmup] = useState<Exercise[]>([]);
  const [warmupDescription, setWarmupDescription] = useState<string>("");

  const [theThang, setTheThang] = useState<WorkoutRound[]>([
    {
      id: createId(),
      name: "Round 1",
      exercises: [],
      timerSeconds: undefined,
      timerRepeatCount: 1,
      description: undefined,
    },
  ]);

  /* ---------------- Drag sensors ---------------- */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  /* ---------------- Keep a ref of theThang for timer effect ---------------- */
  const theThangRef = useRef<WorkoutRound[]>(theThang);
  useEffect(() => {
    theThangRef.current = theThang;
  }, [theThang]);

  /* ---------------- Root ref for click-outside detection ---------------- */
  const plannerRef = useRef<HTMLDivElement | null>(null);

  /* ---------------- Timer panel open state ---------------- */
  const [openTimerRounds, setOpenTimerRounds] = useState<Record<string, boolean>>(
    {}
  );

  /* ---------------- Description panel open state ---------------- */
  const [openDescRounds, setOpenDescRounds] = useState<Record<string, boolean>>(
    {}
  );
  const [isWarmupDescOpen, setIsWarmupDescOpen] = useState(false);
  const [isWarmupMultiOpen, setIsWarmupMultiOpen] = useState(false);
  const [warmupSelected, setWarmupSelected] = useState<string[]>([]);
  const [thangMultiOpen, setThangMultiOpen] = useState<Record<string, boolean>>({});
  const [thangSelected, setThangSelected] = useState<Record<string, string[]>>({});

  /* ---------------- Single timer state ---------------- */
  const [timerState, setTimerState] = useState<TimerState>(defaultTimerState);

  const wakeLockRef = useRef<any>(null);
  const [isAwake, setIsAwakeState] = useState(false);

  const [isViewMode, setIsViewMode] = useState(false);
  const [savedPlans, setSavedPlans] = useState<SavedPlanWithAo[]>([]);
  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [planNameInput, setPlanNameInput] = useState("");
  const [currentPlanId, setCurrentPlanId] = useState<string | null>(null);
  const wipSaveTimeoutRef = useRef<number | null>(null);
  const wipPayloadRef = useRef<any>(null);

  /* ---------------- Load modal filters ---------------- */
  const [loadSearch, setLoadSearch] = useState("");
  const [loadQFilter, setLoadQFilter] = useState<string>("ALL");
  const [loadAoFilter, setLoadAoFilter] = useState<string>("ALL");
  const [showArchived, setShowArchived] = useState(false);

  /* ---------------- Firestore Plans Listener ---------------- */
  useEffect(() => {
    const plansCollectionRef = collection(db, "plans");

    const unsubscribe = onSnapshot(plansCollectionRef, (snapshot) => {
      const plans = snapshot.docs.map(
        (docSnap) => ({ id: docSnap.id, ...docSnap.data() } as SavedPlanWithAo)
      );
      setSavedPlans(plans);
    });

    const wipPlanRaw = localStorage.getItem("f3WipPlan");
    if (wipPlanRaw) {
      try {
        const data = JSON.parse(wipPlanRaw) as {
          id?: string;
          q?: string;
          warmup?: Exercise[];
          warmupDescription?: string;
          theThang?: WorkoutRound[];
          ao?: string;
        };

        setQName(data.q || "");
        setWarmup(data.warmup || []);
        setWarmupDescription(data.warmupDescription || "");

        setTheThang(
          renumberRounds(
            (data.theThang || []).map((r, idx) => ({
              ...r,
              description: (r as any).description ?? undefined,
              timerSeconds: r.timerSeconds ?? undefined,
              timerRepeatCount: r.timerRepeatCount ?? 1,
              id: r.id || `round-${idx}-${createId()}`,
            }))
          )
        );

        setCurrentPlanId(data.id && data.id !== "wip-id" ? data.id : null);
      } catch {
        // ignore corrupted wip
      }
    }

    return () => unsubscribe();
  }, []);

  /* ---------------- Auto-save WIP to localStorage ---------------- */
  useEffect(() => {
    wipPayloadRef.current = {
      id: currentPlanId || "wip-id",
      q: qName,
      // STANDARDIZE: store the short label (e.g., "Compass") to match other views
      ao: compactOptionalString(aoShortLabel),
      warmup,
      warmupDescription,
      theThang,
      name: "wip",
      createdAt: new Date().toISOString(),
    };
  }, [qName, warmup, warmupDescription, theThang, currentPlanId, aoShortLabel]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (wipSaveTimeoutRef.current) {
      clearTimeout(wipSaveTimeoutRef.current);
    }

    wipSaveTimeoutRef.current = window.setTimeout(() => {
      try {
        if (wipPayloadRef.current) {
          localStorage.setItem("f3WipPlan", JSON.stringify(wipPayloadRef.current));
        }
      } catch {
        // ignore storage errors
      }
    }, 700);

    return () => {
      if (wipSaveTimeoutRef.current) {
        clearTimeout(wipSaveTimeoutRef.current);
      }
    };
  }, [qName, warmup, warmupDescription, theThang, currentPlanId, aoShortLabel]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onUnload = () => {
      try {
        if (wipPayloadRef.current) {
          localStorage.setItem("f3WipPlan", JSON.stringify(wipPayloadRef.current));
        }
      } catch {
        // ignore storage errors
      }
    };

    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  /* ---------------- Save Modal Helpers ---------------- */
  const openSaveModal = () => {
    const existingPlan = currentPlanId
      ? savedPlans.find((p) => p.id === currentPlanId)
      : null;

    const upcomingWorkout = getUpcomingWorkoutDetails();
    const defaultName = `${qName.trim() || "Unnamed"} Q for ${upcomingWorkout.date}`;

    setPlanNameInput(existingPlan ? existingPlan.name : defaultName);
    setIsSaveModalOpen(true);
  };

  const handleConfirmSave = async () => {
    if (!planNameInput.trim()) {
      alert("Please enter a name for the plan.");
      return;
    }

    const sanitizedWarmup = warmup.map((ex) => ({
      id: ex.id,
      name: ex.name || "",
      reps: ex.reps || "",
      cadence: ex.cadence || "",
    }));

    const sanitizedTheThang = theThang.map((round) => {
      const sanitizedExercises = round.exercises.map((ex) => ({
        id: ex.id,
        name: ex.name || "",
        reps: ex.reps || "",
        cadence: ex.cadence || "",
      }));

      const cleanedRound: WorkoutRound = {
        id: round.id,
        name: round.name,
        exercises: sanitizedExercises,
        description: compactOptionalString((round as any).description),
        timerSeconds:
          typeof round.timerSeconds === "number" && !isNaN(round.timerSeconds)
            ? round.timerSeconds
            : undefined,
        timerRepeatCount:
          round.timerRepeatCount && round.timerRepeatCount > 0
            ? round.timerRepeatCount
            : 1,
      };

      return JSON.parse(JSON.stringify(cleanedRound)) as WorkoutRound;
    });

    const nowIso = new Date().toISOString();

    // STANDARDIZE: always save as short label (e.g., "Compass")
    const aoForStorage = compactOptionalString(aoShortLabel);

    // IMPORTANT CHANGE:
    // - Keep warmupDescription as a string ("" allowed) OR omit it safely
    // - Then stripUndefined() before write so Firestore never sees undefined
    const basePlanData: Omit<SavedPlan, "id" | "createdAt"> & {
      createdAt?: string;
      ao?: string;
    } = {
      name: planNameInput.trim(),
      q: qName,
      ao: aoForStorage,
      warmup: sanitizedWarmup,

      // This used to produce undefined (compactOptionalString), which breaks setDoc when merged.
      // We'll still compact it, but we will STRIP undefined before sending to Firestore.
      warmupDescription: compactOptionalString(warmupDescription),

      theThang: sanitizedTheThang,
      updatedAt: nowIso,
      isPinned: false,
      isArchived: false,
    };

    try {
      if (currentPlanId) {
        const existing = savedPlans.find((p) => p.id === currentPlanId);

        const patch: Partial<SavedPlanWithAo> = {
          ...(basePlanData as any),
          createdAt: (existing as any)?.createdAt || nowIso,
          isPinned: (existing as any)?.isPinned ?? false,
          isArchived: (existing as any)?.isArchived ?? false,
          updatedAt: nowIso,
        };

        const docRef = doc(db, "plans", currentPlanId);

        // CRITICAL FIX: remove undefined fields before merge write
        await setDoc(docRef, stripUndefined(patch) as any, { merge: true });
      } else {
        const planData: Omit<SavedPlanWithAo, "id"> = {
          ...(basePlanData as any),
          createdAt: nowIso,
        };

        const plansCollectionRef = collection(db, "plans");

        // CRITICAL FIX: remove undefined fields before create write
        const docRef = await addDoc(plansCollectionRef, stripUndefined(planData) as any);
        setCurrentPlanId(docRef.id);
      }

      setIsSaveModalOpen(false);
      setPlanNameInput("");
      alert(`Plan "${planNameInput}" saved successfully!`);
    } catch (error) {
      console.error("Error saving plan to Firebase:", error);
      alert("Could not save plan. Please try again.");
    }
  };

  /* ---------------- Load / Delete / Pin / Archive ---------------- */
  const handleLoadPlan = (plan: SavedPlanWithAo) => {
    setQName(plan.q);
    setWarmup(plan.warmup);

    // IMPORTANT: default to "" so state never becomes undefined
    setWarmupDescription((plan as any).warmupDescription ?? "");

    setTheThang(
      renumberRounds(
        (plan.theThang || []).map((r, idx) => ({
          ...r,
          description: (r as any).description ?? undefined,
          timerSeconds: r.timerSeconds ?? undefined,
          timerRepeatCount: r.timerRepeatCount ?? 1,
          id: r.id || `round-${idx}-${createId()}`,
        }))
      )
    );
    setCurrentPlanId(plan.id);
    setTimerState(defaultTimerState);
    setOpenTimerRounds({});
    setOpenDescRounds({});
    setIsWarmupDescOpen(false);
    setIsLoadModalOpen(false);
  };

  const handleDeletePlan = async (planId: string) => {
    if (!confirm("Are you sure you want to delete this plan?")) return;
    try {
      const docRef = doc(db, "plans", planId);
      await deleteDoc(docRef);
    } catch (error) {
      console.error("Error deleting plan from Firebase:", error);
      alert("Could not delete plan. Please try again.");
    }
  };

  const togglePinned = async (plan: SavedPlanWithAo) => {
    try {
      const docRef = doc(db, "plans", plan.id);
      await setDoc(
        docRef,
        { isPinned: !plan.isPinned, updatedAt: new Date().toISOString() } as any,
        { merge: true }
      );
    } catch (e) {
      console.error("Error toggling pinned:", e);
    }
  };

  const toggleArchived = async (plan: SavedPlanWithAo) => {
    try {
      const docRef = doc(db, "plans", plan.id);
      await setDoc(
        docRef,
        { isArchived: !plan.isArchived, updatedAt: new Date().toISOString() } as any,
        { merge: true }
      );
    } catch (e) {
      console.error("Error toggling archived:", e);
    }
  };

  const handleClearPlan = () => {
    setQName("");
    setWarmup([]);
    setWarmupDescription("");
    setTheThang([
      {
        id: createId(),
        name: "Round 1",
        exercises: [],
        timerSeconds: undefined,
        timerRepeatCount: 1,
        description: undefined,
      },
    ]);
    setCurrentPlanId(null);
    localStorage.removeItem("f3WipPlan");
    setOpenTimerRounds({});
    setOpenDescRounds({});
    setIsWarmupDescOpen(false);
    setTimerState(defaultTimerState);
  };

  /* ---------------- Derived lists for Load modal ---------------- */
  const uniqueQs = useMemo(() => {
    return Array.from(
      new Set(savedPlans.map((p) => (p.q || "").trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));
  }, [savedPlans]);

  const uniqueAos = useMemo(() => {
    return Array.from(
      new Set(savedPlans.map((p) => (p.ao || "").trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));
  }, [savedPlans]);

  const filteredPlans = useMemo(() => {
    const q = loadSearch.trim().toLowerCase();

    return savedPlans
      .filter((p) => (showArchived ? true : !p.isArchived))
      .filter((p) =>
        loadQFilter === "ALL"
          ? true
          : (p.q || "").trim().toLowerCase() === loadQFilter.trim().toLowerCase()
      )
      .filter((p) =>
        loadAoFilter === "ALL"
          ? true
          : (p.ao || "").trim().toLowerCase() === loadAoFilter.trim().toLowerCase()
      )
      .filter((p) => {
        if (!q) return true;
        return (p.name || "").toLowerCase().includes(q);
      })
      .sort((a, b) => {
        const aPinned = !!a.isPinned;
        const bPinned = !!b.isPinned;
        if (aPinned !== bPinned) return aPinned ? -1 : 1;

        const aTime = new Date((a.updatedAt || a.createdAt) as string).getTime();
        const bTime = new Date((b.updatedAt || b.createdAt) as string).getTime();
        return bTime - aTime;
      });
  }, [savedPlans, loadSearch, loadQFilter, loadAoFilter, showArchived]);

  /* ---------------- Wake Lock (Keep Screen Awake) ---------------- */
  const handleWakeLock = async () => {
    if (!("wakeLock" in navigator)) {
      alert("Wake Lock API is not supported in this browser.");
      return;
    }

    if (isAwake && wakeLockRef.current) {
      await wakeLockRef.current.release();
      wakeLockRef.current = null;
      setIsAwakeState(false);
      return;
    }

    try {
      wakeLockRef.current = await (navigator as any).wakeLock.request("screen");
      setIsAwakeState(true);
      wakeLockRef.current.addEventListener("release", () => setIsAwakeState(false));
    } catch (err: any) {
      if (err?.name === "NotAllowedError") {
        alert(
          "The 'Keep Screen Awake' feature is blocked by your browser or device settings."
        );
      } else {
        console.error(`${err?.name}, ${err?.message}`);
        alert("Could not activate 'Keep Screen Awake'. See console for details.");
      }
    }
  };

  /* ---------------- Timer Engine (single active timer) ---------------- */
  useEffect(() => {
    if (!timerState.isRunning || !timerState.activeRoundId) return;

    const intervalId = window.setInterval(() => {
      setTimerState((prev) => {
        if (!prev.isRunning || !prev.activeRoundId) return prev;

        if (prev.remainingSeconds > 1) {
          return { ...prev, remainingSeconds: prev.remainingSeconds - 1 };
        }

        const round = theThangRef.current.find((r) => r.id === prev.activeRoundId);
        const baseSeconds = round?.timerSeconds ?? 0;

        if (prev.remainingRepeats > 1 && baseSeconds > 0) {
          return {
            ...prev,
            remainingSeconds: baseSeconds,
            remainingRepeats: prev.remainingRepeats - 1,
          };
        }

        return { ...defaultTimerState };
      });
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [timerState.isRunning, timerState.activeRoundId]);

  /* ---------------- Click-outside to close timer/desc panels ---------------- */
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!plannerRef.current) return;

      const anyTimerOpen = Object.values(openTimerRounds).some(Boolean);
      const anyDescOpen = Object.values(openDescRounds).some(Boolean);
      if (!anyTimerOpen && !anyDescOpen && !isWarmupDescOpen) return;

      const target = event.target as Node;

      const timerPanels = Array.from(
        plannerRef.current.querySelectorAll("[data-timer-panel]")
      );
      const timerToggles = Array.from(
        plannerRef.current.querySelectorAll("[data-timer-toggle]")
      );

      const descPanels = Array.from(
        plannerRef.current.querySelectorAll("[data-desc-panel]")
      );
      const descToggles = Array.from(
        plannerRef.current.querySelectorAll("[data-desc-toggle]")
      );

      const warmupDescPanels = Array.from(
        plannerRef.current.querySelectorAll("[data-warmup-desc-panel]")
      );
      const warmupDescToggles = Array.from(
        plannerRef.current.querySelectorAll("[data-warmup-desc-toggle]")
      );

      for (const el of [
        ...timerPanels,
        ...timerToggles,
        ...descPanels,
        ...descToggles,
        ...warmupDescPanels,
        ...warmupDescToggles,
      ]) {
        if (el.contains(target)) return;
      }

      setOpenTimerRounds({});
      setOpenDescRounds({});
      setIsWarmupDescOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openTimerRounds, openDescRounds, isWarmupDescOpen]);

  /* ---------------- Warmup helpers ---------------- */
  const addWarmupExercise = () => {
    setIsWarmupDescOpen(false);
    setWarmup((prev) => [...prev, { id: createId(), name: "", reps: "", cadence: "" }]);
  };

  const addWarmupExerciseByName = (nameRaw: string) => {
    const cleaned = String(nameRaw || "").trim();
    if (!cleaned) return;
    setIsWarmupDescOpen(false);
    setWarmup((prev) => [
      ...prev,
      { id: createId(), name: cleaned, reps: "", cadence: "" },
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
    setWarmup((prev) => prev.filter((ex) => ex.id !== id));

  const updateWarmupExercise = (id: string, field: keyof Exercise, value: string) => {
    setWarmup((prev) =>
      prev.map((ex) => (ex.id === id ? { ...ex, [field]: value } : ex))
    );
  };

  const handleWarmupDragEnd = (event: DragEndEvent) => {
    if (isViewMode) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setWarmup((prev) => {
      const oldIndex = prev.findIndex((ex) => ex.id === active.id);
      const newIndex = prev.findIndex((ex) => ex.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  /* ---------------- Round helpers ---------------- */
  const addRound = () =>
    setTheThang((prev) =>
      renumberRounds([
        ...prev,
        {
          id: createId(),
          name: `Round ${prev.length + 1}`,
          exercises: [],
          timerSeconds: undefined,
          timerRepeatCount: 1,
          description: undefined,
        },
      ])
    );

  const removeRound = (id: string) => {
    setTheThang((prev) => renumberRounds(prev.filter((r) => r.id !== id)));
    if (timerState.activeRoundId === id) setTimerState(defaultTimerState);

    setOpenTimerRounds((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setOpenDescRounds((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const copyRound = (roundId: string) => {
    setTheThang((prev) => {
      const source = prev.find((r) => r.id === roundId);
      if (!source) return prev;

      const newRound: WorkoutRound = {
        id: createId(),
        name: `Round ${prev.length + 1}`,
        description: (source as any).description ?? undefined,
        exercises: source.exercises.map((ex) => ({
          id: createId(),
          name: ex.name,
          reps: ex.reps,
          cadence: ex.cadence,
        })),
        timerSeconds: source.timerSeconds,
        timerRepeatCount: source.timerRepeatCount ?? 1,
      };

      return renumberRounds([...prev, newRound]);
    });
  };

  const addExerciseToRound = (roundId: string) => {
    setOpenDescRounds((prev) => ({ ...prev, [roundId]: false }));
    setOpenTimerRounds((prev) => ({ ...prev, [roundId]: false }));

    setTheThang((prev) =>
      prev.map((r) =>
        r.id === roundId
          ? {
              ...r,
              exercises: [
                ...r.exercises,
                { id: createId(), name: "", reps: "", cadence: "" },
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
    setOpenTimerRounds((prev) => ({ ...prev, [roundId]: false }));

    setTheThang((prev) =>
      prev.map((r) =>
        r.id === roundId
          ? {
              ...r,
              exercises: [
                ...r.exercises,
                { id: createId(), name: cleaned, reps: "", cadence: "" },
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

  const removeExerciseFromRound = (roundId: string, exId: string) => {
    setTheThang((prev) =>
      prev.map((r) =>
        r.id === roundId
          ? { ...r, exercises: r.exercises.filter((ex) => ex.id !== exId) }
          : r
      )
    );
  };

  const updateExerciseInRound = (
    roundId: string,
    exId: string,
    field: keyof Exercise,
    value: string
  ) => {
    setTheThang((prev) =>
      prev.map((r) =>
        r.id === roundId
          ? {
              ...r,
              exercises: r.exercises.map((ex) =>
                ex.id === exId ? { ...ex, [field]: value } : ex
              ),
            }
          : r
      )
    );
  };

  const handleRoundExerciseDragEnd = (roundId: string, event: DragEndEvent) => {
    if (isViewMode) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setTheThang((prev) =>
      prev.map((r) => {
        if (r.id !== roundId) return r;

        const oldIndex = r.exercises.findIndex((ex) => ex.id === active.id);
        const newIndex = r.exercises.findIndex((ex) => ex.id === over.id);
        if (oldIndex === -1 || newIndex === -1) return r;

        return { ...r, exercises: arrayMove(r.exercises, oldIndex, newIndex) };
      })
    );
  };

  const handleThangRoundsDragEnd = (event: DragEndEvent) => {
    if (isViewMode) return;

    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setTheThang((prev) => {
      const oldIndex = prev.findIndex((r) => r.id === active.id);
      const newIndex = prev.findIndex((r) => r.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;

      const moved = arrayMove(prev, oldIndex, newIndex);
      return renumberRounds(moved);
    });
  };

  const toggleTimerPanel = (roundId: string) => {
    setOpenTimerRounds((prev) => ({ ...prev, [roundId]: !prev[roundId] }));
  };

  const toggleDescPanel = (roundId: string) => {
    setOpenDescRounds((prev) => ({ ...prev, [roundId]: !prev[roundId] }));
  };

  const updateRoundDescription = (roundId: string, value: string) => {
    setTheThang((prev) =>
      prev.map((r) => (r.id === roundId ? { ...r, description: value } : r))
    );
  };

  const updateRoundTimer = (
    roundId: string,
    secondsPerRound: number | undefined,
    repeatCount: number
  ) => {
    setTheThang((prev) =>
      prev.map((r) =>
        r.id === roundId
          ? { ...r, timerSeconds: secondsPerRound, timerRepeatCount: repeatCount }
          : r
      )
    );

    setTimerState((prev) => {
      if (prev.activeRoundId !== roundId || prev.isRunning) return prev;
      if (!secondsPerRound) return { ...defaultTimerState };

      return {
        ...prev,
        remainingSeconds: secondsPerRound,
        remainingRepeats: repeatCount > 0 ? repeatCount : 1,
      };
    });
  };

  const handleStartTimer = (roundId: string) => {
    const round = theThang.find((r) => r.id === roundId);
    if (!round || !round.timerSeconds || round.timerSeconds <= 0) {
      alert("Please set a timer duration for this round before starting.");
      return;
    }

    const repeats =
      round.timerRepeatCount && round.timerRepeatCount > 0
        ? round.timerRepeatCount
        : 1;

    setTimerState({
      activeRoundId: roundId,
      isRunning: true,
      remainingSeconds: round.timerSeconds,
      remainingRepeats: repeats,
    });
  };

  const handleStopTimer = (roundId: string) => {
    setTimerState((prev) =>
      prev.activeRoundId === roundId ? { ...prev, isRunning: false } : prev
    );
  };

  const handleResetTimer = (roundId: string) => {
    const round = theThang.find((r) => r.id === roundId);
    if (!round || !round.timerSeconds || round.timerSeconds <= 0) {
      setTimerState(defaultTimerState);
      return;
    }

    const repeats =
      round.timerRepeatCount && round.timerRepeatCount > 0
        ? round.timerRepeatCount
        : 1;

    setTimerState((prev) =>
      prev.activeRoundId === roundId
        ? {
            ...prev,
            remainingSeconds: round.timerSeconds!,
            remainingRepeats: repeats,
          }
        : prev
    );
  };

  /* ---------------- RENDER ---------------- */
  return (
    <div ref={plannerRef} className="animate-fade-in">
      {/* Load Plan Modal */}
      {isLoadModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-lg shadow-2xl w-full max-w-lg border border-slate-600">
            <div className="p-4 flex justify-between items-center border-b border-slate-700">
              <h3 className="text-2xl font-display text-white">Load Saved Plan</h3>
              <button
                onClick={() => setIsLoadModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                &times;
              </button>
            </div>

            <div className="p-4 max-h-96 overflow-y-auto">
              <div className="mb-3 space-y-2">
                <input
                  value={loadSearch}
                  onChange={(e) => setLoadSearch(e.target.value)}
                  placeholder="Search by plan name…"
                  className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-white text-sm"
                />

                <div className="flex gap-2 items-center">
                  <select
                    value={loadQFilter}
                    onChange={(e) => setLoadQFilter(e.target.value)}
                    className="flex-1 bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-white text-sm"
                  >
                    <option value="ALL">All Qs</option>
                    {uniqueQs.map((q) => (
                      <option key={q} value={q}>
                        {q}
                      </option>
                    ))}
                  </select>

                  <select
                    value={loadAoFilter}
                    onChange={(e) => setLoadAoFilter(e.target.value)}
                    className="flex-1 bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-white text-sm"
                    title="Filter by location / AO"
                  >
                    <option value="ALL">All Locations</option>
                    {uniqueAos.map((ao) => (
                      <option key={ao} value={ao}>
                        {ao}
                      </option>
                    ))}
                  </select>

                  <label className="flex items-center gap-2 text-sm text-slate-300 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={showArchived}
                      onChange={(e) => setShowArchived(e.target.checked)}
                      className="h-4 w-4 rounded bg-slate-800 border-slate-600 text-red-600 focus:ring-red-500"
                    />
                    Archived
                  </label>
                </div>
              </div>

              {filteredPlans.length > 0 ? (
                <ul className="space-y-2">
                  {filteredPlans.map((plan) => {
                    const createdLabel = plan.createdAt
                      ? new Date(plan.createdAt).toLocaleString()
                      : "Unknown";

                    const updatedLabel = plan.updatedAt
                      ? new Date(plan.updatedAt).toLocaleString()
                      : null;

                    const pinned = !!plan.isPinned;
                    const archived = !!plan.isArchived;

                    return (
                      <li
                        key={plan.id}
                        className="bg-slate-700/50 p-3 rounded-md flex justify-between items-center"
                      >
                        <div className="min-w-0 pr-2">
                          <p
                            className="font-bold text-white break-words whitespace-normal leading-snug"
                            style={{
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                            }}
                            title={plan.name}
                          >
                            {pinned ? "★ " : ""}
                            {plan.name}
                            {archived ? " (Archived)" : ""}
                          </p>

                          <p className="text-xs text-slate-400">Q: {plan.q || "—"}</p>
                          <p className="text-xs text-slate-400">
                            Location: {plan.ao || "—"}
                          </p>
                          <p className="text-xs text-slate-400">
                            {updatedLabel ? (
                              <>
                                Updated: {updatedLabel} · Created: {createdLabel}
                              </>
                            ) : (
                              <>Created: {createdLabel}</>
                            )}
                          </p>
                        </div>

                        <div className="flex gap-2 items-center">
                          <button
                            onClick={() => handleLoadPlan(plan)}
                            className="bg-red-600 text-white font-bold py-1 px-3 rounded-md text-sm hover:bg-red-700"
                          >
                            Load
                          </button>

                          <button
                            onClick={() => togglePinned(plan)}
                            className="text-slate-300 hover:text-yellow-400"
                            title={pinned ? "Unpin" : "Pin"}
                          >
                            ★
                          </button>

                          <button
                            onClick={() => toggleArchived(plan)}
                            className="text-slate-300 hover:text-sky-400"
                            title={archived ? "Unarchive" : "Archive"}
                          >
                            🗄
                          </button>

                          <button
                            onClick={() => handleDeletePlan(plan.id)}
                            className="text-slate-400 hover:text-red-500"
                            title="Delete"
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-slate-400 text-center py-8">No saved plans found.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Save Plan Modal */}
      {isSaveModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-lg shadow-2xl w-full max-w-sm border border-slate-600">
            <div className="p-4 border-b border-slate-700">
              <h3 className="text-2xl font-display text-white">Save Plan</h3>
              {compactOptionalString(aoShortLabel) && (
                <p className="text-xs text-slate-400 mt-1">
                  Location will be saved as:{" "}
                  <span className="text-slate-200 font-semibold">{aoShortLabel}</span>
                </p>
              )}
            </div>

            <div className="p-4 space-y-4">
              <label htmlFor="planNameInput" className="text-slate-300">
                Enter a name for this workout plan:
              </label>
              <input
                id="planNameInput"
                type="text"
                value={planNameInput}
                onChange={(e) => setPlanNameInput(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-white"
                onKeyDown={(e) => e.key === "Enter" && handleConfirmSave()}
              />
            </div>

            <div className="p-4 flex justify-end gap-2 bg-slate-900/50 rounded-b-lg">
              <button
                onClick={() => setIsSaveModalOpen(false)}
                className="bg-slate-600 text-white font-bold py-2 px-4 rounded-md hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSave}
                className="bg-red-600 text-white font-bold py-2 px-4 rounded-md hover:bg-red-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 mb-4">
        <ClipboardListIcon className="h-6 w-6 text-red-500" />
        <h2 className="text-xl sm:text-2xl font-display tracking-wide text-white">
          Workout Planner{" "}
          {compactOptionalString(aoShortLabel) ? (
            <span className="text-slate-300 font-normal">— {aoShortLabel}</span>
          ) : null}
        </h2>
      </div>

      <div className="flex items-center gap-4 mb-1">
        <a
          href="https://f3houston.com/q101/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-400 text-sm underline hover:text-sky-300"
        >
          Q101-1st "F"
        </a>

        <a
          href="https://youtu.be/m3jBwDSbMys?si=fi7GQXCUjfkpvdmS"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-400 text-sm underline hover:text-sky-300"
        >
          How to Count
        </a>

        <a
          href="https://docs.google.com/spreadsheets/d/1VpzFKsGD4qjEa4G8OtOk8BR9CI21r8n3WXsWECivijY/htmlview"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-400 text-sm underline hover:text-sky-300"
        >
          Exicon (F3 Exercises)
        </a>
      </div>

      <div className="max-w-4xl mx-auto bg-slate-800/50 rounded-lg shadow-2xl p-6 border border-slate-700 space-y-6">
        {/* Header and Actions */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setIsViewMode(!isViewMode)}
              className="bg-sky-600 text-white font-bold py-[6px] px-3 rounded-md hover:bg-sky-700 transition-colors text-sm flex items-center gap-1.5 whitespace-nowrap"
            >
              {isViewMode ? <PencilIcon /> : null}
              {isViewMode ? "Edit Mode" : "View Mode"}
            </button>

            <button
              onClick={() => setIsLoadModalOpen(true)}
              className="bg-slate-600 text-white font-bold py-[6px] px-3 rounded-md hover:bg-slate-700 transition-colors text-sm flex items-center gap-1.5 whitespace-nowrap"
            >
              Load
            </button>

            <button
              onClick={openSaveModal}
              className="bg-red-600 text-white font-bold py-[6px] px-3 rounded-md hover:bg-red-700 transition-colors text-sm disabled:opacity-50 whitespace-nowrap"
              disabled={isViewMode}
            >
              Save
            </button>

            <button
              onClick={handleClearPlan}
              className="bg-red-800 text-white font-bold py-[6px] px-3 rounded-md hover:bg-red-900 transition-colors text-sm disabled:opacity-50 whitespace-nowrap"
              disabled={isViewMode}
            >
              Clear
            </button>
          </div>

          <div className="flex-1 min-w-0">
            {compactOptionalString(aoShortLabel) && (
              <div className="bg-slate-900/60 border border-slate-700 rounded-md p-3 mb-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold text-sm text-slate-200 truncate">
                    {aoShortLabel}
                  </div>
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <span className="text-xs text-slate-400">Change AO:</span>
                    <AoSelector />
                  </div>
                </div>
              </div>
            )}
            <div className="flex items-center gap-4">
              <label
                htmlFor="qName-planner"
                className="block text-sm font-bold text-slate-300 mb-1 self-end"
              >
                Q <span className="text-red-400">*</span>
              </label>

              <div className="flex-1 min-w-0">
                <QNameSelect
                  value={qName}
                  onChange={setQName}
                  disabled={isViewMode}
                  paxList={paxListForThisAo}
                />
              </div>
            </div>
            <p className="mt-1 text-xs text-slate-400">Must fill in Q.</p>
          </div>
        </div>

        {/* Disclaimer (view mode only) */}
        {isViewMode && (
          <details className="bg-slate-900/50 p-3 rounded-md border border-slate-700 cursor-pointer">
            <summary className="font-bold text-red-400">
              Disclaimer (Click to Expand)
            </summary>
            <p className="mt-2 text-slate-400 text-sm">
              I am not a professional. You are here on your own free will. I am not
              aware of any existing injuries and am not responsible for them. Push
              yourself, but don't hurt yourself.
            </p>
          </details>
        )}

        {/* Warmup */}
        <div className="pt-4 border-t border-slate-700/60">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="text-xl font-bold text-slate-300">Warmup</h3>

            <button
              type="button"
              data-warmup-desc-toggle
              onClick={() => setIsWarmupDescOpen((v) => !v)}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              className="text-xs text-slate-300 hover:text-sky-400 flex items-center gap-2 disabled:opacity-50"
              disabled={isViewMode}
              title="Add warmup description (optional)"
            >
              <span className="text-lg">📝</span>
              <span className="text-xs sm:text-xs">
                {compactOptionalString(warmupDescription) ? "Edit Description" : "Add Description"}
              </span>
            </button>
          </div>

          {isWarmupDescOpen && (
            <div
              data-warmup-desc-panel
              className="bg-slate-900/50 p-3 rounded-md border border-slate-700 mb-3"
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <label className="block text-xs text-slate-400 mb-1">
                Warmup description (optional)
              </label>
              <textarea
                value={warmupDescription}
                onChange={(e) => setWarmupDescription(e.target.value)}
                placeholder="Example: Dynamic stretching, mosey to coupon, demo cadence…"
                className="w-full bg-slate-800 border border-slate-600 rounded-md p-2 text-white text-sm min-h-[70px]"
                disabled={isViewMode}
                onKeyDown={(e) => e.stopPropagation()}
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
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              className="w-full text-left bg-slate-800/60 border border-slate-700 rounded-md px-3 py-2 mb-2 text-sm text-slate-200 hover:border-sky-500/60"
              title="Click to edit warmup description"
              disabled={isViewMode}
            >
              <span className="text-slate-400 mr-2">📝</span>
              {warmupDescription}
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsWarmupMultiOpen((v) => !v)}
            className="text-sm text-slate-300 hover:text-white mt-2 flex items-center gap-1 disabled:opacity-50"
            disabled={isViewMode}
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
                        disabled={isViewMode}
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
                  disabled={warmupSelected.length === 0 || isViewMode}
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
                  disabled={isViewMode}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleWarmupDragEnd}
            >
              <SortableContext
                items={warmup.map((ex) => ex.id)}
                strategy={verticalListSortingStrategy}
              >
                {warmup.map((ex) => (
                  <SortableExerciseRow key={ex.id} id={ex.id} disabled={isViewMode}>
                    <ExerciseRow
                      exercise={ex}
                      updateExercise={updateWarmupExercise}
                      removeExercise={removeWarmupExercise}
                      exerciseList={WARMUP_EXERCISES}
                      isViewMode={isViewMode}
                    />
                  </SortableExerciseRow>
                ))}
              </SortableContext>
            </DndContext>
          </div>

          <button
            onClick={addWarmupExercise}
            className="text-sm text-red-400 hover:text-red-300 mt-2 flex items-center gap-1 disabled:hidden"
            disabled={isViewMode}
          >
            <PlusCircleIcon /> Add Individual Exercise
          </button>
        </div>

        {/* The Thang */}
        <div className="pt-4 border-t border-slate-700/60">
          <h3 className="text-xl font-bold text-slate-300 mb-2">The Thang</h3>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleThangRoundsDragEnd}
          >
            <SortableContext
              items={theThang.map((r) => r.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-4">
                {theThang.map((round) => {
                  const isRoundActive = timerState.activeRoundId === round.id;
                  const isRoundRunning =
                    isRoundActive && timerState.isRunning && !!round.timerSeconds;

                  const roundDesc = (round as any).description ?? "";

                  return (
                    <SortableRoundCard key={round.id} id={round.id} disabled={isViewMode}>
                      <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700">
                        <div className="flex flex-wrap justify-between items-center mb-2 gap-2">
                          <div className="flex items-center gap-1">
                            <h4 className="font-bold text-red-400">{round.name}</h4>

                            <button
                              type="button"
                              data-desc-toggle
                              onClick={() => toggleDescPanel(round.id)}
                              onMouseDown={(e) => e.stopPropagation()}
                              onPointerDown={(e) => e.stopPropagation()}
                              className="flex items-center gap-0 px-1 py-1 rounded transition-colors text-xs text-slate-300 hover:text-sky-400 disabled:opacity-50 whitespace-nowrap"
                              title="Add round description (optional)"
                              disabled={isViewMode}
                            >
                              <span className="text-base leading-none">📝</span>
                              <span className="leading-none">
                                {compactOptionalString(roundDesc) ? "Edit Description" : "Add Description"}
                              </span>
                            </button>

                            <button
                              type="button"
                              data-timer-toggle
                              onClick={() => toggleTimerPanel(round.id)}
                              onMouseDown={(e) => e.stopPropagation()}
                              onPointerDown={(e) => e.stopPropagation()}
                              className={`flex items-center gap-0 px-1 py-1 rounded transition-colors text-xs whitespace-nowrap ${
                                isRoundRunning
                                  ? "bg-red-700 text-white"
                                  : "text-slate-300 hover:text-sky-400"
                              }`}
                              title="Edit round timer"
                            >
                              <span className="text-base leading-none">
                                {!round.timerSeconds ? "🕒" : isRoundRunning ? "⏱️" : "▶️"}
                              </span>

                              {round.timerSeconds ? (
                                <span className="leading-none">
                                  {Math.floor(round.timerSeconds / 60)}m
                                  {round.timerRepeatCount && round.timerRepeatCount > 1
                                    ? `×${round.timerRepeatCount}`
                                    : ""}
                                </span>
                              ) : (
                                <span className="text-slate-400 leading-none">Add Timer</span>
                              )}
                            </button>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => copyRound(round.id)}
                              onMouseDown={(e) => e.stopPropagation()}
                              onPointerDown={(e) => e.stopPropagation()}
                              className="text-slate-400 hover:text-slate-200 disabled:hidden flex items-center gap-1 text-xs"
                              disabled={isViewMode}
                              title="Copy this round to a new Round X at the bottom"
                            >
                              <ClipboardCopyIcon />
                              Copy Round
                            </button>

                            <button
                              onClick={() => removeRound(round.id)}
                              onMouseDown={(e) => e.stopPropagation()}
                              onPointerDown={(e) => e.stopPropagation()}
                              className="text-slate-500 hover:text-red-500 disabled:hidden"
                              disabled={isViewMode}
                            >
                              <TrashIcon />
                            </button>
                          </div>
                        </div>

                        {openDescRounds[round.id] && (
                          <div
                            data-desc-panel
                            className="bg-slate-900/50 p-3 rounded-md border border-slate-700 mb-3"
                            onMouseDown={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                          >
                            <label className="block text-xs text-slate-400 mb-1">
                              Round description (optional)
                            </label>
                            <textarea
                              value={roundDesc}
                              onChange={(e) => updateRoundDescription(round.id, e.target.value)}
                              placeholder="Example: Partner work; one runs while other does merkins; rotate on timer…"
                              className="w-full bg-slate-800 border border-slate-600 rounded-md p-2 text-white text-sm min-h-[70px]"
                              disabled={isViewMode}
                              onKeyDown={(e) => e.stopPropagation()}
                            />
                            <div className="flex items-center justify-between mt-2">
                              <button
                                type="button"
                                onClick={() => updateRoundDescription(round.id, "")}
                                className="text-xs text-slate-400 hover:text-red-300 disabled:opacity-50"
                                disabled={isViewMode}
                                title="Clear description"
                              >
                                Clear
                              </button>
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

                        {compactOptionalString((round as any).description) && !openDescRounds[round.id] && (
                          <button
                            type="button"
                            onClick={() => toggleDescPanel(round.id)}
                            onMouseDown={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                            className="w-full text-left bg-slate-800/60 border border-slate-700 rounded-md px-3 py-2 mb-2 text-sm text-slate-200 hover:border-sky-500/60"
                            title="Click to edit description"
                          >
                            <span className="text-slate-400 mr-2">📝</span>
                            {(round as any).description}
                          </button>
                        )}

                        {openTimerRounds[round.id] && (
                          <div
                            data-timer-panel
                            onMouseDown={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                          >
                            <RoundTimerControl
                              timerSeconds={round.timerSeconds}
                              repeatCount={round.timerRepeatCount ?? 1}
                              disabled={isViewMode}
                              isActive={isRoundActive}
                              isRunning={isRoundRunning}
                              remainingSeconds={isRoundActive ? timerState.remainingSeconds : undefined}
                              remainingRepeats={isRoundActive ? timerState.remainingRepeats : undefined}
                              onChange={(secondsPerRound, repeatCount) =>
                                updateRoundTimer(round.id, secondsPerRound, repeatCount)
                              }
                              onStart={() => handleStartTimer(round.id)}
                              onStop={() => handleStopTimer(round.id)}
                              onReset={() => handleResetTimer(round.id)}
                              onClosePanel={() => toggleTimerPanel(round.id)}
                            />
                          </div>
                        )}

                        <div className="space-y-2 mt-2">
                          <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            onDragEnd={(event) => handleRoundExerciseDragEnd(round.id, event)}
                          >
                            <SortableContext
                              items={round.exercises.map((ex) => ex.id)}
                              strategy={verticalListSortingStrategy}
                            >
                              {round.exercises.map((ex) => (
                                <SortableExerciseRow key={ex.id} id={ex.id} disabled={isViewMode}>
                                  <ExerciseRow
                                    exercise={ex}
                                    updateExercise={(exId, field, value) =>
                                      updateExerciseInRound(round.id, exId, field, value)
                                    }
                                    removeExercise={(exId) => removeExerciseFromRound(round.id, exId)}
                                    exerciseList={THANG_EXERCISES}
                                    isViewMode={isViewMode}
                                  />
                                </SortableExerciseRow>
                              ))}
                            </SortableContext>
                          </DndContext>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            setThangMultiOpen((prev) => ({
                              ...prev,
                              [round.id]: !prev[round.id],
                            }))
                          }
                          onMouseDown={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          className="text-xs text-slate-300 hover:text-white mt-2 flex items-center gap-1 disabled:opacity-50"
                          disabled={isViewMode}
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
                                      disabled={isViewMode}
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
                                disabled={!thangSelected[round.id]?.length || isViewMode}
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
                                disabled={isViewMode}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}

                        <button
                          onClick={() => addExerciseToRound(round.id)}
                          onMouseDown={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          className="text-xs text-red-400 hover:text-red-300 mt-2 flex items-center gap-1 disabled:hidden"
                          disabled={isViewMode}
                        >
                          <PlusCircleIcon /> Add Individual Exercise
                        </button>
                      </div>
                    </SortableRoundCard>
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>

          <button
            onClick={addRound}
            className="text-sm text-red-400 hover:text-red-300 mt-3 flex items-center gap-1 font-bold disabled:hidden"
            disabled={isViewMode}
          >
            <PlusCircleIcon /> Add Next Round
          </button>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-slate-700">
          <button
            onClick={handleWakeLock}
            className={`w-full sm:w-auto font-bold py-3 px-4 rounded-md transition-colors flex items-center justify-center gap-2 ${
              isAwake
                ? "bg-yellow-500 text-slate-900"
                : "bg-slate-600 text-white hover:bg-slate-700"
            }`}
          >
            <SunIcon /> {isAwake ? "Screen is Awake" : "Keep Screen Awake"}
          </button>

          <button
            onClick={() => onImportPlan({ q: qName, warmup, warmupDescription, theThang } as any)}
            disabled={!qName}
            className="w-full sm:w-auto bg-red-600 text-white font-bold py-3 px-4 rounded-md hover:bg-red-700 transition-colors disabled:bg-slate-600 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            <ClipboardCopyIcon />
            Use for Backblast
          </button>
        </div>
      </div>
    </div>
  );
};
