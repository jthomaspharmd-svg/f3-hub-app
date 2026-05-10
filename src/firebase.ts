// ------------------------------
// Firebase v9 Modular SDK
// ------------------------------
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { FIRESTORE_DATABASE_ID } from "./shared/firestoreConfig";

// ✅ App Check imports
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
  getToken,
} from "firebase/app-check";

const env = (import.meta as ImportMeta & {
  env: Record<string, string | undefined>;
}).env;

// ------------------------------
// Firebase config from .env
// (Vite requires VITE_ prefixes)
// ------------------------------
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

// ------------------------------
// Initialize Firebase
// ------------------------------
const app = initializeApp(firebaseConfig);

// ------------------------------
// App Check (Web)
// ------------------------------

// Enable App Check debug mode ONLY in local dev
// This prevents enforcement from breaking localhost later
if (env.DEV) {
  const explicitDebugToken = env.VITE_FIREBASE_APPCHECK_DEBUG_TOKEN as
    | string
    | undefined;

  if (explicitDebugToken) {
    (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = explicitDebugToken;
  } else if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    // Firebase will print a debug token in the browser console
    (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  } else {
    console.warn(
      "[AppCheck] Missing VITE_FIREBASE_APPCHECK_DEBUG_TOKEN and crypto.randomUUID() is unavailable."
    );
  }
}

const siteKey = env.VITE_RECAPTCHA_V3_SITE_KEY as string | undefined;

if (siteKey) {
  // Initialize App Check (runs once)
  const appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(siteKey),
    isTokenAutoRefreshEnabled: true,
  });

  // Warm up App Check ASAP so early Firestore calls are verified under enforcement
  getToken(appCheck, true).catch(() => {
    // Intentionally swallow errors; App Check metrics will reveal issues.
  });
} else {
  console.warn(
    "[AppCheck] Missing VITE_RECAPTCHA_V3_SITE_KEY; App Check not initialized."
  );
}

// ------------------------------
// Initialize Firestore
// ------------------------------
export const db =
  FIRESTORE_DATABASE_ID === "(default)"
    ? getFirestore(app)
    : getFirestore(app, FIRESTORE_DATABASE_ID);

if (env.DEV) {
  (
    window as Window & {
      __firebaseDebug?: Record<string, unknown>;
    }
  ).__firebaseDebug = {
    projectId: firebaseConfig.projectId || "",
    firestoreDatabaseId: FIRESTORE_DATABASE_ID,
    firestoreEmulatorHost: env.VITE_FIRESTORE_EMULATOR_HOST || null,
  };
}

// ❌ NO MORE seedInitialData()
// Firestore is now populated externally
