import { useCallback, useEffect, useMemo, useState } from "react";
import { getKeys, publicKeyOf, type Session } from "../lib/chain";
import { addRecord, loadMyPatients, loadProviders, loadRecords, type LoadedRecord, type ProviderInfo } from "../lib/records";
import { RecordCard, supersededMap } from "./RecordCard";
import { RecordForm } from "./RecordForm";
import { Address, daysLeft, Empty, Spinner, useAction } from "./ui";

export function ProviderView({ session }: { session: Session }) {
  const { contract, address } = session;
  const [me, setMe] = useState<ProviderInfo | null>(null);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [patients, setPatients] = useState<{ address: string; expiry: number; name?: string }[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [records, setRecords] = useState<LoadedRecord[] | null>(null);
  const [form, setForm] = useState<null | { amending?: LoadedRecord }>(null);
  const { busy, run } = useAction();

  const refresh = useCallback(async () => {
    const provs = await loadProviders(contract);
    setProviders(provs);
    const mine = provs.find((p) => p.address.toLowerCase() === address.toLowerCase()) ?? null;
    setMe(mine);
    setHasKey(Boolean(mine?.hasKey));
    if (!mine?.hasKey) return;
    const keys = await getKeys(session);
    const list = await loadMyPatients(contract, address);
    // Patient names live only inside encrypted records, so they are decrypted here rather than stored on-chain.
    const named = await Promise.all(
      list.map(async (p) => {
        const recs = await loadRecords(contract, p.address, keys.secretKey);
        return { ...p, name: recs.find((r) => r.data?.patientName)?.data?.patientName };
      }),
    );
    setPatients(named);
  }, [contract, address, session]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const loadPatient = useCallback(
    async (p: string) => {
      setSelected(p);
      setRecords(null);
      setForm(null);
      setRecords(await loadRecords(contract, p, (await getKeys(session)).secretKey));
    },
    [contract, session],
  );

  const superseded = useMemo(() => supersededMap(records ?? []), [records]);
  const name = (a: string) => providers.find((p) => p.address.toLowerCase() === a.toLowerCase())?.name;
  const current = patients?.find((p) => p.address === selected);
  const profile = records?.find((r) => r.data)?.data;

  if (hasKey === false) {
    return (
      <div className="view narrow">
        <div className="card center">
          <p className="eyebrow">Provider setup</p>
          <h2>Set up your encryption key</h2>
          <p className="muted">
            Patients encrypt record keys to this public key when they grant you access. It is derived from a signature, so your wallet is the only secret you need.
          </p>
          <button
            className="btn btn-primary"
            disabled={busy === "key"}
            onClick={() => run("key", async () => (await contract.setEncryptionKey(await publicKeyOf(session))).wait(), "Encryption key published").then(refresh)}
          >
            {busy === "key" ? "Publishing…" : "Sign and publish key"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <p className="eyebrow">Provider</p>
          <h1>{me?.name ?? "Provider"}</h1>
          <p className="muted">{me?.organisation}</p>
        </div>
      </div>
      <div className="grid-patients">
        <aside className="card patients">
          <h3>My patients</h3>
          <p className="muted small">Patients who currently grant you access.</p>
          {!patients ? (
            <Spinner />
          ) : patients.length === 0 ? (
            <Empty title="No patients yet">Patients appear here once they grant you access.</Empty>
          ) : (
            <ul className="list selectable">
              {patients.map((p) => (
                <li key={p.address} className={p.address === selected ? "selected" : ""} onClick={() => loadPatient(p.address)}>
                  <div>
                    <Address value={p.address} name={p.name} />
                  </div>
                  <span className="pill pill-ok">{daysLeft(p.expiry)}</span>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <section>
          {!selected ? (
            <div className="card">
              <Empty title="Select a patient">Their records are decrypted locally in your browser.</Empty>
            </div>
          ) : (
            <>
              <div className="row between">
                <div>
                  <h2>{current?.name ?? "Patient"}</h2>
                  <p className="muted small">
                    {profile?.age ? `${profile.age} y · ` : ""}
                    {profile?.gender ? `${profile.gender} · ` : ""}
                    {profile?.bloodType ? `Blood type ${profile.bloodType} · ` : ""}
                    <code>{selected}</code>
                  </p>
                </div>
                {!form && <button className="btn btn-primary" onClick={() => setForm({})}>Add record</button>}
              </div>
              {form && (
                <RecordForm
                  busy={busy === "add"}
                  amending={form.amending?.id}
                  initial={
                    form.amending
                      ? { ...form.amending.data, category: form.amending.category }
                      : { patientName: profile?.patientName, age: profile?.age, gender: profile?.gender, bloodType: profile?.bloodType }
                  }
                  onCancel={() => setForm(null)}
                  onSubmit={async (category, data) => {
                    const ok = await run(
                      "add",
                      () => addRecord(contract, selected, category, data, address, form.amending?.id ?? 0),
                      "Record encrypted and saved on-chain",
                    );
                    if (ok) loadPatient(selected);
                  }}
                />
              )}
              {!records ? (
                <Spinner label="Decrypting records" />
              ) : (
                <div className="records">
                  {records
                    .filter((r) => !r.redacted)
                    .map((r) => (
                      <RecordCard
                        key={r.id}
                        record={r}
                        authorName={name(r.author)}
                        supersededBy={superseded.get(r.id)}
                        onAmend={r.author === address && r.data ? () => setForm({ amending: r }) : undefined}
                      />
                    ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
