export const FIRESTORE_DATABASE_ID =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
    ?.VITE_FIRESTORE_DATABASE_ID || "(default)";

export const FIRESTORE_COLLECTION_PATH = "workoutSessions";

