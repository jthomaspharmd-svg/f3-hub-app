/* ==========================================================
   geminiService.ts
   Updated with:
   ✔ AO-aware hashtags/location via aoConfig
   ✔ Timer label next to round name
   ✔ Round description support (planner → backblast)
   ✔ Warmup description support (planner → backblast)
   ✔ Prevent Gemini from rewriting Warmup & Thang
   ✔ First-person backblast intro (Q = "I")
   ✔ First-person preblast intro (Q = "I")
   ✔ Retry logic preserved + improved error propagation
   ✔ FIX: do NOT swallow errors (throw so UI can retry/classify)
   ✔ FIX: validate aoId and API key with clear errors
   ✔ UPDATE: JP/All AOs narrative rules
     - 3–5 sentences total
     - 1–2 paragraphs allowed
     - NO section headers
     - Must respect correct PAX count
     - Must NOT say "solo" unless PAX count is exactly 1
     - Narrative must appear after hashtags (before content block)
   ✔ NEW: JP-specific narrative generator (NOT a beatdown)
     - Avoids "beatdown/Q-led" language entirely
     - Hard pax-count guardrails
========================================================== */

import type {
  WorkoutPlan,
  WorkoutSession,
  PaxAttendance,
  Exercise,
  Pax,
  WorkoutRound,
} from "../types";
import { createId } from "../utils/ids";

// ✅ AO config (make sure these exports exist in src/ao/aoConfig.ts)
import { getAoById, type AoId } from "../ao/aoConfig";

// -----------------------------------------------------
// VITE ENVIRONMENT VARIABLE (REQUIRED)
// -----------------------------------------------------
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

if (!API_KEY) {
  console.warn("❗ VITE_GEMINI_API_KEY is missing. Gemini API calls will fail.");
}

type GenAiModule = typeof import("@google/genai");
let genAiModulePromise: Promise<GenAiModule> | null = null;
let genAiClient: any = null;

const loadGenAi = async () => {
  if (!genAiModulePromise) {
    genAiModulePromise = import("@google/genai");
  }
  return genAiModulePromise;
};

const getGenAiClient = async () => {
  if (!genAiClient) {
    const { GoogleGenAI } = await loadGenAi();
    genAiClient = new GoogleGenAI({ apiKey: API_KEY });
  }
  return genAiClient;
};

// -----------------------------------------------------
// Build hashtag line: always includes #preblast/#backblast + AO tags
// -----------------------------------------------------
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

const buildHashtags = (aoHashtags: string[], type: "preblast" | "backblast") => {
  const base = type === "preblast" ? "#preblast" : "#backblast";

  const normalized = [base, ...(aoHashtags || [])]
    .map((t) => String(t || "").trim())
    .filter(Boolean)
    .map((t) => (t.startsWith("#") ? t : `#${t}`));

  return Array.from(new Set(normalized)).join(" ");
};

// -----------------------------------------------------
// Error helpers
// -----------------------------------------------------
const normalizeErr = (err: any) => {
  const status = err?.status ?? err?.response?.status;
  const message =
    err?.message ||
    err?.error?.message ||
    (typeof err === "string" ? err : "") ||
    "Unknown Gemini error";
  return { status, message };
};

const isRetryable = (err: any) => {
  const { status, message } = normalizeErr(err);
  const msg = String(message || "").toLowerCase();

  return (
    status === 429 ||
    status === 503 ||
    msg.includes("429") ||
    msg.includes("503") ||
    msg.includes("rate") ||
    msg.includes("quota") ||
    msg.includes("resource exhausted") ||
    msg.includes("overload") ||
    msg.includes("unavailable") ||
    msg.includes("temporarily")
  );
};

// -----------------------------------------------------
// Retry helper (exponential backoff)
// -----------------------------------------------------
const retryGeminiCall = async (
  fn: () => Promise<any>,
  maxRetries = 10,
  maxTotalMs = 60000
) => {
  let attempt = 0;
  const startedAt = Date.now();

  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (err: any) {
      if (!isRetryable(err)) throw err;

      const elapsed = Date.now() - startedAt;
      if (elapsed >= maxTotalMs) break;

      const backoff = Math.min(2000 * Math.pow(1.6, attempt), 20000);
      const remaining = maxTotalMs - elapsed;
      const waitMs = Math.min(backoff, remaining);
      console.warn(`Retry #${attempt + 1} in ${backoff}ms due to Gemini...`, {
        status: err?.status ?? err?.response?.status,
        message: err?.message,
      });

      await new Promise((res) => setTimeout(res, waitMs));
      attempt++;
    }
  }

  // IMPORTANT: throw (do not return a string) so caller can classify/fallback
  throw new Error("Gemini retry limit reached (overload/rate-limit).");
};

// -----------------------------------------------------
// Helper – workout date strings (legacy helper; still used by parse)
// -----------------------------------------------------
const getWorkoutDateAndTime = () => {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 6=Sat
  let workoutDate = new Date();
  let time = "";

  if (day === 2 || day === 4) {
    time = "5:30 AM - 6:15 AM";
  } else if (day === 6) {
    time = "6:30 AM - 7:30 AM";
  } else if (day === 0 || day === 1) {
    workoutDate.setDate(now.getDate() - (day + 1));
    time = "6:30 AM - 7:30 AM";
  } else if (day === 3) {
    workoutDate.setDate(now.getDate() - 1);
    time = "5:30 AM - 6:15 AM";
  } else {
    workoutDate.setDate(now.getDate() - 1);
    time = "5:30 AM - 6:15 AM";
  }

  const dateString = `${workoutDate.toLocaleDateString("en-US", {
    weekday: "long",
  })}, ${workoutDate.getMonth() + 1}/${workoutDate.getDate()}/${workoutDate.getFullYear()}`;

  const simpleDateString = `${
    workoutDate.getMonth() + 1
  }/${workoutDate.getDate()}/${String(workoutDate.getFullYear()).slice(
    -2
  )} (${workoutDate.toLocaleDateString("en-US", { weekday: "short" })})`;

  return { date: dateString, time, simpleDate: simpleDateString };
};

// -----------------------------------------------------
// PREBLAST GENERATOR (WITH RETRY) — FIRST PERSON ✅
// IMPORTANT CHANGE: throws on failure so caller can handle.
// -----------------------------------------------------
export const generatePreblast = async (
  aoId: AoId,
  qName: string,
  notes: string,
  toBring: string[],
  workoutDate: string,
  workoutTime: string,
  minimalEmojis: boolean = false,
  weatherSummary: string = "",
  extraHashtags: string[] = []
): Promise<string> => {
  if (!API_KEY) throw new Error("Missing VITE_GEMINI_API_KEY.");
  if (!aoId) throw new Error("Missing aoId for generatePreblast().");

  const ai = await getGenAiClient();

  // ✅ Pull AO details from config
  const ao = getAoById(aoId);

  // ---- If your aoConfig uses different field names, adjust here:
  const aoHashtags = ao.hashtags ?? [];
  const extraHashtagsByAo: string[] = [];
  if (aoId === "thehill" && isFridayFromDateString(workoutDate)) {
    extraHashtagsByAo.push("#hillybillyshuffle");
  }
  const whereLine = (ao as any).whereLine ?? ao.displayName ?? "AO";
  const addressLine = (ao as any).addressLine ?? "";
  // ------------------------------------------------------------

  const hashtagLine = buildHashtags(
    [...aoHashtags, ...extraHashtagsByAo, ...(extraHashtags || [])],
    "preblast"
  );

  const isSaturday = workoutDate.toLowerCase().includes("sat");
  const earlyBird = {
    dd: "DD (Comment Below)",
    td: "TD (Comment Below)",
  };

  const toBringList =
    toBring.length > 0 ? toBring.join(", ") : "Just your gloom-hating self.";

  const preblastContent = `
💪Q: ${qName}
📍WHERE: ${whereLine}
${addressLine ? addressLine : ""}
🗓️Date/Time: ${workoutDate} (${workoutTime})
${earlyBird.dd}
${earlyBird.td}

🎒 BRING: ${toBringList}
  `.trim();

  const preblastContentPlain = `
Q: ${qName}
WHERE: ${whereLine}
${addressLine ? addressLine : ""}
Date/Time: ${workoutDate} (${workoutTime})
${earlyBird.dd}
${earlyBird.td}

Bring: ${toBringList}
  `.trim();

  const finalPreblastContent = minimalEmojis
    ? preblastContentPlain
    : preblastContent;

  const prompt = `
You are an F3 Pre-Blast generator.

VOICE & POV (CRITICAL):
- Write the hype intro in FIRST PERSON, as if **I am the Q** named "${
    qName || "the Q"
  }".
- Use "I" when describing what the Q is bringing/doing (e.g., "I'm bringing...", "I've got a beatdown...").
- Use "we" or "the PAX" when talking about the group.
- NEVER refer to the Q in third person (no "the Q is bringing...", no "he/she", and do NOT write "${qName} is bringing..." in narration).
- Do not say "your workout" or "the Q's workout"—just write it like a real Q posting.

CRITICAL RULES:
1. The FIRST LINE MUST be: ${hashtagLine}
2. The SECOND LINE MUST be blank.
3. Write a hype intro (2–4 sentences) in first person (see POV rules above).
4. End the intro with a short “HC below” call-to-action. It should mean: comment/HC if you’re attending. Do NOT require verbatim wording.
5. Then show the pre-blast content exactly as provided (no edits).

IMPORTANT:
You must NOT rewrite or reformat anything inside the Pre-Blast Content block.
Print the Pre-Blast Content EXACTLY as provided (including line breaks, emojis, and spacing).

SPECIAL RULE:
Whenever you see "Little Baby Arm Circles", abbreviate it as "LBAC".

Notes (use only to flavor the hype intro, not the content block):
${notes || "A standard beatdown is expected."}

Pre-Blast Content (print exactly, no changes):
${finalPreblastContent}
`.trim();

  const response = await retryGeminiCall(() =>
    ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    })
  );

  const text = (response?.text ?? "").trim();
  if (!text) throw new Error("Gemini returned empty text for preblast.");
  return text;
};

// -----------------------------------------------------
// WORKOUT PLAN GENERATOR (unchanged behavior)
// -----------------------------------------------------
export const generateWorkoutPlan = async (
  theme: string
): Promise<WorkoutPlan> => {
  if (!API_KEY) throw new Error("Missing VITE_GEMINI_API_KEY.");

  const ai = await getGenAiClient();
  const { Type } = await loadGenAi();

  const prompt = `
Create a JSON-only 45-minute F3 workout plan with Warmup, The Thang, and Mary.
Theme: "${theme}"
Follow the schema exactly.
`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          warmup: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                reps: { type: Type.STRING },
              },
              required: ["name", "reps"],
            },
          },
          theThang: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                exercises: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      name: { type: Type.STRING },
                      reps: { type: Type.STRING },
                    },
                    required: ["name", "reps"],
                  },
                },
              },
              required: ["name", "exercises"],
            },
          },
          mary: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                reps: { type: Type.STRING },
              },
              required: ["name", "reps"],
            },
          },
        },
        required: ["warmup", "theThang", "mary"],
      },
    },
  });

  const raw = (response?.text ?? "").trim();
  if (!raw) throw new Error("Gemini returned empty JSON for workout plan.");
  return JSON.parse(raw);
};

// -----------------------------------------------------
// JP (Jurassic Park) Narrative Generator — NOT a beatdown
// Produces ONLY 3–5 sentences, no headers, optional 1–2 paragraphs
// IMPORTANT: throws on failure so UI can retry/classify.
// -----------------------------------------------------
export const generateJurassicParkNarrative = async (args: {
  aoId: AoId;
  organizerName: string; // uses your "Q" field, but treated as organizer/POC
  workoutDate: string;
  workoutTime: string;
  paxCount: number;
  notes: string;
}): Promise<string> => {
  if (!API_KEY) throw new Error("Missing VITE_GEMINI_API_KEY.");
  if (!args?.aoId)
    throw new Error("Missing aoId for generateJurassicParkNarrative().");

  const ai = await getGenAiClient();

  const ao = getAoById(args.aoId);

  const aoTitle = ao?.displayName ?? "Jurassic Park";
  const whereName = (ao as any)?.whereLine ?? aoTitle;
  const address = (ao as any)?.addressLine ?? "";

  const paxCount = Number.isFinite(args.paxCount) ? args.paxCount : 0;

  const prompt = `
You are writing a short narrative for an F3 "Jurassic Park" style run/ruck meetup.

THIS IS NOT A BEATDOWN:
- Do NOT say "beatdown", "workout plan", "Warmup", "The Thang", "I led", "I Q'd", or anything implying a structured Q-led beatdown.
- Treat "${args.organizerName}" as the organizer / point of contact, not a beatdown Q.

HARD FACTS (DO NOT CONTRADICT):
- AO: ${aoTitle}
- Location: ${whereName}
- Address: ${address}
- Date/Time: ${args.workoutDate} (${args.workoutTime})
- PAX_COUNT: ${paxCount}

PAX COUNT RULES (CRITICAL):
- Do NOT describe it as "solo", "just me", "only me", "no one else", or similar unless PAX_COUNT is exactly 1.
- If PAX_COUNT is 2 or more, write as a group ("we", "the PAX") and reference the count naturally (e.g., "8 strong", "a crew of 8").

OUTPUT REQUIREMENTS:
- Output ONLY the narrative. No hashtags. No headers. No labels.
- 3–5 sentences total.
- You may use 1 paragraph OR 2 short paragraphs.
- Motivational tone is optional; keep it natural and F3-appropriate (not preachy, not corny).
- First-person is OK (organizer POV), but keep it consistent.

Organizer Notes (optional color—do not invent facts not supported here):
${(args.notes || "").trim()}
`.trim();

  const response = await retryGeminiCall(() =>
    ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        temperature: 0.7,
      },
    })
  );

  const text = String(response?.text ?? "").trim();
  if (!text)
    throw new Error("Gemini returned empty text for Jurassic Park narrative.");
  return text;
};

// -----------------------------------------------------
// BACKBLAST GENERATOR (WITH RETRY) — FIRST PERSON
// IMPORTANT CHANGE: throws on failure so UI can retry/classify.
// -----------------------------------------------------
interface BackblastData {
  aoId: AoId; // ✅ REQUIRED NOW
  qName: string;
  workoutDate: string;
  workoutTime: string;
  paxAttendance: PaxAttendance[];
  warmup: Exercise[];
  theThang: WorkoutRound[];
  announcements: string;
  taps: string;
  notes: string;
  minimalEmojis?: boolean;

  // optional descriptions coming from planner/backblast editor
  warmupDescription?: string;
}

const hasText = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

export const generateBackblast = async (data: BackblastData): Promise<string> => {
  if (!API_KEY) throw new Error("Missing VITE_GEMINI_API_KEY.");
  if (!data?.aoId) throw new Error("Missing aoId for generateBackblast().");

  const ai = await getGenAiClient();

  const {
    aoId,
    qName,
    workoutDate,
    workoutTime,
    paxAttendance,
    warmup,
    theThang,
    announcements,
    taps,
    notes,
    minimalEmojis = false,
    warmupDescription,
  } = data;

  // ✅ Pull AO details from config
  const ao = getAoById(aoId);

  // ---- If your aoConfig uses different field names, adjust here:
  const aoHashtags = ao.hashtags ?? [];
  const extraHashtags =
    aoId === "thehill" && isFridayFromDateString(workoutDate)
      ? ["#hillybillyshuffle"]
      : [];
  const aoTitle = ao.displayName ?? "AO";
  const aoNameLine = (ao as any).aoNameLine ?? aoTitle; // e.g., "Compass at Lost Creek"
  // ------------------------------------------------------------

  const hashtagLine = buildHashtags(
    [...aoHashtags, ...extraHashtags],
    "backblast"
  );

  // ----------------------------
  // FORMAT EXERCISES
  // ----------------------------
  const formatExercise = (e: Exercise) => {
    let line = `• ${e.name}`;
    if (e.reps) line += ` x${e.reps}`;
    if ((e as any).cadence) line += ` (${(e as any).cadence})`;
    return line;
  };

  // Warmup: optional description printed above the first exercise
  const warmupLines: string[] = [];
  if (hasText(warmupDescription)) warmupLines.push(warmupDescription.trim());
  if (hasText(warmupDescription) && warmup.length > 0) warmupLines.push("");
  if (warmup.length > 0) warmupLines.push(...warmup.map(formatExercise));
  const warmupSection = warmupLines.join("\n") || "As dictated by the Q.";

  // ------------------------------------------------------
  // THANG: TIMER LABELS NEXT TO ROUND NAME + ROUND DESCRIPTION
  // ------------------------------------------------------
  const thangSection =
    theThang
      .filter((r) => (r.exercises || []).length > 0)
      .map((round, i) => {
        const totalSeconds = (round as any).timerSeconds ?? 0;
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;

        let timeLabel = "";
        if (totalSeconds > 0) {
          timeLabel = `${mins} minutes`;
          if (secs > 0) timeLabel += ` ${secs} seconds`;
          const repeat = (round as any).timerRepeatCount ?? 1;
          if (repeat > 1) timeLabel += ` × ${repeat} rounds`;
        }

        const title = timeLabel
          ? `**${round.name || `Round ${i + 1}`}** — ${timeLabel}`
          : `**${round.name || `Round ${i + 1}`}**`;

        const descLine = hasText((round as any).description)
          ? `${String((round as any).description).trim()}\n`
          : "";

        const exercises = (round.exercises || []).map(formatExercise).join("\n");
        return `${title}\n${descLine}${exercises}`;
      })
      .join("\n\n") || "A glorious beatdown ensued.";

  // ----------------------------
  // FORMAT PAX GROUPS
  // ----------------------------
  const totalPax = paxAttendance.filter((p) => !p.starsky).length;

  // paxAttendance might already include '@' depending on caller;
  // normalize to no '@' then re-add once.
  const stripAt = (s: string) => String(s || "").trim().replace(/^@+/, "");
  const withAt = (s: string) => {
    const n = stripAt(s);
    return n ? `@${n}` : "";
  };

  const formatPaxNameWithExtras = (p: PaxAttendance) => {
    const tags: string[] = [];
    if (p.bigfoot) tags.push("Bigfoot");
    const base = withAt(p.name);
    return tags.length ? `${base} (${tags.join(", ")})` : base;
  };

  const starsky = paxAttendance.filter((p) => p.starsky).map((p) => withAt(p.name));
  const td = paxAttendance
    .filter((p) => p.td && !p.starsky)
    .map((p) => formatPaxNameWithExtras(p));
  const dd = paxAttendance
    .filter((p) => p.dd && !p.td && !p.starsky)
    .map((p) => formatPaxNameWithExtras(p));
  const bd = paxAttendance
    .filter((p) => p.bd && !p.dd && !p.td && !p.starsky)
    .map((p) => formatPaxNameWithExtras(p));

  const paxLinesEmoji: string[] = [];
  if (td.length) paxLinesEmoji.push(...td.map((n) => `${n} [TD]`));
  if (dd.length) paxLinesEmoji.push(...dd.map((n) => `${n} [DD]`));
  if (bd.length) paxLinesEmoji.push(...bd);
  if (starsky.length) paxLinesEmoji.push(...starsky.map((n) => `${n} (Starsky)`));

  const paxLinesPlain: string[] = [];
  if (td.length) paxLinesPlain.push(...td.map((n) => `${n} [TD]`));
  if (dd.length) paxLinesPlain.push(...dd.map((n) => `${n} [DD]`));
  if (bd.length) paxLinesPlain.push(...bd);
  if (starsky.length) paxLinesPlain.push(...starsky.map((n) => `${n} (Starsky)`));

  const paxSectionEmoji = paxLinesEmoji.join("\n");
  const paxSectionPlain = paxLinesPlain.join("\n");

  // ----------------------------
  // FINAL CLEAN CONTENT BLOCK
  // ----------------------------
  const backblastContentEmoji = `
Backblast - ${aoTitle}
📅Date/Time: ${workoutDate} (${workoutTime})
🎩Q: ${qName}
👥PAX: ${totalPax} Total

${paxSectionEmoji}

🚨Disclaimer🚨 (Standard disclaimer)
🔢Count O Rama: ${totalPax}

Warmup:
${warmupSection}

The Thang:
${thangSection}

Announcements: ${announcements || "None."}
TAPS: ${taps || "None."}
`.trim();

  const backblastContentPlain = `
Backblast - ${aoTitle}
Date/Time: ${workoutDate} (${workoutTime})
Q: ${qName}
PAX: ${totalPax} Total

${paxSectionPlain}

Disclaimer (Standard disclaimer)
Count O Rama: ${totalPax}

Warmup:
${warmupSection}

The Thang:
${thangSection}

Announcements: ${announcements || "None."}
TAPS: ${taps || "None."}
`.trim();

  const backblastContent = minimalEmojis ? backblastContentPlain : backblastContentEmoji;

  // Light anchors to reduce repetition (DO NOT print)
  const variabilityAnchors = `
DO NOT PRINT ANYTHING IN THIS BLOCK.
ANCHORS:
- AO: ${aoTitle}
- AO line: ${aoNameLine}
- Date: ${workoutDate}
- Q: ${qName}
- PAX_COUNT: ${totalPax}
END DO NOT PRINT.
`.trim();

  // ------------------------------------------------------
  // UPDATED PROMPT — 3–5 SENTENCES, NO HEADERS, AFTER HASHTAGS
  // ------------------------------------------------------
  const prompt = `
You are an F3 Backblast generator.

VOICE & POV (CRITICAL):
- Write everything in FIRST PERSON, as if **I am the Q** named "${
    qName || "the Q"
  }".
- Use "I" when describing what I did (e.g., "I decided...", "I led...").
- Use "we" or "the PAX" when describing the group.
- NEVER refer to the Q in third person (no "the Q did X", no "he", "she", or "${
    qName || ""
  }" in narration).
- Do not say "your workout" or "the Q's workout".

PAX COUNT (CRITICAL):
- The correct PAX count is EXACTLY: ${totalPax}.
- Do NOT describe this workout as solo unless PAX count is exactly 1.
- If PAX count is > 1, do not use words like "solo", "just me", "only me", "no one else", or similar.

NARRATIVE REQUIREMENTS (CRITICAL):
- Write 3–5 sentences total.
- You may use 1 paragraph OR 2 short paragraphs (optional).
- Motivational tone is optional; keep it natural and F3-appropriate (not preachy, not corny).
- NO section headers at all. Do not output lines like "Appreciation:", "Inspiration:", "AAR:", etc.
- Do NOT include bullet points in the narrative.
- Do NOT mention AI, prompts, models, or that this was generated.
  - Emojis: ${
    minimalEmojis ? "none (do not use any emojis)." : "optional, at most one, only if it fits naturally."
  }

CRITICAL FORMATTING RULES FOR WARMUP & THE THANG:
1. For the Thang, DO NOT create a separate timer summary section.
2. Keep timers IMMEDIATELY after each round name, exactly as provided.
3. If a round description line exists, it MUST remain directly under the round name (and timer label if present).
4. NEVER move timer/description information to the bottom or to a different section.

IMPORTANT:
You must NOT rewrite or reformat anything inside the **Warmup** or **The Thang** sections.
Print those sections EXACTLY as provided inside backblastContent.
- Do NOT rearrange, remove, shorten, or summarize any lines.
- Do NOT remove timers or move timer labels.
- Do NOT change bullet markers or wording in those sections.

SPECIAL RULE:
Whenever you see "Little Baby Arm Circles", abbreviate it as "LBAC".

OUTPUT FORMAT (CRITICAL):
1) FIRST LINE MUST be exactly:
${hashtagLine}
2) SECOND LINE MUST be blank.
3) THEN write the narrative (3–6 sentences; 1–2 paragraphs; NO headers).
4) THEN a blank line.
5) THEN print backblastContent EXACTLY as given (no edits).

${variabilityAnchors}

Notes for narrative flavor (do not print as a header; use lightly):
${notes || "It was a good day to get better."}

backblastContent (print exactly, no changes):
${backblastContent}
`.trim();

  const response = await retryGeminiCall(() =>
    ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        // Controlled variability; keep the output consistent but less “samey”.
        temperature: 0.8,
      },
    })
  );

  const text = (response?.text ?? "").trim();
  if (!text) throw new Error("Gemini returned empty text for backblast.");
  return text;
};

// -----------------------------------------------------
// PARSE BACKBLAST (unchanged except better guards)
// -----------------------------------------------------
export const parsePastedBackblast = async (
  pastedText: string
): Promise<Partial<WorkoutSession>> => {
  if (!API_KEY) throw new Error("Missing VITE_GEMINI_API_KEY.");

  const ai = await getGenAiClient();
  const { Type } = await loadGenAi();

  const prompt = `
Analyze this F3 backblast text… return JSON only.

${pastedText}
`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          q: { type: Type.STRING },
          date: { type: Type.STRING },
          paxList: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
              },
              required: ["name"],
            },
          },
          exercises: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
              },
              required: ["name"],
            },
          },
        },
        required: ["q", "date", "paxList", "exercises"],
      },
    },
  });

  const raw = (response?.text ?? "").trim();
  if (!raw)
    throw new Error("Gemini returned empty JSON for parsePastedBackblast().");

  const parsed = JSON.parse(raw);

  const paxAttendance: PaxAttendance[] = (parsed.paxList || []).map((p: Pax) => ({
    id: createId(),
    name: p.name,
    bd: true,
    dd: false,
    td: false,
    bigfoot: false,
    starsky: false,
  }));

  const exerciseList: Exercise[] = (parsed.exercises || []).map(
    (e: { name: string }) => ({
      id: createId(),
      name: e.name,
    })
  );

  const theThang: WorkoutRound[] = [
    {
      id: createId(),
      name: "Parsed Workout",
      exercises: exerciseList,
    } as WorkoutRound,
  ];

  return {
    q: parsed.q,
    date: parsed.date || getWorkoutDateAndTime().simpleDate,
    paxAttendance,
    paxCount: paxAttendance.length,
    warmup: [],
    theThang,
  };
};
