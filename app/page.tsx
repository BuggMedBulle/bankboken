"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Person = "Helo" | "Halvis";
type Split = "helo" | "half" | "halvis";
type Expense = {
  id: string;
  description: string;
  amount: number;
  paidBy: Person;
  split: Split;
  icon: string;
  createdAt: string;
};

const PEOPLE: Record<Person, { phone: string; initials: string }> = {
  Helo: { phone: "46739709200", initials: "HE" },
  Halvis: { phone: "46736137972", initials: "HA" },
};

const ICONS = ["🛒", "🍝", "🏠", "🚕", "🎟️", "✈️", "🎁", "☕", "🧾", "⛽"];

const money = new Intl.NumberFormat("sv-SE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function owedByHalvis(expense: Expense) {
  const heloShare = expense.split === "helo" ? expense.amount : expense.split === "half" ? expense.amount / 2 : 0;
  const halvisShare = expense.amount - heloShare;
  return expense.paidBy === "Helo" ? halvisShare : -heloShare;
}

function avatar(person: Person) {
  return <span className={`avatar avatar-${person.toLowerCase()}`}>{PEOPLE[person].initials}</span>;
}

export default function Home() {
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState<Person>("Helo");
  const [split, setSplit] = useState<Split>("half");
  const [icon, setIcon] = useState("🛒");
  const [showIcons, setShowIcons] = useState(false);
  const [toast, setToast] = useState("");
  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    setUnlocked(sessionStorage.getItem("bankboken-unlocked") === "yes");
    const saved = localStorage.getItem("bankboken-expenses");
    if (saved) {
      try { setExpenses(JSON.parse(saved)); } catch { localStorage.removeItem("bankboken-expenses"); }
    }
    setStorageReady(true);
  }, []);

  useEffect(() => {
    if (storageReady) localStorage.setItem("bankboken-expenses", JSON.stringify(expenses));
  }, [expenses, storageReady]);

  const balance = useMemo(() => expenses.reduce((sum, expense) => sum + owedByHalvis(expense), 0), [expenses]);
  const debtor: Person | null = balance > 0.004 ? "Halvis" : balance < -0.004 ? "Helo" : null;
  const creditor: Person | null = debtor === "Helo" ? "Halvis" : debtor === "Halvis" ? "Helo" : null;
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const heloPaid = expenses.filter((expense) => expense.paidBy === "Helo").reduce((sum, expense) => sum + expense.amount, 0);
  const halvisPaid = total - heloPaid;

  function unlock(event: FormEvent) {
    event.preventDefault();
    if (password === "helohalvis") {
      sessionStorage.setItem("bankboken-unlocked", "yes");
      setUnlocked(true);
      setError("");
    } else {
      setError("Fel lösenord. Försök igen.");
    }
  }

  function addExpense(event: FormEvent) {
    event.preventDefault();
    const parsedAmount = Number(amount.replace(",", "."));
    if (!description.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setToast("Fyll i beskrivning och ett giltigt belopp.");
      return;
    }
    setExpenses((current) => [{
      id: crypto.randomUUID(),
      description: description.trim(),
      amount: parsedAmount,
      paidBy,
      split,
      icon,
      createdAt: new Date().toISOString(),
    }, ...current]);
    setDescription("");
    setAmount("");
    setToast("Utgiften är tillagd");
    window.setTimeout(() => setToast(""), 2200);
  }

  function swish() {
    if (!debtor || !creditor) return;
    const params = new URLSearchParams({
      payee: PEOPLE[creditor].phone,
      amount: Math.abs(balance).toFixed(2),
      currency: "SEK",
      message: "Bankboken",
    });
    window.location.href = `swish://payment?${params.toString()}`;
  }

  if (!unlocked) {
    return (
      <main className="lock-page">
        <section className="lock-card">
          <div className="brand-mark">B</div>
          <p className="eyebrow">Helo + Halvis</p>
          <h1>Bankboken</h1>
          <p className="lock-intro">Ert lilla gemensamma ställe för utgifter, saldo och enkel Swish-reglering.</p>
          <form onSubmit={unlock}>
            <label htmlFor="password">Lösenord</label>
            <input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Skriv lösenordet" autoFocus />
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button" type="submit">Öppna Bankboken</button>
          </form>
          <p className="privacy-note">🔒 Uppgifterna sparas bara på den här enheten.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div><p className="eyebrow">Helo + Halvis</p><h1>Bankboken</h1></div>
        <button className="lock-button" onClick={() => { sessionStorage.removeItem("bankboken-unlocked"); setUnlocked(false); }} aria-label="Lås Bankboken">Lås</button>
      </header>

      <section className="balance-card">
        <div className="balance-top">
          <div>
            <p className="eyebrow">Aktuellt saldo</p>
            <h2>{money.format(Math.abs(balance))} kr</h2>
            <p className="balance-copy">{debtor && creditor ? <><strong>{debtor}</strong> är skyldig {creditor}</> : "Allt är jämnt. Ingen är skyldig något."}</p>
          </div>
          <div className="people-stack">{avatar("Helo")}{avatar("Halvis")}</div>
        </div>
        <button className="swish-button" onClick={swish} disabled={!debtor}>
          <span>{debtor ? `Reglera ${money.format(Math.abs(balance))} kr med` : "Ni är kvitt"}</span>
          {debtor && <img src="/swish-logo.svg" alt="Swish" />}
        </button>
      </section>

      <section className="card new-expense">
        <div className="section-heading"><div><p className="eyebrow">Ny post</p><h2>Lägg till utgift</h2></div><span className="step-pill">01</span></div>
        <form onSubmit={addExpense}>
          <label>Beskrivning</label>
          <div className="description-row">
            <div className="icon-wrap">
              <button type="button" className="icon-button" onClick={() => setShowIcons(!showIcons)} aria-label="Välj ikon">{icon}<small>+</small></button>
              {showIcons && <div className="icon-picker">{ICONS.map((item) => <button type="button" key={item} onClick={() => { setIcon(item); setShowIcons(false); }}>{item}</button>)}</div>}
            </div>
            <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="t.ex. Matvaror ICA" />
          </div>

          <label htmlFor="amount">Belopp</label>
          <div className="amount-input"><input id="amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0,00" /><span>kr</span></div>

          <label>Betalat av</label>
          <div className="segmented two">
            {(["Helo", "Halvis"] as Person[]).map((person) => <button type="button" className={paidBy === person ? "active" : ""} onClick={() => setPaidBy(person)} key={person}>{avatar(person)} {person}</button>)}
          </div>

          <label>Delning</label>
          <div className="segmented three">
            <button type="button" className={split === "helo" ? "active" : ""} onClick={() => setSplit("helo")}>100% Helo</button>
            <button type="button" className={split === "half" ? "active" : ""} onClick={() => setSplit("half")}>50/50</button>
            <button type="button" className={split === "halvis" ? "active" : ""} onClick={() => setSplit("halvis")}>100% Halvis</button>
          </div>
          <button className="primary-button" type="submit">Lägg till utgift <span>→</span></button>
        </form>
      </section>

      <section className="card history-card">
        <div className="section-heading"><div><p className="eyebrow">Överblick</p><h2>Historik</h2></div><span className="step-pill">{String(expenses.length).padStart(2, "0")}</span></div>
        <div className="totals"><span>Helo <strong>{money.format(heloPaid)} kr</strong></span><span>Halvis <strong>{money.format(halvisPaid)} kr</strong></span><span>Totalt <strong>{money.format(total)} kr</strong></span></div>
        {expenses.length === 0 ? <div className="empty"><span>🧾</span><h3>Inga utgifter ännu</h3><p>Den första utgiften ni lägger till dyker upp här.</p></div> : <div className="expense-list">{expenses.map((expense) => (
          <article className="expense-item" key={expense.id}>
            <span className="expense-icon">{expense.icon}</span>
            <div className="expense-main"><h3>{expense.description}</h3><p>{new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "short" }).format(new Date(expense.createdAt))} · {expense.paidBy} betalade · {expense.split === "half" ? "50/50" : expense.split === "helo" ? "100% Helo" : "100% Halvis"}</p></div>
            <div className="expense-amount"><strong>{money.format(expense.amount)} kr</strong><button onClick={() => setExpenses((current) => current.filter((item) => item.id !== expense.id))} aria-label={`Ta bort ${expense.description}`}>Ta bort</button></div>
          </article>
        ))}</div>}
      </section>
      <footer>Bankboken · Bara för Helo & Halvis</footer>
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
