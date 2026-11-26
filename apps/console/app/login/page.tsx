import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; expired?: string }> }) {
  const { next, expired } = await searchParams;
  return (
    <main className="login-page">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/evgo-logo.png" alt="EVGO" width={160} height={45} />
      <h1>Operator console</h1>
      <p className="hint">Sign in with the email and password your EVGO admin gave you.</p>
      {expired && <p className="error">Your session ended. Sign in again.</p>}
      <LoginForm next={next ?? "/"} />
      <p className="hint">Forgot your password? Ask an EVGO admin to reset it.</p>
    </main>
  );
}
