// Public landing page for the backend's URL. The real UI is the dashboard app
// and SMS; this just tells a visitor how to report.
export default function Home() {
  const phone = process.env.REPORT_PHONE_NUMBER;
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-3xl font-semibold">Community4You</h1>
      <p className="text-lg max-w-md">
        See a problem in your neighborhood? {phone ? <>Text <strong>{phone}</strong></> : "Text us"} with what&apos;s
        happening and where. No app or account needed.
      </p>
      <p className="text-sm opacity-70">If anyone is in danger, call 911.</p>
    </main>
  );
}
