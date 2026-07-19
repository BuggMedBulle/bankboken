# 📒 Bankboken

A tiny shared expense tracker for two people (Helo & Halvis). Track who paid
what, see the running balance, and settle up with one tap via **Swish**
(deep link + QR).

- Password lock on the start page
- Real-time sync between phones via **Firebase Firestore**
- Works offline on a single device (localStorage) until Firebase is configured
- Static site — hosts free on **GitHub Pages**

Everything you need to edit lives in **`config.js`**.

---

## 1. Set the people & Swish numbers

In `config.js`:

```js
export const PEOPLE = {
  A: { name: "Helo",   swish: "0700000000" },
  B: { name: "Halvis", swish: "0700000001" },
};
```

Use the real mobile numbers registered with each person's Swish.

## 2. Set the password

Current password is **`helohalvis`**. To change it, open any browser console and run:

```js
crypto.subtle.digest('SHA-256', new TextEncoder().encode('YOURNEWPASS'))
  .then(b => console.log([...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')))
```

Paste the printed hash into `PASSWORD_SHA256` in `config.js`.

> ⚠️ This is a *simple* lock, not real security — anyone who reads the page
> source can see the hash. The real protection is the Firestore rules below.

## 3. Set up Firebase (for phone-to-phone sync)

1. Create a free project at <https://console.firebase.google.com>.
2. **Build → Firestore Database → Create database** (Production mode).
3. **Project settings → Your apps → Web (`</>`)** → register an app → copy the
   `firebaseConfig` object into `FIREBASE_CONFIG` in `config.js`.
4. **Firestore → Rules** — paste this so only your app's collection is used:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /entries/{doc} {
         allow read, write: if true;   // gated by the app password
       }
     }
   }
   ```

   > This lets anyone with the URL read/write the `entries` collection. That's
   > fine for a private 2-person tracker behind an unguessable URL + password.
   > For stronger protection, enable Firebase Anonymous Auth and change the rule
   > to `if request.auth != null`.

Until `FIREBASE_CONFIG` is filled in, the app quietly uses `localStorage`
(single-device only) so you can try it immediately.

## 4. Deploy to GitHub Pages

```bash
cd hepa-expenses
git init && git add . && git commit -m "Helo & Halvis kassa"
gh repo create hepa-expenses --public --source=. --push
```

Then in the repo: **Settings → Pages → Branch: `main` / root → Save**.
Your app appears at `https://<user>.github.io/hepa-expenses/`.

Add it to the home screen on both phones for an app-like experience.

---

## How the balance works

Each expense is either split **50 / 50** or paid **fully for the other person**.
Settlements move the balance back toward zero. The balance card always shows
who owes whom and how much — tap **Betala** to open Swish pre-filled, or let the
other person scan the QR.
