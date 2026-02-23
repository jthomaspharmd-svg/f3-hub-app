export interface Exercise {
  id: string; // Unique ID for React keys
  name: string;
  reps?: string;
  cadence?: string;
}

export interface WorkoutRound {
  id: string;
  name: string;
  exercises: Exercise[];

  // NEW: Optional per-round description (Planner + Backblast)
  description?: string;

  timerSeconds?: number;
  timerRepeatCount?: number;
}

export interface PlannerData {
  q: string;
  warmup: Exercise[];

  // NEW: Optional warmup section description (Planner + Backblast)
  warmupDescription?: string;

  theThang: WorkoutRound[];
}

/**
 * Saved plan model in Firestore.
 * NOTE: The planner UI now supports:
 * - updatedAt (so the most recently touched plans sort to the top)
 * - isPinned (keep templates at the top)
 * - isArchived (hide old one-offs from the Active list)
 */
export interface SavedPlan extends PlannerData {
  id: string;
  name: string;
  createdAt: string;

  updatedAt?: string;
  isPinned?: boolean;
  isArchived?: boolean;
}

export interface WorkoutPlan {
  warmup: Exercise[];
  theThang: WorkoutRound[];
  mary: Exercise[];
}

export interface Pax {
  name: string;
  fng?: boolean;
}

export interface PaxAttendance {
  id: string; // Unique ID for React keys
  name: string;
  bd: boolean;
  dd: boolean;
  td: boolean;
  bigfoot: boolean;
  starsky: boolean;
}

export interface WorkoutSession {
  id: string;
  date: string;
  // YYYYMMDD string for efficient Firestore queries/sorting
  dateKey?: string;
  time: string;
  q: string;
  notes: string;
  dbj: string;
  food: string;

  paxCount?: number;
  paxAttendance?: PaxAttendance[];
  warmup?: Exercise[];
  theThang?: WorkoutRound[];
  mary?: Exercise[];
  plan?: PlannerData;
  announcements?: string;
  taps?: string;
}
