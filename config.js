// =============================================================
//  CONFIG — fill these in. This is the only file you edit.
// =============================================================

// --- 1. The two people -------------------------------------------------
export const PEOPLE = {
  A: { name: "Helo",   swish: "0739709200" },  // <- Helo's Swish number
  B: { name: "Halvis", swish: "0736137972" },  // <- Halvis's Swish number
};

// --- 2. Password lock --------------------------------------------------
// Simple client-side gate (NOT real security — anyone who reads the source
// can see the hash, and Firestore rules are what actually protect the data).
// To change the password, run this in a browser console and paste the result:
//   crypto.subtle.digest('SHA-256', new TextEncoder().encode('yourpass'))
//     .then(b => console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')))
// Current password is: helohalvis
export const PASSWORD_SHA256 =
  "d5e19ee3755dfdccea0d5808b1b2a7de96cf592c8000b8ae361dc43470ec2708";

// --- 3. Firebase -------------------------------------------------------
// Create a free project at https://console.firebase.google.com
//   → add a Web app → copy the config object here.
//   → enable Firestore Database (production mode).
// See README.md for the security rules to paste.
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBDdEDfGulZQ7dedv9TxFIfC9FCoHY0zaY",
  authDomain: "hh-bankboken.firebaseapp.com",
  projectId: "hh-bankboken",
  storageBucket: "hh-bankboken.firebasestorage.app",
  messagingSenderId: "866961585089",
  appId: "1:866961585089:web:1bbea0b32c0d7863d0f540",
};
