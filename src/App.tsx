import React, {
  useState,
  useEffect,
  useCallback,
  lazy,
  Suspense,
} from "react";

const QSheetView = lazy(() =>
  import("./components/QSheetView").then((m) => ({ default: m.QSheetView }))
);
const PreblastGeneratorView = lazy(() =>
  import("./components/PreblastGeneratorView").then((m) => ({
    default: m.PreblastGeneratorView,
  }))
);
const WorkoutPlannerView = lazy(() =>
  import("./components/WorkoutPlannerView").then((m) => ({
    default: m.WorkoutPlannerView,
  }))
);
const BackblastGeneratorView = lazy(() =>
  import("./components/BackblastGeneratorView").then((m) => ({
    default: m.BackblastGeneratorView,
  }))
);

import {
  F3LogoIcon,
  CalendarIcon,
  MegaphoneIcon,
  ClipboardListIcon,
  DocumentTextIcon,
} from "./components/icons";

import type { WorkoutSession, PlannerData } from "./types";
import { getPaxDirectory } from "./services/paxDirectory";
import { setPaxDirectory } from "./constants";
import { useBumpPaxDirectoryVersion } from "./pax/PaxDirectoryContext";

// ✅ AO (new)
import { useAo } from "./ao/AoContext";
import { AoSelector } from "./ao/AoSelector";

type View = "Q_SHEET" | "PRE_BLAST" | "WORKOUT_PLANNER" | "BACK_BLAST";

const defaultLogged: WorkoutSession[] = [];

const ACTIVE_VIEW_KEY = "f3ActiveView"; // session-scoped

const App: React.FC = () => {
  // ✅ AO context
  const { activeAo } = useAo();

  // ✅ Restore last view after mobile refresh/app-switch
  const [activeView, setActiveView] = useState<View>(() => {
    const saved = sessionStorage.getItem(ACTIVE_VIEW_KEY) as View | null;
    return saved ?? "Q_SHEET";
  });

  // ✅ Persist view whenever it changes
  useEffect(() => {
    sessionStorage.setItem(ACTIVE_VIEW_KEY, activeView);
  }, [activeView]);

  // ✅ If AO disables Planner, ensure we aren’t stuck on it
  useEffect(() => {
    if (activeView === "WORKOUT_PLANNER" && !activeAo.modules.planner) {
      setActiveView("Q_SHEET");
    }
  }, [activeAo.modules.planner, activeView]);

  // ✅ If AO disables Q-Sheet, ensure we aren’t stuck on it
  useEffect(() => {
    if (activeView === "Q_SHEET" && !activeAo.modules.qSheet) {
      setActiveView("PRE_BLAST");
    }
  }, [activeAo.modules.qSheet, activeView]);

  const [loggedWorkouts, setLoggedWorkouts] = useState<WorkoutSession[]>(() => {
    const saved = localStorage.getItem("f3LoggedWorkouts");
    return saved ? JSON.parse(saved) : defaultLogged;
  });

  const [planToImport, setPlanToImport] = useState<PlannerData | null>(null);
  const [isPaxRefreshing, setIsPaxRefreshing] = useState(false);
  const bumpPaxDirectoryVersion = useBumpPaxDirectoryVersion();

  //
  // Logged Workouts
  //
  const addLoggedWorkout = useCallback((session: WorkoutSession) => {
    setLoggedWorkouts((prev) => [...prev, session]);
  }, []);

  useEffect(() => {
    localStorage.setItem("f3LoggedWorkouts", JSON.stringify(loggedWorkouts));
  }, [loggedWorkouts]);

  useEffect(() => {
    getPaxDirectory()
      .then((data) => {
        if (data) {
          setPaxDirectory(data);
          bumpPaxDirectoryVersion();
        }
      })
      .catch((err) => {
        console.warn("PAX directory load failed:", err);
      });
  }, []);

  const refreshPaxDirectory = async () => {
    try {
      setIsPaxRefreshing(true);
      const data = await getPaxDirectory({ force: true });
      if (data) {
        setPaxDirectory(data);
        bumpPaxDirectoryVersion();
      }
    } catch (err) {
      console.warn("PAX directory refresh failed:", err);
    } finally {
      setIsPaxRefreshing(false);
    }
  };

  //
  // Planner → Backblast
  //
  const handleImportPlan = (plan: PlannerData) => {
    setPlanToImport(plan);
    setActiveView("BACK_BLAST");
  };

  const clearImportedPlan = () => setPlanToImport(null);

  //
  // Render active view
  //
  const renderView = () => {
    switch (activeView) {
      case "Q_SHEET":
        // Guard: if a user somehow navigates here, show a message (optional)
        if (!activeAo.modules.qSheet) {
          return (
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
              <h2 className="text-lg font-semibold mb-2">
                Q-Sheet not used for {activeAo.shortName}
              </h2>
              <p className="text-slate-300">
                {activeAo.displayName} does not use the Q-Sheet module.
              </p>
            </div>
          );
        }
        return <QSheetView />;

      case "PRE_BLAST":
        return <PreblastGeneratorView />;

      case "WORKOUT_PLANNER":
        // Guard: if a user somehow navigates here, show a message (optional)
        if (!activeAo.modules.planner) {
          return (
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
              <h2 className="text-lg font-semibold mb-2">
                Planner not used for {activeAo.shortName}
              </h2>
              <p className="text-slate-300">
                {activeAo.displayName} is a once-weekly run/ruck AO, so the
                Workout Planner module is disabled here.
              </p>
            </div>
          );
        }
        return <WorkoutPlannerView onImportPlan={handleImportPlan} />;

      case "BACK_BLAST":
        return (
          <BackblastGeneratorView
            addLoggedWorkout={addLoggedWorkout}
            planToImport={planToImport}
            clearImportedPlan={clearImportedPlan}
          />
        );

      default:
        return null;
    }
  };

  //
  // Nav button
  //
  const NavItem: React.FC<{
    view: View;
    label: string;
    icon: React.ReactNode;
  }> = ({ view, label, icon }) => (
    <button
      onClick={() => setActiveView(view)}
      className={`flex items-center gap-1 px-2 py-2 rounded-md 
          ${
            activeView === view
              ? "bg-red-600 text-white"
              : "text-slate-300 hover:bg-slate-700"
          }`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );

  // -------------------------------------------------
  // Header line 2: per your examples
  // -------------------------------------------------
  const headerLine2 = (() => {
  switch (activeAo.id) {
    case "compass":
      return "Compass";
    case "colosseum":
      return "Colosseum";
    case "jurassicpark":
      return "Jurassic Park";
    default:
      return activeAo.displayName;
  }
})();

  const ViewFallback = (
    <div className="h-80 flex items-center justify-center text-slate-300">
      Loading…
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <header className="bg-slate-800 shadow-lg sticky top-0 z-10">
        {/* tighter vertical padding */}
        <div className="max-w-6xl mx-auto px-3 py-2">
          {/* ROW 1: logo + title (left) | nav + ao selector (right) */}
          <div className="flex justify-between items-center gap-3">
            <div className="flex items-center min-w-0">
  <div className="min-w-0">
    <h1 className="text-xl sm:text-3xl font-display leading-tight truncate">
      F3 Hub
    </h1>

    <div className="text-xs sm:text-sm text-slate-400 truncate">
      {headerLine2}
    </div>
  </div>
</div>


            <div className="flex items-center gap-3 flex-shrink-0">
              <nav className="flex items-center gap-2">
                {activeAo.modules.qSheet && (
                  <NavItem view="Q_SHEET" label="Q-Sheet" icon={<CalendarIcon />} />
                )}
                <NavItem
                  view="PRE_BLAST"
                  label="Pre-Blast"
                  icon={<MegaphoneIcon />}
                />

                {/* ✅ Planner hidden for AOs that don’t use it (JP) */}
                {activeAo.modules.planner && (
                  <NavItem
                    view="WORKOUT_PLANNER"
                    label="Planner"
                    icon={<ClipboardListIcon />}
                  />
                )}

                <NavItem
                  view="BACK_BLAST"
                  label="Backblast"
                  icon={<DocumentTextIcon />}
                />
              </nav>

              {/* ✅ AO selector in header (dropdown shows Jurassic Park (JP) per your AoSelector update) */}
              <AoSelector />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4">
        <Suspense fallback={ViewFallback}>{renderView()}</Suspense>
      </main>

      <footer className="py-6 text-center text-slate-500">
        <div>Forged in the gloom. Built for the PAX.</div>
        <button
          onClick={refreshPaxDirectory}
          className="mt-2 text-xs text-slate-400 hover:text-slate-100"
          title="Refresh PAX list from Google Sheet"
          disabled={isPaxRefreshing}
        >
          {isPaxRefreshing ? "Refreshing PAX…" : "Refresh PAX"}
        </button>
      </footer>
    </div>
  );
};

export default App;
