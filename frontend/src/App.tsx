import { useCallback, useEffect, useState } from "react";
import { AdminView } from "./components/AdminView";
import { PatientView } from "./components/PatientView";
import { ProviderView } from "./components/ProviderView";
import { Spinner, ToastProvider, useAction } from "./components/ui";
import {
  DEMO_ACCOUNTS,
  DEPLOYMENT,
  demoSession,
  isLocalChainUp,
  publicKeyOf,
  short,
  walletSession,
  type Role,
  type Session,
} from "./lib/chain";

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<Role | null>(null);

  const loadRole = useCallback(async (s: Session) => {
    setRole(null);
    setRole((await s.contract.roleOf(s.address)) as Role);
  }, []);

  useEffect(() => {
    if (session) loadRole(session);
  }, [session, loadRole]);

  useEffect(() => {
    const eth = (window as any).ethereum;
    if (!eth || session?.mode !== "wallet") return;
    const onChange = () => walletSession().then(setSession).catch(() => setSession(null));
    eth.on?.("accountsChanged", onChange);
    return () => eth.removeListener?.("accountsChanged", onChange);
  }, [session?.mode]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" onClick={() => setSession(null)}>
          <Logo />
          <span>MedChain</span>
        </div>
        {session && (
          <div className="account">
            {role && role !== "none" && <span className={`role role-${role}`}>{role}</span>}
            <span className="account-name">{session.label ?? short(session.address)}</span>
            <code className="hide-sm">{short(session.address)}</code>
            <button className="btn btn-ghost btn-sm" onClick={() => setSession(null)}>Switch account</button>
          </div>
        )}
      </header>
      <main>
        {!session ? (
          <Connect onSession={setSession} />
        ) : role === null ? (
          <div className="view"><Spinner label="Reading your role from the contract" /></div>
        ) : role === "admin" ? (
          <AdminView session={session} />
        ) : role === "provider" ? (
          <ProviderView session={session} />
        ) : role === "patient" ? (
          <PatientView key={session.address} session={session} />
        ) : (
          <Onboarding session={session} onDone={() => loadRole(session)} />
        )}
      </main>
      <footer className="footer muted small">
        Contract <code>{DEPLOYMENT.address}</code> · chain {DEPLOYMENT.chainId} · All demo data is fictional.
      </footer>
    </div>
  );
}

function Connect({ onSession }: { onSession: (s: Session) => void }) {
  const [chainUp, setChainUp] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    isLocalChainUp().then(setChainUp);
  }, []);

  return (
    <div className="landing">
      <section className="hero">
        <p className="eyebrow">Patient-controlled health records on Ethereum</p>
        <h1>Your medical history, encrypted end to end and owned by you.</h1>
        <p className="lead">
          Records are encrypted in the browser before they reach the blockchain. The chain stores only ciphertext and a
          tamper-evident hash, and patients decide which verified providers hold a key, and for how long.
        </p>
        <ul className="features">
          <li><b>End-to-end encrypted</b><span>X25519 key wrapping and XSalsa20-Poly1305. Nobody without a key, including the admin, can read a record.</span></li>
          <li><b>Consent you can revoke</b><span>Time-limited access grants. Revoking deletes the provider's keys.</span></li>
          <li><b>Tamper-evident</b><span>Each record's hash is stored on-chain and checked every time it is read.</span></li>
          <li><b>Full audit trail</b><span>Every grant, revocation, record and redaction is an immutable event.</span></li>
        </ul>
      </section>

      <section className="card signin">
        <h2>Sign in</h2>
        {chainUp === null ? (
          <Spinner label="Looking for the local blockchain" />
        ) : chainUp ? (
          <>
            <p className="muted small">Pick a demo account on the local Hardhat chain. Each one is a real wallet that signs real transactions.</p>
            <div className="demo-accounts">
              {DEMO_ACCOUNTS.map((a) => (
                <button key={a.index} className="demo" onClick={() => onSession(demoSession(a.index))}>
                  <span className="avatar">{a.label.replace("Dr. ", "").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</span>
                  <span>
                    <b>{a.label}</b>
                    <small>{a.subtitle}</small>
                  </span>
                </button>
              ))}
            </div>
            <div className="divider"><span>or</span></div>
          </>
        ) : (
          <div className="notice">
            <b>Local blockchain not found.</b> Run <code>npm run dev</code> from the project root to start a Hardhat node with demo data.
          </div>
        )}
        <button
          className="btn btn-outline wide"
          onClick={() => walletSession().then(onSession).catch((e) => setError(e?.shortMessage ?? e?.message))}
        >
          Connect MetaMask
        </button>
        {error && <p className="error-text small">{error}</p>}
      </section>
    </div>
  );
}

function Onboarding({ session, onDone }: { session: Session; onDone: () => void }) {
  const { busy, run } = useAction();
  return (
    <div className="view narrow">
      <div className="card center">
        <p className="eyebrow">Welcome</p>
        <h2>Create your patient profile</h2>
        <p className="muted">
          You will be asked to sign a message. The signature deterministically generates your personal encryption key,
          so nothing extra needs to be stored or remembered. Only the public half is published on-chain.
        </p>
        <button
          className="btn btn-primary"
          disabled={!!busy}
          onClick={() =>
            run("register", async () => (await session.contract.registerPatient(await publicKeyOf(session))).wait(), "Patient profile created").then(
              (ok) => ok && onDone(),
            )
          }
        >
          {busy ? "Registering…" : "Sign and register"}
        </button>
        <p className="muted small">Healthcare provider? Ask the administrator to verify your wallet address.</p>
      </div>
    </div>
  );
}

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M13 7h6v6h6v6h-6v6h-6v-6H7v-6h6z" fill="white" />
    </svg>
  );
}
