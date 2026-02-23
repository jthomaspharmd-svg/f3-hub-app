// generateSessions.js
// Produces full workoutSessions JSON from today until 12/31/2028
// T/Th/Sat schedule @ 0530

function generateWorkoutSessions() {
  const sessions = [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const end = new Date("2028-12-31");
  const validDays = [2, 4, 6]; // Tue (2), Thu (4), Sat (6)

  let idCounter = 1;

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (!validDays.includes(d.getDay())) continue;

    const dateString = d.toLocaleDateString("en-US", {
      month: "numeric",
      day: "numeric",
      year: "numeric",
    });

    const weekday = d.toLocaleDateString("en-US", { weekday: "short" });

    sessions.push({
      id: String(idCounter++),
      date: `${dateString} (${weekday})`,
      time: "0530",
      q: "",
      notes: "",
      dbj: "",
      food: ""
    });
  }

  return sessions;
}

console.log(JSON.stringify(generateWorkoutSessions(), null, 2));
