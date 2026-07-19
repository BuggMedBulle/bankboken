import { PEOPLE, PASSWORD_SHA256, FIREBASE_CONFIG } from "./config.js";

// ============================================================
//  STORAGE LAYER
//  Firebase (real-time sync) when config.js is filled in,
//  otherwise localStorage so the app works on a single device.
// ============================================================
const firebaseReady = !String(FIREBASE_CONFIG.apiKey).includes("PASTE_ME");
let store; // { subscribe(cb), add(entry), remove(id) }

async function initStore() {
  if (firebaseReady) {
    const appMod = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
    const fs = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    const app = appMod.initializeApp(FIREBASE_CONFIG);
    const db = fs.getFirestore(app);
    const col = fs.collection(db, "entries");
    store = {
      subscribe(cb) {
        const q = fs.query(col, fs.orderBy("ts", "desc"));
        return fs.onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
          (err) => { console.error(err); setSync(false); });
      },
      async add(entry) { await fs.addDoc(col, entry); },
      async remove(id) { await fs.deleteDoc(fs.doc(db, "entries", id)); },
    };
    setSync(true, "Synkad (Firebase)");
  } else {
    const KEY = "hepa-entries";
    const read = () => JSON.parse(localStorage.getItem(KEY) || "[]");
    const write = (arr) => localStorage.setItem(KEY, JSON.stringify(arr));
    let listeners = [];
    const emit = () => listeners.forEach((cb) => cb([...read()].sort((a, b) => b.ts - a.ts)));
    store = {
      subscribe(cb) { listeners.push(cb); emit(); return () => { listeners = listeners.filter((l) => l !== cb); }; },
      async add(entry) { const a = read(); a.push({ id: crypto.randomUUID(), ...entry }); write(a); emit(); },
      async remove(id) { write(read().filter((e) => e.id !== id)); emit(); },
    };
    setSync(true, "Lokalt läge (ingen synk)");
  }
}

function setSync(ok, title) {
  const dot = document.getElementById("sync-dot");
  dot.style.color = ok ? "#93a986" : "#c56b6b";
  if (title) dot.title = title;
}

// ============================================================
//  BALANCE MODEL
//  Each expense stores `split` = whose cost it is:
//    'a' = 100% Helo, 'even' = 50/50, 'b' = 100% Halvis.
//  The payer fronts the other person's share, so the other owes it.
//  balance > 0  →  B (Halvis) owes A (Helo).
// ============================================================
function sharesOf(e) {
  if (e.split === "a") return { a: e.amount, b: 0 };        // Helo bears all
  if (e.split === "b") return { a: 0, b: e.amount };        // Halvis bears all
  return { a: e.amount / 2, b: e.amount / 2 };              // 50/50
}

function balanceOf(entries) {
  let bal = 0;
  for (const e of entries) {
    if (e.type === "settlement") {
      bal += (e.payer === "A" ? 1 : -1) * e.amount;
    } else {
      const s = sharesOf(e);
      bal += e.payer === "A" ? s.b : -s.a; // other person's share the payer covered
    }
  }
  return Math.round(bal * 100) / 100;
}

const kr = (n) =>
  new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: 2 }).format(n);
const kr0 = (n) =>
  new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: 0 }).format(n);

// ============================================================
//  RENDER
// ============================================================
let ENTRIES = [];
let CURRENT_USER = localStorage.getItem("bankboken-person");
let APP_INITIALIZED = false;

function subjectName(personKey) {
  return personKey === CURRENT_USER ? "Du" : PEOPLE[personKey].name;
}

function objectName(personKey) {
  return personKey === CURRENT_USER ? "dig" : PEOPLE[personKey].name;
}

function render() { renderBalance(); renderHistory(); }

function renderBalance() {
  const bal = balanceOf(ENTRIES);
  const heading = document.getElementById("balance-heading");
  const sub = document.getElementById("balance-sub");
  const btn = document.getElementById("settle-btn");
  const panel = document.getElementById("settle-panel");

  panel.hidden = true;
  btn.hidden = true;

  if (Math.abs(bal) < 0.01) {
    heading.textContent = kr(0);
    sub.textContent = "Allt är jämnt. Ingen är skyldig något.";
    return;
  }

  const debtorKey = bal > 0 ? "B" : "A";
  const creditorKey = bal > 0 ? "A" : "B";
  const debtor = PEOPLE[debtorKey];
  const creditor = PEOPLE[creditorKey];
  const owed = Math.abs(bal);

  heading.textContent = kr(owed);
  sub.innerHTML = `<strong>${escapeHtml(subjectName(debtorKey))}</strong> är skyldig ${escapeHtml(objectName(creditorKey))}`;
  if (CURRENT_USER !== debtorKey) return;

  btn.hidden = false;
  btn.dataset.payee = creditor.swish;
  btn.dataset.amount = owed.toFixed(2);
  btn.dataset.msg = `Reglering ${debtor.name} till ${creditor.name}`;
}

function renderHistory() {
  const list = document.getElementById("history-list");
  const empty = document.getElementById("history-empty");
  const totals = document.getElementById("totals");
  list.innerHTML = "";

  const hasEntries = ENTRIES.length > 0;
  empty.hidden = hasEntries;
  totals.hidden = !hasEntries;

  if (hasEntries) {
    const sum = (who) =>
      ENTRIES.filter((e) => e.type !== "settlement" && e.payer === who).reduce((s, e) => s + e.amount, 0);
    const a = sum("A"), b = sum("B");
    totals.innerHTML = `
      <span>${subjectName("A")}<b>${kr0(a)}</b></span>
      <span>${subjectName("B")}<b>${kr0(b)}</b></span>
      <span>Totalt<b>${kr0(a + b)}</b></span>`;
  }

  for (const e of ENTRIES) {
    const li = document.createElement("li");
    const who = PEOPLE[e.payer] ? subjectName(e.payer) : e.payer;
    const date = new Date(e.ts).toLocaleDateString("sv-SE", { day: "numeric", month: "short" });

    if (e.type === "settlement") {
      const recipientKey = e.payer === "A" ? "B" : "A";
      const to = objectName(recipientKey);
      li.className = "h-settle";
      li.innerHTML = `
        <div class="h-ico">💸</div>
        <div class="h-main">
          <div class="h-title">Reglering</div>
          <div class="h-sub">${who} betalade ${to} · ${date}</div>
        </div>
        <div class="h-amt">${kr(e.amount)}</div>`;
    } else {
      const split =
        e.split === "a" ? `100% ${subjectName("A")}` :
        e.split === "b" ? `100% ${subjectName("B")}` : "50/50";
      li.innerHTML = `
        <div class="h-ico">${e.icon || "🧾"}</div>
        <div class="h-main">
          <div class="h-title">${escapeHtml(e.desc)}</div>
          <div class="h-sub">${who} betalade · ${split} · ${date}</div>
        </div>
        <div class="h-amt">${kr(e.amount)}</div>`;
    }
    const del = document.createElement("button");
    del.className = "h-del";
    del.textContent = "✕";
    del.title = "Ta bort";
    del.onclick = () => { if (confirm("Ta bort denna post?")) store.remove(e.id); };
    li.appendChild(del);
    list.appendChild(li);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ============================================================
//  SWISH
// ============================================================
const buildSwishLink = (payee, amount, msg) =>
  `https://app.swish.nu/1/p/sw/?${new URLSearchParams({ sw: payee, amt: amount, cur: "SEK", msg })}`;

function onSettleClick() {
  const btn = document.getElementById("settle-btn");
  if (btn.hidden) return;
  const { payee, amount, msg } = btn.dataset;
  const link = buildSwishLink(payee, amount, msg);

  document.getElementById("settle-panel").hidden = false;
  window.open(link, "_blank", "noopener,noreferrer");
}

async function confirmSettlement() {
  const bal = balanceOf(ENTRIES);
  if (Math.abs(bal) < 0.01) return;
  const payer = bal > 0 ? "B" : "A";
  if (CURRENT_USER !== payer) return;
  await store.add({
    type: "settlement", payer, amount: Math.abs(bal), ts: Date.now(),
  });
  document.getElementById("settle-panel").hidden = true;
  document.getElementById("saldo-card").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ============================================================
//  FORM
// ============================================================
function initSegments(id, onChange, key = "val") {
  const seg = document.getElementById(id);
  seg.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    seg.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    onChange?.(btn.dataset[key]);
  });
  return () => seg.querySelector(".active").dataset[key];
}
function setActive(segId, val, key = "val") {
  document.querySelectorAll(`#${segId} button`).forEach((b) =>
    b.classList.toggle("active", b.dataset[key] === val));
}

let getPayer, getSplit;

// ---- category icon popup ----
const ICON_DEFAULT = "🧾"; // receipt is the default category
let selectedIcon = ICON_DEFAULT;

function getIcon() { return selectedIcon; }

function setIcon(icon) {
  selectedIcon = icon;
  document.getElementById("icon-trigger").textContent = icon;
  document.querySelectorAll("#icon-pop button").forEach((b) =>
    b.classList.toggle("active", b.dataset.icon === icon));
}

function closeIconPop() {
  document.getElementById("icon-pop").hidden = true;
  document.getElementById("icon-trigger").setAttribute("aria-expanded", "false");
}

function initIconPicker() {
  const trigger = document.getElementById("icon-trigger");
  const pop = document.getElementById("icon-pop");
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = pop.hidden;
    pop.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
  });
  pop.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    setIcon(b.dataset.icon);
    closeIconPop();
  });
  document.addEventListener("click", (e) => {
    if (!pop.hidden && !pop.contains(e.target) && e.target !== trigger) closeIconPop();
  });
  setIcon(ICON_DEFAULT); // receipt by default
}

function payerKey() { return getPayer() === PEOPLE.A.name ? "A" : "B"; }
function currentPersonName() { return PEOPLE[CURRENT_USER]?.name || PEOPLE.A.name; }

function updatePersonLabels() {
  document.querySelector('#e-payer [data-val="Helo"]').textContent = subjectName("A");
  document.querySelector('#e-payer [data-val="Halvis"]').textContent = subjectName("B");
  document.querySelector('#e-split [data-val="a"]').textContent = `100% ${subjectName("A")}`;
  document.querySelector('#e-split [data-val="b"]').textContent = `100% ${subjectName("B")}`;
}

function todayInputValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function expenseTimestamp(dateValue) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const now = new Date();
  return new Date(
    year, month - 1, day,
    now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds(),
  ).getTime();
}

function updatePreview() {
  const amount = parseFloat(document.getElementById("e-amount").value) || 0;
  const split = getSplit(); // 'a' | 'even' | 'b'
  const payer = payerKey();
  const other = payer === "A" ? "B" : "A";
  const el = document.getElementById("split-preview");

  if (amount <= 0) { el.hidden = true; return; }
  const shares = sharesOf({ amount, split });
  const owes = payerKey() === "A" ? shares.b : shares.a; // what the non-payer owes
  el.hidden = false;
  el.textContent = owes <= 0
    ? `Ingen skuld – ${subjectName(payer)} står för hela beloppet.`
    : `${subjectName(other)} blir skyldig ${objectName(payer)} ${kr(owes)}.`;
}

function initApp() {
  getPayer = initSegments("e-payer", updatePreview);
  getSplit = initSegments("e-split", updatePreview);
  initIconPicker();

  const dateInput = document.getElementById("e-date");
  dateInput.value = todayInputValue();

  document.getElementById("e-amount").addEventListener("input", updatePreview);

  // Config-driven labels
  const pA = document.querySelector('#e-payer [data-val="Helo"]');
  const pB = document.querySelector('#e-payer [data-val="Halvis"]');
  pA.dataset.val = PEOPLE.A.name;
  pB.dataset.val = PEOPLE.B.name;
  updatePersonLabels();
  setActive("e-payer", currentPersonName());

  document.getElementById("expense-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const desc = document.getElementById("e-desc").value.trim();
    const amount = parseFloat(document.getElementById("e-amount").value);
    const date = dateInput.value;
    if (!desc || !(amount > 0) || !date) return;
    await store.add({
      type: "expense", desc, amount, icon: getIcon(),
      payer: payerKey(), split: getSplit(), ts: expenseTimestamp(date),
    });
    ev.target.reset();
    dateInput.value = todayInputValue();
    setActive("e-payer", currentPersonName());
    setActive("e-split", "even");
    setIcon(ICON_DEFAULT);
    closeIconPop();
    updatePreview();
    document.getElementById("saldo-card").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.getElementById("settle-btn").addEventListener("click", onSettleClick);
  document.getElementById("confirm-settle").addEventListener("click", confirmSettlement);
}

// ============================================================
//  LOCK
// ============================================================
async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function unlock() {
  document.getElementById("lock").hidden = true;
  if (!CURRENT_USER) {
    document.getElementById("identity").hidden = false;
    return;
  }
  await enterApp();
}

async function enterApp() {
  document.getElementById("identity").hidden = true;
  document.getElementById("app").hidden = false;
  document.getElementById("identity-change").textContent = PEOPLE[CURRENT_USER].name;
  if (APP_INITIALIZED) {
    updatePersonLabels();
    setActive("e-payer", currentPersonName());
    updatePreview();
    render();
    return;
  }
  await initStore();
  store.subscribe((entries) => { ENTRIES = entries; render(); });
  initApp();
  APP_INITIALIZED = true;
}

document.getElementById("identity").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-person]");
  if (!button) return;
  CURRENT_USER = button.dataset.person;
  localStorage.setItem("bankboken-person", CURRENT_USER);
  await enterApp();
});

document.getElementById("identity-change").addEventListener("click", () => {
  document.getElementById("app").hidden = true;
  document.getElementById("identity").hidden = false;
});

document.getElementById("lock-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const err = document.getElementById("lock-error");
  if ((await sha256(document.getElementById("pw").value)) === PASSWORD_SHA256) {
    localStorage.setItem("hepa-unlocked", "1");
    unlock();
  } else {
    err.hidden = false;
    document.getElementById("pw").value = "";
  }
});

if (localStorage.getItem("hepa-unlocked") === "1") unlock();
