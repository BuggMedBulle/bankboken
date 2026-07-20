import { FIREBASE_CONFIG } from "./config.js";

let PEOPLE = {
  A: { name: "Person 1", swish: "" },
  B: { name: "Person 2", swish: "" },
};
let firebaseApp;
let db;
let fs;
let auth;
let authApi;
let signedInUser;
let activeBankbook;
let unsubscribeEntries;
let unsubscribeWaitingRoom;
let unsubscribeActiveBankbook;
let openingBankbook = false;

// ============================================================
//  STORAGE LAYER
//  Firebase (real-time sync) when config.js is filled in,
//  otherwise localStorage so the app works on a single device.
// ============================================================
let store; // { subscribe(cb), add(entry), update(id, entry), remove(id) }

async function initStore() {
  const col = fs.collection(db, "bankbooks", activeBankbook.id, "entries");
  store = {
    subscribe(cb) {
      const q = fs.query(col, fs.orderBy("ts", "desc"));
      return fs.onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        (err) => { console.error(err); setSync(false, "Synkningen misslyckades"); });
    },
    async add(entry) { await fs.addDoc(col, { ...entry, updatedBy: signedInUser.uid }); },
    async update(id, entry) { await fs.updateDoc(fs.doc(col, id), { ...entry, updatedBy: signedInUser.uid }); },
    async remove(id) { await fs.deleteDoc(fs.doc(col, id)); },
  };
  setSync(true, "Synkad (Firebase)");
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
  return `Split Happens - reglering ${date}`;
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

function payerKey() { return getPayer(); }
function currentPersonName() { return CURRENT_USER || "A"; }

function updatePersonLabels() {
  document.querySelector('#e-payer [data-val="A"]').textContent = subjectName("A");
  document.querySelector('#e-payer [data-val="B"]').textContent = subjectName("B");
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
  setActive("e-payer", entry.payer);
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
  dateInput.addEventListener("change", () => dateInput.blur());

  document.getElementById("e-amount").addEventListener("input", updatePreview);
  document.getElementById("e-custom-share").addEventListener("input", () => {
    updateCustomSplitLabels();
    updatePreview();
  });

  // Config-driven labels
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
//  ACCOUNTS AND BANKBOOKS
// ============================================================
let registrationMode = false;
let profileCompletionMode = false;
let userProfile;

function showOnly(screenId) {
  for (const id of ["auth-screen", "bankbook-screen", "app"]) {
    document.getElementById(id).hidden = id !== screenId;
  }
}

function showError(elementId, error) {
  const element = document.getElementById(elementId);
  const messages = {
    "auth/email-already-in-use": "Det finns redan ett konto med den e-postadressen.",
    "auth/invalid-credential": "Fel e-postadress eller lösenord.",
    "auth/weak-password": "Lösenordet måste innehålla minst 6 tecken.",
    "auth/configuration-not-found": "Inloggning är inte aktiverad i Firebase ännu. Aktivera Email/Password under Authentication → Sign-in method.",
    "permission-denied": "Firestore-reglerna för Split Happens är inte publicerade ännu.",
  };
  element.textContent = messages[error?.code] || error?.message || "Något gick fel. Försök igen.";
  element.hidden = false;
}

function normalizeSwish(value) {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("0")) return `46${digits.slice(1)}`;
  return digits;
}

async function loadProfile(uid) {
  const snapshot = await fs.getDoc(fs.doc(db, "users", uid));
  return snapshot.exists() ? snapshot.data() : null;
}

async function loadBankbooks() {
  const q = fs.query(fs.collection(db, "bankbooks"), fs.where("memberIds", "array-contains", signedInUser.uid));
  const snapshot = await fs.getDocs(q);
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
}

function pendingInviteId() {
  return new URL(window.location.href).searchParams.get("invite")?.trim() || "";
}

function parseInvite(value) {
  const trimmed = value.trim();
  try {
    return new URL(trimmed).searchParams.get("invite")?.trim() || trimmed;
  } catch {
    return trimmed;
  }
}

function invitationUrl(bankbookId) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("invite", bankbookId);
  return url.toString();
}

function renderWaitingRoom(bankbook) {
  showOnly("bankbook-screen");
  document.getElementById("welcome-name").textContent = `Hej ${userProfile.name}! Väntar på den andra personen…`;
  document.getElementById("invite-panel").hidden = false;
  document.getElementById("join-bankbook-form").hidden = true;
  document.getElementById("invite-link").value = invitationUrl(bankbook.id);
  watchWaitingRoom(bankbook.id);
}

function watchWaitingRoom(bankbookId) {
  if (unsubscribeWaitingRoom) unsubscribeWaitingRoom();
  const reference = fs.doc(db, "bankbooks", bankbookId);
  unsubscribeWaitingRoom = fs.onSnapshot(reference, async (snapshot) => {
    if (!snapshot.exists() || openingBankbook) return;
    const updatedBankbook = { id: snapshot.id, ...snapshot.data() };
    if (updatedBankbook.memberIds.length < 2 || !peopleFromBankbook(updatedBankbook)) return;
    openingBankbook = true;
    unsubscribeWaitingRoom();
    unsubscribeWaitingRoom = null;
    await openBankbook(updatedBankbook);
    openingBankbook = false;
  }, (error) => showError("bankbook-error", error));
}

async function refreshBankbookMenu(autoOpen = true) {
  const bankbooks = await loadBankbooks();
  const inviteId = pendingInviteId();
  if (bankbooks.length > 0) {
    const bankbook = bankbooks[0];
    if (inviteId && inviteId !== bankbook.id) {
      showOnly("bankbook-screen");
      showError("bankbook-error", new Error("Kontot är redan kopplat till en annan delning."));
      return;
    }
    if (bankbook.memberIds.length === 2 && autoOpen) {
      await openBankbook(bankbook);
    } else {
      renderWaitingRoom(bankbook);
    }
    return;
  }
  if (inviteId) {
    document.getElementById("invite-code").value = inviteId;
    await joinBankbook(inviteId);
    return;
  }
  const bankbook = await createAutomaticBankbook();
  renderWaitingRoom(bankbook);
}

async function createAutomaticBankbook() {
  const reference = fs.doc(fs.collection(db, "bankbooks"));
  const bankbook = {
    name: "Split Happens",
    createdBy: signedInUser.uid,
    memberIds: [signedInUser.uid],
    members: {
      [signedInUser.uid]: { name: userProfile.name, swish: userProfile.swish, slot: "A" },
    },
    createdAt: fs.serverTimestamp(),
  };
  await fs.setDoc(reference, bankbook);
  return { id: reference.id, ...bankbook };
}

function peopleFromBankbook(bankbook) {
  const profiles = Object.entries(bankbook.members || {});
  const personA = profiles.find(([, profile]) => profile.slot === "A");
  const personB = profiles.find(([, profile]) => profile.slot === "B");
  if (!personA || !personB) return null;
  return {
    people: { A: personA[1], B: personB[1] },
    currentSlot: personA[0] === signedInUser.uid ? "A" : "B",
  };
}

async function openBankbook(bankbook) {
  const people = peopleFromBankbook(bankbook);
  if (!people) return renderWaitingRoom(bankbook);
  if (unsubscribeWaitingRoom) {
    unsubscribeWaitingRoom();
    unsubscribeWaitingRoom = null;
  }
  activeBankbook = bankbook;
  PEOPLE = people.people;
  CURRENT_USER = people.currentSlot;
  localStorage.setItem(`bankboken-active-${signedInUser.uid}`, bankbook.id);
  document.querySelector(".brand").title = bankbook.name;
  ENTRIES = [];
  HISTORY_FILTER = null;
  HISTORY_PAGE = 1;
  if (unsubscribeEntries) unsubscribeEntries();
  await initStore();
  if (!APP_INITIALIZED) {
    initApp();
    APP_INITIALIZED = true;
  } else {
    updatePersonLabels();
    resetExpenseForm();
  }
  unsubscribeEntries = store.subscribe((entries) => { ENTRIES = entries; render(); });
  watchActiveBankbook(bankbook.id);
  showOnly("app");
}

function watchActiveBankbook(bankbookId) {
  if (unsubscribeActiveBankbook) unsubscribeActiveBankbook();
  unsubscribeActiveBankbook = fs.onSnapshot(fs.doc(db, "bankbooks", bankbookId), (snapshot) => {
    if (!snapshot.exists()) return;
    const updatedBankbook = { id: snapshot.id, ...snapshot.data() };
    const people = peopleFromBankbook(updatedBankbook);
    if (!people) return;
    activeBankbook = updatedBankbook;
    PEOPLE = people.people;
    CURRENT_USER = people.currentSlot;
    if (APP_INITIALIZED) {
      updatePersonLabels();
      updatePreview();
      render();
    }
  }, (error) => setSync(false, error.message));
}

document.getElementById("auth-mode").addEventListener("click", () => {
  if (profileCompletionMode) {
    authApi.signOut(auth);
    return;
  }
  registrationMode = !registrationMode;
  document.getElementById("auth-name").hidden = !registrationMode;
  document.getElementById("auth-swish").hidden = !registrationMode;
  document.getElementById("auth-name").required = registrationMode;
  document.getElementById("auth-swish").required = registrationMode;
  document.getElementById("auth-submit").textContent = registrationMode ? "Skapa konto" : "Logga in";
  document.getElementById("auth-mode").textContent = registrationMode ? "Jag har redan ett konto" : "Skapa ett konto";
  document.getElementById("auth-password").autocomplete = registrationMode ? "new-password" : "current-password";
  document.getElementById("auth-error").hidden = true;
});

document.getElementById("auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  document.getElementById("auth-error").hidden = true;
  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  try {
    if (registrationMode) {
      const credential = profileCompletionMode
        ? { user: signedInUser }
        : await authApi.createUserWithEmailAndPassword(auth, email, password);
      const profile = {
        name: document.getElementById("auth-name").value.trim(),
        swish: normalizeSwish(document.getElementById("auth-swish").value),
        email,
        createdAt: fs.serverTimestamp(),
      };
      await fs.setDoc(fs.doc(db, "users", credential.user.uid), profile);
      userProfile = profile;
      profileCompletionMode = false;
      await refreshBankbookMenu(false);
    } else {
      await authApi.signInWithEmailAndPassword(auth, email, password);
    }
  } catch (error) {
    showError("auth-error", error);
  }
});

async function joinBankbook(code) {
  const reference = fs.doc(db, "bankbooks", code);
  try {
    const existing = await loadBankbooks();
    if (existing.length && existing[0].id !== code) throw new Error("Kontot är redan kopplat till en annan delning.");
    await fs.runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists()) throw new Error("Inbjudningskoden finns inte.");
      const bankbook = snapshot.data();
      if (bankbook.memberIds.includes(signedInUser.uid)) return;
      if (bankbook.memberIds.length >= 2) throw new Error("Den här delningen har redan två personer.");
      transaction.update(reference, {
        memberIds: [...bankbook.memberIds, signedInUser.uid],
        members: {
          ...bankbook.members,
          [signedInUser.uid]: { name: userProfile.name, swish: userProfile.swish, slot: "B" },
        },
      });
    });
    document.getElementById("invite-code").value = "";
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("invite");
    window.history.replaceState({}, "", cleanUrl);
    await refreshBankbookMenu();
  } catch (error) {
    showOnly("bankbook-screen");
    showError("bankbook-error", error);
  }
}

document.getElementById("join-bankbook-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  await joinBankbook(parseInvite(document.getElementById("invite-code").value));
});

document.getElementById("copy-invite").addEventListener("click", async () => {
  await navigator.clipboard.writeText(document.getElementById("invite-link").value);
  document.getElementById("copy-invite").textContent = "Kopierad!";
});

document.getElementById("share-invite").addEventListener("click", async () => {
  const url = document.getElementById("invite-link").value;
  if (navigator.share) await navigator.share({ title: "Split Happens", text: "Anslut till vår delning", url });
  else await navigator.clipboard.writeText(url);
});

function closeSettings() {
  document.getElementById("settings-modal").hidden = true;
  document.getElementById("settings-error").hidden = true;
}

document.getElementById("settings-trigger").addEventListener("click", () => {
  document.getElementById("settings-name").value = userProfile.name;
  document.getElementById("settings-error").hidden = true;
  document.getElementById("settings-modal").hidden = false;
});

document.getElementById("settings-close").addEventListener("click", closeSettings);
document.getElementById("settings-modal").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeSettings();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !document.getElementById("settings-modal").hidden) closeSettings();
});
document.getElementById("settings-logout").addEventListener("click", () => authApi.signOut(auth));
document.getElementById("settings-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = document.getElementById("settings-name").value.trim();
  if (!name || !activeBankbook) return;
  try {
    const members = {
      ...activeBankbook.members,
      [signedInUser.uid]: { ...activeBankbook.members[signedInUser.uid], name },
    };
    const batch = fs.writeBatch(db);
    batch.update(fs.doc(db, "users", signedInUser.uid), { name });
    batch.update(fs.doc(db, "bankbooks", activeBankbook.id), { members });
    await batch.commit();
    userProfile = { ...userProfile, name };
    activeBankbook = { ...activeBankbook, members };
    PEOPLE[CURRENT_USER] = { ...PEOPLE[CURRENT_USER], name };
    updatePersonLabels();
    updatePreview();
    render();
    closeSettings();
  } catch (error) {
    showError("settings-error", error);
  }
});

document.getElementById("logout-menu").addEventListener("click", () => authApi.signOut(auth));

async function initializeFirebase() {
  const appApi = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
  fs = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  authApi = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
  firebaseApp = appApi.initializeApp(FIREBASE_CONFIG, "bankboken-v2");
  db = fs.getFirestore(firebaseApp);
  auth = authApi.getAuth(firebaseApp);
  authApi.onAuthStateChanged(auth, async (user) => {
    signedInUser = user;
    if (!user) {
      if (unsubscribeEntries) unsubscribeEntries();
      if (unsubscribeWaitingRoom) unsubscribeWaitingRoom();
      if (unsubscribeActiveBankbook) unsubscribeActiveBankbook();
      unsubscribeWaitingRoom = null;
      unsubscribeActiveBankbook = null;
      closeSettings();
      profileCompletionMode = false;
      document.getElementById("auth-email").disabled = false;
      document.getElementById("auth-password").hidden = false;
      document.getElementById("auth-password").required = true;
      showOnly("auth-screen");
      return;
    }
    try {
      userProfile = await loadProfile(user.uid);
    } catch (error) {
      showOnly("auth-screen");
      showError("auth-error", error);
      return;
    }
    if (!userProfile) {
      profileCompletionMode = true;
      registrationMode = true;
      showOnly("auth-screen");
      document.getElementById("auth-name").hidden = false;
      document.getElementById("auth-swish").hidden = false;
      document.getElementById("auth-name").required = true;
      document.getElementById("auth-swish").required = true;
      document.getElementById("auth-email").value = user.email || "";
      document.getElementById("auth-email").disabled = true;
      document.getElementById("auth-password").hidden = true;
      document.getElementById("auth-password").required = false;
      document.getElementById("auth-submit").textContent = "Slutför konto";
      document.getElementById("auth-mode").textContent = "Logga ut och byt konto";
      showError("auth-error", new Error("Kontot är skapat, men profilen saknas. Publicera Firestore-reglerna och slutför sedan kontot här."));
      return;
    }
    await refreshBankbookMenu();
  });
}

initializeFirebase().catch((error) => showError("auth-error", error));
