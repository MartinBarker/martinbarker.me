'use client';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const apiBaseURL = () =>
  process.env.NODE_ENV === 'development'
    ? 'http://localhost:3030'
    : 'https://www.martinbarker.me/internal-api';

let initPromise = null;

async function fetchFirebaseConfig() {
  const res = await fetch(`${apiBaseURL()}/firebase/config`, { credentials: 'include' });
  if (!res.ok) {
    throw new Error(`Failed to fetch Firebase config: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export function initFirebase() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const config = await fetchFirebaseConfig();
    const app = getApps().length ? getApp() : initializeApp(config);
    return {
      app,
      auth: getAuth(app),
      db: getFirestore(app),
      googleProvider: new GoogleAuthProvider(),
    };
  })();
  return initPromise;
}

export const getFirebaseAuth = () => initFirebase().then((f) => f.auth);
export const getFirebaseDb = () => initFirebase().then((f) => f.db);
export const getGoogleProvider = () => initFirebase().then((f) => f.googleProvider);
