// ------------------------------
// Firebase v9 Modular SDK
// ------------------------------
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// ✅ App Check imports
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
  getToken,
} from "firebase/app-check";

// ------------------------------
// Firebase config from .env
// (Vite requires VITE_ prefixes)
// ------------------------------
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
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
if (import.meta.env.DEV) {
  // Firebase will print a debug token in the browser console
  (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}

const siteKey = import.meta.env.VITE_RECAPTCHA_V3_SITE_KEY as string | undefined;

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
export const db = getFirestore(app);

// ❌ NO MORE seedInitialData()
// Firestore is now populated externally
