import { PEOPLE, PASSWORD_SHA256, FIREBASE_CONFIG } from "./config.js";

// ============================================================
//  STORAGE LAYER
//  Firebase (real-time sync) when config.js is filled in,
//  otherwise localStorage so the app works on a single device.
// ============================================================
const firebaseReady = !String(FIREBASE_CONFIG.apiKey).includes("PASTE_ME");
let store; // { subscribe(cb), add(entry), update(id, entry), remove(id) }

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
      async update(id, entry) { await fs.updateDoc(fs.doc(db, "entries", id), entry); },
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
      async update(id, entry) { write(read().map((e) => e.id === id ? { ...e, ...entry } : e)); emit(); },
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
  if (e.split === "custom") {
    const shareA = Math.min(1, Math.max(0, Number(e.shareA) || 0));
    return { a: e.amount * shareA, b: e.amount * (1 - shareA) };
  }
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
let HISTORY_FILTER = null;
let HISTORY_PAGE = 1;
const HISTORY_PAGE_SIZE = 10;

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
  const creditor = PEOPLE[creditorKey];
  const owed = Math.abs(bal);

  heading.textContent = kr(owed);
  sub.innerHTML = `<strong>${escapeHtml(subjectName(debtorKey))}</strong> är skyldig ${escapeHtml(objectName(creditorKey))}`;
  if (CURRENT_USER !== debtorKey) return;

  btn.hidden = false;
  btn.dataset.payee = creditor.swish;
  btn.dataset.amount = owed.toFixed(2);
}

function renderHistory() {
  const list = document.getElementById("history-list");
  const empty = document.getElementById("history-empty");
  const totals = document.getElementById("totals");
  const pagination = document.getElementById("history-pagination");
  list.innerHTML = "";

  const hasEntries = ENTRIES.length > 0;
  totals.hidden = !hasEntries;
  totals.classList.toggle("is-filtered", Boolean(HISTORY_FILTER));

  if (hasEntries) {
    const sum = (who) =>
      ENTRIES.filter((e) => e.type !== "settlement" && e.payer === who).reduce((s, e) => s + e.amount, 0);
    const a = sum("A"), b = sum("B");
    totals.innerHTML = `
      <button type="button" data-filter="A" class="${HISTORY_FILTER === "A" ? "active" : ""}" aria-pressed="${HISTORY_FILTER === "A"}">${subjectName("A")}<b>${kr0(a)}</b></button>
      <button type="button" data-filter="B" class="${HISTORY_FILTER === "B" ? "active" : ""}" aria-pressed="${HISTORY_FILTER === "B"}">${subjectName("B")}<b>${kr0(b)}</b></button>
      <button type="button" data-filter="all" aria-label="Visa alla utgifter">Totalt<b>${kr0(a + b)}</b></button>`;
  }

  const visibleEntries = HISTORY_FILTER
    ? ENTRIES.filter((entry) => entry.type !== "settlement" && entry.payer === HISTORY_FILTER)
    : ENTRIES;
  empty.hidden = visibleEntries.length > 0;
  empty.textContent = HISTORY_FILTER
    ? `Inga utgifter för ${subjectName(HISTORY_FILTER)}.`
    : "Inga utgifter än. Lägg till er första ovan.";

  const pageCount = Math.max(1, Math.ceil(visibleEntries.length / HISTORY_PAGE_SIZE));
  HISTORY_PAGE = Math.min(HISTORY_PAGE, pageCount);
  const pageStart = (HISTORY_PAGE - 1) * HISTORY_PAGE_SIZE;
  const pageEntries = visibleEntries.slice(pageStart, pageStart + HISTORY_PAGE_SIZE);
  pagination.hidden = visibleEntries.length <= HISTORY_PAGE_SIZE;
  document.getElementById("history-page-status").textContent = `Sida ${HISTORY_PAGE} av ${pageCount}`;
  document.getElementById("history-prev").disabled = HISTORY_PAGE === 1;
  document.getElementById("history-next").disabled = HISTORY_PAGE === pageCount;

  let renderedDate = null;
  for (const e of pageEntries) {
    const li = document.createElement("li");
    const who = PEOPLE[e.payer] ? subjectName(e.payer) : e.payer;
    const date = new Date(e.ts).toLocaleDateString("sv-SE", { day: "numeric", month: "long" });

    if (date !== renderedDate) {
      const marker = document.createElement("li");
      marker.className = "history-date-marker";
      marker.textContent = date;
      list.appendChild(marker);
      renderedDate = date;
    }

    if (e.type === "settlement") {
      const recipientKey = e.payer === "A" ? "B" : "A";
      const to = objectName(recipientKey);
      li.className = "h-settle";
      li.innerHTML = `
        <div class="h-ico">💸</div>
        <div class="h-main">
          <div class="h-title">Reglering</div>
          <div class="h-sub">${who} betalade ${to}</div>
        </div>
        <div class="h-amt">${kr(e.amount)}</div>`;
    } else {
      const split =
        e.split === "a" ? `100% ${subjectName("A")}` :
        e.split === "b" ? `100% ${subjectName("B")}` :
        e.split === "custom" ? `${Math.round((e.shareA || 0) * 100)}% ${subjectName("A")} / ${Math.round((1 - (e.shareA || 0)) * 100)}% ${subjectName("B")}` :
        "50/50";
      li.innerHTML = `
        <div class="h-ico">${e.icon || "🧾"}</div>
        <div class="h-main">
          <div class="h-title">${escapeHtml(e.desc)}</div>
          <div class="h-sub">${who} betalade · ${split}</div>
        </div>
        <div class="h-amt">${kr(e.amount)}</div>`;
    }
    if (e.type !== "settlement") {
      li.classList.add("h-expense");
      li.tabIndex = 0;
      li.setAttribute("role", "button");
      li.setAttribute("aria-label", `Redigera ${e.desc}`);
      li.onclick = () => startEditing(e);
      li.onkeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          startEditing(e);
        }
      };
    } else {
      const del = document.createElement("button");
      del.className = "h-del";
      del.innerHTML = '<img src="delete.svg" alt="" />';
      del.title = "Ta bort";
      del.onclick = () => { if (confirm("Ta bort denna post?")) store.remove(e.id); };
      li.appendChild(del);
    }
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
const settlementMessage = () => {
  const date = new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "long" }).format(new Date());
  return `Bankboken - reglering ${date}`;
};

const buildSwishLink = (payee, amount, msg) =>
  `https://app.swish.nu/1/p/sw/?sw=${encodeURIComponent(payee)}` +
  `&amt=${encodeURIComponent(amount)}&cur=SEK&msg=${encodeURIComponent(msg)}`;

function onSettleClick() {
  const btn = document.getElementById("settle-btn");
  if (btn.hidden) return;
  const { payee, amount } = btn.dataset;
  const link = buildSwishLink(payee, amount, settlementMessage());

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
let EDITING_ID = null;

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
  updateCustomSplitLabels();
}

function customShareA() {
  return 1 - Number(document.getElementById("e-custom-share").value) / 100;
}

function updateCustomSplitLabels() {
  const slider = document.getElementById("e-custom-share");
  const sliderPosition = Number(slider.value);
  const fillStart = Math.min(50, sliderPosition);
  const fillEnd = Math.max(50, sliderPosition);
  slider.style.background = `linear-gradient(to right, var(--ink-3) 0 ${fillStart}%, var(--ink) ${fillStart}% ${fillEnd}%, var(--ink-3) ${fillEnd}% 100%)`;
  const percentA = Math.round(customShareA() * 100);
  const amount = parseFloat(document.getElementById("e-amount").value) || 0;
  document.getElementById("custom-a-name").textContent = subjectName("A");
  document.getElementById("custom-b-name").textContent = subjectName("B");
  document.getElementById("custom-a-value").textContent = `${percentA}% · ${kr(amount * percentA / 100)}`;
  document.getElementById("custom-b-value").textContent = `${100 - percentA}% · ${kr(amount * (100 - percentA) / 100)}`;
}

function onSplitChange(split) {
  document.getElementById("custom-split").hidden = split !== "custom";
  updatePreview();
}

function todayInputValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function expenseTimestamp(dateValue, previousTimestamp = null) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const now = previousTimestamp ? new Date(previousTimestamp) : new Date();
  return new Date(
    year, month - 1, day,
    now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds(),
  ).getTime();
}

function dateInputValue(timestamp) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function resetExpenseForm() {
  const form = document.getElementById("expense-form");
  document.getElementById("expense-form-home").appendChild(form);
  document.getElementById("edit-modal").hidden = true;
  EDITING_ID = null;
  form.reset();
  document.getElementById("e-date").value = todayInputValue();
  setActive("e-payer", currentPersonName());
  setActive("e-split", "even");
  document.getElementById("e-custom-share").value = "50";
  document.getElementById("custom-split").hidden = true;
  document.getElementById("expense-heading").textContent = "Ny utgift";
  document.getElementById("submit-icon").textContent = "+";
  document.getElementById("submit-label").textContent = "Lägg till utgift";
  document.getElementById("edit-cancel").hidden = true;
  document.getElementById("edit-delete").hidden = true;
  updateCustomSplitLabels();
  setIcon(ICON_DEFAULT);
  closeIconPop();
  updatePreview();
}

function startEditing(entry) {
  EDITING_ID = entry.id;
  document.getElementById("edit-form-modal").appendChild(document.getElementById("expense-form"));
  document.getElementById("edit-modal").hidden = false;
  document.getElementById("e-desc").value = entry.desc;
  document.getElementById("e-amount").value = entry.amount;
  document.getElementById("e-date").value = dateInputValue(entry.ts);
  setActive("e-payer", PEOPLE[entry.payer].name);
  setActive("e-split", entry.split || "even");
  document.getElementById("e-custom-share").value = entry.split === "custom"
    ? String(Math.round((1 - entry.shareA) * 100))
    : "50";
  document.getElementById("custom-split").hidden = entry.split !== "custom";
  setIcon(entry.icon || ICON_DEFAULT);
  document.getElementById("submit-icon").textContent = "✓";
  document.getElementById("submit-label").textContent = "Spara ändringar";
  document.getElementById("edit-cancel").hidden = false;
  document.getElementById("edit-delete").hidden = false;
  updateCustomSplitLabels();
  updatePreview();
  document.getElementById("e-desc").focus();
}

function updatePreview() {
  const amount = parseFloat(document.getElementById("e-amount").value) || 0;
  updateCustomSplitLabels();
  const split = getSplit(); // 'a' | 'even' | 'b'
  const payer = payerKey();
  const other = payer === "A" ? "B" : "A";
  const el = document.getElementById("split-preview");

  if (amount <= 0) { el.hidden = true; return; }
  const shares = sharesOf({ amount, split, shareA: customShareA() });
  const owes = payerKey() === "A" ? shares.b : shares.a; // what the non-payer owes
  el.hidden = false;
  el.textContent = owes <= 0
    ? `Ingen skuld – ${subjectName(payer)} står för hela beloppet.`
    : `${subjectName(other)} blir skyldig ${objectName(payer)} ${kr(owes)}.`;
}

function initApp() {
  getPayer = initSegments("e-payer", updatePreview);
  getSplit = initSegments("e-split", onSplitChange);
  initIconPicker();

  const dateInput = document.getElementById("e-date");
  dateInput.value = todayInputValue();

  document.getElementById("e-amount").addEventListener("input", updatePreview);
  document.getElementById("e-custom-share").addEventListener("input", () => {
    updateCustomSplitLabels();
    updatePreview();
  });

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
    const split = getSplit();
    const existingEntry = EDITING_ID ? ENTRIES.find((entry) => entry.id === EDITING_ID) : null;
    const expense = {
      type: "expense", desc, amount, icon: getIcon(),
      payer: payerKey(), split,
      shareA: split === "custom" ? customShareA() : null,
      ts: expenseTimestamp(date, existingEntry?.ts),
    };
    if (EDITING_ID) await store.update(EDITING_ID, expense);
    else await store.add(expense);
    resetExpenseForm();
    document.getElementById("saldo-card").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.getElementById("edit-cancel").addEventListener("click", resetExpenseForm);
  document.getElementById("edit-delete").addEventListener("click", async () => {
    if (!EDITING_ID || !confirm("Ta bort detta utlägg?")) return;
    await store.remove(EDITING_ID);
    resetExpenseForm();
  });

  document.getElementById("edit-modal").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) resetExpenseForm();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !document.getElementById("edit-modal").hidden) resetExpenseForm();
  });

  document.getElementById("totals").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;
    const filter = button.dataset.filter;
    HISTORY_FILTER = filter === "all" || HISTORY_FILTER === filter ? null : filter;
    HISTORY_PAGE = 1;
    renderHistory();
  });

  document.getElementById("history-prev").addEventListener("click", () => {
    if (HISTORY_PAGE <= 1) return;
    HISTORY_PAGE -= 1;
    renderHistory();
    document.getElementById("totals").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.getElementById("history-next").addEventListener("click", () => {
    HISTORY_PAGE += 1;
    renderHistory();
    document.getElementById("totals").scrollIntoView({ behavior: "smooth", block: "start" });
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
  document.getElementById("identity-name").textContent = PEOPLE[CURRENT_USER].name;
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
