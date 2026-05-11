import type { WorkoutSession } from "../types";
import { AO_CONFIG } from "../ao/aoConfig";
import compassBaseWorkoutSessionsJson from "../data/workoutSessions.json";

export type WorkoutSessionScheduleSource = {
  [key: string]: unknown;
  id?: string;
  date?: string;
  dateKey?: string;
  time?: string;
  q?: string;
  notes?: string;
  dbj?: string;
  food?: string;
};

export type CompassQScheduleRow = {
  aoId: "compass";
  aoName: string;
  workoutDate: string;
  startTime: string;
  qPaxId: string;
  qName: string;
  preblastUrl: string;
  bandUrl: string;
};

export const COMPASS_Q_SCHEDULE_DEFAULT_LOOKAHEAD_DAYS = 7;
export const COMPASS_Q_SCHEDULE_TIME_ZONE = "America/Chicago";

const COMPASS_AO = AO_CONFIG.compass;
const COMPASS_AO_NAME = COMPASS_AO.displayName;
const COMPASS_PREBLAST_URL = "https://f3workouthub.netlify.app/preblast?ao=compass";
const COMPASS_BAND_URL = COMPASS_AO.bandPostUrl || COMPASS_AO.bandUrl || "";
const COMPASS_BASE_WORKOUT_SESSIONS = compassBaseWorkoutSessionsJson as WorkoutSession[];

const ISO_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: COMPASS_Q_SCHEDULE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const SAMPLE_LIMIT = 5;
const DATE_FIELD_CANDIDATES = [
  "date",
  "workoutDate",
  "dateString",
  "sessionDate",
  "dateKey",
  "Date",
];
const TIME_FIELD_CANDIDATES = ["time", "startTime", "workoutTime", "start", "Time"];
const Q_FIELD_CANDIDATES = ["q", "qName", "assignedQ", "assignedTo", "leader", "Q"];

type ExclusionReason =
  | "missingDate"
  | "invalidDate"
  | "outsideLookahead"
  | "missingQ"
  | "included";

export type CompassQScheduleDiagnostics = {
  sampleRawDocs: Array<Record<string, string>>;
  detectedDateFields: Array<{ fieldName: string; value: string }>;
  detectedQFields: Array<{ fieldName: string; value: string }>;
  parsedSamples: Array<{
    id: string;
    rawDate: string;
    rawTime: string;
    rawQ: string;
    workoutDate: string | null;
    startTime: string;
    qName: string;
    exclusionReason: ExclusionReason;
  }>;
  exclusionReasonCounts: Record<ExclusionReason, number>;
  baseSessionCount: number;
  persistedOverrideCount: number;
  matchedOverrideCount: number;
  unmatchedOverrideCount: number;
  effectiveSessionCount: number;
  fromDateUsed: string;
  effectiveWorkoutDateRange: {
    minWorkoutDate: string | null;
    maxWorkoutDate: string | null;
  };
  firstEffectiveSessionsOnOrAfterFromDate: Array<{
    id: string;
    date: string;
    dateKey: string;
    time: string;
    q: string;
    notes: string;
  }>;
  firstEffectiveSessionsInRequestedWindow: Array<{
    id: string;
    date: string;
    dateKey: string;
    time: string;
    q: string;
    notes: string;
  }>;
  assignedEffectiveSessionsInRequestedWindow: Array<{
    id: string;
    date: string;
    dateKey: string;
    time: string;
    q: string;
    notes: string;
  }>;
  persistedSessionsInRequestedWindow: Array<{
    id: string;
    date: string;
    dateKey: string;
    time: string;
    q: string;
    notes: string;
  }>;
};

const normalizeDateText = (value: string) => {
  const match = String(value || "").match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
  return match ? match[1] : String(value || "").trim();
};

const normalizeDisplayValue = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => normalizeDisplayValue(item)).join(", ");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.stringValue === "string") return record.stringValue.trim();
    if (typeof record.integerValue === "string") return record.integerValue.trim();
    if (typeof record.doubleValue === "number") return String(record.doubleValue);
    if (typeof record.booleanValue === "boolean") return String(record.booleanValue);
    if (typeof record.timestampValue === "string") return record.timestampValue;
    return JSON.stringify(record);
  }
  return String(value).trim();
};

const getFirstFieldValue = (
  session: WorkoutSessionScheduleSource,
  candidates: string[]
): { fieldName: string; value: string } | null => {
  for (const fieldName of candidates) {
    const rawValue = session[fieldName];
    const value = normalizeDisplayValue(rawValue);
    if (value) return { fieldName, value };
  }
  return null;
};

const toIsoDate = (value: string): string | null => {
  const cleaned = normalizeDateText(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;
  const isoMatch = cleaned.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (isoMatch) return isoMatch[1];
  if (/^\d{8}$/.test(cleaned)) {
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}`;
  }
  const slashIsoMatch = cleaned.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (slashIsoMatch) {
    const [, year, month, day] = slashIsoMatch;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const [monthRaw, dayRaw, yearRaw] = cleaned.split("/");
  if (!monthRaw || !dayRaw || !yearRaw) return null;

  const year =
    yearRaw.length === 2 ? `20${yearRaw.padStart(2, "0")}` : yearRaw.padStart(4, "0");
  const month = monthRaw.padStart(2, "0");
  const day = dayRaw.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const normalizeCompassDateToDate = (dateStr: string) => {
  const isoDate = toIsoDate(dateStr);
  if (!isoDate) return new Date("2100-01-01");
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
};

export const dateStringToKey = (dateStr: string) => {
  const isoDate = toIsoDate(dateStr);
  return isoDate ? isoDate.replace(/-/g, "") : "99999999";
};

const normalizeStartTime = (value: string) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 3) return `0${digits.slice(0, 1)}:${digits.slice(1)}`;
  if (digits.length >= 4) return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
  return "";
};

const slugifyPaxId = (value: string) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const isoDateToUtcDayNumber = (isoDate: string) =>
  Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / 86400000);

const cloneWorkoutSession = (session: WorkoutSession): WorkoutSession => ({
  ...session,
  paxAttendance: session.paxAttendance ? [...session.paxAttendance] : undefined,
  warmup: session.warmup ? [...session.warmup] : undefined,
  theThang: session.theThang ? [...session.theThang] : undefined,
  mary: session.mary ? [...session.mary] : undefined,
  plan: session.plan ? { ...session.plan } : undefined,
});

const hasOwn = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

const sanitizePersistedSession = (
  session: WorkoutSessionScheduleSource
): WorkoutSessionScheduleSource => {
  const sanitized: WorkoutSessionScheduleSource = {};
  for (const [key, value] of Object.entries(session)) {
    if (value !== undefined) sanitized[key] = value;
  }

  const dateField = getFirstFieldValue(sanitized, DATE_FIELD_CANDIDATES);
  const timeField = getFirstFieldValue(sanitized, TIME_FIELD_CANDIDATES);
  const qField = getFirstFieldValue(sanitized, Q_FIELD_CANDIDATES);

  if (dateField?.value) sanitized.date = dateField.value;
  if (timeField?.value) sanitized.time = timeField.value;
  if (qField?.value) sanitized.q = qField.value;
  if (!sanitizeDisplayString(sanitized.dateKey) && dateField?.value) {
    sanitized.dateKey = dateStringToKey(dateField.value);
  }

  return sanitized;
};

const sanitizeDisplayString = (value: unknown) => normalizeDisplayValue(value);

const materializeWorkoutSession = (
  session: WorkoutSessionScheduleSource
): WorkoutSession | null => {
  const id = normalizeDisplayValue(session.id);
  const dateField = getFirstFieldValue(session, DATE_FIELD_CANDIDATES);
  const timeField = getFirstFieldValue(session, TIME_FIELD_CANDIDATES);
  if (!id || !dateField || !timeField) return null;

  return {
    id,
    date: dateField.value,
    dateKey: normalizeDisplayValue(session.dateKey) || dateStringToKey(dateField.value),
    time: timeField.value,
    q: normalizeDisplayValue(getFirstFieldValue(session, Q_FIELD_CANDIDATES)?.value),
    notes: normalizeDisplayValue(session.notes),
    dbj: normalizeDisplayValue(session.dbj),
    food: normalizeDisplayValue(session.food),
  };
};

export const getCompassScheduleTodayIsoDate = (now: Date = new Date()) => {
  const parts = ISO_DATE_FORMATTER.formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    throw new Error("Failed to format Compass schedule date.");
  }
  return `${year}-${month}-${day}`;
};

export const parseLookaheadDays = (value: string | null | undefined) => {
  if (!value) return COMPASS_Q_SCHEDULE_DEFAULT_LOOKAHEAD_DAYS;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.min(parsed, 365);
};

export const parseFromDate = (value: string | null | undefined) => {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
};

export const getCompassBaseWorkoutSessions = (): WorkoutSession[] =>
  COMPASS_BASE_WORKOUT_SESSIONS.map(cloneWorkoutSession);

export const buildCompassEffectiveWorkoutSessions = (
  persistedOverrides: WorkoutSessionScheduleSource[]
): {
  sessions: WorkoutSession[];
  matchedOverrideCount: number;
  unmatchedOverrideCount: number;
} => {
  const baseSessions = getCompassBaseWorkoutSessions();
  const overridesById = new Map<string, WorkoutSessionScheduleSource>();
  const overridesByDateKey = new Map<string, WorkoutSessionScheduleSource>();
  const overridesByDate = new Map<string, WorkoutSessionScheduleSource>();

  for (const rawSession of persistedOverrides) {
    const session = sanitizePersistedSession(rawSession);
    const id = normalizeDisplayValue(session.id);
    const dateKey = normalizeDisplayValue(session.dateKey);
    const dateField = getFirstFieldValue(session, DATE_FIELD_CANDIDATES);
    if (id) {
      overridesById.set(id, { ...(overridesById.get(id) || {}), ...session, id });
    }
    if (dateKey) {
      overridesByDateKey.set(dateKey, {
        ...(overridesByDateKey.get(dateKey) || {}),
        ...session,
      });
    }
    if (dateField?.value) {
      overridesByDate.set(dateField.value, {
        ...(overridesByDate.get(dateField.value) || {}),
        ...session,
      });
    }
  }

  const matchedOverrideKeys = new Set<string>();

  const mergedBaseSessions = baseSessions.map((baseSession) => {
    const override =
      overridesById.get(baseSession.id) ||
      (baseSession.dateKey ? overridesByDateKey.get(baseSession.dateKey) : undefined) ||
      overridesByDate.get(baseSession.date);

    if (!override) return baseSession;

    const overrideId = normalizeDisplayValue(override.id);
    if (overrideId) matchedOverrideKeys.add(overrideId);

    return {
      ...baseSession,
      ...override,
      id: baseSession.id,
      date: hasOwn(override, "date")
        ? normalizeDisplayValue(override.date)
        : baseSession.date,
      dateKey: hasOwn(override, "dateKey")
        ? normalizeDisplayValue(override.dateKey)
        : baseSession.dateKey,
      time: hasOwn(override, "time")
        ? normalizeDisplayValue(override.time)
        : baseSession.time,
      q: hasOwn(override, "q") ? normalizeDisplayValue(override.q) : baseSession.q,
      notes: hasOwn(override, "notes")
        ? normalizeDisplayValue(override.notes)
        : baseSession.notes,
      dbj: hasOwn(override, "dbj") ? normalizeDisplayValue(override.dbj) : baseSession.dbj,
      food: hasOwn(override, "food")
        ? normalizeDisplayValue(override.food)
        : baseSession.food,
    };
  });

  const unmatchedPersistedSessions = persistedOverrides
    .filter((session) => {
      const id = normalizeDisplayValue(session.id);
      return id ? !matchedOverrideKeys.has(id) : true;
    })
    .map(materializeWorkoutSession)
    .filter((session): session is WorkoutSession => Boolean(session))
    .filter((session) => {
      if (!session.dateKey) return true;
      return !mergedBaseSessions.some((base) => base.dateKey === session.dateKey);
    });

  const sessions = [...mergedBaseSessions, ...unmatchedPersistedSessions].sort((a, b) =>
    dateStringToKey(a.date).localeCompare(dateStringToKey(b.date))
  );

  return {
    sessions,
    matchedOverrideCount: matchedOverrideKeys.size,
    unmatchedOverrideCount: unmatchedPersistedSessions.length,
  };
};

export const filterWorkoutSessionsByMonthWindow = (
  sessions: WorkoutSession[],
  today: Date,
  pastMonths: number,
  futureMonths: number
) => {
  const futureCut = new Date(today);
  futureCut.setMonth(today.getMonth() + futureMonths);

  const pastCut = new Date(today);
  pastCut.setMonth(today.getMonth() - pastMonths);

  return sessions.filter((session) => {
    const workoutDate = normalizeCompassDateToDate(session.date);
    if (Number.isNaN(workoutDate.getTime())) return false;
    if (pastMonths === 0 && workoutDate < today) return false;
    if (workoutDate < pastCut) return false;
    if (workoutDate > futureCut) return false;
    return true;
  });
};

export const mapWorkoutSessionsToCompassSchedule = (
  persistedOverrides: WorkoutSessionScheduleSource[],
  options?: {
    lookaheadDays?: number;
    fromDateIso?: string;
  }
): CompassQScheduleRow[] => {
  return mapWorkoutSessionsToCompassScheduleWithDiagnostics(
    persistedOverrides,
    options
  ).schedule;
};

export const mapWorkoutSessionsToCompassScheduleWithDiagnostics = (
  persistedOverrides: WorkoutSessionScheduleSource[],
  options?: {
    lookaheadDays?: number;
    fromDateIso?: string;
  }
): {
  schedule: CompassQScheduleRow[];
  diagnostics: CompassQScheduleDiagnostics;
} => {
  const lookaheadDays =
    options?.lookaheadDays ?? COMPASS_Q_SCHEDULE_DEFAULT_LOOKAHEAD_DAYS;
  const fromDateIso = options?.fromDateIso ?? getCompassScheduleTodayIsoDate();
  const todayDayNumber = isoDateToUtcDayNumber(fromDateIso);
  const windowEndDayNumber = todayDayNumber + lookaheadDays - 1;
  const exclusionReasonCounts: Record<ExclusionReason, number> = {
    missingDate: 0,
    invalidDate: 0,
    outsideLookahead: 0,
    missingQ: 0,
    included: 0,
  };
  const sampleRawDocs: Array<Record<string, string>> = [];
  const detectedDateFields: Array<{ fieldName: string; value: string }> = [];
  const detectedQFields: Array<{ fieldName: string; value: string }> = [];
  const parsedSamples: CompassQScheduleDiagnostics["parsedSamples"] = [];

  const effective = buildCompassEffectiveWorkoutSessions(persistedOverrides);
  const effectiveWithWorkoutDate = effective.sessions.map((session) => {
    const workoutDate = toIsoDate(session.date);
    return { session, workoutDate };
  });
  const minWorkoutDate =
    effectiveWithWorkoutDate.find((item) => item.workoutDate)?.workoutDate || null;
  const maxWorkoutDate =
    [...effectiveWithWorkoutDate]
      .reverse()
      .find((item) => item.workoutDate)?.workoutDate || null;

  const serializeSession = (session: WorkoutSession) => ({
    id: session.id,
    date: session.date,
    dateKey: session.dateKey || dateStringToKey(session.date),
    time: session.time,
    q: session.q,
    notes: session.notes,
  });

  const firstEffectiveSessionsOnOrAfterFromDate = effectiveWithWorkoutDate
    .filter((item) => item.workoutDate && isoDateToUtcDayNumber(item.workoutDate) >= todayDayNumber)
    .slice(0, 10)
    .map((item) => serializeSession(item.session));

  const firstEffectiveSessionsInRequestedWindow = effectiveWithWorkoutDate
    .filter((item) => {
      if (!item.workoutDate) return false;
      const dayNumber = isoDateToUtcDayNumber(item.workoutDate);
      return dayNumber >= todayDayNumber && dayNumber <= windowEndDayNumber;
    })
    .slice(0, 10)
    .map((item) => serializeSession(item.session));

  const assignedEffectiveSessionsInRequestedWindow = effectiveWithWorkoutDate
    .filter((item) => {
      if (!item.workoutDate) return false;
      const dayNumber = isoDateToUtcDayNumber(item.workoutDate);
      return (
        dayNumber >= todayDayNumber &&
        dayNumber <= windowEndDayNumber &&
        Boolean(item.session.q?.trim())
      );
    })
    .map((item) => serializeSession(item.session));

  const persistedSessionsInRequestedWindow = persistedOverrides
    .map(materializeWorkoutSession)
    .filter((session): session is WorkoutSession => Boolean(session))
    .filter((session) => {
      const workoutDate = toIsoDate(session.date);
      if (!workoutDate) return false;
      const dayNumber = isoDateToUtcDayNumber(workoutDate);
      return dayNumber >= todayDayNumber && dayNumber <= windowEndDayNumber;
    })
    .slice(0, 20)
    .map(serializeSession);

  const schedule = effective.sessions
    .map((session) => {
      const dateField = getFirstFieldValue(session as WorkoutSessionScheduleSource, DATE_FIELD_CANDIDATES);
      const timeField = getFirstFieldValue(session as WorkoutSessionScheduleSource, TIME_FIELD_CANDIDATES);
      const qField = getFirstFieldValue(session as WorkoutSessionScheduleSource, Q_FIELD_CANDIDATES);
      const rawDate = dateField?.value || "";
      const rawTime = timeField?.value || "";
      const rawQ = qField?.value || "";
      const workoutDate = rawDate ? toIsoDate(rawDate) : null;
      let exclusionReason: ExclusionReason = "included";

      if (sampleRawDocs.length < SAMPLE_LIMIT) {
        const sampleDoc: Record<string, string> = {};
        for (const [key, value] of Object.entries(session)) {
          const normalized = normalizeDisplayValue(value);
          if (normalized) sampleDoc[key] = normalized;
        }
        sampleRawDocs.push(sampleDoc);
      }
      if (dateField && detectedDateFields.length < SAMPLE_LIMIT) {
        detectedDateFields.push(dateField);
      }
      if (qField && detectedQFields.length < SAMPLE_LIMIT) {
        detectedQFields.push(qField);
      }

      if (!rawDate) {
        exclusionReason = "missingDate";
      } else if (!workoutDate) {
        exclusionReason = "invalidDate";
      } else {
        const diffDays = isoDateToUtcDayNumber(workoutDate) - todayDayNumber;
        if (diffDays < 0 || diffDays >= lookaheadDays) {
          exclusionReason = "outsideLookahead";
        } else if (!rawQ) {
          exclusionReason = "missingQ";
        }
      }

      exclusionReasonCounts[exclusionReason] += 1;

      if (parsedSamples.length < SAMPLE_LIMIT) {
        parsedSamples.push({
          id: normalizeDisplayValue(session.id),
          rawDate,
          rawTime,
          rawQ,
          workoutDate,
          startTime: normalizeStartTime(rawTime),
          qName: rawQ,
          exclusionReason,
        });
      }

      if (exclusionReason !== "included") return null;

      return {
        aoId: "compass" as const,
        aoName: COMPASS_AO_NAME,
        workoutDate,
        startTime: normalizeStartTime(rawTime),
        qPaxId: slugifyPaxId(rawQ),
        qName: rawQ,
        preblastUrl: COMPASS_PREBLAST_URL,
        bandUrl: COMPASS_BAND_URL,
      };
    })
    .filter((row): row is CompassQScheduleRow => Boolean(row))
    .sort((a, b) => {
      const dateCompare = a.workoutDate.localeCompare(b.workoutDate);
      if (dateCompare !== 0) return dateCompare;
      return a.startTime.localeCompare(b.startTime);
    });

  return {
    schedule,
    diagnostics: {
      sampleRawDocs,
      detectedDateFields,
      detectedQFields,
      parsedSamples,
      exclusionReasonCounts,
      baseSessionCount: COMPASS_BASE_WORKOUT_SESSIONS.length,
      persistedOverrideCount: persistedOverrides.length,
      matchedOverrideCount: effective.matchedOverrideCount,
      unmatchedOverrideCount: effective.unmatchedOverrideCount,
      effectiveSessionCount: effective.sessions.length,
      fromDateUsed: fromDateIso,
      effectiveWorkoutDateRange: {
        minWorkoutDate,
        maxWorkoutDate,
      },
      firstEffectiveSessionsOnOrAfterFromDate,
      firstEffectiveSessionsInRequestedWindow,
      assignedEffectiveSessionsInRequestedWindow,
      persistedSessionsInRequestedWindow,
    },
  };
};
