/**
 * Run with:
 *   node importWorkoutSessions.cjs
 */

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

// --- Load your Firebase Admin SDK key ---
const serviceAccount = require("./serviceAccountKey.json");

// --- Initialize Firebase Admin ---
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// --- Load the JSON file ---
const sessionsPath = path.join(__dirname, "src", "data", "workoutSessions.json");
const sessions = JSON.parse(fs.readFileSync(sessionsPath, "utf8"));

/**
 * Given a session with date like "11/22/2025 (Sat)" and time "0530",
 * return:
 *   - date with 2-digit year: "11/22/25 (Sat)"
 *   - time:
 *       Tue / Thu -> "0530"
 *       Sat       -> "0630"
 *       others    -> keep original or "0530"
 */
function computeDateAndTime(session) {
  const originalDateStr = session.date;
  const originalTime = session.time || "0530";

  if (!originalDateStr) {
    return {
      newDate: originalDateStr,
      fixedTime: originalTime,
    };
  }

  // Split "11/22/2025 (Sat)" -> ["11/22/2025", "(Sat)"]
  const parts = originalDateStr.split(" ");
  const datePart = parts[0]; // "11/22/2025"
  const suffix =
    parts.length > 1 ? " " + parts.slice(1).join(" ") : ""; // " (Sat)" if present

  const [m, d, y] = datePart.split("/");
  if (!m || !d || !y) {
    return {
      newDate: originalDateStr,
      fixedTime: originalTime,
    };
  }

  const yearFull = y.length === 2 ? Number("20" + y) : Number(y);
  const monthIndex = Number(m) - 1;
  const dayNum = Number(d);

  const dateForDow = new Date(yearFull, monthIndex, dayNum);

  let fixedTime = originalTime;

  if (!isNaN(dateForDow.getTime())) {
    const dow = dateForDow.getDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat

    if (dow === 2 || dow === 4) {
      // Tue / Thu
      fixedTime = "0530";
    } else if (dow === 6) {
      // Sat
      fixedTime = "0630";
    }
  }

  const shortYear = String(yearFull).slice(-2); // "25", "26", etc.
  const newDate = `${m}/${d}/${shortYear}${suffix}`; // e.g. "11/22/25 (Sat)"

  return { newDate, fixedTime };
}

/**
 * Convert "11/22/25 (Sat)" or "11/22/2025" -> "20251122"
 */
function computeDateKey(dateStr) {
  if (!dateStr) return undefined;
  const cleaned = String(dateStr).split(" ")[0];
  const [m, d, y] = cleaned.split("/");
  if (!m || !d || !y) return undefined;
  const year = y.length === 2 ? `20${y}` : y;
  return `${year}${m.padStart(2, "0")}${d.padStart(2, "0")}`;
}

async function importSessions() {
  console.log(`⏳ Importing ${sessions.length} workout sessions...`);
  console.log("Using JSON file:", sessionsPath);

  const batch = db.batch();
  const collectionRef = db.collection("workoutSessions");

  sessions.forEach((session) => {
    const { newDate, fixedTime } = computeDateAndTime(session);
    const dateKey = computeDateKey(newDate);

    // Mutate in-memory object so we can also rewrite the JSON file
    session.date = newDate;
    session.time = fixedTime;
    if (dateKey) session.dateKey = dateKey;

    const docRef = collectionRef.doc(session.id);
    batch.set(
      docRef,
      {
        date: newDate,
        time: fixedTime,
        ...(dateKey ? { dateKey } : {}),
      },
      { merge: true }
    );
  });

  await batch.commit();
  console.log("✅ Firestore import complete.");

  // Also update the JSON file on disk so it matches the new format
  fs.writeFileSync(sessionsPath, JSON.stringify(sessions, null, 2), "utf8");
  console.log("📝 Updated workoutSessions.json with 2-digit years and new times.");
}

importSessions().catch((err) => {
  console.error("❌ Import failed:", err);
});
