import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { getPaxListByAo, THANG_EXERCISES, WARMUP_EXERCISES } from "../constants";
import { db } from "../firebase";
import { createId } from "../utils/ids";
import {
  BurgerIcon,
  CalendarIcon,
  ClipboardListIcon,
  DocumentTextIcon,
  FireIcon,
  SilverwareIcon,
  TrashIcon,
  UserIcon,
  UserGroupIcon,
} from "./icons";

type SignupValue = "" | string;
type StatusValue = "Open" | "Filled" | "Locked" | "Check";

type LeadershipRole = {
  id: string;
  category: string;
  role: string;
  assignedTo: SignupValue;
  notes: string;
};

type WorkoutExerciseRow = {
  id: string;
  name: string;
  details: string;
};

type WorkoutSection = {
  id: string;
  title: string;
  exerciseOptions: string[];
  exercises: WorkoutExerciseRow[];
};

type SignupItem = {
  id: string;
  category: string;
  item: string;
  qtyNeeded: string;
  assignees: SignupValue[];
  status: StatusValue;
  notes: string;
};

type SignupSection = {
  id: string;
  title: string;
  items: SignupItem[];
};

type PaxAssignment = {
  lane: string;
  detail: string;
};

type TabKey = "leadership" | "workout" | "food" | "logistics" | "pax";
type SignupGroup = "food" | "logistics";

const tabs: {
  key: TabKey;
  label: string;
  mobileLabel: string;
  icon: React.ReactNode;
  accent: string;
}[] = [
  {
    key: "leadership",
    label: "Roles",
    mobileLabel: "Roles",
    icon: <UserIcon />,
    accent: "text-amber-200 bg-amber-500/15 border-amber-500/30",
  },
  {
    key: "workout",
    label: "Workout Plan",
    mobileLabel: "Workout",
    icon: <FireIcon />,
    accent: "text-red-200 bg-red-500/15 border-red-500/30",
  },
  {
    key: "food",
    label: "Coffeteria",
    mobileLabel: "Food",
    icon: <BurgerIcon />,
    accent: "text-emerald-200 bg-emerald-500/15 border-emerald-500/30",
  },
  {
    key: "logistics",
    label: "Supplies & Logistics",
    mobileLabel: "Supplies",
    icon: <SilverwareIcon />,
    accent: "text-sky-200 bg-sky-500/15 border-sky-500/30",
  },
  {
    key: "pax",
    label: "Duties",
    mobileLabel: "Duties",
    icon: <ClipboardListIcon />,
    accent: "text-violet-200 bg-violet-500/15 border-violet-500/30",
  },
];

const initialLeadershipRoles: LeadershipRole[] = [
  {
    id: "preblast-creator",
    category: "Event",
    role: "Preblast Creator",
    assignedTo: "",
    notes: "",
  },
  {
    id: "announcement-writer",
    category: "Event",
    role: "Announcement Writer",
    assignedTo: "",
    notes: "",
  },
  {
    id: "backblast-writer",
    category: "Event",
    role: "Backblast Writer",
    assignedTo: "",
    notes: "",
  },
  {
    id: "music-lead",
    category: "Event",
    role: "Music Lead",
    assignedTo: "",
    notes: "Optional",
  },
  {
    id: "photo-timekeeper-1",
    category: "Content",
    role: "BD Photographer #1",
    assignedTo: "",
    notes: "",
  },
  {
    id: "photo-timekeeper-2",
    category: "Content",
    role: "BD Photographer #2",
    assignedTo: "",
    notes: "",
  },
  {
    id: "photo-coffeteria",
    category: "Content",
    role: "Photo (Coffeteria)",
    assignedTo: "",
    notes: "",
  },
  {
    id: "warmup-leader",
    category: "Workout",
    role: "Warmup Leader",
    assignedTo: "",
    notes: "",
  },
  {
    id: "station-1-leader",
    category: "Workout",
    role: "Station 1 Leader",
    assignedTo: "",
    notes: "",
  },
  {
    id: "station-2-leader",
    category: "Workout",
    role: "Station 2 Leader",
    assignedTo: "",
    notes: "",
  },
  {
    id: "station-3-leader",
    category: "Workout",
    role: "Station 3 Leader",
    assignedTo: "",
    notes: "",
  },
  {
    id: "station-4-leader",
    category: "Workout",
    role: "Station 4 Leader",
    assignedTo: "",
    notes: "",
  },
  {
    id: "dd-run-leader",
    category: "Workout",
    role: "DD Run Leader",
    assignedTo: "",
    notes: "",
  },
  {
    id: "dd-ruck-leader",
    category: "Workout",
    role: "DD Ruck Leader",
    assignedTo: "",
    notes: "",
  },
  {
    id: "td-run-leader",
    category: "Workout",
    role: "TD Run Leader",
    assignedTo: "",
    notes: "",
  },
  {
    id: "grillmaster",
    category: "Food",
    role: "Grillmaster",
    assignedTo: "Hardwood",
    notes: "Brisket + Pork",
  },
  {
    id: "assistant-grillmaster",
    category: "Food",
    role: "Assistant Grillmaster",
    assignedTo: "",
    notes: "",
  },
  {
    id: "beverage-lead",
    category: "Food",
    role: "Beverage Lead",
    assignedTo: "",
    notes: "",
  },
  {
    id: "dry-food-lead",
    category: "Food",
    role: "Dry Food Lead",
    assignedTo: "",
    notes: "",
  },
  {
    id: "tables-setup-lead",
    category: "Logistics",
    role: "Tables / Setup Lead",
    assignedTo: "",
    notes: "",
  },
  {
    id: "cleanup-lead",
    category: "Logistics",
    role: "Cleanup Lead",
    assignedTo: "",
    notes: "",
  },
  {
    id: "equipment-lead",
    category: "Logistics",
    role: "Equipment Lead",
    assignedTo: "",
    notes: "",
  },
];

const createEmptyWorkoutExercise = (): WorkoutExerciseRow => ({
  id: createId(),
  name: "",
  details: "",
});

const isCustomWorkoutExerciseName = (name: string, options: string[]) =>
  Boolean(name) && !options.includes(name);

const initialWorkoutPlan: WorkoutSection[] = [
  {
    id: "warm-up",
    title: "Warm-Up",
    exerciseOptions: WARMUP_EXERCISES,
    exercises: [createEmptyWorkoutExercise()],
  },
  {
    id: "station-1",
    title: "Station 1",
    exerciseOptions: THANG_EXERCISES,
    exercises: [createEmptyWorkoutExercise()],
  },
  {
    id: "station-2",
    title: "Station 2",
    exerciseOptions: THANG_EXERCISES,
    exercises: [createEmptyWorkoutExercise()],
  },
  {
    id: "station-3",
    title: "Station 3",
    exerciseOptions: THANG_EXERCISES,
    exercises: [createEmptyWorkoutExercise()],
  },
  {
    id: "station-4",
    title: "Station 4",
    exerciseOptions: THANG_EXERCISES,
    exercises: [createEmptyWorkoutExercise()],
  },
];

const initialFoodSections: SignupSection[] = [
  {
    id: "grill-hot-food",
    title: "Section A: Grill / Hot Food",
    items: [
      {
        id: "brisket",
        category: "Grill",
        item: "Brisket",
        qtyNeeded: "2",
        assignees: ["Hardwood", "Hardwood"],
        status: "Locked",
        notes: "",
      },
      {
        id: "pulled-pork",
        category: "Grill",
        item: "Pulled Pork",
        qtyNeeded: "1",
        assignees: ["Hardwood"],
        status: "Locked",
        notes: "",
      },
      { id: "bacon", category: "Grill", item: "Bacon", qtyNeeded: "", assignees: [""], status: "Open", notes: "" },
      { id: "sausage", category: "Grill", item: "Sausage", qtyNeeded: "", assignees: [""], status: "Open", notes: "" },
      { id: "eggs", category: "Grill", item: "Eggs", qtyNeeded: "", assignees: [""], status: "Open", notes: "" },
      { id: "tortillas", category: "Grill", item: "Tortillas", qtyNeeded: "", assignees: [""], status: "Open", notes: "" },
      { id: "hot-sauce", category: "Grill", item: "Hot Sauce", qtyNeeded: "", assignees: [""], status: "Open", notes: "" },
      {
        id: "griddle",
        category: "Grill",
        item: "Griddle/Blackstone",
        qtyNeeded: "",
        assignees: [""],
        status: "Check",
        notes: "Do we have one?",
      },
    ],
  },
  {
    id: "drinks-coffeteria",
    title: "Section B: Drinks / Coffeteria",
    items: [
      { id: "coffee-hot", category: "Drinks", item: "Coffee (Hot)", qtyNeeded: "", assignees: [""], status: "Open", notes: "" },
      { id: "coffee-cold", category: "Drinks", item: "Coffee (Cold)", qtyNeeded: "", assignees: [""], status: "Open", notes: "" },
      { id: "creamer", category: "Drinks", item: "Creamer", qtyNeeded: "", assignees: [""], status: "Open", notes: "" },
      { id: "sugar", category: "Drinks", item: "Sugar/Sweetener", qtyNeeded: "", assignees: [""], status: "Open", notes: "" },
      { id: "stir-sticks", category: "Drinks", item: "Stir Sticks", qtyNeeded: "", assignees: [""], status: "Open", notes: "" },
      { id: "water", category: "Drinks", item: "Water", qtyNeeded: "", assignees: [""], status: "Open", notes: "" },
      { id: "orange-juice", category: "Drinks", item: "Orange Juice", qtyNeeded: "", assignees: [""], status: "Open", notes: "" },
      { id: "gatorade", category: "Drinks", item: "Gatorade / Electrolytes", qtyNeeded: "", assignees: [""], status: "Open", notes: "" },
      { id: "ice", category: "Drinks", item: "Ice", qtyNeeded: "", assignees: [""], status: "Open", notes: "" },
    ],
  },
  {
    id: "dry-food-sides",
    title: "Section C: Dry Food / Sides",
    items: [
      { id: "donuts", category: "Dry Food", item: "Donuts", qtyNeeded: "", assignees: [""], status: "Open", notes: "" },
      { id: "bagels", category: "Dry Food", item: "Bagels", qtyNeeded: "", assignees: [""], status: "Open", notes: "" },
      { id: "cream-cheese", category: "Dry Food", item: "Cream Cheese", qtyNeeded: "", assignees: [""], status: "Open", notes: "" },
      { id: "biscuits", category: "Dry Food", item: "Biscuits", qtyNeeded: "", assignees: [""], status: "Open", notes: "" },
      { id: "fruit-tray", category: "Dry Food", item: "Fruit Tray", qtyNeeded: "", assignees: [""], status: "Open", notes: "" },
      { id: "yogurt", category: "Dry Food", item: "Yogurt", qtyNeeded: "", assignees: [""], status: "Open", notes: "" },
      { id: "granola-bars", category: "Dry Food", item: "Granola Bars", qtyNeeded: "", assignees: [""], status: "Open", notes: "" },
    ],
  },
];

const initialLogisticsSections: SignupSection[] = [
  {
    id: "consumables",
    title: "Consumables",
    items: [
      { id: "paper-plates", category: "Supplies", item: "Paper Plates", qtyNeeded: "", assignees: [""], status: "Open", notes: "" },
      { id: "paper-bowls", category: "Supplies", item: "Paper Bowls", qtyNeeded: "", assignees: [""], status: "Open", notes: "" },
      { id: "utensils", category: "Supplies", item: "Utensils", qtyNeeded: "", assignees: [""], status: "Open", notes: "" },
      { id: "napkins", category: "Supplies", item: "Napkins / Paper Towels", qtyNeeded: "", assignees: [""], status: "Open", notes: "" },
      { id: "cups", category: "Supplies", item: "Cups", qtyNeeded: "", assignees: [""], status: "Open", notes: "" },
      { id: "trays-pans-foil", category: "Serving", item: "Aluminum Trays / Pans / Foil", qtyNeeded: "", assignees: [""], status: "Open", notes: "" },
      { id: "trash-bags", category: "Cleanup", item: "Trash Bags", qtyNeeded: "", assignees: [""], status: "Open", notes: "" },
      { id: "wipes", category: "Cleanup", item: "Wipes / Sanitizer / Wet Wipes", qtyNeeded: "", assignees: [""], status: "Open", notes: "" },
      { id: "ziplock-bags", category: "Cleanup", item: "Ziplock Bags (Leftovers)", qtyNeeded: "", assignees: [""], status: "Open", notes: "" },
    ],
  },
  {
    id: "loaners",
    title: "Returnables",
    items: [
      { id: "serving-tongs", category: "Serving", item: "Serving Tongs", qtyNeeded: "", assignees: [""], status: "Open", notes: "Brisket + pork" },
      { id: "serving-spoons", category: "Serving", item: "Serving Spoons", qtyNeeded: "", assignees: [""], status: "Open", notes: "" },
      { id: "carving-knife", category: "Serving", item: "Carving Knife", qtyNeeded: "", assignees: [""], status: "Open", notes: "" },
      { id: "tables-serving", category: "Setup", item: "Tables (Serving)", qtyNeeded: "", assignees: [""], status: "Open", notes: "" },
      { id: "tent", category: "Setup", item: "Tent (Weather Dependent)", qtyNeeded: "", assignees: [""], status: "Check", notes: "If rain/sun" },
    ],
  },
];

const eventOverview = {
  title: "Compass Anniversary",
  dateLabel: "Saturday, June 20",
  eventDateIso: "2026-06-20",
};

const EVENT_COLLECTION = "events";
const EVENT_DOC_ID = "compass-anniversary-shared-planner";
const EVENT_PLANNER_VERSION = 1;

const getEventPlannerDocRef = () => doc(db, EVENT_COLLECTION, EVENT_DOC_ID);
const getLeadershipRolesCollection = () => collection(getEventPlannerDocRef(), "leadershipRoles");
const getWorkoutSectionsCollection = () => collection(getEventPlannerDocRef(), "workoutSections");
const getWorkoutExercisesCollection = (sectionId: string) =>
  collection(getEventPlannerDocRef(), "workoutSections", sectionId, "exercises");
const getSignupSectionsCollection = (group: SignupGroup) =>
  collection(getEventPlannerDocRef(), group === "food" ? "foodSections" : "logisticsSections");
const getSignupItemsCollection = (group: SignupGroup, sectionId: string) =>
  collection(
    getEventPlannerDocRef(),
    group === "food" ? "foodSections" : "logisticsSections",
    sectionId,
    "items"
  );

const getNextOrder = (items: { id: string }[]) => items.length;

const ensureSharedPlannerSeed = async () => {
  await runTransaction(db, async (transaction) => {
    const plannerRef = getEventPlannerDocRef();
    const plannerSnapshot = await transaction.get(plannerRef);

    if (plannerSnapshot.exists()) return;

    transaction.set(plannerRef, {
      title: eventOverview.title,
      dateLabel: eventOverview.dateLabel,
      eventDateIso: eventOverview.eventDateIso,
      plannerVersion: EVENT_PLANNER_VERSION,
      updatedAt: serverTimestamp(),
    });

    initialLeadershipRoles.forEach((role, index) => {
      transaction.set(doc(getLeadershipRolesCollection(), role.id), {
        ...role,
        order: index,
        updatedAt: serverTimestamp(),
      });
    });

    initialWorkoutPlan.forEach((section, sectionIndex) => {
      transaction.set(doc(getWorkoutSectionsCollection(), section.id), {
        title: section.title,
        exerciseOptions: section.exerciseOptions,
        order: sectionIndex,
        updatedAt: serverTimestamp(),
      });

      section.exercises.forEach((exercise, exerciseIndex) => {
        transaction.set(doc(getWorkoutExercisesCollection(section.id), exercise.id), {
          ...exercise,
          order: exerciseIndex,
          updatedAt: serverTimestamp(),
        });
      });
    });

    ([
      ["food", initialFoodSections],
      ["logistics", initialLogisticsSections],
    ] as const).forEach(([group, sections]) => {
      sections.forEach((section, sectionIndex) => {
        transaction.set(doc(getSignupSectionsCollection(group), section.id), {
          title: section.title,
          order: sectionIndex,
          updatedAt: serverTimestamp(),
        });

        section.items.forEach((item, itemIndex) => {
          transaction.set(doc(getSignupItemsCollection(group, section.id), item.id), {
            ...item,
            assignees: normalizeAssignees(item.qtyNeeded, item.assignees),
            order: itemIndex,
            updatedAt: serverTimestamp(),
          });
        });
      });
    });
  });
};

const shellClass = "bg-slate-800/50 rounded-lg shadow-2xl border border-slate-700";
const sectionClass = "rounded-lg border border-slate-700 bg-slate-900/60";
const itemCardClass = "rounded-lg border border-slate-700 bg-slate-950/60 p-3";
const inputClass =
  "min-h-[40px] w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white outline-none transition focus:border-red-400";
const compactInputClass =
  "w-full rounded-md border border-slate-600 bg-slate-700 px-2 py-1 text-white text-xs outline-none transition focus:border-red-400";

const statusClassName = (status: StatusValue) => {
  if (status === "Locked") return "border-amber-500/40 bg-amber-500/10 text-amber-200";
  if (status === "Filled") return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  if (status === "Check") return "border-sky-500/40 bg-sky-500/10 text-sky-200";
  return "border-slate-600 bg-slate-800 text-slate-300";
};

function parseQty(qtyNeeded: string) {
  const parsed = Number.parseInt(qtyNeeded, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function normalizeAssignees(qtyNeeded: string, assignees: SignupValue[]) {
  const qty = parseQty(qtyNeeded);
  return Array.from({ length: qty }, (_, index) => assignees[index] ?? "");
}

const resolveRoleStatus = (role: LeadershipRole): "Open" | "Filled" =>
  role.assignedTo ? "Filled" : "Open";

const resolveSignupStatus = (item: SignupItem): StatusValue => {
  if (item.status === "Locked" || item.status === "Check") return item.status;
  return normalizeAssignees(item.qtyNeeded, item.assignees).every(Boolean) ? "Filled" : "Open";
};

const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
    {children}
  </label>
);

const StatusPill: React.FC<{ status: StatusValue }> = ({ status }) => (
  <span
    className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${statusClassName(
      status
    )}`}
  >
    {status}
  </span>
);

const ActionButton: React.FC<{
  label: string;
  onClick: () => void;
  variant?: "primary" | "secondary" | "ghost";
}> = ({ label, onClick, variant = "secondary" }) => {
  const variantClass =
    variant === "primary"
      ? "border-red-500 bg-red-600 text-white hover:bg-red-500"
      : variant === "ghost"
        ? "border-slate-600 bg-transparent text-slate-200 hover:bg-slate-800"
        : "border-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-[40px] rounded-md border px-3 text-sm font-semibold transition-colors ${variantClass}`}
    >
      {label}
    </button>
  );
};

const StatusSelect: React.FC<{
  value: StatusValue;
  onChange: (value: StatusValue) => void;
}> = ({ value, onChange }) => (
  <select
    value={value}
    onChange={(event) => onChange(event.target.value as StatusValue)}
    className={inputClass}
  >
    <option value="Open">Open</option>
    <option value="Filled">Filled</option>
    <option value="Locked">Locked</option>
    <option value="Check">Check</option>
  </select>
);

const SummaryCard: React.FC<{ label: string; value: string; hint?: string }> = ({
  label,
  value,
  hint,
}) => (
  <div className="rounded-lg border border-slate-700 bg-slate-950/60 px-2 py-1.5">
    <div className="flex items-baseline gap-1.5 whitespace-nowrap sm:justify-center">
      <span className="text-[11px] uppercase tracking-[0.16em] text-slate-400">{label}</span>
      <span className="text-xs font-semibold text-white sm:text-sm">{value}</span>
    </div>
    {hint ? <div className="mt-1 text-xs text-slate-400 sm:text-center">{hint}</div> : null}
  </div>
);

const SectionHeader: React.FC<{
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  description: string;
  accentClass: string;
  action?: React.ReactNode;
}> = ({ icon, eyebrow, title, description, accentClass, action }) => (
  <div className="flex flex-col gap-3 border-b border-slate-700 px-3 py-2.5 sm:items-center sm:px-4 sm:py-3">
    <div className="flex items-start gap-3 sm:text-center">
      <div className={`rounded-lg border p-2 ${accentClass}`}>{icon}</div>
      <div className="min-w-0 sm:flex sm:flex-col sm:items-center">
        {eyebrow ? (
          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">{eyebrow}</div>
        ) : null}
        <h2 className="mt-1 text-lg font-semibold text-white sm:text-xl">{title}</h2>
        {description ? <p className="mt-1 text-sm text-slate-300">{description}</p> : null}
      </div>
    </div>
    {action ? <div className="sm:flex sm:justify-center">{action}</div> : null}
  </div>
);

export const EventPlannerMock: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabKey>("leadership");
  const [leadershipRoles, setLeadershipRoles] = useState(initialLeadershipRoles);
  const [workoutPlan, setWorkoutPlan] = useState(initialWorkoutPlan);
  const [foodSections, setFoodSections] = useState(initialFoodSections);
  const [logisticsSections, setLogisticsSections] = useState(initialLogisticsSections);
  const [workoutSectionIds, setWorkoutSectionIds] = useState<string[]>([]);
  const [foodSectionIds, setFoodSectionIds] = useState<string[]>([]);
  const [logisticsSectionIds, setLogisticsSectionIds] = useState<string[]>([]);
  const [isPlannerReady, setIsPlannerReady] = useState(false);
  const [draggedLeadershipRoleId, setDraggedLeadershipRoleId] = useState<string | null>(null);
  const [selectedPaxName, setSelectedPaxName] = useState("");
  const [isPaxFilterOpen, setIsPaxFilterOpen] = useState(false);

  const countdownLabel = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const eventDate = new Date(`${eventOverview.eventDateIso}T00:00:00`);
    const daysRemaining = Math.ceil((eventDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (daysRemaining <= 0) return "Event week";
    return `${daysRemaining} Days`;
  }, []);

  const paxOptions = useMemo(() => [...getPaxListByAo("compass")], []);

  useEffect(() => {
    let isMounted = true;

    ensureSharedPlannerSeed()
      .then(() => {
        if (isMounted) setIsPlannerReady(true);
      })
      .catch((error) => {
        if (error?.code === "already-exists") {
          if (isMounted) setIsPlannerReady(true);
          return;
        }

        console.error("Unable to initialize shared event planner:", error);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isPlannerReady) return;

    const unsubscribe = onSnapshot(
      query(getLeadershipRolesCollection(), orderBy("order")),
      (snapshot) => {
        setLeadershipRoles(
          snapshot.docs.map((item) => {
            const data = item.data() as LeadershipRole & { order?: number };
            return {
              id: item.id,
              category: String(data.category ?? ""),
              role: String(data.role ?? ""),
              assignedTo: String(data.assignedTo ?? ""),
              notes: String(data.notes ?? ""),
            };
          })
        );
      },
      (error) => console.error("Leadership roles listener failed:", error)
    );

    return unsubscribe;
  }, [isPlannerReady]);

  useEffect(() => {
    if (!isPlannerReady) return;

    const unsubscribe = onSnapshot(
      query(getWorkoutSectionsCollection(), orderBy("order")),
      (snapshot) => {
        const sections = snapshot.docs.map((item) => {
          const data = item.data() as {
            title?: string;
            exerciseOptions?: string[];
          };

          return {
            id: item.id,
            title: String(data.title ?? ""),
            exerciseOptions: Array.isArray(data.exerciseOptions) ? data.exerciseOptions : [],
          };
        });

        setWorkoutSectionIds(sections.map((section) => section.id));
        setWorkoutPlan((current) =>
          sections.map((section) => ({
            ...section,
            exercises: current.find((entry) => entry.id === section.id)?.exercises ?? [],
          }))
        );
      },
      (error) => console.error("Workout sections listener failed:", error)
    );

    return unsubscribe;
  }, [isPlannerReady]);

  useEffect(() => {
    if (!isPlannerReady || workoutSectionIds.length === 0) return;

    const unsubscribers = workoutSectionIds.map((sectionId) =>
      onSnapshot(
        query(getWorkoutExercisesCollection(sectionId), orderBy("order")),
        (snapshot) => {
          const exercises = snapshot.docs.map((item) => {
            const data = item.data() as WorkoutExerciseRow & { order?: number };
            return {
              id: item.id,
              name: String(data.name ?? ""),
              details: String(data.details ?? ""),
            };
          });

          setWorkoutPlan((current) =>
            current.map((section) =>
              section.id === sectionId ? { ...section, exercises } : section
            )
          );
        },
        (error) => console.error(`Workout exercises listener failed for ${sectionId}:`, error)
      )
    );

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [isPlannerReady, workoutSectionIds.join("|")]);

  useEffect(() => {
    if (!isPlannerReady) return;

    const unsubscribe = onSnapshot(
      query(getSignupSectionsCollection("food"), orderBy("order")),
      (snapshot) => {
        const sections = snapshot.docs.map((item) => {
          const data = item.data() as { title?: string };
          return {
            id: item.id,
            title: String(data.title ?? ""),
          };
        });

        setFoodSectionIds(sections.map((section) => section.id));
        setFoodSections((current) =>
          sections.map((section) => ({
            ...section,
            items: current.find((entry) => entry.id === section.id)?.items ?? [],
          }))
        );
      },
      (error) => console.error("Food sections listener failed:", error)
    );

    return unsubscribe;
  }, [isPlannerReady]);

  useEffect(() => {
    if (!isPlannerReady || foodSectionIds.length === 0) return;

    const unsubscribers = foodSectionIds.map((sectionId) =>
      onSnapshot(
        query(getSignupItemsCollection("food", sectionId), orderBy("order")),
        (snapshot) => {
          const items = snapshot.docs.map((item) => {
            const data = item.data() as SignupItem & { order?: number };
            return {
              id: item.id,
              category: String(data.category ?? ""),
              item: String(data.item ?? ""),
              qtyNeeded: String(data.qtyNeeded ?? ""),
              assignees: Array.isArray(data.assignees)
                ? normalizeAssignees(String(data.qtyNeeded ?? ""), data.assignees)
                : [""],
              status: (data.status ?? "Open") as StatusValue,
              notes: String(data.notes ?? ""),
            };
          });

          setFoodSections((current) =>
            current.map((section) => (section.id === sectionId ? { ...section, items } : section))
          );
        },
        (error) => console.error(`Food items listener failed for ${sectionId}:`, error)
      )
    );

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [isPlannerReady, foodSectionIds.join("|")]);

  useEffect(() => {
    if (!isPlannerReady) return;

    const unsubscribe = onSnapshot(
      query(getSignupSectionsCollection("logistics"), orderBy("order")),
      (snapshot) => {
        const sections = snapshot.docs.map((item) => {
          const data = item.data() as { title?: string };
          return {
            id: item.id,
            title: String(data.title ?? ""),
          };
        });

        setLogisticsSectionIds(sections.map((section) => section.id));
        setLogisticsSections((current) =>
          sections.map((section) => ({
            ...section,
            items: current.find((entry) => entry.id === section.id)?.items ?? [],
          }))
        );
      },
      (error) => console.error("Logistics sections listener failed:", error)
    );

    return unsubscribe;
  }, [isPlannerReady]);

  useEffect(() => {
    if (!isPlannerReady || logisticsSectionIds.length === 0) return;

    const unsubscribers = logisticsSectionIds.map((sectionId) =>
      onSnapshot(
        query(getSignupItemsCollection("logistics", sectionId), orderBy("order")),
        (snapshot) => {
          const items = snapshot.docs.map((item) => {
            const data = item.data() as SignupItem & { order?: number };
            return {
              id: item.id,
              category: String(data.category ?? ""),
              item: String(data.item ?? ""),
              qtyNeeded: String(data.qtyNeeded ?? ""),
              assignees: Array.isArray(data.assignees)
                ? normalizeAssignees(String(data.qtyNeeded ?? ""), data.assignees)
                : [""],
              status: (data.status ?? "Open") as StatusValue,
              notes: String(data.notes ?? ""),
            };
          });

          setLogisticsSections((current) =>
            current.map((section) => (section.id === sectionId ? { ...section, items } : section))
          );
        },
        (error) => console.error(`Logistics items listener failed for ${sectionId}:`, error)
      )
    );

    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [isPlannerReady, logisticsSectionIds.join("|")]);

  const leadershipSummary = useMemo(() => {
    const filled = leadershipRoles.filter((role) => resolveRoleStatus(role) === "Filled").length;
    return {
      open: leadershipRoles.length - filled,
      filled,
      total: leadershipRoles.length,
    };
  }, [leadershipRoles]);

  const foodSummary = useMemo(() => {
    const items = foodSections.flatMap((section) => section.items);
    const slotSummary = items.reduce(
      (totals, item) => {
        const slots = normalizeAssignees(item.qtyNeeded, item.assignees);

        if (item.status === "Locked") {
          totals.filled += slots.filter(Boolean).length;
          return totals;
        }

        totals.filled += slots.filter(Boolean).length;
        totals.open += slots.filter((value) => !value).length;
        return totals;
      },
      { open: 0, filled: 0 }
    );

    return {
      open: slotSummary.open,
      filled: slotSummary.filled,
      locked: items.filter((item) => resolveSignupStatus(item) === "Locked").length,
      total: items.length,
    };
  }, [foodSections]);

  const logisticsSummary = useMemo(() => {
    const items = logisticsSections.flatMap((section) => section.items);
    return {
      open: items.filter((item) => resolveSignupStatus(item) === "Open").length,
      check: items.filter((item) => resolveSignupStatus(item) === "Check").length,
      total: items.length,
    };
  }, [logisticsSections]);

  const paxAssignments = useMemo(() => {
    const assignments = new Map<string, PaxAssignment[]>();

    const addAssignment = (name: SignupValue, assignment: PaxAssignment) => {
      if (!name) return;
      const current = assignments.get(name) ?? [];
      current.push(assignment);
      assignments.set(name, current);
    };

    leadershipRoles.forEach((role) => {
      addAssignment(role.assignedTo, {
        lane: "Leadership",
        detail: role.role || "Leadership role",
      });
    });

    foodSections.forEach((section) => {
      section.items.forEach((item) => {
        normalizeAssignees(item.qtyNeeded, item.assignees).forEach((assignee) => {
          addAssignment(assignee, {
            lane: "Food",
            detail: `${section.title}: ${item.item || "Item"}`,
          });
        });
      });
    });

    logisticsSections.forEach((section) => {
      section.items.forEach((item) => {
        normalizeAssignees(item.qtyNeeded, item.assignees).forEach((assignee) => {
          addAssignment(assignee, {
            lane: "Gear",
            detail: `${section.title}: ${item.item || "Item"}`,
          });
        });
      });
    });

    const paxOrder = new Map(paxOptions.map((name, index) => [name, index]));

    return Array.from(assignments.entries())
      .map(([name, items]) => ({
        name,
        items,
      }))
      .sort((left, right) => {
        const leftIndex = paxOrder.get(left.name);
        const rightIndex = paxOrder.get(right.name);

        if (leftIndex !== undefined && rightIndex !== undefined) return leftIndex - rightIndex;
        if (leftIndex !== undefined) return -1;
        if (rightIndex !== undefined) return 1;
        return left.name.localeCompare(right.name);
      });
  }, [foodSections, leadershipRoles, logisticsSections]);

  const filteredPaxAssignments = useMemo(() => {
    if (!selectedPaxName) return paxAssignments;
    return paxAssignments.filter((pax) => pax.name === selectedPaxName);
  }, [paxAssignments, selectedPaxName]);

  const updateLeadershipRole = (
    id: string,
    field: keyof LeadershipRole,
    value: string
  ) => {
    setLeadershipRoles((current) =>
      current.map((role) => (role.id === id ? { ...role, [field]: value } : role))
    );

    void setDoc(
      doc(getLeadershipRolesCollection(), id),
      {
        [field]: value,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    ).catch((error) => {
      console.error(`Failed to update leadership role ${id}:`, error);
    });
  };

  const addLeadershipRole = () => {
    const nextRole: LeadershipRole = {
      id: createId(),
      category: "Event",
      role: "",
      assignedTo: "",
      notes: "",
    };

    const order = getNextOrder(leadershipRoles);

    setLeadershipRoles((current) => [...current, nextRole]);

    void setDoc(doc(getLeadershipRolesCollection(), nextRole.id), {
      ...nextRole,
      order,
      updatedAt: serverTimestamp(),
    }).catch((error) => {
      console.error("Failed to add leadership role:", error);
    });
  };

  const removeLeadershipRole = (id: string) => {
    setLeadershipRoles((current) => current.filter((role) => role.id !== id));

    void (async () => {
      try {
        await deleteDoc(doc(getLeadershipRolesCollection(), id));

        const remaining = leadershipRoles.filter((role) => role.id !== id);
        const batch = writeBatch(db);
        remaining.forEach((role, index) => {
          batch.set(
            doc(getLeadershipRolesCollection(), role.id),
            { order: index, updatedAt: serverTimestamp() },
            { merge: true }
          );
        });
        await batch.commit();
      } catch (error) {
        console.error(`Failed to remove leadership role ${id}:`, error);
      }
    })();
  };

  const moveLeadershipRole = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;

    const draggedIndex = leadershipRoles.findIndex((role) => role.id === draggedId);
    const targetIndex = leadershipRoles.findIndex((role) => role.id === targetId);

    if (draggedIndex < 0 || targetIndex < 0) return;

    const next = [...leadershipRoles];
    const [draggedRole] = next.splice(draggedIndex, 1);
    next.splice(targetIndex, 0, draggedRole);
    setLeadershipRoles(next);

    void (async () => {
      try {
        const batch = writeBatch(db);
        next.forEach((role, index) => {
          batch.set(
            doc(getLeadershipRolesCollection(), role.id),
            { order: index, updatedAt: serverTimestamp() },
            { merge: true }
          );
        });
        await batch.commit();
      } catch (error) {
        console.error("Failed to reorder leadership roles:", error);
      }
    })();
  };

  const addWorkoutExercise = (sectionId: string) => {
    const nextExercise = createEmptyWorkoutExercise();
    const section = workoutPlan.find((entry) => entry.id === sectionId);
    const order = section ? getNextOrder(section.exercises) : 0;

    setWorkoutPlan((current) =>
      current.map((item) =>
        item.id === sectionId
          ? { ...item, exercises: [...item.exercises, nextExercise] }
          : item
      )
    );

    void setDoc(doc(getWorkoutExercisesCollection(sectionId), nextExercise.id), {
      ...nextExercise,
      order,
      updatedAt: serverTimestamp(),
    }).catch((error) => {
      console.error(`Failed to add workout exercise for ${sectionId}:`, error);
    });
  };

  const updateWorkoutExercise = (
    sectionId: string,
    exerciseId: string,
    field: keyof WorkoutExerciseRow,
    value: string
  ) => {
    setWorkoutPlan((current) =>
      current.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              exercises: section.exercises.map((exercise) =>
                exercise.id === exerciseId ? { ...exercise, [field]: value } : exercise
              ),
            }
          : section
      )
    );

    void setDoc(
      doc(getWorkoutExercisesCollection(sectionId), exerciseId),
      {
        [field]: value,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    ).catch((error) => {
      console.error(`Failed to update workout exercise ${exerciseId}:`, error);
    });
  };

  const removeWorkoutExercise = (sectionId: string, exerciseId: string) => {
    const section = workoutPlan.find((entry) => entry.id === sectionId);
    if (!section) return;

    const remainingExercises = section.exercises.filter((exercise) => exercise.id !== exerciseId);

    if (remainingExercises.length === 0) {
      setWorkoutPlan((current) =>
        current.map((item) =>
          item.id === sectionId
            ? {
                ...item,
                exercises: item.exercises.map((exercise) =>
                  exercise.id === exerciseId ? { ...exercise, name: "", details: "" } : exercise
                ),
              }
            : item
        )
      );

      void setDoc(
        doc(getWorkoutExercisesCollection(sectionId), exerciseId),
        {
          name: "",
          details: "",
          order: 0,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ).catch((error) => {
        console.error(`Failed to reset workout exercise ${exerciseId}:`, error);
      });

      return;
    }

    setWorkoutPlan((current) =>
      current.map((item) =>
        item.id === sectionId ? { ...item, exercises: remainingExercises } : item
      )
    );

    void (async () => {
      try {
        await deleteDoc(doc(getWorkoutExercisesCollection(sectionId), exerciseId));

        const batch = writeBatch(db);
        remainingExercises.forEach((exercise, index) => {
          batch.set(
            doc(getWorkoutExercisesCollection(sectionId), exercise.id),
            { order: index, updatedAt: serverTimestamp() },
            { merge: true }
          );
        });
        await batch.commit();
      } catch (error) {
        console.error(`Failed to remove workout exercise ${exerciseId}:`, error);
      }
    })();
  };

  const addSignupItem = (group: SignupGroup, sectionId: string) => {
    const nextItem: SignupItem = {
      id: createId(),
      category: "",
      item: "",
      qtyNeeded: "",
      assignees: [""],
      status: "Open",
      notes: "",
    };

    const sections = group === "food" ? foodSections : logisticsSections;
    const section = sections.find((entry) => entry.id === sectionId);
    const order = section ? getNextOrder(section.items) : 0;
    const setter = group === "food" ? setFoodSections : setLogisticsSections;

    setter((current) =>
      current.map((item) =>
        item.id === sectionId ? { ...item, items: [...item.items, nextItem] } : item
      )
    );

    void setDoc(doc(getSignupItemsCollection(group, sectionId), nextItem.id), {
      ...nextItem,
      assignees: normalizeAssignees(nextItem.qtyNeeded, nextItem.assignees),
      order,
      updatedAt: serverTimestamp(),
    }).catch((error) => {
      console.error(`Failed to add ${group} signup item:`, error);
    });
  };

  const removeSignupItem = (group: SignupGroup, sectionId: string, itemId: string) => {
    const sections = group === "food" ? foodSections : logisticsSections;
    const setter = group === "food" ? setFoodSections : setLogisticsSections;
    const section = sections.find((entry) => entry.id === sectionId);
    if (!section) return;

    const remainingItems = section.items.filter((item) => item.id !== itemId);

    setter((current) =>
      current.map((item) =>
        item.id === sectionId ? { ...item, items: remainingItems } : item
      )
    );

    void (async () => {
      try {
        await deleteDoc(doc(getSignupItemsCollection(group, sectionId), itemId));

        const batch = writeBatch(db);
        remainingItems.forEach((item, index) => {
          batch.set(
            doc(getSignupItemsCollection(group, sectionId), item.id),
            { order: index, updatedAt: serverTimestamp() },
            { merge: true }
          );
        });
        await batch.commit();
      } catch (error) {
        console.error(`Failed to remove ${group} signup item ${itemId}:`, error);
      }
    })();
  };

  const updateSignupItem = (
    group: SignupGroup,
    sectionId: string,
    itemId: string,
    field: keyof SignupItem,
    value: string
  ) => {
    const setter = group === "food" ? setFoodSections : setLogisticsSections;
    let nextItemForWrite: SignupItem | null = null;

    setter((current) =>
      current.map((section) => {
        if (section.id !== sectionId) return section;
        return {
          ...section,
          items: section.items.map((item) => {
            if (item.id !== itemId) return item;
            const nextItem = { ...item, [field]: value };
            if (field === "qtyNeeded") {
              nextItem.assignees = normalizeAssignees(value, item.assignees);
            }
            nextItemForWrite = nextItem;
            return nextItem;
          }),
        };
      })
    );

    if (!nextItemForWrite) return;

    void setDoc(
      doc(getSignupItemsCollection(group, sectionId), itemId),
      {
        ...nextItemForWrite,
        assignees: normalizeAssignees(nextItemForWrite.qtyNeeded, nextItemForWrite.assignees),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    ).catch((error) => {
      console.error(`Failed to update ${group} signup item ${itemId}:`, error);
    });
  };

  const updateSignupAssignee = (
    group: SignupGroup,
    sectionId: string,
    itemId: string,
    index: number,
    value: SignupValue
  ) => {
    const setter = group === "food" ? setFoodSections : setLogisticsSections;
    let nextAssignees: SignupValue[] | null = null;

    setter((current) =>
      current.map((section) => {
        if (section.id !== sectionId) return section;
        return {
          ...section,
          items: section.items.map((item) => {
            if (item.id !== itemId) return item;
            const assignees = normalizeAssignees(item.qtyNeeded, item.assignees);
            assignees[index] = value;
             nextAssignees = assignees;
            return { ...item, assignees };
          }),
        };
      })
    );

    if (!nextAssignees) return;

    void setDoc(
      doc(getSignupItemsCollection(group, sectionId), itemId),
      {
        assignees: nextAssignees,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    ).catch((error) => {
      console.error(`Failed to update ${group} assignee for ${itemId}:`, error);
    });
  };

  const renderLeadershipTab = () => (
    <section className={shellClass}>
      <div className="flex items-start justify-between gap-3 border-b border-slate-700 px-3 py-2.5 sm:flex-col sm:items-center sm:justify-center sm:px-4 sm:py-3">
        <div className="flex min-w-0 items-start gap-3 sm:text-center">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/15 p-2 text-amber-200">
            <UserGroupIcon />
          </div>
          <div className="min-w-0 flex-1 pt-0.5 sm:flex sm:flex-col sm:items-center">
            <h2 className="text-lg font-semibold text-white sm:text-xl">Roles</h2>
            <p className="mt-0.5 min-w-0 text-sm text-slate-300">Volunteer to lead.</p>
          </div>
        </div>
        <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap text-xs sm:flex-wrap sm:justify-center">
          <span className="rounded-md border border-slate-600 bg-slate-900/70 px-2 py-1 text-slate-300">
            Open <span className="font-semibold text-white">{leadershipSummary.open}</span>
          </span>
          <span className="rounded-md border border-slate-600 bg-slate-900/70 px-2 py-1 text-slate-300">
            Filled <span className="font-semibold text-white">{leadershipSummary.filled}</span>
          </span>
          <button
            type="button"
            onClick={addLeadershipRole}
            className="rounded-md border border-slate-600 bg-slate-900/70 px-2 py-1 text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
          >
            Add
          </button>
        </div>
      </div>
      <div className="space-y-4 px-2 py-2.5 sm:px-3 sm:py-3">
        <div className="overflow-x-auto rounded-lg border border-slate-700 bg-slate-800/50 lg:mx-auto lg:max-w-4xl">
          <table className="w-full text-left">
            <thead className="bg-slate-900/60">
              <tr>
                <th className="min-w-[146px] px-1 py-2 text-xs text-slate-400 sm:px-1 lg:min-w-0">
                  Role
                </th>
                <th className="min-w-[118px] px-1 py-2 text-xs text-slate-400 sm:min-w-[191px] sm:px-1 lg:w-[220px] lg:min-w-[220px] lg:max-w-[220px]">
                  Volunteer
                </th>
                <th className="w-[40px] px-1 py-2 text-xs text-slate-400 sm:px-1 lg:w-[48px]"> </th>
              </tr>
            </thead>
            <tbody>
              {leadershipRoles.map((role) => {
                return (
                  <tr
                    key={role.id}
                    draggable
                    onDragStart={() => setDraggedLeadershipRoleId(role.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (draggedLeadershipRoleId) {
                        moveLeadershipRole(draggedLeadershipRoleId, role.id);
                      }
                      setDraggedLeadershipRoleId(null);
                    }}
                    onDragEnd={() => setDraggedLeadershipRoleId(null)}
                    className={`border-t border-slate-700 align-top ${
                      draggedLeadershipRoleId === role.id ? "opacity-50" : ""
                    }`}
                  >
                    <td className="min-w-[210px] px-1 py-2 sm:min-w-[292px] sm:px-1 lg:min-w-0">
                      <input
                        value={role.role}
                        onChange={(event) =>
                          updateLeadershipRole(role.id, "role", event.target.value)
                        }
                        className={`${compactInputClass} w-[202px] min-w-[202px] max-w-[202px] sm:w-[284px] sm:min-w-[284px] sm:max-w-[284px] lg:w-full lg:min-w-0 lg:max-w-none`}
                        placeholder="Role"
                      />
                    </td>
                    <td className="min-w-[118px] px-1 py-2 sm:min-w-[191px] sm:px-1 lg:w-[220px] lg:min-w-[220px] lg:max-w-[220px]">
                      <select
                        value={role.assignedTo}
                        onChange={(event) =>
                          updateLeadershipRole(role.id, "assignedTo", event.target.value)
                        }
                        className={`${compactInputClass} w-[110px] min-w-[110px] max-w-[110px] sm:w-[183px] sm:min-w-[183px] sm:max-w-[183px] lg:w-full lg:min-w-0 lg:max-w-none`}
                      >
                        <option value="">Open</option>
                        {paxOptions.map((pax) => (
                          <option key={pax} value={pax}>
                            {pax}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="w-[40px] px-1 py-2 sm:px-1 lg:w-[48px]">
                      <button
                        type="button"
                        onClick={() => removeLeadershipRole(role.id)}
                        aria-label="Remove role"
                        className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center text-slate-500 transition-colors hover:text-red-500"
                      >
                        <TrashIcon />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );

  const renderWorkoutTab = () => (
    <section className={shellClass}>
      <div className="flex items-start justify-between gap-3 border-b border-slate-700 px-3 py-2.5 sm:flex-col sm:items-center sm:justify-center sm:px-4 sm:py-3">
        <div className="flex min-w-0 items-start gap-3 sm:text-center">
          <div className="rounded-lg border border-red-500/30 bg-red-500/15 p-2 text-red-200">
            <CalendarIcon />
          </div>
          <div className="min-w-0 flex-1 pt-0.5 sm:flex sm:flex-col sm:items-center">
            <div className="flex min-w-0 items-baseline gap-2 sm:flex-col sm:items-center sm:gap-0.5">
              <h2 className="text-lg font-semibold text-white sm:text-xl">Workout Plan</h2>
              <p className="min-w-0 text-sm text-slate-300">Exercises for each station.</p>
            </div>
          </div>
        </div>
      </div>
      <div className="space-y-4 px-2 py-2.5 sm:px-3 sm:py-3 lg:mx-auto lg:max-w-4xl">
          {workoutPlan.map((section) => (
            <div key={section.id} className={sectionClass}>
              <div className="flex items-center justify-between gap-3 border-b border-slate-700 px-2.5 py-2.5 sm:flex-col sm:items-center sm:justify-center sm:px-3">
                <div className="flex min-w-0 items-center gap-2 sm:flex-col sm:text-center">
                  <h3 className="text-base font-semibold text-white">{section.title}</h3>
                  {(() => {
                    const exerciseCount = section.exercises.filter((exercise) => exercise.name).length;

                    return (
                      <div className="text-xs text-slate-400">
                        {exerciseCount} {exerciseCount === 1 ? "Exercise" : "Exercises"}
                      </div>
                    );
                  })()}
                </div>
                <button
                  type="button"
                  onClick={() => addWorkoutExercise(section.id)}
                  className="rounded-md border border-slate-600 bg-slate-900/70 px-2 py-1 text-xs text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
                >
                  Add Exercise
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-[326px] min-w-[326px] table-fixed text-left sm:w-[458px] sm:min-w-[458px] lg:w-full lg:min-w-0">
                  <tbody>
                    {section.exercises.map((exercise, index) => (
                      <tr
                        key={exercise.id}
                        className={`${index === 0 ? "" : "border-t border-slate-700"} align-top`}
                      >
                        <td className="w-[135px] min-w-[135px] max-w-[135px] px-1.5 py-2 pr-3 sm:w-[160px] sm:min-w-[160px] sm:max-w-[160px] sm:px-2 sm:pr-4 lg:w-[240px] lg:min-w-[240px] lg:max-w-[240px]">
                          {isCustomWorkoutExerciseName(exercise.name, section.exerciseOptions) ? (
                            <input
                              value={exercise.name}
                              onChange={(event) =>
                                updateWorkoutExercise(
                                  section.id,
                                  exercise.id,
                                  "name",
                                  event.target.value
                                )
                              }
                              className={`${compactInputClass} w-[135px] min-w-[135px] max-w-[135px] sm:w-[160px] sm:min-w-[160px] sm:max-w-[160px] lg:w-full lg:min-w-0 lg:max-w-none`}
                              placeholder="Custom exercise"
                            />
                          ) : (
                            <select
                              value={exercise.name}
                              onChange={(event) =>
                                updateWorkoutExercise(
                                  section.id,
                                  exercise.id,
                                  "name",
                                  event.target.value === "__custom__" ? "Custom Exercise" : event.target.value
                                )
                              }
                              className={`${compactInputClass} w-[135px] min-w-[135px] max-w-[135px] sm:w-[160px] sm:min-w-[160px] sm:max-w-[160px] lg:w-full lg:min-w-0 lg:max-w-none`}
                            >
                              <option value="">Select exercise</option>
                              {section.exerciseOptions.map((name, index) => (
                                <option key={`${section.id}-${name}-${index}`} value={name}>
                                  {name}
                                </option>
                              ))}
                              <option value="__custom__">Custom</option>
                            </select>
                          )}
                        </td>
                        <td className="w-[224px] min-w-[224px] max-w-[224px] px-1.5 py-2 pl-3 sm:w-[369px] sm:min-w-[369px] sm:max-w-[369px] sm:px-2 sm:pl-4 lg:w-auto lg:min-w-0 lg:max-w-none">
                          <div className="flex items-center gap-2">
                            <input
                              value={exercise.details}
                              onChange={(event) =>
                                updateWorkoutExercise(
                                  section.id,
                                  exercise.id,
                                  "details",
                                  event.target.value
                                )
                              }
                              className={`${compactInputClass} w-[188px] min-w-[188px] max-w-[188px] sm:w-[333px] sm:min-w-[333px] sm:max-w-[333px] lg:w-full lg:min-w-0 lg:max-w-none`}
                              placeholder="Reps, IC, distance"
                            />
                            <button
                              type="button"
                              onClick={() => removeWorkoutExercise(section.id, exercise.id)}
                              aria-label="Remove exercise"
                              className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center text-slate-500 transition-colors hover:text-red-500"
                            >
                              <TrashIcon />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
      </div>
    </section>
  );

  const renderFoodTab = () => (
    <section className={shellClass}>
      <div className="flex items-start justify-between gap-3 border-b border-slate-700 px-3 py-2.5 sm:flex-col sm:items-center sm:justify-center sm:px-4 sm:py-3">
        <div className="flex min-w-0 items-start gap-3 sm:text-center">
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/15 p-2 text-emerald-200">
            <DocumentTextIcon />
          </div>
          <div className="min-w-0 flex-1 pt-0.5 sm:flex sm:flex-col sm:items-center">
            <h2 className="text-lg font-semibold text-white sm:text-xl">Coffeteria</h2>
            <p className="mt-0.5 min-w-0 text-sm text-slate-300">Volunteer to bring food.</p>
          </div>
        </div>
        <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap text-xs sm:flex-wrap sm:justify-center">
          <span className="rounded-md border border-slate-600 bg-slate-900/70 px-2 py-1 text-slate-300">
            Open <span className="font-semibold text-white">{foodSummary.open}</span>
          </span>
          <span className="rounded-md border border-slate-600 bg-slate-900/70 px-2 py-1 text-slate-300">
            Filled <span className="font-semibold text-white">{foodSummary.filled}</span>
          </span>
        </div>
      </div>
      <div className="space-y-4 px-2 py-2.5 sm:px-3 sm:py-3">
        <div className="space-y-4 xl:grid xl:grid-cols-2 xl:items-start xl:gap-4 xl:space-y-0 2xl:grid-cols-3">
          {foodSections.map((section) => (
            <div key={section.id} className={sectionClass}>
              {(() => {
                const sectionSummary = section.items.reduce(
                  (totals, item) => {
                    const slots = normalizeAssignees(item.qtyNeeded, item.assignees);

                    totals.filled += slots.filter(Boolean).length;

                    if (item.status !== "Locked") {
                      totals.open += slots.filter((value) => !value).length;
                    }

                    return totals;
                  },
                  { open: 0, filled: 0 }
                );

                return (
              <div className="flex items-center justify-between gap-3 border-b border-slate-700 px-2.5 py-2.5 sm:flex-col sm:items-center sm:justify-center sm:px-3">
                <div className="min-w-0 sm:text-center">
                  <h3 className="text-base font-semibold text-white">{section.title}</h3>
                  <div className="mt-1 text-xs text-slate-400">
                    Filled {sectionSummary.filled} · Open {sectionSummary.open}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => addSignupItem("food", section.id)}
                  className="rounded-md border border-slate-600 bg-slate-900/70 px-2 py-1 text-xs text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
                >
                  Add Item
                </button>
              </div>
                );
              })()}

              <div className="overflow-x-auto">
                <table className="w-[370px] min-w-[370px] table-fixed text-left sm:w-[473px] sm:min-w-[473px] xl:w-full xl:min-w-0">
                  <thead className="bg-slate-900/60">
                    <tr>
                      <th className="w-[160px] min-w-[160px] max-w-[160px] px-1.5 py-2 pr-2 text-xs text-slate-400 sm:px-2 sm:pr-2 xl:w-auto xl:min-w-0 xl:max-w-none">Item</th>
                      <th className="w-[44px] min-w-[44px] max-w-[44px] px-1.5 py-2 pl-2 pr-2 text-xs text-slate-400 sm:px-2 sm:pl-2 sm:pr-2 xl:w-[56px] xl:min-w-[56px] xl:max-w-[56px]">Qty</th>
                      <th className="w-[118px] min-w-[118px] max-w-[118px] px-1 py-2 pl-2 text-xs text-slate-400 sm:w-[191px] sm:min-w-[191px] sm:max-w-[191px] sm:px-1 sm:pl-2 xl:w-[210px] xl:min-w-[210px] xl:max-w-[210px]">
                        Volunteer
                      </th>
                      <th className="w-[40px] px-1 py-2 text-xs text-slate-400 sm:px-1 xl:w-[48px]"> </th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.items.map((item) => {
                      const assignees = normalizeAssignees(item.qtyNeeded, item.assignees);

                      return (
                        <tr key={item.id} className="border-t border-slate-700 align-top">
                          <td className="w-[160px] min-w-[160px] max-w-[160px] px-1.5 py-2 pr-2 sm:px-2 sm:pr-2 xl:w-auto xl:min-w-0 xl:max-w-none">
                            <input
                              value={item.item}
                              onChange={(event) =>
                                updateSignupItem(
                                  "food",
                                  section.id,
                                  item.id,
                                  "item",
                                  event.target.value
                                )
                              }
                              className={`${compactInputClass} w-[154px] min-w-[154px] max-w-[154px] xl:w-full xl:min-w-0 xl:max-w-none`}
                              placeholder="Item"
                            />
                          </td>
                          <td className="w-[44px] min-w-[44px] max-w-[44px] px-1.5 py-2 pl-2 pr-2 sm:px-2 sm:pl-2 sm:pr-2 xl:w-[56px] xl:min-w-[56px] xl:max-w-[56px]">
                            <input
                              value={item.qtyNeeded}
                              onChange={(event) =>
                                updateSignupItem(
                                  "food",
                                  section.id,
                                  item.id,
                                  "qtyNeeded",
                                  event.target.value
                                )
                              }
                              className={`${compactInputClass} w-[36px] min-w-[36px] max-w-[36px] xl:w-full xl:min-w-0 xl:max-w-none`}
                              placeholder="1"
                            />
                          </td>
                          <td className="w-[118px] min-w-[118px] max-w-[118px] px-1 py-2 pl-2 sm:w-[191px] sm:min-w-[191px] sm:max-w-[191px] sm:px-1 sm:pl-2 xl:w-[210px] xl:min-w-[210px] xl:max-w-[210px]">
                            <div className="space-y-2">
                              {assignees.map((assignee, index) => (
                                <select
                                  key={`${item.id}-food-volunteer-${index}`}
                                  value={assignee}
                                  onChange={(event) =>
                                    updateSignupAssignee(
                                      "food",
                                      section.id,
                                      item.id,
                                      index,
                                      event.target.value
                                    )
                                  }
                                  className={`${compactInputClass} w-[110px] min-w-[110px] max-w-[110px] sm:w-[183px] sm:min-w-[183px] sm:max-w-[183px] xl:w-full xl:min-w-0 xl:max-w-none`}
                                >
                                  <option value="">Open</option>
                                  {paxOptions.map((pax) => (
                                    <option key={pax} value={pax}>
                                      {pax}
                                    </option>
                                  ))}
                                </select>
                              ))}
                            </div>
                          </td>
                          <td className="w-[40px] px-1 py-2 sm:px-1 xl:w-[48px]">
                            <button
                              type="button"
                              onClick={() => removeSignupItem("food", section.id, item.id)}
                              aria-label="Remove item"
                              className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center text-slate-500 transition-colors hover:text-red-500"
                            >
                              <TrashIcon />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );

  const renderLogisticsTab = () => (
    <section className={shellClass}>
      <div className="flex items-start justify-between gap-3 border-b border-slate-700 px-3 py-2.5 sm:flex-col sm:items-center sm:justify-center sm:px-4 sm:py-3">
        <div className="flex min-w-0 items-start gap-3 sm:text-center">
          <div className="rounded-lg border border-sky-500/30 bg-sky-500/15 p-2 text-sky-200">
            <ClipboardListIcon />
          </div>
          <div className="min-w-0 flex-1 pt-0.5 sm:flex sm:flex-col sm:items-center">
            <h2 className="text-lg font-semibold text-white sm:text-xl">Supplies</h2>
            <p className="mt-0.5 min-w-0 text-sm text-slate-300">Donate/lend supplies.</p>
          </div>
        </div>
        <div className="flex flex-nowrap items-center gap-2 whitespace-nowrap text-xs sm:flex-wrap sm:justify-center">
          <span className="rounded-md border border-slate-600 bg-slate-900/70 px-2 py-1 text-slate-300">
            Open <span className="font-semibold text-white">{logisticsSummary.open}</span>
          </span>
          <span className="rounded-md border border-slate-600 bg-slate-900/70 px-2 py-1 text-slate-300">
            Review <span className="font-semibold text-white">{logisticsSummary.check}</span>
          </span>
        </div>
      </div>
      <div className="space-y-4 px-2 py-2.5 sm:px-3 sm:py-3">
        <div className="space-y-4 xl:grid xl:grid-cols-2 xl:items-start xl:gap-4 xl:space-y-0">
          {logisticsSections.map((section) => (
            <div key={section.id} className={sectionClass}>
              {(() => {
                const sectionSummary = section.items.reduce(
                  (totals, item) => {
                    const status = resolveSignupStatus(item);

                    if (status === "Check") {
                      totals.check += 1;
                    } else if (status === "Open") {
                      totals.open += 1;
                    }

                    return totals;
                  },
                  { open: 0, check: 0 }
                );

                return (
              <div className="flex items-center justify-between gap-3 border-b border-slate-700 px-2.5 py-2.5 sm:flex-col sm:items-center sm:justify-center sm:px-3">
                <div className="min-w-0 sm:text-center">
                  <h3 className="text-base font-semibold text-white">{section.title}</h3>
                  <div className="mt-1 text-xs text-slate-400">
                    Open {sectionSummary.open} · Review {sectionSummary.check}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => addSignupItem("logistics", section.id)}
                  className="rounded-md border border-slate-600 bg-slate-900/70 px-2 py-1 text-xs text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
                >
                  Add Item
                </button>
              </div>
                );
              })()}

              <div className="overflow-x-auto">
                <table className="w-[370px] min-w-[370px] table-fixed text-left sm:w-[473px] sm:min-w-[473px] xl:w-full xl:min-w-0">
                  <thead className="bg-slate-900/60">
                    <tr>
                      <th className="w-[168px] min-w-[168px] max-w-[168px] px-1.5 py-2 pr-2 text-xs text-slate-400 sm:px-2 sm:pr-2 xl:w-auto xl:min-w-0 xl:max-w-none">Item</th>
                      <th className="w-[32px] min-w-[32px] max-w-[32px] px-1.5 py-2 pl-2 pr-2 text-xs text-slate-400 sm:px-2 sm:pl-2 sm:pr-2 xl:w-[56px] xl:min-w-[56px] xl:max-w-[56px]">Qty</th>
                      <th className="w-[118px] min-w-[118px] max-w-[118px] px-1 py-2 pl-2 text-xs text-slate-400 sm:w-[191px] sm:min-w-[191px] sm:max-w-[191px] sm:px-1 sm:pl-2 xl:w-[210px] xl:min-w-[210px] xl:max-w-[210px]">
                        Volunteer
                      </th>
                      <th className="w-[40px] px-1 py-2 pl-2 text-xs text-slate-400 sm:px-1 sm:pl-2 xl:w-[48px]"> </th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.items.map((item) => {
                      const assignees = normalizeAssignees(item.qtyNeeded, item.assignees);

                      return (
                        <tr key={item.id} className="border-t border-slate-700 align-top">
                          <td className="w-[168px] min-w-[168px] max-w-[168px] px-1.5 py-2 pr-2 sm:px-2 sm:pr-2 xl:w-auto xl:min-w-0 xl:max-w-none">
                            <input
                              value={item.item}
                              onChange={(event) =>
                                updateSignupItem(
                                  "logistics",
                                  section.id,
                                  item.id,
                                  "item",
                                  event.target.value
                                )
                              }
                              className={`${compactInputClass} w-[162px] min-w-[162px] max-w-[162px] xl:w-full xl:min-w-0 xl:max-w-none`}
                              placeholder="Item"
                            />
                          </td>
                          <td className="w-[32px] min-w-[32px] max-w-[32px] px-1.5 py-2 pl-2 pr-2 sm:px-2 sm:pl-2 sm:pr-2 xl:w-[56px] xl:min-w-[56px] xl:max-w-[56px]">
                            <input
                              value={item.qtyNeeded}
                              onChange={(event) =>
                                updateSignupItem(
                                  "logistics",
                                  section.id,
                                  item.id,
                                  "qtyNeeded",
                                  event.target.value
                                )
                              }
                              className={`${compactInputClass} w-[24px] min-w-[24px] max-w-[24px] xl:w-full xl:min-w-0 xl:max-w-none`}
                              placeholder="1"
                            />
                          </td>
                          <td className="w-[118px] min-w-[118px] max-w-[118px] px-1 py-2 pl-2 sm:w-[191px] sm:min-w-[191px] sm:max-w-[191px] sm:px-1 sm:pl-2 xl:w-[210px] xl:min-w-[210px] xl:max-w-[210px]">
                            <div className="space-y-2">
                              {assignees.map((assignee, index) => (
                                <select
                                  key={`${item.id}-logistics-volunteer-${index}`}
                                  value={assignee}
                                  onChange={(event) =>
                                    updateSignupAssignee(
                                      "logistics",
                                      section.id,
                                      item.id,
                                      index,
                                      event.target.value
                                    )
                                  }
                                  disabled={item.status === "Locked"}
                                  className={`${compactInputClass} w-[110px] min-w-[110px] max-w-[110px] sm:w-[183px] sm:min-w-[183px] sm:max-w-[183px] xl:w-full xl:min-w-0 xl:max-w-none ${
                                    item.status === "Locked" ? "cursor-not-allowed opacity-70" : ""
                                  }`}
                                >
                                  <option value="">Open</option>
                                  {paxOptions.map((pax) => (
                                    <option key={pax} value={pax}>
                                      {pax}
                                    </option>
                                  ))}
                                </select>
                              ))}
                            </div>
                          </td>
                          <td className="w-[40px] px-1 py-2 pl-2 sm:px-1 sm:pl-2 xl:w-[48px]">
                            <button
                              type="button"
                              onClick={() => removeSignupItem("logistics", section.id, item.id)}
                              aria-label="Remove item"
                              className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center text-slate-500 transition-colors hover:text-red-500"
                            >
                              <TrashIcon />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );

  const renderPaxTab = () => (
    <section className={shellClass}>
      <div className="flex items-start justify-between gap-3 border-b border-slate-700 px-3 py-2.5 sm:flex-col sm:items-center sm:justify-center sm:px-4 sm:py-3">
        <div className="flex min-w-0 items-start gap-3 sm:text-center">
          <div className="rounded-lg border border-violet-500/30 bg-violet-500/15 p-2 text-violet-200">
            <UserGroupIcon />
          </div>
          <div className="min-w-0 flex-1 pt-0.5 sm:flex sm:flex-col sm:items-center">
            <h2 className="text-lg font-semibold text-white sm:text-xl">Duties</h2>
            <p className="mt-0.5 min-w-0 text-sm text-slate-300">
              Everything you're accountable for.
            </p>
          </div>
        </div>
        <div className="relative flex-shrink-0 sm:flex sm:justify-center">
          <button
            type="button"
            onClick={() => setIsPaxFilterOpen((current) => !current)}
            className="min-h-[36px] rounded-md border border-slate-600 bg-slate-900/70 px-2 py-1.5 text-sm font-semibold text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
          >
            {selectedPaxName || "Filter"}
          </button>
          {isPaxFilterOpen ? (
            <div className="absolute right-0 top-full z-10 mt-2 w-52 rounded-lg border border-slate-700 bg-slate-900 p-2 shadow-xl sm:left-1/2 sm:right-auto sm:-translate-x-1/2">
              <button
                type="button"
                onClick={() => {
                  setSelectedPaxName("");
                  setIsPaxFilterOpen(false);
                }}
                className={`w-full rounded-md px-2 py-1 text-left text-xs transition-colors ${
                  !selectedPaxName
                    ? "bg-violet-500/15 text-violet-200"
                    : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
              >
                All PAX
              </button>
              <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">
                {paxAssignments.map((pax) => (
                  <button
                    key={`filter-${pax.name}`}
                    type="button"
                    onClick={() => {
                      setSelectedPaxName(pax.name);
                      setIsPaxFilterOpen(false);
                    }}
                    className={`w-full rounded-md px-2 py-1 text-left text-xs transition-colors ${
                      selectedPaxName === pax.name
                        ? "bg-violet-500/15 text-violet-200"
                        : "text-slate-300 hover:bg-slate-800 hover:text-white"
                    }`}
                  >
                    {pax.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <div className="space-y-4 px-2 py-2.5 sm:px-3 sm:py-3">
        {filteredPaxAssignments.length === 0 ? (
          <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-4 text-sm text-slate-300">
            {selectedPaxName ? "No matching PAX assignments." : "No PAX assignments yet."}
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-5">
            {filteredPaxAssignments.map((pax) => (
              <div key={pax.name} className={itemCardClass}>
                {(() => {
                  const groupedItems = pax.items.reduce(
                    (groups, item) => {
                      const current = groups.get(item.lane) ?? [];
                      current.push(item.detail);
                      groups.set(item.lane, current);
                      return groups;
                    },
                    new Map<string, string[]>()
                  );

                  return (
                <>
                  <div className="flex items-start gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <h3 className="text-base font-semibold text-white">{pax.name}</h3>
                      <div className="text-xs text-slate-400">
                        {pax.items.length} assignment{pax.items.length === 1 ? "" : "s"}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 space-y-2">
                    {Array.from(groupedItems.entries()).map(([lane, details]) => (
                      <div
                        key={`${pax.name}-${lane}`}
                        className="rounded-md border border-slate-700 bg-slate-900/70 px-3 py-2"
                      >
                        <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">
                          {lane}
                        </div>
                        <div className="mt-1 space-y-1">
                          {details.map((detail, index) => (
                            <div key={`${pax.name}-${lane}-${index}`} className="text-sm text-slate-100">
                              {detail}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
                  );
                })()}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );

  if (!isPlannerReady) {
    return (
      <section className={shellClass}>
        <div className="border-b border-slate-700 px-4 py-3 text-center">
          <h1 className="text-xl font-semibold text-white">{eventOverview.title}</h1>
          <p className="mt-1 text-sm text-slate-300">Connecting to the shared event planner...</p>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-4 pb-28 sm:pb-0">
      <section className={shellClass}>
        <div className="border-b border-slate-700 px-4 py-2.5 sm:px-5 sm:py-3">
          <div className="space-y-1.5 sm:flex sm:flex-col sm:items-center sm:text-center">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-white sm:text-[1.7rem]">
                {eventOverview.title}
              </h1>
            </div>
            <div className="flex flex-wrap gap-1.5 sm:justify-center">
              <SummaryCard label="Date" value={eventOverview.dateLabel} />
              <SummaryCard label="Countdown" value={countdownLabel} />
            </div>
          </div>
        </div>

        <div className="hidden p-2 sm:block sm:p-3">
          <div className="sm:flex sm:justify-center sm:gap-2">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex min-h-[48px] items-center justify-center gap-2 rounded-lg border px-3 py-2 text-center transition-colors ${
                    isActive
                      ? `${tab.accent} shadow-[0_10px_24px_rgba(15,23,42,0.35)]`
                      : "border-slate-700 bg-slate-900/60 text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  <span className="flex h-5 w-5 items-center justify-center">{tab.icon}</span>
                  <span className="text-sm font-semibold">{tab.mobileLabel}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {activeTab === "leadership" && renderLeadershipTab()}
      {activeTab === "workout" && renderWorkoutTab()}
      {activeTab === "food" && renderFoodTab()}
      {activeTab === "logistics" && renderLogisticsTab()}
      {activeTab === "pax" && renderPaxTab()}

      <div className="sm:hidden fixed inset-x-0 bottom-4 z-10 px-3">
        <div className="mx-auto max-w-md rounded-[28px] border border-slate-700/80 bg-slate-900/95 p-2 shadow-[0_16px_40px_rgba(0,0,0,0.45)] backdrop-blur">
          <div
            className="grid gap-1"
            style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
          >
            {tabs.map((tab) => {
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={`mobile-${tab.key}`}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 transition-colors ${
                    isActive
                      ? "bg-red-600 text-white shadow-[0_10px_24px_rgba(220,38,38,0.35)]"
                      : "text-slate-300"
                  }`}
                >
                  <span className="flex h-5 items-center">{tab.icon}</span>
                  <span className="text-[11px] leading-none">{tab.mobileLabel}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EventPlannerMock;
