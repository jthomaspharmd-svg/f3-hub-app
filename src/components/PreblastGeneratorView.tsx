import React, { useState, useMemo, useEffect, useRef } from "react";
import { generatePreblast } from "../services/geminiService";
import { MegaphoneIcon, ExternalLinkIcon } from "./icons";
import { getPaxListByAo, getBandNameForF3Name } from "../constants";
import { usePaxDirectoryVersion } from "../pax/PaxDirectoryContext";
import { useAo } from "../ao/AoContext";
import { AoSelector } from "../ao/AoSelector";

/* -------------------------------------------------
   Helpers: Time + Date formatting
------------------------------------------------- */
const pad2 = (n: number) => String(n).padStart(2, "0");

const formatTime12FromMinutes = (mins: number): string => {
  const m = ((mins % 1440) + 1440) % 1440;
  const hh24 = Math.floor(m / 60);
  const mm = m % 60;
  const ap = hh24 >= 12 ? "PM" : "AM";
  const hh12 = ((hh24 + 11) % 12) + 1;
  return `${hh12}:${pad2(mm)} ${ap}`;
};

const formatTime12 = (time24: string) => {
  const [hhStr, mmStr] = String(time24 || "").split(":");
  const hh = Number(hhStr);
  const mm = Number(mmStr);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return time24;

  const ap = hh >= 12 ? "PM" : "AM";
  const hour12 = ((hh + 11) % 12) + 1;
  return `${hour12}:${pad2(mm)} ${ap}`;
};

const formatDateLong = (d: Date) => {
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  return `${weekday}, ${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
};

const stripWeekdayFromDate = (value: string) => {
  const trimmed = String(value || "").trim();
  return trimmed.replace(/^[A-Za-z]+,\s*/, "");
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

const stripAt = (s: string) => String(s || "").trim().replace(/^@+/, "");

/* -------------------------------------------------
   Preblast style helpers (emoji rotation + DD/TD)
------------------------------------------------- */
const EMOJI_USE_PERCENT = 40; // Increase chance of no-emoji output
const EMOJI_ROTATION = {
  date: ["🗓️", "📅", "⏰", "⌚", "🔢"],
  q: ["💪", "🏋️", "🧑‍💪", "🧭", "🛡️"],
  bring: ["🎒", "🧳", "🧢", "🧤", "🧃"],
};
const LABEL_STYLE_ROTATION = [
  "plain",
  "plain",
  "dash",
] as const;
type LabelStyle = (typeof LABEL_STYLE_ROTATION)[number];

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

const pickLabelStyle = (seed: string): LabelStyle =>
  (pickFrom([...LABEL_STYLE_ROTATION], seed, "label-style") as LabelStyle) ||
  "plain";

const formatStyledLabel = (label: string, style: LabelStyle) => {
  const core = label.replace(/:\s*$/, "");
  if (style === "dash") return `${core} -`;
  return `${core}:`;
};

const buildStyledFieldLine = (
  prefix: string,
  label: string,
  value: string,
  style: LabelStyle
) => `${prefix}${formatStyledLabel(label, style)} ${value}`;

const pickBringLabel = (seed: string) =>
  pickFrom(["Bring", "Bring", "What to Bring"], seed, "bring-label") || "Bring";

const buildDdTdBlock = (style: LabelStyle) =>
  [
    buildStyledFieldLine("", "DD:", "Comment Below", style),
    buildStyledFieldLine("", "TD:", "Comment Below", style),
  ].join("\n");

const buildPreblastClosing = (styleSeed: string, qName: string) => {
  const qClean = stripAt(qName) || "TBD";
  const variants = [
    ["SYITG", `-${qClean}`],
    ["HC below."],
    ["HC below.", "- SYITG!"],
    ["SYITG"],
    [`-${qClean}`],
    [],
  ];
  const idx = hashSeed(`${styleSeed}:preblast-closing`) % variants.length;
  return variants[idx].join("\n");
};

const shouldIncludeAoAddress = (aoId: string, styleSeed: string) => {
  if (aoId !== "compass") return true;
  return (hashSeed(`${styleSeed}:ao-address`) % 100) < 55;
};

const buildPreblastDateTimeBlock = (
  styleSeed: string,
  workoutDate: string,
  workoutTime: string,
  labelStyle: LabelStyle,
  datePrefix: string
) => {
  const splitDateTime = (hashSeed(`${styleSeed}:date-time-layout`) % 100) < 40;
  const cleanDate = stripWeekdayFromDate(workoutDate);
  const timeEmoji = pickFrom(EMOJI_ROTATION.date, styleSeed, "time");
  const timePrefix = datePrefix || (timeEmoji ? `${timeEmoji} ` : "");

  if (splitDateTime) {
    return [
      buildStyledFieldLine(datePrefix, "Date:", cleanDate, labelStyle),
      buildStyledFieldLine(timePrefix, "Time:", workoutTime, labelStyle),
    ].join("\n");
  }

  return buildStyledFieldLine(
    datePrefix,
    "Date/Time:",
    `${cleanDate} (${workoutTime})`,
    labelStyle
  );
};

const escapeRegExp = (value: string) =>
  String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildStyleSeed = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const shouldUseEmojis = (
  seed: string,
  forceNoEmojis: boolean,
  minimalEmojis: boolean
) => {
  if (forceNoEmojis || minimalEmojis) return false;
  const n = hashSeed(`${seed}:emoji`) % 100;
  return n < EMOJI_USE_PERCENT;
};

/* -------------------------------------------------
   Parse start time from "6:00 AM - 7:15 AM"
------------------------------------------------- */
const parseStartTimeFromRange = (
  range: string
): { minutes: number; ok: boolean } => {
  const m = String(range || "").match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return { minutes: 0, ok: false };

  let hh = Number(m[1]);
  const mm = Number(m[2]);
  const ap = String(m[3]).toUpperCase();
  if (Number.isNaN(hh) || Number.isNaN(mm)) return { minutes: 0, ok: false };

  if (ap === "AM") {
    if (hh === 12) hh = 0;
  } else {
    if (hh !== 12) hh += 12;
  }

  return { minutes: hh * 60 + mm, ok: true };
};

const safeStartMinutesFromWorkoutTime = (workoutTime: string): number => {
  const parsed = parseStartTimeFromRange(workoutTime);
  return parsed.ok ? parsed.minutes : 6 * 60; // fallback 6:00 AM
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

const parseWorkoutDateToIso = (workoutDate: string): string => {
  const parsed = new Date(workoutDate);
  if (!Number.isNaN(parsed.getTime())) {
    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, "0");
    const dd = String(parsed.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  const m = String(workoutDate || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return "";
  const mm = m[1].padStart(2, "0");
  const dd = m[2].padStart(2, "0");
  const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${yyyy}-${mm}-${dd}`;
};

/* -------------------------------------------------
   Find next workout date/time based on AO scheduleBlocks
------------------------------------------------- */
const getUpcomingWorkoutDetailsForAo = (ao: {
  scheduleBlocks: {
    daysOfWeek: number[];
    startTime24: string;
    endTime24: string;
  }[];
}) => {
  const now = new Date();

  const parseStart = (d: Date, startTime24: string) => {
    const [hh, mm] = startTime24.split(":").map(Number);
    const x = new Date(d);
    x.setHours(hh || 0, mm || 0, 0, 0);
    return x;
  };

  let best: {
    start: Date;
    startTime24: string;
    endTime24: string;
  } | null = null;

  for (let add = 0; add <= 14; add++) {
    const day = new Date(now);
    day.setDate(now.getDate() + add);

    for (const block of ao.scheduleBlocks || []) {
      if (!block.daysOfWeek.includes(day.getDay())) continue;

      const start = parseStart(day, block.startTime24);
      if (start.getTime() <= now.getTime()) continue;

      if (!best || start.getTime() < best.start.getTime()) {
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
    date: formatDateLong(chosen.start),
    time: buildWorkoutTimeRange(chosen.startTime24, chosen.endTime24),
    startTime24: chosen.startTime24,
  };
};

/* -------------------------------------------------
   Hashtags helper: AO hashtags + #preblast
-------------------------------------------------- */
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
  opts?: { aoId?: string; workoutDate?: string; userHashtags?: string[] }
) => {
  const extra = kind === "preblast" ? ["#preblast"] : ["#backblast"];
  const extraAoTags =
    opts?.aoId === "thehill" && isFridayFromDateString(opts?.workoutDate || "")
      ? ["#hillybillyshuffle"]
      : [];
  const seen = new Set<string>();
  return [
    ...extra,
    ...(aoHashtags || []),
    ...((opts?.userHashtags as string[]) || []),
    ...extraAoTags,
  ].filter((t) => {
    const v = String(t || "").trim();
    if (!v) return false;
    const key = v.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const normalizeHashtags = (tags: string[]) => {
  const seen = new Set<string>();
  return tags
    .map((t) => String(t || "").trim())
    .filter(Boolean)
    .map((t) => (t.startsWith("#") ? t : `#${t}`))
    .filter((t) => {
      const key = t.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const parseCustomHashtags = (raw: string) => {
  return String(raw || "")
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
};

/* -------------------------------------------------
   JP detection
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
   Normalize Gemini output quirks
   - Fix "📍WHERE:" => "📍Where:"
------------------------------------------------- */
const normalizeAiPreblast = (
  raw: string,
  aoId: string,
  address: string,
  styleSeed: string,
  useEmojis: boolean,
  qName: string
): string => {
  const text = String(raw || "").replace(/\r\n/g, "\n");
  const labelStyle = pickLabelStyle(styleSeed);
  const bringLabel = pickBringLabel(styleSeed);
  // Most common variant you showed:
  let out = text.replace(/📍\s*WHERE\s*:/gi, "📍Where:");
  // A couple defensive extras:
  out = out.replace(/^\s*WHERE\s*:/gim, "Where:");
  // Normalize BRING label + add a blank line before it after TD.
  out = out.replace(/🎒\s*BRING\s*:/gi, "🎒 Bring:");
  out = out.replace(/^\s*DD\s*(?:\(|:|-|—)?\s*(?:Drop It in the Comments|Drop it in comments|Comment Below)\)?\s*$/gim, "DD: Comment Below");
  out = out.replace(/^\s*TD\s*(?:\(|:|-|—)?\s*(?:Drop It in the Comments|Drop it in comments|Comment Below)\)?\s*$/gim, "TD: Comment Below");
  out = out.replace(/^\s*DD\/TD\s*(?:-|—|:)\s*Drop It in the Comments\s*$/gim, "DD: Comment Below\nTD: Comment Below");
  out = out.replace(/TD:\s*Comment Below\s*\n\s*🎒/gi, "TD: Comment Below\n\n🎒");
  out = out.replace(/TD:\s*Comment Below\s*\n\s*Bring\s*:/gi, "TD: Comment Below\n\nBring:");
  out = out.replace(/TD:\s*Comment Below\s*\n+/gi, "TD: Comment Below\n\n");
  out = out.replace(/TD:\s*Comment Below\s*Bring\s*:/gi, "TD: Comment Below\n\nBring:");
  out = out.replace(
    /TD:\s*Comment Below\s*\n*(\S)/gi,
    "TD: Comment Below\n\n$1"
  );
  out = out.replace(
    /TD:\s*Comment Below\s*(Bring\s*:)/gi,
    "TD: Comment Below\n\n$1"
  );
  out = out.replace(
    /TD:\s*Comment Below\s*\n+((?:🎒\s*)?(?:Bring|What to Bring)\s*:)/gi,
    "TD: Comment Below\n\n$1"
  );
  // Final guard: enforce a blank line between TD and Bring even if spacing varies.
  out = out.replace(
    /TD:\s*Comment Below\s*(?:\r?\n\s*)+(?:🎒\s*)?(?:Bring|What to Bring)\s*:/gi,
    "TD: Comment Below\n\nBring:"
  );
  out = out.replace(
    /TD:\s*Comment Below\s*(?:🎒\s*)?(?:Bring|What to Bring)\s*:/gi,
    "TD: Comment Below\n\nBring:"
  );
  // Add a blank line between Q and Where if missing.
  out = out.replace(/(💪\s*Q\s*:.*)\n(📍\s*Where\s*:)/gi, "$1\n\n$2");
  out = out.replace(/(💪Q\s*:.*)\n(📍\s*Where\s*:)/gi, "$1\n\n$2");
  out = out.replace(/(^\s*Q\s*:.*)\n(📍\s*Where\s*:)/gim, "$1\n\n$2");
  out = out.replace(/(^\s*Q\s*:.*)\n(^\s*Where\s*:)/gim, "$1\n\n$2");
  out = out.replace(/(💪\s*Q\s*:.*)\n(📍\s*AO\s*:)/gi, "$1\n\n$2");
  out = out.replace(/(💪Q\s*:.*)\n(📍\s*AO\s*:)/gi, "$1\n\n$2");
  out = out.replace(/(^\s*Q\s*:.*)\n(📍\s*AO\s*:)/gim, "$1\n\n$2");
  out = out.replace(/(^\s*Q\s*:.*)\n(^\s*AO\s*:)/gim, "$1\n\n$2");
  // Normalize Date/Time line (remove stray leading chars)
  out = out.replace(/^[^\S\r\n]*[\p{So}\uFE0F]*\s*Date\/Time:/gimu, "Date/Time:");
  out = out.replace(
    /^(Date\/Time:\s*)([A-Za-z]+,\s*)/gim,
    "$1"
  );
  // Ensure a blank line before Date/Time and after Date/Time.
  out = out.replace(/([^\n])\n(Date\/Time:)/gim, "$1\n\n$2");
  out = out.replace(/^(Date\/Time:[^\n]*)(\n*)/gim, "$1\n\n");
  out = out.replace(
    /^(Date\/Time:[^\n]*)(?:\n+)(DD:\s*Comment Below)/gim,
    "$1\n\n$2"
  );
  // Ensure no leading space before Bring
  out = out.replace(/^\s*Bring\s*:/gim, "Bring:");
  out = out.replace(/^\s*What to Bring\s*:/gim, "What to Bring:");
  // Remove any Weather line from content block (weather should be in intro only)
  out = out.replace(/^\s*Weather\s*:[^\n]*\n?/gim, "");
  const addr = String(address || "").trim();
  if (addr) {
    const includeAoAddress = shouldIncludeAoAddress(aoId, styleSeed);
    // Remove any standalone address lines
    out = out.replace(/^\s*(?:📫\s*)?Address\s*:[^\n]*\n?/gim, "");
    out = out.replace(new RegExp(`^\\s*${escapeRegExp(addr)}\\s*$`, "gim"), "");

    if (includeAoAddress) {
      // Ensure AO/Where line includes address in parentheses
      out = out.replace(
        /^(📍\s*)?(AO|Where)\s*:\s*(.+)$/gim,
        (m, p1, label, rest) => {
          const restStr = String(rest || "").trim();
          if (!restStr) return m;
          if (restStr.toLowerCase().includes(addr.toLowerCase())) {
            return `${p1 || ""}${label}: ${restStr}`;
          }
          return `${p1 || ""}${label}: ${restStr} (${addr})`;
        }
      );
    } else {
      out = out.replace(
        new RegExp(`\\s*\\(${escapeRegExp(addr)}\\)`, "gi"),
        ""
      );
    }
  }

  // Emoji rotation (if enabled)
  const qEmoji = useEmojis ? pickFrom(EMOJI_ROTATION.q, styleSeed, "q") : "";
  const dateEmoji = useEmojis
    ? pickFrom(EMOJI_ROTATION.date, styleSeed, "date")
    : "";
  const bringEmoji = useEmojis
    ? pickFrom(EMOJI_ROTATION.bring, styleSeed, "bring")
    : "";

  const qPrefix = useEmojis && qEmoji ? `${qEmoji} ` : "";
  const datePrefix = useEmojis && dateEmoji ? `${dateEmoji} ` : "";
  const bringPrefix = useEmojis && bringEmoji ? `${bringEmoji} ` : "";
  out = out.replace(
    /^[^\S\r\n]*[\p{So}\uFE0F]*\s*Q\s*:/gim,
    `${qPrefix}${formatStyledLabel("Q:", labelStyle)}`
  );
  out = out.replace(
    /^[^\S\r\n]*[\p{So}\uFE0F]*\s*(Date\/Time|Date)\s*:/gim,
    `${datePrefix}${formatStyledLabel("Date/Time:", labelStyle)}`
  );
  if ((hashSeed(`${styleSeed}:date-time-layout`) % 100) < 40) {
    out = out.replace(
      /^(.*?)(?:Date\/Time|Date)\s*:\s*([^()\n]+?)\s*\(([^)\n]+)\)\s*$/gim,
      (_m, prefix, datePart, timePart) =>
        `${buildStyledFieldLine(
          prefix,
          "Date:",
          String(datePart || "").trim(),
          labelStyle
        )}\n${buildStyledFieldLine(
          "",
          "Time:",
          String(timePart || "").trim(),
          labelStyle
        ).trimStart()}`
    );
  }
  out = out.replace(
    /^[^\S\r\n]*[\p{So}\uFE0F]*\s*(?:Bring|What to Bring)\s*:/gim,
    `${bringPrefix}${formatStyledLabel(`${bringLabel}:`, labelStyle)}`
  );
  out = out.replace(
    /^[^\S\r\n]*[\p{So}\uFE0F]*\s*AO\s*:/gim,
    `${useEmojis ? "📍 " : ""}${formatStyledLabel("AO:", labelStyle)}`
  );
  out = out.replace(
    /^[^\S\r\n]*[\p{So}\uFE0F]*\s*Where\s*:/gim,
    `${useEmojis ? "📍 " : ""}${formatStyledLabel("Where:", labelStyle)}`
  );

  const closingBlock = buildPreblastClosing(styleSeed, qName);
  if (closingBlock) {
    const lines = out
      .split("\n")
      .filter(
        (line) =>
          !/^\s*(DD|TD|DD\/TD|Double Down|Triple Down)\b/i.test(line.trim())
      );
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    lines.push("");
    lines.push(...closingBlock.split("\n"));
    out = lines.join("\n");
  }

  return out;
};

const stripEmojis = (text: string): string =>
  String(text || "").replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "");

const stripMarkdownImageLines = (text: string): string =>
  String(text || "")
    .replace(/^\s*!\[[^\]]*]\([^)]+\)\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/* -------------------------------------------------
   Extract ONLY the inspirational message from Gemini output
   (defensive: if Gemini returns extra stuff)
------------------------------------------------- */
const extractInspirationalMessage = (raw: string): string => {
  const text = String(raw || "").replace(/\r\n/g, "\n").trim();
  if (!text) return "";

  const lines = text.split("\n").map((l) => l.trim());

  while (lines.length && lines[0] === "") lines.shift();
  while (lines.length && lines[lines.length - 1] === "") lines.pop();

  const stopMatchers = [
    /^#preblast\b/i,
    /^\*\*\*Q\b/i,
    /^💪\s*Q\s*:/i,
    /^💪Q\s*:/i,
    /^📍\s*(AO|Where)\s*:/i,
    /^📫\s*Address\s*:/i,
    /^📌\s*(Meet|Meet Location)\b/i,
    /^🗓️\s*(Date\/Time|Date)\s*:/i,
    /^🎒\s*BRING\s*:/i,
    /^⏰\s*Early Opportunities\b/i,
    /^🛑\s*COT\b/i,
    /^🏃/i,
    /^🎒\s*Ruckers/i,
  ];

  const out: string[] = [];
  for (const line of lines) {
    if (!line) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      continue;
    }
    if (stopMatchers.some((rx) => rx.test(line))) break;
    out.push(line);
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
};

/* -------------------------------------------------
   Jurassic Park formatters
   - NO-AI: keep the Q-fill placeholder line (no random hook lines)
   - Meet Location default: "Far south end of the parking lot"
------------------------------------------------- */
const JP_DEFAULT_MEET = "Far south end of the parking lot";

const formatJurassicParkNoAI = (args: {
  qName: string;
  workoutDate: string;
  workoutTime: string;
  styleSeed: string;
  useEmojis: boolean;
  ao: {
    id: string;
    displayName: string;
    whereName: string;
    address: string;
    meetingPoint?: string;
    hashtags: string[];
  };
  extraHashtags: string[];
}) => {
  const hashtags = buildHashtags(args.ao.hashtags || [], "preblast", {
    aoId: args.ao.id,
    workoutDate: args.workoutDate,
    userHashtags: args.extraHashtags,
  }).join(" ");
  const qClean = stripAt(args.qName) || "TBD";

  const whereLine =
    args.ao.whereName && args.ao.whereName !== args.ao.displayName
      ? `${args.ao.displayName} — ${args.ao.whereName}`
      : args.ao.displayName;
  const addrSuffix =
    args.ao.address && shouldIncludeAoAddress(args.ao.id, args.styleSeed)
      ? ` (${args.ao.address})`
      : "";

  const meetRaw = (args.ao.meetingPoint || "").trim();
  const meet =
    !meetRaw ||
    /^meeting point is the far south end of the parking lot\.?$/i.test(meetRaw)
      ? JP_DEFAULT_MEET
      : meetRaw;


  const lines: string[] = [];
  const qEmoji = args.useEmojis
    ? pickFrom(EMOJI_ROTATION.q, args.styleSeed, "q")
    : "";
  const dateEmoji = args.useEmojis
    ? pickFrom(EMOJI_ROTATION.date, args.styleSeed, "date")
    : "";
  const qPrefix = args.useEmojis && qEmoji ? `${qEmoji} ` : "";
  const datePrefix = args.useEmojis && dateEmoji ? `${dateEmoji} ` : "";
  const labelStyle = pickLabelStyle(args.styleSeed);
  const ddTdBlock = buildDdTdBlock(labelStyle);

  lines.push(hashtags);
  lines.push("");
  lines.push("🦖 Jurassic Park Pre-Blast 🦖");
  lines.push("");
  lines.push(
    '***Q — CLICK “COPY & START POST IN BAND”, THEN REPLACE THIS WITH YOUR OWN CALL TO ACTION MESSAGE***'
  );
  lines.push("");
  lines.push(buildStyledFieldLine(qPrefix, "Q:", qClean, labelStyle));
  lines.push("");
  lines.push(
    buildStyledFieldLine(
      args.useEmojis ? "📍 " : "",
      "AO:",
      `${whereLine}${addrSuffix}`,
      labelStyle
    )
  );
  lines.push(`📌 Meet Location: ${meet}`);
  lines.push("");
  lines.push(`${datePrefix}${stripWeekdayFromDate(args.workoutDate)}`);
  lines.push("");
  lines.push("🏃‍♂️ Runners — First Wave");
  lines.push("6:00 AM step-off");
  lines.push("6.15 miles");
  lines.push("");
  lines.push("🏃‍♂️ Runners — Second Wave");
  lines.push("6:35 AM step-off");
  lines.push("3.0 miles");
  lines.push("Meet at the land bridge and merge with Wave 1");
  lines.push("");
  lines.push("🎒 Ruckers / Walkers");
  lines.push("6:00 AM step-off from AO meeting point");
  lines.push("");
  lines.push("🛑 COT & Announcements: 7:15 AM sharp");
  lines.push("☕ Coffeeteria immediately following");
  lines.push("");
  lines.push("⏰ Early Opportunities");
  lines.push(ddTdBlock);

  return lines.join("\n");
};

const formatJurassicParkAI = (args: {
  qName: string;
  workoutDate: string;
  workoutTime: string;
  styleSeed: string;
  useEmojis: boolean;
  ao: {
    id: string;
    displayName: string;
    whereName: string;
    address: string;
    meetingPoint?: string;
    hashtags: string[];
  };
  aiMessage: string;
  extraHashtags: string[];
}) => {
  const hashtags = buildHashtags(args.ao.hashtags || [], "preblast", {
    aoId: args.ao.id,
    workoutDate: args.workoutDate,
    userHashtags: args.extraHashtags,
  }).join(" ");
  const qClean = stripAt(args.qName) || "TBD";

  const whereLine =
    args.ao.whereName && args.ao.whereName !== args.ao.displayName
      ? `${args.ao.displayName} — ${args.ao.whereName}`
      : args.ao.displayName;
  const addrSuffix = args.ao.address ? ` (${args.ao.address})` : "";

  const meetRaw = (args.ao.meetingPoint || "").trim();
  const meet =
    !meetRaw ||
    /^meeting point is the far south end of the parking lot\.?$/i.test(meetRaw)
      ? JP_DEFAULT_MEET
      : meetRaw;


  const FALLBACKS = [
    "Post up and start Sunday strong—run or ruck with the PAX. All fitness levels welcome. HC below.",
    "Bring a friend and get your miles in with the boys. Run or ruck—either way, we roll together. HC below.",
    "Sunrise miles and strong fellowship. Show up and put in the work—then lock in COT. HC below.",
  ];

  const rawMsg = (args.aiMessage || "").trim();
  const msg = rawMsg || FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)];

  const lines: string[] = [];
  const qEmoji = args.useEmojis
    ? pickFrom(EMOJI_ROTATION.q, args.styleSeed, "q")
    : "";
  const dateEmoji = args.useEmojis
    ? pickFrom(EMOJI_ROTATION.date, args.styleSeed, "date")
    : "";
  const qPrefix = args.useEmojis && qEmoji ? `${qEmoji} ` : "";
  const datePrefix = args.useEmojis && dateEmoji ? `${dateEmoji} ` : "";
  const labelStyle = pickLabelStyle(args.styleSeed);
  const ddTdBlock = buildDdTdBlock(labelStyle);

  lines.push(hashtags);
  lines.push("");
  lines.push("🦖 Jurassic Park Pre-Blast 🦖");
  lines.push("");
  lines.push(msg);
  lines.push("");
  lines.push(buildStyledFieldLine(qPrefix, "Q:", qClean, labelStyle));
  lines.push("");
  lines.push(
    buildStyledFieldLine(
      args.useEmojis ? "📍 " : "",
      "AO:",
      `${whereLine}${addrSuffix}`,
      labelStyle
    )
  );
  lines.push(`📌 Meet Location: ${meet}`);
  lines.push("");
  lines.push(`${datePrefix}${args.workoutDate}`);
  lines.push("");
  lines.push("🏃‍♂️ Runners — First Wave");
  lines.push("6:00 AM step-off");
  lines.push("6.15 miles");
  lines.push("");
  lines.push("🏃‍♂️ Runners — Second Wave");
  lines.push("6:35 AM step-off");
  lines.push("3.0 miles");
  lines.push("Meet at the land bridge and merge with Wave 1");
  lines.push("");
  lines.push("🎒 Ruckers / Walkers");
  lines.push("6:00 AM step-off from AO meeting point");
  lines.push("");
  lines.push("🛑 COT & Announcements: 7:15 AM sharp");
  lines.push("☕ Coffeeteria immediately following");
  lines.push("");
  lines.push("⏰ Early Opportunities");
  lines.push(ddTdBlock);

  return lines.join("\n");
};

/* -------------------------------------------------
   Standard AI Formatter (non-JP)
------------------------------------------------- */
const formatStandardAI = (args: {
  qName: string;
  workoutDate: string;
  workoutTime: string;
  bringItems: string[];
  styleSeed: string;
  useEmojis: boolean;
  ao: {
    id: string;
    displayName: string;
    whereName: string;
    address: string;
    meetingPoint?: string;
    hashtags: string[];
  };
  aiMessage: string;
  extraHashtags: string[];
}) => {
  const hashtags = buildHashtags(args.ao.hashtags || [], "preblast", {
    aoId: args.ao.id,
    workoutDate: args.workoutDate,
    userHashtags: args.extraHashtags,
  }).join(" ");

  const whereLine =
    args.ao.whereName && args.ao.whereName !== args.ao.displayName
      ? `${args.ao.displayName} — ${args.ao.whereName}`
      : args.ao.displayName;

  const qEmoji = args.useEmojis
    ? pickFrom(EMOJI_ROTATION.q, args.styleSeed, "q")
    : "";
  const dateEmoji = args.useEmojis
    ? pickFrom(EMOJI_ROTATION.date, args.styleSeed, "date")
    : "";
  const bringEmoji = args.useEmojis
    ? pickFrom(EMOJI_ROTATION.bring, args.styleSeed, "bring")
    : "";
  const qPrefix = args.useEmojis && qEmoji ? `${qEmoji} ` : "";
  const datePrefix = args.useEmojis && dateEmoji ? `${dateEmoji} ` : "";
  const bringPrefix = args.useEmojis && bringEmoji ? `${bringEmoji} ` : "";
  const labelStyle = pickLabelStyle(args.styleSeed);
  const bringLabel = pickBringLabel(args.styleSeed);

  const bringLine = args.bringItems.length
    ? buildStyledFieldLine(
        bringPrefix,
        `${bringLabel}:`,
        args.bringItems.join(", "),
        labelStyle
      )
    : "";

  const addrSuffix =
    args.ao.address && shouldIncludeAoAddress(args.ao.id, args.styleSeed)
      ? ` (${args.ao.address})`
      : "";
  const closingBlock = buildPreblastClosing(args.styleSeed, args.qName);
  const FALLBACKS = [
    "Post up and put in the work with the PAX. I’ve got the beatdown covered and all fitness levels are welcome.",
    "Come get better with me in the gloom. We’ll mix sweat, fellowship, and some good hard work.",
    "Show up ready to move and chase some discomfort. I’ve got the plan, you just bring the effort.",
  ];

  const rawMsg = (args.aiMessage || "").trim();
  const msg = rawMsg || FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)];

  const lines: string[] = [];

  lines.push(hashtags);
  lines.push("");
  lines.push(msg);
  lines.push("");
  lines.push(
    buildStyledFieldLine(
      qPrefix,
      "Q:",
      stripAt(args.qName) || "TBD",
      labelStyle
    )
  );
  lines.push("");
  lines.push(
    buildStyledFieldLine(
      args.useEmojis ? "📍 " : "",
      "AO:",
      `${whereLine}${addrSuffix}`,
      labelStyle
    )
  );

  if (args.ao.meetingPoint?.trim()) {
    lines.push(
      `${args.useEmojis ? "📌 " : ""}Meet: ${args.ao.meetingPoint.trim()}`
    );
  }

  lines.push("");
  lines.push(
    buildPreblastDateTimeBlock(
      args.styleSeed,
      args.workoutDate,
      args.workoutTime,
      labelStyle,
      datePrefix
    )
  );
  if (bringLine) lines.push(bringLine);

  if (closingBlock) {
    lines.push("");
    lines.push(closingBlock);
  }

  return lines.join("\n");
};

/* -------------------------------------------------
   Standard No-AI Formatter (non-JP) — your blank-line rules
------------------------------------------------- */
const formatStandardNoAI = (args: {
  qName: string;
  workoutDate: string;
  workoutTime: string;
  bringItems: string[];
  styleSeed: string;
  useEmojis: boolean;
  ao: {
    id: string;
    displayName: string;
    whereName: string;
    address: string;
    meetingPoint?: string;
    hashtags: string[];
  };
  extraHashtags: string[];
}) => {
  const hashtags = buildHashtags(args.ao.hashtags || [], "preblast", {
    aoId: args.ao.id,
    workoutDate: args.workoutDate,
    userHashtags: args.extraHashtags,
  }).join(" ");

  const whereLine =
    args.ao.whereName && args.ao.whereName !== args.ao.displayName
      ? `${args.ao.displayName} — ${args.ao.whereName}`
      : args.ao.displayName;

  const qEmoji = args.useEmojis
    ? pickFrom(EMOJI_ROTATION.q, args.styleSeed, "q")
    : "";
  const dateEmoji = args.useEmojis
    ? pickFrom(EMOJI_ROTATION.date, args.styleSeed, "date")
    : "";
  const bringEmoji = args.useEmojis
    ? pickFrom(EMOJI_ROTATION.bring, args.styleSeed, "bring")
    : "";
  const qPrefix = args.useEmojis && qEmoji ? `${qEmoji} ` : "";
  const datePrefix = args.useEmojis && dateEmoji ? `${dateEmoji} ` : "";
  const bringPrefix = args.useEmojis && bringEmoji ? `${bringEmoji} ` : "";
  const labelStyle = pickLabelStyle(args.styleSeed);
  const bringLabel = pickBringLabel(args.styleSeed);

  const bringLine = args.bringItems.length
    ? buildStyledFieldLine(
        bringPrefix,
        `${bringLabel}:`,
        args.bringItems.join(", "),
        labelStyle
      )
    : "";

  const addrSuffix = args.ao.address ? ` (${args.ao.address})` : "";
  const closingBlock = buildPreblastClosing(args.styleSeed, args.qName);


  const lines: string[] = [];

  lines.push(hashtags);
  lines.push("");
  lines.push(
    '***Q — CLICK “COPY & START POST IN BAND”, THEN REPLACE THIS WITH YOUR OWN CALL TO ACTION MESSAGE***'
  );
  lines.push("");
  lines.push(
    buildStyledFieldLine(
      qPrefix,
      "Q:",
      stripAt(args.qName) || "TBD",
      labelStyle
    )
  );
  lines.push("");
  lines.push(
    buildStyledFieldLine(
      args.useEmojis ? "📍 " : "",
      "AO:",
      `${whereLine}${addrSuffix}`,
      labelStyle
    )
  );

  if (args.ao.meetingPoint?.trim()) {
    lines.push(
      `${args.useEmojis ? "📌 " : ""}Meet: ${args.ao.meetingPoint.trim()}`
    );
  }

  lines.push("");
  lines.push(
    buildPreblastDateTimeBlock(
      args.styleSeed,
      args.workoutDate,
      args.workoutTime,
      labelStyle,
      datePrefix
    )
  );
  if (bringLine) lines.push(bringLine);

  if (closingBlock) {
    lines.push("");
    lines.push(closingBlock);
  }

  return lines.join("\n");
};

/* -------------------------------------------------
   QName Select (Shared PAX List)
------------------------------------------------- */
const QNameSelect: React.FC<{
  value: string;
  onChange: (v: string) => void;
  paxList: readonly string[];
}> = ({ value, onChange, paxList }) => {
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
        className="w-full min-h-[44px] bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-white text-sm"
        autoFocus
      />
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "custom") setIsCustomEditing(true);
        else onChange(v);
      }}
      className="w-full min-h-[44px] bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-white text-sm"
    >
      <option value="">Select Q</option>

      {isCustomValue && <option value={value}>{value}</option>}

      {paxList.map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}

      <option value="custom">-- Custom --</option>
    </select>
  );
};

const MobileSectionToggle: React.FC<{
  title: string;
  subtitle?: string;
  expanded: boolean;
  onToggle: () => void;
}> = ({ title, subtitle, expanded, onToggle }) => {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="sm:hidden w-full rounded-md border border-slate-600 bg-slate-700/70 px-3 py-3 text-left"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white">{title}</div>
          {subtitle ? (
            <div className="mt-0.5 text-xs text-slate-400">{subtitle}</div>
          ) : null}
        </div>
        <span className="text-slate-400" aria-hidden="true">
          {expanded ? "▴" : "▾"}
        </span>
      </div>
    </button>
  );
};

/* -------------------------------------------------
   MAIN COMPONENT
------------------------------------------------- */
export const PreblastGeneratorView: React.FC = () => {
  const { activeAo } = useAo();
  const paxDirectoryVersion = usePaxDirectoryVersion();
  const paxList = useMemo(
    () => getPaxListByAo(activeAo.id),
    [activeAo.id, paxDirectoryVersion]
  );

  const renderPreblastPreview = (text: string) => {
    const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
    return lines.map((line, idx) => {
      if (!line.trim()) {
        return <div key={`line-${idx}`} className="h-3" />;
      }
      return (
        <div key={`line-${idx}`} className="text-slate-200 whitespace-pre-wrap">
          {line}
        </div>
      );
    });
  };

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

  const forceNoEmojis = activeAo.id === "theshadows";
  const forceNoAiAo = [
    "thehill",
    "phoenixrising",
    "gatorbay",
    "theshadows",
  ].includes(activeAo.id);

  const preblastAoLabel = useMemo(() => {
    if (activeAo.id === "theshadows") return "Shadows";
    return activeAo.shortName || activeAo.displayName;
  }, [activeAo.id, activeAo.shortName, activeAo.displayName]);

  const preblastWhereName = useMemo(() => {
    if (activeAo.id === "compass" || activeAo.id === "theshadows") {
      return preblastAoLabel;
    }
    return activeAo.whereName;
  }, [activeAo.id, activeAo.whereName, preblastAoLabel]);

  const { date: defaultDate, time: defaultTime } = useMemo(() => {
    return getUpcomingWorkoutDetailsForAo(activeAo);
  }, [activeAo]);

  const [qName, setQName] = useState("");
  const [workoutDate, setWorkoutDate] = useState(defaultDate);
  const [workoutTime, setWorkoutTime] = useState(defaultTime);
  const [dateInputValue, setDateInputValue] = useState(() => toIsoDate(defaultDate));
  const { start: parsedStart, end: parsedEnd } = useMemo(
    () => parseTimeRangeTo24(defaultTime),
    [defaultTime]
  );
  const [startTime24, setStartTime24] = useState(parsedStart || "06:00");
  const [endTime24, setEndTime24] = useState(parsedEnd || "07:00");
  const [toBring, setToBring] = useState<string[]>([]);
  const [customToBring, setCustomToBring] = useState("");
  const [extraHashtags, setExtraHashtags] = useState<string[]>([]);
  const [customHashtags, setCustomHashtags] = useState("");
  const [isMobileHashtagsExpanded, setIsMobileHashtagsExpanded] = useState(false);
  const [isMobileBringExpanded, setIsMobileBringExpanded] = useState(false);
  const [isMobileAiExpanded, setIsMobileAiExpanded] = useState(false);
  const [notes, setNotes] = useState("");
  const [generatedPreblastText, setGeneratedPreblastText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [generateMode, setGenerateMode] = useState<"AI" | "NO_AI" | null>(null);
  const [outputLabel, setOutputLabel] = useState("");
  const [outputTimestamp, setOutputTimestamp] = useState("");
  const [outputMode, setOutputMode] = useState<"AI" | "NO_AI" | "">("");
  const [aiOptions, setAiOptions] = useState({
    highEnergy: false,
    gratitude: false,
    missionValues: false,
    minimalEmojis: false,
    funny: false,
    ironSharpensIron: false,
  });

  // Error = red (actual problem), Info = slate/blue (status / fallback messaging)
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const [copySuccess, setCopySuccess] = useState(false);

  // Gemini progress indicator (# seconds)
  const [geminiSeconds, setGeminiSeconds] = useState(0);
  const geminiStartMsRef = useRef<number | null>(null);
  const geminiIntervalRef = useRef<number | null>(null);

  const outputRef = useRef<HTMLDivElement | null>(null);
  const outputBottomRef = useRef<HTMLDivElement | null>(null);
  const dateInputRef = useRef<HTMLInputElement | null>(null);
  const startTimeInputRef = useRef<HTMLInputElement | null>(null);
  const endTimeInputRef = useRef<HTMLInputElement | null>(null);

  const PREBLAST_DRAFT_KEY = useMemo(
    () => `f3PreblastDraft_${activeAo.id}`,
    [activeAo.id]
  );
  const didRestoreRef = useRef(false);
  const [hydrated, setHydrated] = useState(false);
  const lastAoIdRef = useRef<string | null>(null);

  const stopGeminiTimer = () => {
    if (geminiIntervalRef.current) {
      window.clearInterval(geminiIntervalRef.current);
      geminiIntervalRef.current = null;
    }
    geminiStartMsRef.current = null;
  };

  const startGeminiTimer = () => {
    stopGeminiTimer();
    setGeminiSeconds(0);
    geminiStartMsRef.current = Date.now();
    geminiIntervalRef.current = window.setInterval(() => {
      const start = geminiStartMsRef.current;
      if (!start) return;
      const secs = Math.floor((Date.now() - start) / 1000);
      setGeminiSeconds(secs);
    }, 250);
  };

  useEffect(() => {
    return () => stopGeminiTimer();
  }, []);

  useEffect(() => {
    if (forceNoAiAo && generateMode !== "NO_AI") {
      setGenerateMode("NO_AI");
    }
  }, [forceNoAiAo, generateMode]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(PREBLAST_DRAFT_KEY);
      if (!raw) {
        setHydrated(true);
        return;
      }

      const saved = JSON.parse(raw);

      if (saved?.draftForDate !== defaultDate) {
        sessionStorage.removeItem(PREBLAST_DRAFT_KEY);
        setHydrated(true);
        return;
      }

      if (typeof saved.qName === "string") setQName(saved.qName);
      if (typeof saved.workoutDate === "string") setWorkoutDate(saved.workoutDate);
      if (typeof saved.workoutTime === "string") setWorkoutTime(saved.workoutTime);
      if (Array.isArray(saved.toBring)) setToBring(saved.toBring);
      if (typeof saved.customToBring === "string") setCustomToBring(saved.customToBring);
      if (Array.isArray(saved.extraHashtags)) setExtraHashtags(saved.extraHashtags);
      if (typeof saved.customHashtags === "string") setCustomHashtags(saved.customHashtags);
      if (typeof saved.notes === "string") setNotes(saved.notes);
      if (typeof saved.generatedPreblastText === "string")
        setGeneratedPreblastText(saved.generatedPreblastText);

      didRestoreRef.current = true;
      setHydrated(true);
    } catch {
      sessionStorage.removeItem(PREBLAST_DRAFT_KEY);
      setHydrated(true);
    }
  }, [PREBLAST_DRAFT_KEY, defaultDate]);

  useEffect(() => {
    if (didRestoreRef.current) return;
    setWorkoutDate(defaultDate);
    setWorkoutTime(defaultTime);
  }, [defaultDate, defaultTime]);

  useEffect(() => {
    if (lastAoIdRef.current === activeAo.id) return;
    lastAoIdRef.current = activeAo.id;
    didRestoreRef.current = false;
    setIsMobileHashtagsExpanded(false);
    setIsMobileBringExpanded(false);
    setIsMobileAiExpanded(false);
    setWorkoutDate(defaultDate);
    setWorkoutTime(defaultTime);
    setDateInputValue(toIsoDate(defaultDate));
    const parsed = parseTimeRangeTo24(defaultTime);
    setStartTime24(parsed.start || "06:00");
    setEndTime24(parsed.end || "07:00");
  }, [activeAo.id, defaultDate, defaultTime]);

  useEffect(() => {
    setDateInputValue(toIsoDate(workoutDate));
  }, [workoutDate]);

  useEffect(() => {
    const parsed = parseTimeRangeTo24(workoutTime);
    if (parsed.start) setStartTime24(parsed.start);
    if (parsed.end) setEndTime24(parsed.end);
  }, [workoutTime]);

  useEffect(() => {
    if (!hydrated) return;

    const payload = {
      draftForDate: defaultDate,
      qName,
      workoutDate,
      workoutTime,
      toBring,
      customToBring,
      extraHashtags,
      customHashtags,
      notes,
      generatedPreblastText,
    };

    sessionStorage.setItem(PREBLAST_DRAFT_KEY, JSON.stringify(payload));

    return () => {
      sessionStorage.removeItem(PREBLAST_DRAFT_KEY);
    };
  }, [
    hydrated,
    PREBLAST_DRAFT_KEY,
    defaultDate,
    qName,
    workoutDate,
    workoutTime,
    toBring,
    customToBring,
    extraHashtags,
    customHashtags,
    notes,
    generatedPreblastText,
  ]);

  useEffect(() => {
    if (!generatedPreblastText) return;
    const t = setTimeout(() => {
      if (window.matchMedia("(max-width: 639px)").matches) {
        const pageBottom = Math.max(
          document.body.scrollHeight,
          document.documentElement.scrollHeight
        );
        window.scrollTo({ top: pageBottom, behavior: "smooth" });
        return;
      }
      outputRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
    return () => clearTimeout(t);
  }, [generatedPreblastText]);

  const commonItems = [
    "Coupon",
    "FNG",
    "Gloves",
    "Headlamp",
    "Hydration",
    "Ruck",
    "Sandbag",
    "Vest",
  ];

  const hashtagOptions = useMemo(() => {
    const base =
      activeAo.id === "jurassicpark"
        ? []
        : ["#1%better", "#AQ", "#BQ", "#GQ", "#ironsharpensiron", "#ruck"];
    const aoOpts = (activeAo as any)?.optionalHashtags || [];
    const combined = normalizeHashtags([...base, ...aoOpts]);
    return combined.sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    );
  }, [activeAo]);

  const normalizedExtraHashtags = useMemo(() => {
    const combined = [
      ...extraHashtags,
      ...parseCustomHashtags(customHashtags),
    ];
    return normalizeHashtags(combined);
  }, [extraHashtags, customHashtags]);

  const qDisplayName = useMemo(() => stripAt(qName) || "", [qName]);

  const defaultHashtags = useMemo(() => {
    return buildHashtags(activeAo.hashtags || [], "preblast", {
      aoId: activeAo.id,
      workoutDate,
    });
  }, [activeAo.hashtags, activeAo.id, workoutDate]);

  const optionalHashtags = useMemo(() => {
    const defaultsLower = new Set(defaultHashtags.map((t) => t.toLowerCase()));
    return hashtagOptions.filter((t) => !defaultsLower.has(t.toLowerCase()));
  }, [defaultHashtags, hashtagOptions]);

  const mobileOptionalHashtags = useMemo(
    () => optionalHashtags.filter((tag) => tag.toLowerCase() !== "#ruck"),
    [optionalHashtags]
  );

  const combinedHashtags = useMemo(() => {
    const defaultSet = new Set(defaultHashtags.map((t) => t.toLowerCase()));
    const combined = [...defaultHashtags, ...optionalHashtags];
    return combined.map((tag) => ({
      tag,
      isDefault: defaultSet.has(tag.toLowerCase()),
    }));
  }, [defaultHashtags, optionalHashtags]);

  const mobileVisibleHashtags = useMemo(
    () => normalizeHashtags([...defaultHashtags, ...normalizedExtraHashtags]),
    [defaultHashtags, normalizedExtraHashtags]
  );

  const mobileSelectedBringCount = toBring.length + (customToBring.trim() ? 1 : 0);
  const mobileSelectedAiCount = Object.values(aiOptions).filter(Boolean).length;
  const mobileVisibleBringItems = useMemo(() => {
    const items = [...toBring];
    if (customToBring.trim()) items.push(customToBring.trim());
    return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
  }, [toBring, customToBring]);

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

  const buildBringItems = () => {
    if (isJP) return []; // JP: remove bring section entirely
    const items = [...toBring];
    if (customToBring.trim()) items.push(customToBring.trim());
    return Array.from(new Set(items.map((x) => x.trim()).filter(Boolean)));
  };

  const buildAiOptionsNotes = (suppressEmojis: boolean) => {
    const lines: string[] = [];
    if (aiOptions.highEnergy)
      lines.push(
        "Tone: urgent, punchy, and energetic. Use strong action language, not generic hype."
      );
    if (aiOptions.gratitude)
      lines.push(
        "Include a brief appreciation note, but make it specific and grounded in the PAX showing up or putting in work. Avoid generic praise."
      );
    if (aiOptions.missionValues)
      lines.push(
        "Work in a short F3 values line focused on fitness, fellowship, or faith, but keep it natural and not preachy."
      );
    if (aiOptions.minimalEmojis || forceNoEmojis || suppressEmojis)
      lines.push("Do not use emojis.");
    if (aiOptions.funny)
      lines.push(
        "Add a light funny line with some personality. Avoid canned dad-joke phrasing and avoid vulgarity."
      );
    if (aiOptions.ironSharpensIron)
      lines.push(
        'Include a short iron-sharpens-iron style line about men pushing each other to get better, without using the exact same stock wording every time.'
      );
    return lines.join("\n");
  };

  const buildNoAiFormattedText = (styleSeed: string) => {
    const items = buildBringItems();
    const useEmojis = shouldUseEmojis(styleSeed, forceNoEmojis, false);

    if (isJP) {
      return formatJurassicParkNoAI({
        qName: qDisplayName,
        workoutDate,
        workoutTime,
        styleSeed,
        useEmojis,
        ao: {
          id: activeAo.id,
          displayName: preblastAoLabel,
          whereName: preblastWhereName,
          address: activeAo.address,
          meetingPoint: activeAo.meetingPoint,
          hashtags: activeAo.hashtags || [],
        },
        extraHashtags: normalizedExtraHashtags,
      });
    }

    return formatStandardNoAI({
      qName: qDisplayName,
      workoutDate,
      workoutTime,
      bringItems: items,
      styleSeed,
      useEmojis,
      ao: {
        id: activeAo.id,
        displayName: preblastAoLabel,
        whereName: preblastWhereName,
        address: activeAo.address,
        meetingPoint: activeAo.meetingPoint,
        hashtags: activeAo.hashtags || [],
      },
      extraHashtags: normalizedExtraHashtags,
    });
  };

  /* ---------------- Generate AI Button ---------------- */
  const handleGenerateAI = async () => {
    if (forceNoAiAo) {
      handleFormatNoAI();
      return;
    }
    if (!qName.trim()) {
      setError("Please select or enter a Q Name.");
      return;
    }

    setError("");
    setInfo("");
    setIsLoading(true);
    setGeneratedPreblastText("");

    // Show progress + timer (and the fallback promise)
    startGeminiTimer();
    setInfo(
      "Contacting Gemini… (Will try for up to 60 seconds, then fall back to the formatted version.)"
    );

    const items = buildBringItems();
    const styleSeed = buildStyleSeed();
    const useEmojis = shouldUseEmojis(
      styleSeed,
      forceNoEmojis,
      aiOptions.minimalEmojis
    );
    const aiOptionsNotes = buildAiOptionsNotes(!useEmojis);

    // AI should write only the hook/CTA. The app formats the full preblast.
    const strictNotes = isJP
      ? [
          "You are writing ONLY the short hook message for an F3 pre-blast (Jurassic Park).",
          "Jurassic Park is a Sunday RUN/RUCK (no beatdown).",
          "Write 2–4 sentences: inviting, energetic, not cheesy.",
          'Include a clear call to action (e.g., "Post up", "Bring a friend", "All fitness levels welcome").',
          "Optional emojis are allowed but keep it minimal (0–2).",
          "Avoid inside jokes, long lore, or excessive emojis.",
          'End the message with exactly: "HC below."',
          aiOptionsNotes ? `OPTIONS:\n${aiOptionsNotes}` : "",
          notes?.trim() ? `Optional Q notes:\n${notes.trim()}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : [aiOptionsNotes ? `OPTIONS:\n${aiOptionsNotes}` : "", notes].filter(Boolean).join("\n");

    try {
      const raw = await generatePreblast(
        activeAo.id,
        qDisplayName,
        strictNotes,
        items,
        workoutDate,
        workoutTime,
        aiOptions.minimalEmojis,
        normalizedExtraHashtags
      );

      const rawText = String(raw || "");
      const cleanedRaw =
        aiOptions.minimalEmojis || forceNoEmojis || !useEmojis
          ? stripEmojis(rawText)
          : rawText;

      if (isJP) {
        const msg = extractInspirationalMessage(cleanedRaw);

        const formatted = formatJurassicParkAI({
          qName: qDisplayName,
          workoutDate,
          workoutTime,
          styleSeed,
          useEmojis,
          ao: {
            id: activeAo.id,
            displayName: preblastAoLabel,
            whereName: preblastWhereName,
            address: activeAo.address,
            meetingPoint: activeAo.meetingPoint,
            hashtags: activeAo.hashtags || [],
          },
          aiMessage: msg,
          extraHashtags: normalizedExtraHashtags,
        });

      const finalText =
        forceNoEmojis || !useEmojis ? stripEmojis(formatted) : formatted;
      setGeneratedPreblastText(finalText);
      markOutput("Generated by AI", "AI");
    } else {
      const msg = extractInspirationalMessage(cleanedRaw);
      const formatted = formatStandardAI({
        qName: qDisplayName,
        workoutDate,
        workoutTime,
        bringItems: items,
        styleSeed,
        useEmojis,
        ao: {
          id: activeAo.id,
          displayName: preblastAoLabel,
          whereName: preblastWhereName,
          address: activeAo.address,
          meetingPoint: activeAo.meetingPoint,
          hashtags: activeAo.hashtags || [],
        },
        aiMessage: msg,
        extraHashtags: normalizedExtraHashtags,
      });
      const finalText =
        forceNoEmojis || !useEmojis ? stripEmojis(formatted) : formatted;
      setGeneratedPreblastText(finalText);
      markOutput("Generated by AI", "AI");
    }

      setError("");
      setInfo("Gemini response received.");
    } catch {
      // Auto-fallback to formatted version (your request)
      const fallback = stripMarkdownImageLines(
        buildNoAiFormattedText(styleSeed)
      );
      setGeneratedPreblastText(fallback);
      markOutput("Generated (No AI)", "NO_AI");

      setError(""); // not an app-breaking error; we successfully fell back
      setInfo("Gemini failed — using the formatted (No AI) version instead.");
    } finally {
      stopGeminiTimer();
      setIsLoading(false);
    }
  };

  /* ---------------- Format No-AI Button ---------------- */
  const handleFormatNoAI = () => {
    if (!qName.trim()) {
      setError("Please select or enter a Q Name.");
      return;
    }

    setError("");
    setInfo("");
    setIsLoading(false);
    stopGeminiTimer();

    const formatted = buildNoAiFormattedText(buildStyleSeed());
    setGeneratedPreblastText(stripMarkdownImageLines(formatted));
    markOutput("Generated (No AI)", "NO_AI");
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

  /* ---------------------- Copy + Start Post Button ---------------------- */
  const handleCopyAndPost = async () => {
    if (!generatedPreblastText) return;

    const bandUrl = activeAo.bandPostUrl || "https://www.band.us";
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    const copied = await copyTextToClipboard(generatedPreblastText);

    if (!copied) {
      setError(
        "Could not copy to clipboard on this device/browser. BAND will open—tap and hold in the post box and choose Paste. If Paste still doesn’t appear, use the preview: long-press → Select All → Copy."
      );
    } else {
      setError("");
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }

    if (isMobile) {
      const link = document.createElement("a");
      link.href = bandUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setInfo("BAND should open in the app while keeping this page available in your browser.");
      return;
    }

    const newWin = window.open(bandUrl, "_blank", "noopener,noreferrer");
    if (newWin) {
      newWin.opener = null;
      return;
    }

    window.location.href = bandUrl;
  };

  /* -------------------------------------------------
     UI
  ------------------------------------------------- */
  return (
    <div className="animate-fade-in pb-24 sm:pb-0">
      {/* PAGE HEADER */}
      <div className="flex items-center gap-2 mb-4">
        <MegaphoneIcon className="h-6 w-6 text-red-500 shrink-0" />
        <h2 className="text-lg sm:text-xl font-display text-white tracking-wide truncate">
          Pre-Blast Generator
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* LEFT PANEL */}
        <div className="bg-slate-800/50 rounded-lg shadow-2xl p-4 sm:p-6 border border-slate-700">
          <div className="space-y-6">
            {/* AO DETAILS */}
            <div className="bg-slate-900/60 border border-slate-700 rounded-md p-3">
              <div className="text-sm flex items-center justify-between gap-2 min-w-0">
                <span className="font-bold text-slate-300 whitespace-nowrap text-xs sm:text-sm">
                  Currently Selected AO:
                </span>
                <div className="min-w-0 flex-1 sm:flex-none">
                  <AoSelector compact />
                </div>
              </div>

              {activeAo.bandUrl && (
                <div className="mt-2">
                  <a
                    href={activeAo.bandUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-blue-300 hover:text-blue-200"
                  >
                    Band
                  </a>
                </div>
              )}
            </div>

            {/* Q */}
            <div>
              <div className="flex items-center gap-2 sm:gap-3">
                <label className="text-sm font-bold text-slate-300 whitespace-nowrap">
                  Q <span className="text-red-400">*</span>
                </label>
                <div className="flex-1 min-w-0">
                  <QNameSelect value={qName} onChange={setQName} paxList={paxList} />
                </div>
              </div>
            </div>

            {/* DATE / TIME */}
            <div className="pt-4 border-t border-slate-700/60">
              <label className="block text-sm font-bold text-slate-300 mb-2">
                Workout Date & Time
              </label>

              <div className="grid grid-cols-[1.6fr_0.7fr_0.7fr] sm:grid-cols-[1.7fr_0.65fr_0.65fr] gap-3">
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
                      value={workoutDate}
                      readOnly
                      className="w-full min-h-[44px] bg-slate-700 border border-slate-600 rounded-md py-2 px-2 text-white text-xs sm:text-sm pointer-events-none"
                    />
                    <input
                      ref={dateInputRef}
                      type="date"
                      value={dateInputValue}
                      onChange={(e) => {
                        const iso = e.target.value;
                        setDateInputValue(iso);
                        if (iso) {
                          setWorkoutDate(
                            formatDateLong(new Date(`${iso}T00:00:00`))
                          );
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
                      className="w-full min-h-[44px] bg-slate-700 border border-slate-600 rounded-md py-2 px-2 text-white text-xs sm:text-sm pointer-events-none"
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
                  <label className="block text-[11px] text-slate-400 mb-1">
                    End Time
                  </label>
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
                      className="w-full min-h-[44px] bg-slate-700 border border-slate-600 rounded-md py-2 px-2 text-white text-xs sm:text-sm pointer-events-none"
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

            {/* HASHTAGS */}
            <div className="pt-4 border-t border-slate-700/60">
              <label className="hidden sm:block text-sm font-bold text-slate-300 mb-2">
                Hashtags
              </label>

              <div className="space-y-3">
                <MobileSectionToggle
                  title="Hashtags"
                  expanded={isMobileHashtagsExpanded}
                  onToggle={() => setIsMobileHashtagsExpanded((prev) => !prev)}
                />

                <div className="flex flex-wrap gap-2 sm:hidden">
                  {mobileVisibleHashtags.map((tag) => (
                    <span
                      key={`mobile-hashtag-${tag}`}
                      className="inline-flex items-center rounded-full border border-slate-600 bg-slate-700/70 px-3 py-1.5 text-xs text-slate-200"
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="hidden sm:block">
                  {activeAo.id !== "jurassicpark" ? (
                    <div className="grid grid-cols-3 gap-2">
                      {combinedHashtags.map(({ tag, isDefault }) => {
                        const checked = isDefault || normalizedExtraHashtags.includes(tag);
                        return (
                          <label
                            key={tag}
                            className={`flex items-center gap-2 bg-slate-700 p-2 rounded-md text-sm ${
                              isDefault ? "" : "hover:bg-slate-600"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={isDefault}
                              onChange={() =>
                                setExtraHashtags((prev) =>
                                  prev.includes(tag)
                                    ? prev.filter((t) => t !== tag)
                                    : [...prev, tag]
                                )
                              }
                              className="h-5 w-5 text-red-600"
                            />
                            {tag}
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <>
                      {defaultHashtags.length > 0 && (
                        <div className="grid grid-cols-2 gap-2">
                          {defaultHashtags.map((tag) => (
                            <label
                              key={`default-${tag}`}
                              className="flex items-center gap-2 bg-slate-700 p-2 rounded-md text-sm"
                            >
                              <input
                                type="checkbox"
                                checked
                                disabled
                                className="h-5 w-5 text-red-600"
                              />
                              {tag}
                            </label>
                          ))}
                        </div>
                      )}

                      {optionalHashtags.length > 0 && (
                        <div className="grid grid-cols-2 gap-2 mt-3">
                          {optionalHashtags.map((tag) => {
                            const checked = normalizedExtraHashtags.includes(tag);
                            return (
                              <label
                                key={tag}
                                className="flex items-center gap-2 bg-slate-700 p-2 rounded-md text-sm hover:bg-slate-600"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() =>
                                    setExtraHashtags((prev) =>
                                      prev.includes(tag)
                                        ? prev.filter((t) => t !== tag)
                                        : [...prev, tag]
                                    )
                                  }
                                  className="h-5 w-5 text-red-600"
                                />
                                {tag}
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div
                  className={
                    isMobileHashtagsExpanded
                      ? "sm:hidden space-y-3 rounded-md border border-slate-700 bg-slate-900/40 p-3"
                      : "hidden sm:hidden"
                  }
                >
                  {mobileOptionalHashtags.length > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      {mobileOptionalHashtags.map((tag) => {
                        const checked = normalizedExtraHashtags.includes(tag);
                        return (
                          <label
                            key={`mobile-${tag}`}
                            className={`flex items-center gap-2 rounded-md border p-2 text-xs ${
                              checked
                                ? "border-red-500/50 bg-red-500/10 text-white"
                                : "border-slate-600 bg-slate-700 hover:bg-slate-600"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setExtraHashtags((prev) =>
                                  prev.includes(tag)
                                    ? prev.filter((t) => t !== tag)
                                    : [...prev, tag]
                                )
                              }
                              className="h-5 w-5 text-red-600"
                            />
                            {tag}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className={isMobileHashtagsExpanded ? "" : "hidden sm:block"}>
                  <label className="block text-xs text-slate-400 mb-1">
                    Custom hashtags (space or comma separated)
                  </label>
                  <input
                    type="text"
                    value={customHashtags}
                    onChange={(e) => setCustomHashtags(e.target.value)}
                    placeholder="#1%better #ironsharpensiron #ruck"
                    className="w-full min-h-[44px] bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-white text-xs sm:text-sm"
                  />
                </div>

                {normalizedExtraHashtags.length > 0 && (
                  <div className="hidden sm:flex flex-wrap gap-2 text-xs text-slate-300">
                    {normalizedExtraHashtags.map((tag) => (
                      <span
                        key={`selected-${tag}`}
                        className="inline-flex items-center rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-slate-100"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ITEMS TO BRING (hidden for Jurassic Park) */}
            {!isJP && (
              <div className="pt-4 border-t border-slate-700/60">
                <h3 className="hidden sm:block text-sm font-bold text-slate-300 mb-2">
                  What to Bring
                </h3>
                <MobileSectionToggle
                  title="What to Bring"
                  subtitle={
                    mobileSelectedBringCount > 0
                      ? `${mobileSelectedBringCount} items selected`
                      : undefined
                  }
                  expanded={isMobileBringExpanded}
                  onToggle={() => setIsMobileBringExpanded((prev) => !prev)}
                />

                <div className="flex flex-wrap gap-2 sm:hidden">
                  {mobileVisibleBringItems.map((item) => (
                    <span
                      key={`mobile-bring-${item}`}
                      className="inline-flex items-center rounded-full border border-slate-600 bg-slate-700/70 px-3 py-1.5 text-xs text-slate-200"
                    >
                      {item}
                    </span>
                  ))}
                </div>

                <div
                  className={`${
                    isMobileBringExpanded ? "grid" : "hidden"
                  } grid-cols-2 gap-2 sm:grid sm:grid-cols-4 mt-3 sm:mt-0`}
                >
                  {commonItems.map((item) => (
                    <label
                      key={item}
                      className={`flex items-center gap-2 rounded-md border p-2 text-xs sm:text-sm ${
                        toBring.includes(item)
                          ? "border-blue-500/50 bg-blue-500/10 text-white"
                          : "border-slate-600 bg-slate-700 hover:bg-slate-600"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={toBring.includes(item)}
                        onChange={() =>
                          setToBring((prev) =>
                            prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]
                          )
                        }
                        className="h-5 w-5 text-red-600"
                      />
                      {item}
                    </label>
                  ))}
                </div>

                <div className={isMobileBringExpanded ? "mt-2 sm:mt-2" : "hidden sm:block"}>
                  <input
                    type="text"
                    value={customToBring}
                    onChange={(e) => setCustomToBring(e.target.value)}
                    placeholder="Other items..."
                    className="w-full min-h-[44px] bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-white text-xs sm:text-sm"
                  />
                </div>
              </div>
            )}

            {/* GENERATE MODE */}
            <div className="pt-4 border-t border-slate-700/60 space-y-3">
              {!forceNoAiAo && (
                <>
                  <div className="text-sm font-bold text-slate-300">
                    Have AI Write Call to Action?{" "}
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
                  {generateMode === "AI" && (
                    <div className="h-px bg-slate-700/70" />
                  )}
                  {generateMode === "AI" && (
                    <>
                      <MobileSectionToggle
                        title="Customize AI"
                        subtitle={
                          mobileSelectedAiCount > 0
                            ? `${mobileSelectedAiCount} options selected`
                            : "Tone and style controls"
                        }
                        expanded={isMobileAiExpanded}
                        onToggle={() => setIsMobileAiExpanded((prev) => !prev)}
                      />
                      <div
                        className={`space-y-2 ${
                          isMobileAiExpanded ? "block" : "hidden"
                        } sm:block`}
                      >
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
                            className={`flex items-center gap-2 rounded-md border px-2 py-2 text-xs sm:text-sm cursor-pointer ${
                              (aiOptions as any)[key]
                                ? "border-red-500/50 bg-red-500/10 text-white"
                                : "border-slate-600 bg-slate-700/60 text-slate-200"
                            }`}
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
                              className="h-4 w-4 rounded bg-slate-800 border-slate-600 text-blue-500 focus:ring-blue-500"
                            />
                            {label}
                          </label>
                        ))}
                        </div>
                      </div>
                    </>
                  )}
                  {/* NOTES (AI only) */}
                  {generateMode === "AI" && (
                    <div className={isMobileAiExpanded ? "block" : "hidden sm:block"}>
                      <label className="block text-sm font-bold text-slate-300 mb-2">
                        Notes for AI
                      </label>
                      <textarea
                        rows={3}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Theme, VQ, BQ, etc."
                        className="w-full min-h-[44px] bg-slate-700 border border-slate-600 rounded-md py-2 px-3 text-white text-sm"
                      />
                    </div>
                  )}
                </>
              )}
              <button
                onClick={() => (generateMode === "AI" ? handleGenerateAI() : handleFormatNoAI())}
                disabled={
                  !generateMode || (generateMode === "AI" && isLoading) || !qName.trim()
                }
                className={`w-full text-white font-bold py-3 px-4 rounded-md transition-colors disabled:bg-slate-600 ${
                  generateMode === "AI"
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-blue-600 hover:bg-blue-700"
                }`}
              >
                {generateMode === "AI" && isLoading ? "Generating…" : "Generate Pre-Blast"}
              </button>
              {!forceNoAiAo && generateMode === "AI" && !isLoading && (
                <div className="text-xs text-slate-400 mt-2">
                  Gemini will try for up to 60 seconds before falling back to the formatted
                  version.
                </div>
              )}
            </div>

            {/* Gemini progress line (Issue #1) */}
            {isLoading && (
              <div className="text-xs text-slate-300">
                Contacting Gemini… <span className="font-semibold">{geminiSeconds}s</span>{" "}
                <span className="text-slate-400">/ 60s max</span>
                <span className="text-slate-400">(If it fails, it will fall back to the formatted version.)</span>
              </div>
            )}

            {/* Info / Error */}
            {!!info && !isLoading && <p className="text-slate-300 text-sm">{info}</p>}
            {error && <p className="text-red-400 text-sm">{error}</p>}
          </div>
        </div>

        {/* RIGHT PANEL */}
        <div
          ref={outputRef}
          className="bg-slate-800/50 rounded-lg shadow-2xl p-4 sm:p-6 border border-slate-700 flex flex-col"
        >
          <div className="mb-4">
            <div className="flex items-center gap-2">
              <h3 className="text-xl sm:text-3xl font-display text-white">Generated Pre-Blast</h3>
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

          <div className="bg-slate-900 p-4 rounded-md flex-grow min-h-[240px] sm:min-h-[300px] text-slate-200 text-sm leading-relaxed overflow-y-auto">
            {generatedPreblastText ? (
              renderPreblastPreview(generatedPreblastText)
            ) : (
              <div className="text-sm text-slate-500">
                Generate a pre-blast to preview the final post here.
              </div>
            )}
          </div>

          {generatedPreblastText && (
            <button
              onClick={handleCopyAndPost}
              className="mt-4 hidden sm:flex w-full bg-green-600 text-white font-bold py-2 rounded-md hover:bg-green-700 items-center justify-center gap-2"
            >
              <ExternalLinkIcon />
              {copySuccess ? "Copied! Opening BAND..." : "Copy & Start Post in BAND"}
            </button>
          )}

          <div ref={outputBottomRef} className="h-px sm:hidden" />
        </div>
      </div>

      {generatedPreblastText && (
        <div className="sm:hidden fixed left-1/2 bottom-28 z-10 w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 rounded-2xl border border-slate-700 bg-slate-950/95 px-3 py-3 shadow-[0_16px_40px_rgba(0,0,0,0.45)] backdrop-blur">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() =>
                generateMode === "AI" ? handleGenerateAI() : handleFormatNoAI()
              }
              className="min-h-[48px] rounded-md border border-slate-600 bg-slate-800 px-3 text-sm font-semibold text-slate-100"
            >
              Regenerate
            </button>
            <button
              type="button"
              onClick={handleCopyAndPost}
              className="min-h-[48px] rounded-md bg-green-600 px-3 text-sm font-semibold text-white"
            >
              {copySuccess ? "Copied! Opening BAND..." : "Copy & Start Post in BAND"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

