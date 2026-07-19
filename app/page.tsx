export default function Home() {
  return (
    <main className="imported-app-shell">
      <iframe
        className="imported-app-frame"
        src="/bankboken/index.html"
        title="Bankboken"
        allow="clipboard-write"
      />
    </main>
  );
}
