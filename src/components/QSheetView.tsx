import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import type { WorkoutSession } from "../types";
import { db } from "../firebase";
import { collection, doc, onSnapshot, setDoc } from "firebase/firestore";
import {
  CalendarIcon,
  UserIcon,
  SparklesIcon,
  FireIcon,
  ExternalLinkIcon,
} from "./icons";
import { PAX_LIST, getPaxListByAo } from "../constants";
import { usePaxDirectoryVersion } from "../pax/PaxDirectoryContext";
import { useAo } from "../ao/AoContext";

/* ----------------------------------------------------
   AO helpers: normalize context value + canonical key
---------------------------------------------------- */
const normalizeAoName = (raw: any): string => {
  if (!raw) return "";

  if (typeof raw === "object") {
    const name =
      raw.name ||
      raw.label ||
      raw.title ||
      raw.ao ||
      raw.currentAo ||
      raw.selectedAo ||
      raw.id;
    if (typeof name === "string") return name.trim();
  }

  if (typeof raw === "string") return raw.trim();
  return "";
};

const canonicalAoKey = (nameOrId: string): string => {
  const n = (nameOrId || "").toLowerCase();

  // Accept either ids or names
  if (n === "compass" || n.includes("compass")) return "Compass";
  if (n === "colosseum" || n.includes("colosseum")) return "Colosseum";
  if (n === "thehill" || n.includes("the hill")) return "The Hill";
  if (n === "theshadows" || n.includes("the shadows")) return "The Shadows";
  if (n === "gatorbay" || n.includes("gator bay")) return "Gator Bay";
  if (n === "phoenixrising" || n.includes("phoenix rising"))
    return "Phoenix Rising";
  if (
    n === "jurassicpark" ||
    n.includes("jurassic") ||
    n.includes("jurassic park")
  )
    return "Jurassic Park";

  // fallback: return trimmed string so getPaxListByAo can still try
  return (nameOrId || "").trim();
};

/* ----------------------------------------------------
   Map helpers: coordinate link builder
---------------------------------------------------- */
const googleMapsCoordLink = (lat: number, lng: number) =>
  `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

/* ----------------------------------------------------
   PAX SELECT CELL (now takes paxList)
---------------------------------------------------- */
const PaxSelectCellComponent: React.FC<{
  value?: string;
  onSave: (v: string) => void;
  paxList: string[];
}> = ({ value = "", onSave, paxList }) => {
  const [isCustomEditing, setIsCustomEditing] = useState(false);
  const [text, setText] = useState(value);

  const isEmpty = value === "";
  const isCustomValue = value && !paxList.includes(value);

  const saveCustom = () => {
    const trimmed = text.trim();
    onSave(trimmed);
    setIsCustomEditing(false);
  };

  // keep input aligned if value changes externally
  useEffect(() => {
    if (!isCustomEditing) setText(value);
  }, [value, isCustomEditing]);

  if (isCustomEditing) {
    return (
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={saveCustom}
        onKeyDown={(e) => e.key === "Enter" && saveCustom()}
        className="w-full bg-slate-700 border border-slate-600 rounded-md px-2 py-1 text-white text-xs"
        autoFocus
      />
    );
  }

  const base =
    "w-full rounded-md px-2 py-1 text-white text-xs cursor-pointer border transition";
  const style = isEmpty
    ? "bg-slate-700 border-slate-600"
    : "bg-blue-500/40 border-blue-400 shadow-[0_0_8px_rgba(59,130,246,0.45)]";

  return (
    <select
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "custom") {
          setText(value);
          setIsCustomEditing(true);
        } else {
          onSave(v);
        }
      }}
      className={`${base} ${style}`}
    >
      <option value="">*Open*</option>
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
const PaxSelectCell = React.memo(PaxSelectCellComponent);
PaxSelectCell.displayName = "PaxSelectCell";

/* ----------------------------------------------------
   NOTES CELL
---------------------------------------------------- */
const EditableCellComponent: React.FC<{
  value?: string;
  onSave: (v: string) => void;
}> = ({ value = "", onSave }) => {
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(value);

  useEffect(() => setText(value), [value]);

  const save = () => {
    onSave(text);
    setEdit(false);
  };

  if (edit) {
    return (
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && save()}
        className="w-full bg-slate-600 border border-slate-500 rounded-md px-2 py-1 text-white text-xs"
        autoFocus
      />
    );
  }

  return (
    <div
      className="cursor-pointer hover:bg-slate-700/50 rounded px-1 text-xs"
      onClick={() => setEdit(true)}
    >
      {value || <span className="text-slate-500">Open</span>}
    </div>
  );
};
const EditableCell = React.memo(EditableCellComponent);
EditableCell.displayName = "EditableCell";

/* ----------------------------------------------------
   DATE PARSER
---------------------------------------------------- */
const normalizeDate = (dateStr: string) => {
  const cleaned = dateStr.split(" ")[0];
  const [m, d, y] = cleaned.split("/");
  if (!m || !d || !y) return new Date("2100-01-01");
  const year = y.length === 2 ? Number("20" + y) : Number(y);
  return new Date(year, Number(m) - 1, Number(d));
};

/* ----------------------------------------------------
   DATE KEY (YYYYMMDD) for efficient Firestore queries
---------------------------------------------------- */
const dateStringToKey = (dateStr: string) => {
  const cleaned = dateStr.split(" ")[0];
  const [m, d, y] = cleaned.split("/");
  if (!m || !d || !y) return "99999999";
  const year = y.length === 2 ? `20${y}` : y;
  return `${year}${m.padStart(2, "0")}${d.padStart(2, "0")}`;
};

/* ----------------------------------------------------
   GOOGLE-SHEET (NON-FIRESTORE) Q SHEET CARD
---------------------------------------------------- */
const GoogleSheetQSheet: React.FC<{
  title: string;
  whereName: string;
  address: string;
  sheetUrl: string;
  addressLinkUrl?: string;
}> = ({ title, whereName, address, sheetUrl, addressLinkUrl }) => {
  const buildPreviewUrl = (url: string) => {
    const match = url.match(/https:\/\/docs\.google\.com\/spreadsheets\/d\/([^/]+)/);
    if (!match) return url;
    const base = `https://docs.google.com/spreadsheets/d/${match[1]}`;
    const gidMatch = url.match(/[#?]gid=([0-9]+)/);
    const gid = gidMatch ? gidMatch[1] : "";
    if (!gid) return `${base}/edit`;
    return `${base}/edit?gid=${gid}&single=true&widget=true&headers=false`;
  };

  const previewUrl = buildPreviewUrl(sheetUrl);

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="bg-slate-800/50 border border-slate-700 p-4 rounded-lg text-center mb-6">
        <h3 className="text-xl text-red-500 font-display tracking-wide">
          AO: {title}
        </h3>
        <p className="text-slate-300">{whereName}</p>

        {addressLinkUrl ? (
          <a
            href={addressLinkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-400 text-sm mt-1 whitespace-pre-line underline decoration-dotted hover:decoration-solid hover:text-red-300 inline-block"
          >
            {address}
          </a>
        ) : (
          <p className="text-slate-400 text-sm mt-1 whitespace-pre-line">
            {address}
          </p>
        )}
      </div>

      {/* Body */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-6">
        <div className="flex items-center gap-2 mb-3">
          <CalendarIcon className="text-red-500 h-6 w-6" />
          <h2 className="text-2xl sm:text-3xl font-display tracking-wide">
            Q-Sheet
          </h2>
        </div>

        <p className="text-slate-300 mb-4">
          This AO uses the Google Sheet for Q sign-ups.
        </p>

        <a
          href={sheetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 w-full sm:w-auto bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-5 rounded-md mb-4"
        >
          <ExternalLinkIcon />
          Open Q-Sheet (Google Sheet)
        </a>

        <div className="w-full border border-slate-700 rounded-md overflow-hidden mb-4">
          <iframe
            title={`${title} Q-Sheet Preview`}
            src={previewUrl}
            className="w-full h-[520px] bg-white"
            loading="lazy"
          />
        </div>

        <p className="text-slate-500 text-xs mt-3 break-all">{sheetUrl}</p>
      </div>
    </div>
  );
};

/* ----------------------------------------------------
   MAIN COMPONENT
---------------------------------------------------- */
export const QSheetView: React.FC = () => {
  const aoCtx = useAo() as any;

  // Hooks MUST come before conditional returns
  const DEFAULT_FUTURE_MONTHS = 1;
  const [pastMonths, setPastMonths] = useState(0);
  const [futureMonths, setFutureMonths] = useState(DEFAULT_FUTURE_MONTHS);
  const [workoutSessions, setWorkoutSessions] = useState<WorkoutSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadMoreAnchorRef = useRef<HTMLDivElement | null>(null);
  const [pendingScrollToLoadMore, setPendingScrollToLoadMore] = useState(false);

  // Robust AO extraction
  const activeAo = aoCtx?.activeAo;
  const activeAoId = normalizeAoName(activeAo?.id);
  const activeAoName = normalizeAoName(activeAo?.name) || normalizeAoName(activeAo);

  const aoKey = canonicalAoKey(activeAoId || activeAoName);

  const isCompass = aoKey === "Compass";
  const isColosseum = aoKey === "Colosseum";
  const isJurassicPark = aoKey === "Jurassic Park";

  // AO-specific coordinate links
  const COMPASS_COORDS = { lat: 29.594717923278505, lng: -95.58967308684299 };
  const COLOSSEUM_COORDS = { lat: 29.62695548953722, lng: -95.63029043988304 };
  const JURASSIC_COORDS = { lat: 29.591870310392448, lng: -95.64927266698801 };

  const compassLink = googleMapsCoordLink(COMPASS_COORDS.lat, COMPASS_COORDS.lng);
  const colosseumLink = googleMapsCoordLink(
    COLOSSEUM_COORDS.lat,
    COLOSSEUM_COORDS.lng
  );
  const jurassicLink = googleMapsCoordLink(
    JURASSIC_COORDS.lat,
    JURASSIC_COORDS.lng
  );

  // Dynamic pax list based on AO; fallback to global list
  const paxDirectoryVersion = usePaxDirectoryVersion();
  const paxListForAo = useMemo(() => {
    const aoId = normalizeAoName(activeAo?.id);
    if (!aoId) return PAX_LIST;

    const list = (getPaxListByAo as any)?.(aoId);
    return Array.isArray(list) && list.length ? list : PAX_LIST;
  }, [activeAo?.id, paxDirectoryVersion]);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // Firestore: read all workoutSessions (client-side filtering)
  useEffect(() => {
    setIsLoading(true);
    const ref = collection(db, "workoutSessions");

    const unsub = onSnapshot(
      ref,
      (snapshot) => {
        const sessions = snapshot.docs.map((d) => d.data() as WorkoutSession);
        sessions.sort((a, b) =>
          dateStringToKey(a.date).localeCompare(dateStringToKey(b.date))
        );
        setWorkoutSessions(sessions);
        setIsLoading(false);
      },
      (err) => {
        console.error("Firestore error:", err);
        setIsLoading(false);
      }
    );

    return () => unsub();
  }, []);

  // Update one field inside a workoutSession document
  const updateField = useCallback(
    async (sessionId: string, field: keyof WorkoutSession, value: string) => {
      try {
        const ref = doc(db, "workoutSessions", sessionId);
        await setDoc(ref, { [field]: value }, { merge: true });
      } catch (err) {
        console.error("Error updating Firestore:", err);
      }
    },
    []
  );

  const displayed = useMemo(() => {
    const futureCut = new Date(today);
    futureCut.setMonth(today.getMonth() + futureMonths);

    const pastCut = new Date(today);
    pastCut.setMonth(today.getMonth() - pastMonths);

    return workoutSessions.filter((s) => {
      const d = normalizeDate(s.date);
      if (isNaN(d.getTime())) return false;
      if (pastMonths === 0 && d < today) return false;
      if (d < pastCut) return false;
      if (d > futureCut) return false;
      return true;
    });
  }, [workoutSessions, pastMonths, futureMonths, today]);

  // Keep view anchored near the "Load more" buttons after expanding range
  useEffect(() => {
    if (!pendingScrollToLoadMore) return;
    const anchor = loadMoreAnchorRef.current;
    if (!anchor) {
      setPendingScrollToLoadMore(false);
      return;
    }
    requestAnimationFrame(() => {
      anchor.scrollIntoView({ block: "end" });
      setPendingScrollToLoadMore(false);
    });
  }, [pendingScrollToLoadMore, displayed.length]);

  const noteIcon = (note: string = "") => {
    const n = note.toLowerCase();
    if (n.includes("vq")) return <FireIcon className="text-red-500" />;
    if (n.includes("bq")) return <SparklesIcon className="text-yellow-400" />;
    if (n.includes("gq")) return <UserIcon className="text-sky-400" />;
    return null;
  };

  const QSheetRow = React.memo(
    ({
      session,
      paxList,
      onUpdate,
    }: {
      session: WorkoutSession;
      paxList: string[];
      onUpdate: (id: string, field: keyof WorkoutSession, v: string) => void;
    }) => (
      <tr className="border-t border-slate-700">
        <td className="p-2 text-xs whitespace-nowrap">
          {session.date} {session.time}
        </td>

        <td className="p-2">
          <PaxSelectCell
            value={session.q}
            onSave={(v) => onUpdate(session.id, "q", v)}
            paxList={paxList}
          />
        </td>

        <td className="p-2">
          <div className="flex items-center gap-1">
            {noteIcon(session.notes)}
            <EditableCell
              value={session.notes}
              onSave={(v) => onUpdate(session.id, "notes", v)}
            />
          </div>
        </td>

      </tr>
    )
  );
  QSheetRow.displayName = "QSheetRow";

  // Now it is safe to return conditionally (hooks already ran)
  if (isColosseum) {
    return (
      <GoogleSheetQSheet
        title="Colosseum"
        whereName="Old Kempner Stadium"
        address={"223 5th St, Sugar Land, TX 77498"}
        addressLinkUrl={colosseumLink}
        sheetUrl="https://docs.google.com/spreadsheets/d/1C_AamtdoHPaodpH-pDUx92n4DYgJUKLQhII0MoZDxIM/edit?gid=0#gid=0"
      />
    );
  }

  if (isJurassicPark) {
    return (
      <GoogleSheetQSheet
        title="Jurassic Park"
        whereName="Houston Museum of Natural Science"
        address={
          "13016 University Blvd, Sugar Land, TX 77479\nMeeting point is the far south end of the parking lot."
        }
        addressLinkUrl={jurassicLink}
        sheetUrl="https://docs.google.com/spreadsheets/d/1C_AamtdoHPaodpH-pDUx92n4DYgJUKLQhII0MoZDxIM/edit?gid=1205329126#gid=1205329126"
      />
    );
  }

  if (isLoading) {
    return (
      <div className="h-96 flex flex-col items-center justify-center">
        <div className="animate-spin border-t-4 border-b-4 border-red-600 rounded-full w-16 h-16" />
        <p className="mt-4 text-slate-300">Loading schedule…</p>
      </div>
    );
  }

  // Header content: default Compass text, but don’t hardcode if AO changes
  const headerTitle = isCompass ? "Compass at Lost Creek" : aoKey || "Q-Sheet";
  const headerSub = isCompass ? "Lost Creek Park — Sugar Land, TX" : " ";

  return (
    <div>
      {/* HEADER */}
      <div className="bg-slate-800/50 border border-slate-700 p-4 rounded-lg text-center mb-6">
        <h3 className="text-xl text-red-500 font-display tracking-wide">
          AO: {headerTitle}
        </h3>

        {isCompass ? (
          <a
            href={compassLink}
            target="_blank"
            rel="noopener noreferrer"
            className="text-slate-300 underline decoration-dotted hover:decoration-solid hover:text-red-300"
          >
            {headerSub}
          </a>
        ) : (
          <p className="text-slate-300">{headerSub}</p>
        )}

        {isCompass && <p className="text-slate-400 text-sm mt-1">AOQ: Alcatraz</p>}
      </div>

      {/* CONTROLS */}
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          <CalendarIcon className="text-red-500 h-6 w-6" />
          <h2 className="text-2xl sm:text-3xl font-display tracking-wide">
            Q-Sheet
          </h2>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setPastMonths((p) => (p === 0 ? 1 : p + 1))}
            className="bg-blue-600 px-3 py-2 rounded text-xs"
          >
            Show Previous Month
          </button>

          {pastMonths > 0 && (
            <button
              onClick={() => setPastMonths(0)}
              className="bg-slate-600 px-3 py-2 rounded text-xs"
            >
              Hide Past
            </button>
          )}
        </div>
      </div>

      {/* TABLE */}
      <div className="overflow-x-auto border border-slate-700 rounded-lg bg-slate-800/50">
        <table className="w-full text-left">
          <thead className="bg-slate-900/60">
            <tr>
              <th className="p-2 text-slate-400 text-xs whitespace-nowrap">
                Date
              </th>
              <th className="p-2 text-slate-400 text-xs min-w-[135px] sm:min-w-[225px]">
                Q
              </th>
              <th className="p-2 text-slate-400 text-xs sm:min-w-[225px] w-full">
                Notes
              </th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((s) => (
              <QSheetRow
                key={s.id}
                session={s}
                paxList={paxListForAo}
                onUpdate={updateField}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* LOAD MORE */}
      <div
        className="flex justify-center gap-4 mt-6 flex-wrap"
        ref={loadMoreAnchorRef}
      >
        <button
          onClick={() => {
            setFutureMonths((f) => f + 1);
            setPendingScrollToLoadMore(true);
          }}
          className="bg-slate-700 px-4 py-2 rounded"
        >
          Load Next Month
        </button>

        <button
          onClick={() => {
            setFutureMonths((f) => f + 3);
            setPendingScrollToLoadMore(true);
          }}
          className="bg-red-600 px-4 py-2 rounded"
        >
          Load 3 More Months
        </button>

        {futureMonths > DEFAULT_FUTURE_MONTHS && (
          <button
            onClick={() => setFutureMonths(DEFAULT_FUTURE_MONTHS)}
            className="bg-slate-600 px-4 py-2 rounded"
          >
            Reset Future
          </button>
        )}
      </div>
    </div>
  );
};
