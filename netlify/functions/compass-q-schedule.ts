import fs from "fs/promises";
import path from "path";
import { JWT } from "google-auth-library";
import { initializeApp, getApps, type FirebaseOptions } from "firebase/app";
import { collection, getDocs, getFirestore } from "firebase/firestore/lite";
import {
  type CompassQScheduleDiagnostics,
  getCompassScheduleTodayIsoDate,
  mapWorkoutSessionsToCompassScheduleWithDiagnostics,
  parseFromDate,
  parseLookaheadDays,
} from "../../src/shared/compassQSchedule";

type NetlifyEvent = {
  headers?: Record<string, string | undefined> | null;
  queryStringParameters?: Record<string, string | undefined> | null;
};

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

type Diagnostics = {
  mode: "local" | "production";
  firestoreProjectId: string;
  firestoreDatabaseId: string;
  collectionPath: "workoutSessions";
  firebaseConfigPresent: Record<string, boolean>;
  serviceAccountPresent: boolean;
  serviceAccountProjectId: string | null;
  reader: "service-account-rest" | "firebase-web-sdk";
  firestoreEmulatorEnv: {
    FIRESTORE_EMULATOR_HOST: string | null;
    VITE_FIRESTORE_EMULATOR_HOST: string | null;
  };
  restDocumentPath: string;
  restPageCount: number;
  restDocsPerPage: number[];
  fetchedDocIdsSample: string[];
  doc74Found: boolean;
  rawDoc74?: Record<string, unknown> | null;
  flattenedDoc74?: Record<string, unknown> | null;
  docCount?: number;
} & Partial<CompassQScheduleDiagnostics>;

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

const COLLECTION_PATH = "workoutSessions";
const DEFAULT_LOCAL_SERVICE_ACCOUNT_PATH = "serviceAccountKey.json";
const FIRESTORE_DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || "(default)";

const FIREBASE_CONFIG: FirebaseOptions = {
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
};

const getFirebaseApp = () => {
  const existing = getApps()[0];
  if (existing) return existing;
  return initializeApp(FIREBASE_CONFIG);
};

const isLocalDevRequest = (event: NetlifyEvent) => {
  const host = event.headers?.host || "";
  return (
    process.env.NETLIFY_DEV === "true" ||
    host.includes("localhost") ||
    host.includes("127.0.0.1")
  );
};

const isProductionRequest = (event: NetlifyEvent) => !isLocalDevRequest(event);

const firebaseConfigPresent = () => ({
  apiKey: Boolean(FIREBASE_CONFIG.apiKey),
  authDomain: Boolean(FIREBASE_CONFIG.authDomain),
  projectId: Boolean(FIREBASE_CONFIG.projectId),
  storageBucket: Boolean(FIREBASE_CONFIG.storageBucket),
  messagingSenderId: Boolean(FIREBASE_CONFIG.messagingSenderId),
  appId: Boolean(FIREBASE_CONFIG.appId),
});

const missingFirebaseConfig = () =>
  Object.entries(FIREBASE_CONFIG)
    .filter(([, value]) => !value)
    .map(([key]) => key);

const buildDiagnostics = (
  event: NetlifyEvent,
  overrides?: Partial<Diagnostics>
): Diagnostics => ({
  mode: isLocalDevRequest(event) ? "local" : "production",
  firestoreProjectId: FIREBASE_CONFIG.projectId || "",
  firestoreDatabaseId: FIRESTORE_DATABASE_ID,
  collectionPath: COLLECTION_PATH,
  firebaseConfigPresent: firebaseConfigPresent(),
  serviceAccountPresent: false,
  serviceAccountProjectId: null,
  reader: "firebase-web-sdk",
  firestoreEmulatorEnv: {
    FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || null,
    VITE_FIRESTORE_EMULATOR_HOST: process.env.VITE_FIRESTORE_EMULATOR_HOST || null,
  },
  restDocumentPath: `/v1/projects/${FIREBASE_CONFIG.projectId || ""}/databases/${FIRESTORE_DATABASE_ID}/documents/${COLLECTION_PATH}`,
  restPageCount: 0,
  restDocsPerPage: [],
  fetchedDocIdsSample: [],
  doc74Found: false,
  ...overrides,
});

const withDiagnostics = (
  event: NetlifyEvent,
  body: Record<string, unknown>,
  diagnostics: Diagnostics
) => {
  if (!isLocalDevRequest(event)) return body;
  return { ...body, diagnostics };
};

const readServiceAccount = async (): Promise<ServiceAccount | null> => {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON) as ServiceAccount;
  }

  if (process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON) as ServiceAccount;
  }

  const configuredPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH || DEFAULT_LOCAL_SERVICE_ACCOUNT_PATH;
  const fullPath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.join(process.cwd(), configuredPath);

  try {
    const raw = await fs.readFile(fullPath, "utf8");
    return JSON.parse(raw) as ServiceAccount;
  } catch {
    return null;
  }
};

const getServiceAccountAccessToken = async (serviceAccount: ServiceAccount) => {
  const client = new JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key,
    scopes: ["https://www.googleapis.com/auth/datastore"],
  });
  const { access_token } = await client.authorize();
  if (!access_token) {
    throw new Error("Failed to obtain Firestore access token from service account.");
  }
  return access_token;
};

type FirestoreValue =
  | {
      stringValue?: string;
      integerValue?: string;
      doubleValue?: number;
      booleanValue?: boolean;
      nullValue?: null;
      timestampValue?: string;
      mapValue?: { fields?: Record<string, FirestoreValue> };
      arrayValue?: { values?: FirestoreValue[] };
    }
  | undefined;

const decodeFirestoreValue = (value: FirestoreValue): unknown => {
  if (!value) return "";
  if ("stringValue" in value && value.stringValue !== undefined) return value.stringValue;
  if ("integerValue" in value && value.integerValue !== undefined) return value.integerValue;
  if ("doubleValue" in value && value.doubleValue !== undefined) return value.doubleValue;
  if ("booleanValue" in value && value.booleanValue !== undefined) return value.booleanValue;
  if ("timestampValue" in value && value.timestampValue !== undefined) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("mapValue" in value && value.mapValue !== undefined) {
    const fields = value.mapValue.fields || {};
    return Object.fromEntries(
      Object.entries(fields).map(([key, nestedValue]) => [key, decodeFirestoreValue(nestedValue)])
    );
  }
  if ("arrayValue" in value && value.arrayValue !== undefined) {
    return (value.arrayValue.values || []).map((entry) => decodeFirestoreValue(entry));
  }
  return "";
};

const listWorkoutSessionsWithServiceAccount = async (
  serviceAccount: ServiceAccount
) => {
  const projectId = FIREBASE_CONFIG.projectId || serviceAccount.project_id;
  const token = await getServiceAccountAccessToken(serviceAccount);
  const allDocuments: Array<{
    name?: string;
    fields?: Record<string, FirestoreValue>;
  }> = [];
  const restDocsPerPage: number[] = [];
  let nextPageToken: string | undefined;
  let restPageCount = 0;

  do {
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${FIRESTORE_DATABASE_ID}/documents/${COLLECTION_PATH}`
    );
    url.searchParams.set("pageSize", "1000");
    if (nextPageToken) {
      url.searchParams.set("pageToken", nextPageToken);
    }

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Firestore REST error: ${res.status} ${text}`);
    }

    const json = (await res.json()) as {
      documents?: Array<{
        name?: string;
        fields?: Record<
          string,
          {
            stringValue?: string;
            integerValue?: string;
            doubleValue?: number;
            booleanValue?: boolean;
            nullValue?: null;
            timestampValue?: string;
            mapValue?: { fields?: Record<string, FirestoreValue> };
            arrayValue?: { values?: FirestoreValue[] };
          }
        >;
      }>;
      nextPageToken?: string;
    };

    const documents = json.documents || [];
    allDocuments.push(...documents);
    restDocsPerPage.push(documents.length);
    restPageCount += 1;
    nextPageToken = json.nextPageToken;
  } while (nextPageToken);

  const documents = allDocuments;
  const rawDoc74 =
    documents.find((doc) => doc.name?.split("/").pop() === "74") || null;

  const sessions = documents.map((doc) => {
    const fields = doc.fields || {};
    const idFromPath = doc.name?.split("/").pop() || "";
    const flattenedFields = Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)])
    );
    return {
      ...flattenedFields,
      id: (decodeFirestoreValue(fields.id) as string) || idFromPath,
    };
  });
  const flattenedDoc74 =
    (sessions.find((session) => String(session.id) === "74") as Record<string, unknown> | undefined) ||
    null;
  const fetchedDocIdsSample = sessions
    .slice(0, 20)
    .map((session) => String(session.id))
    .concat(
      sessions
        .filter((session) => ["74", "75", "76", "77", "78", "86"].includes(String(session.id)))
        .map((session) => String(session.id))
    )
    .filter((value, index, array) => array.indexOf(value) === index);

  return {
    sessions,
    projectId,
    docCount: sessions.length,
    restPageCount,
    restDocsPerPage,
    fetchedDocIdsSample,
    doc74Found: Boolean(rawDoc74),
    rawDoc74,
    flattenedDoc74,
  };
};

const listWorkoutSessionsWithWebSdk = async () => {
  const db =
    FIRESTORE_DATABASE_ID === "(default)"
      ? getFirestore(getFirebaseApp())
      : getFirestore(getFirebaseApp(), FIRESTORE_DATABASE_ID);
  const snapshot = await getDocs(collection(db, COLLECTION_PATH));
  const sessions = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Record<string, unknown>),
  }));

  return {
    sessions,
    projectId: FIREBASE_CONFIG.projectId || "",
    docCount: snapshot.size,
    restPageCount: 0,
    restDocsPerPage: [],
    fetchedDocIdsSample: sessions.slice(0, 20).map((session) => String(session.id)),
    doc74Found: sessions.some((session) => String(session.id) === "74"),
    rawDoc74: null,
    flattenedDoc74:
      (sessions.find((session) => String(session.id) === "74") as Record<string, unknown> | undefined) ||
      null,
  };
};

export const handler = async (event: NetlifyEvent) => {
  const requiredKey = process.env.Q_SCHEDULE_API_KEY;
  const providedKey = event.queryStringParameters?.key;

  if (requiredKey && providedKey !== requiredKey) {
    return {
      statusCode: 401,
      headers: JSON_HEADERS,
      body: JSON.stringify(
        withDiagnostics(
          event,
          {
            ok: false,
            error: "Unauthorized",
          },
          buildDiagnostics(event)
        )
      ),
    };
  }

  const lookaheadDays = parseLookaheadDays(
    event.queryStringParameters?.lookaheadDays
  );
  const requestedFromDate = event.queryStringParameters?.fromDate;
  const fromDateIso =
    requestedFromDate === undefined
      ? getCompassScheduleTodayIsoDate()
      : parseFromDate(requestedFromDate);

  if (!lookaheadDays) {
    return {
      statusCode: 400,
      headers: JSON_HEADERS,
      body: JSON.stringify(
        withDiagnostics(
          event,
          {
            ok: false,
            error: "Invalid lookaheadDays",
          },
          buildDiagnostics(event)
        )
      ),
    };
  }

  if (requestedFromDate !== undefined && !fromDateIso) {
    return {
      statusCode: 400,
      headers: JSON_HEADERS,
      body: JSON.stringify(
        withDiagnostics(
          event,
          {
            ok: false,
            error: "Invalid fromDate",
          },
          buildDiagnostics(event)
        )
      ),
    };
  }

  const missingConfig = missingFirebaseConfig();
  if (missingConfig.length > 0) {
    return {
      statusCode: 500,
      headers: JSON_HEADERS,
      body: JSON.stringify(
        withDiagnostics(
          event,
          {
            ok: false,
            error: "Missing Firebase configuration",
            missing: missingConfig,
          },
          buildDiagnostics(event)
        )
      ),
    };
  }

  const serviceAccount = await readServiceAccount();
  const baseDiagnostics = buildDiagnostics(event, {
    serviceAccountPresent: Boolean(serviceAccount),
    serviceAccountProjectId: serviceAccount?.project_id || null,
    reader: serviceAccount ? "service-account-rest" : "firebase-web-sdk",
  });

  if (!serviceAccount && isProductionRequest(event)) {
    return {
      statusCode: 500,
      headers: JSON_HEADERS,
      body: JSON.stringify(
        withDiagnostics(
          event,
          {
            ok: false,
            error: "Missing Firebase service account configuration",
            message:
              "Production requires FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON for Firestore server access.",
          },
          baseDiagnostics
        )
      ),
    };
  }

  try {
    const result = serviceAccount
      ? await listWorkoutSessionsWithServiceAccount(serviceAccount)
      : await listWorkoutSessionsWithWebSdk();

    const mapped = mapWorkoutSessionsToCompassScheduleWithDiagnostics(result.sessions, {
      lookaheadDays,
      fromDateIso,
    });
    const { schedule, diagnostics: parserDiagnostics } = mapped;

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify(
        withDiagnostics(
          event,
          {
            ok: true,
            aoId: "compass",
            aoName: "Compass at Lost Creek",
            lookaheadDays,
            schedule,
          },
          {
            ...baseDiagnostics,
            firestoreProjectId: result.projectId,
            docCount: result.docCount,
            restPageCount: result.restPageCount,
            restDocsPerPage: result.restDocsPerPage,
            fetchedDocIdsSample: result.fetchedDocIdsSample,
            doc74Found: result.doc74Found,
            rawDoc74: result.rawDoc74,
            flattenedDoc74: result.flattenedDoc74,
            ...parserDiagnostics,
          }
        )
      ),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: JSON_HEADERS,
      body: JSON.stringify(
        withDiagnostics(
          event,
          {
            ok: false,
            error: "Failed to load Compass Q schedule",
            message: error instanceof Error ? error.message : String(error),
          },
          baseDiagnostics
        )
      ),
    };
  }
};
