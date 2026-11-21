import { useCallback, useEffect, useMemo, useState } from "react";
import { getKeys, type Session } from "../lib/chain";
import {
  addRecord,
  grantAccess,
  loadActivity,
  loadProviders,
  loadRecords,
  type ActivityItem,
  type LoadedRecord,
  type ProviderInfo,
} from "../lib/records";
import { Activity } from "./Activity";
import { RecordCard, supersededMap } from "./RecordCard";
import { RecordForm } from "./RecordForm";
import { Address, daysLeft, Empty, Spinner, useAction } from "./ui";

type Tab = "records" | "access" | "activity";

export function PatientView({ session }: { session: Session }) {
  const { contract, address } = session;
  const [tab, setTab] = useState<Tab>("records");
  const [records, setRecords] = useState<LoadedRecord[] | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [grants, setGrants] = useState<{ address: string; expiry: number; active: boolean }[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [showRedacted, setShowRedacted] = useState(false);
  const [form, setForm] = useState<null | { amending?: LoadedRecord }>(null);
  const { busy, run } = useAction();

  const refresh = useCallback(async () => {
    const keys = await getKeys(session);
    const [recs, provs, grantees, act] = await Promise.all([
      loadRecords(contract, address, keys.secretKey),
      loadProviders(contract),
      contract.getGrantees(address) as Promise<string[]>,
      loadActivity(contract, address),
    ]);
    setRecords(recs);
    setProviders(provs);
    setActivity(act);
    setGrants(
      await Promise.all(
        grantees.map(async (g) => ({
          address: g,
          expiry: Number(await contract.accessExpiry(address, g)),
          active: await contract.hasAccess(address, g),
        })),
      ),
    );
  }, [contract, address, session]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const name = (a: string) => providers.find((p) => p.address.toLowerCase() === a.toLowerCase())?.name;
  const superseded = useMemo(() => supersededMap(records ?? []), [records]);
  const visible = (records ?? []).filter((r) => showRedacted || !r.redacted);
  const latestProfile = records?.find((r) => r.data)?.data;

  const activeReaders = grants.filter((g) => g.active).map((g) => g.address);

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <p className="eyebrow">Patient</p>
          <h1>{latestProfile?.patientName ?? "My health records"}</h1>
          <p className="muted">
            {records ? `${records.length} records` : "…"} · {activeReaders.length} provider{activeReaders.length === 1 ? "" : "s"} with access
          </p>
        </div>
        <nav className="tabs">
          {(["records", "access", "activity"] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {t === "records" ? "Records" : t === "access" ? "Access control" : "Audit log"}
            </button>
          ))}
        </nav>
      </div>

      {tab === "records" && (
        <section>
          <div className="row between">
            <label className="check">
              <input type="checkbox" checked={showRedacted} onChange={(e) => setShowRedacted(e.target.checked)} /> Show redacted
            </label>
            {!form && <button className="btn btn-primary" onClick={() => setForm({})}>Add self-reported record</button>}
          </div>
          {form && (
            <RecordForm
              busy={busy === "add"}
              amending={form.amending?.id}
              initial={form.amending ? { ...form.amending.data, category: form.amending.category } : latestProfile ? {
                patientName: latestProfile.patientName, age: latestProfile.age, gender: latestProfile.gender, bloodType: latestProfile.bloodType,
              } : {}}
              onCancel={() => setForm(null)}
              onSubmit={async (category, data) => {
                const ok = await run(
                  "add",
                  () => addRecord(contract, address, category, data, address, form.amending?.id ?? 0),
                  form.amending ? "Amendment saved" : "Record encrypted and saved on-chain",
                );
                if (ok) {
                  setForm(null);
                  refresh();
                }
              }}
            />
          )}
          {!records ? (
            <Spinner label="Decrypting records" />
          ) : visible.length === 0 ? (
            <Empty title="No records yet">Records added by you or your providers will appear here.</Empty>
          ) : (
            <div className="records">
              {visible.map((r) => (
                <RecordCard
                  key={r.id}
                  record={r}
                  authorName={name(r.author)}
                  supersededBy={superseded.get(r.id)}
                  onAmend={r.author === address && r.data ? () => setForm({ amending: r }) : undefined}
                  onRedact={() => run("redact", async () => (await contract.redactRecord(r.id)).wait(), `Record #${r.id} redacted`).then(refresh)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "access" && (
        <AccessPanel
          providers={providers}
          grants={grants}
          busy={busy}
          onGrant={(provider, days) =>
            run("grant", async () => grantAccess(contract, address, provider, days, (await getKeys(session)).secretKey), "Access granted and record keys shared").then(refresh)
          }
          onRevoke={(provider) => run("revoke", async () => (await contract.revokeAccess(provider)).wait(), "Access revoked").then(refresh)}
        />
      )}

      {tab === "activity" && (
        <section className="card">
          <h3>Audit log</h3>
          <p className="muted small">Every change to your records and permissions, reconstructed from contract events. Entries cannot be edited or removed.</p>
          {activity.length ? <Activity items={activity} providers={providers} patient={address} /> : <Empty title="No activity yet" />}
        </section>
      )}
    </div>
  );
}

function AccessPanel({
  providers,
  grants,
  busy,
  onGrant,
  onRevoke,
}: {
  providers: ProviderInfo[];
  grants: { address: string; expiry: number; active: boolean }[];
  busy: string | null;
  onGrant: (provider: string, days: number) => void;
  onRevoke: (provider: string) => void;
}) {
  const eligible = providers.filter((p) => p.active && p.hasKey);
  const [provider, setProvider] = useState("");
  const [days, setDays] = useState(30);
  const info = (a: string) => providers.find((p) => p.address.toLowerCase() === a.toLowerCase());

  return (
    <section className="grid-sidebar">
      <div className="card">
        <h3>Providers with access</h3>
        {grants.length === 0 ? (
          <Empty title="Nobody can read your records">Grant access to a verified provider to share your history with them.</Empty>
        ) : (
          <ul className="list">
            {grants.map((g) => {
              const p = info(g.address);
              return (
                <li key={g.address}>
                  <div>
                    <Address value={g.address} name={p?.name} />
                    <p className="muted small">{p?.organisation}</p>
                  </div>
                  <div className="row">
                    <span className={`pill ${g.active ? "pill-ok" : "pill-off"}`}>{g.active ? daysLeft(g.expiry) : "expired"}</span>
                    <button className="btn btn-danger btn-sm" disabled={busy === "revoke"} onClick={() => onRevoke(g.address)}>
                      Revoke
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <form
        className="card form"
        onSubmit={(e) => {
          e.preventDefault();
          if (provider) onGrant(provider, days);
        }}
      >
        <h3>Grant access</h3>
        <p className="muted small">
          Your browser unwraps each record key and re-encrypts it for the provider's public key. Access ends automatically when it expires.
        </p>
        <label>
          Verified provider
          <select required value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="">Select a provider</option>
            {eligible.map((p) => (
              <option key={p.address} value={p.address}>
                {p.name} · {p.organisation}
              </option>
            ))}
          </select>
        </label>
        <label>
          Duration
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[7, 30, 90, 365].map((d) => (
              <option key={d} value={d}>{d} days</option>
            ))}
          </select>
        </label>
        <button className="btn btn-primary" disabled={busy === "grant" || !provider}>
          {busy === "grant" ? "Sharing keys…" : "Grant access"}
        </button>
      </form>
    </section>
  );
}
