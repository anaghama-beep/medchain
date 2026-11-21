import { useCallback, useEffect, useState } from "react";
import { isAddress } from "ethers";
import type { Session } from "../lib/chain";
import { loadProviders, type ProviderInfo } from "../lib/records";
import { Address, Empty, Spinner, useAction, useToast } from "./ui";

export function AdminView({ session }: { session: Session }) {
  const { contract } = session;
  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [form, setForm] = useState({ address: "", name: "", organisation: "" });
  const [stats, setStats] = useState({ records: 0 });
  const { busy, run } = useAction();
  const toast = useToast();

  const refresh = useCallback(async () => {
    setProviders(await loadProviders(contract));
    setStats({ records: Number(await contract.recordCount()) });
  }, [contract]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="view">
      <div className="view-head">
        <div>
          <p className="eyebrow">Administrator</p>
          <h1>Provider registry</h1>
          <p className="muted">
            {providers?.length ?? "…"} providers · {stats.records} encrypted records on-chain. The admin can verify providers but cannot read any record.
          </p>
        </div>
      </div>
      <div className="grid-sidebar">
        <div className="card">
          <h3>Registered providers</h3>
          {!providers ? (
            <Spinner />
          ) : providers.length === 0 ? (
            <Empty title="No providers yet" />
          ) : (
            <ul className="list">
              {providers.map((p) => (
                <li key={p.address}>
                  <div>
                    <Address value={p.address} name={p.name} />
                    <p className="muted small">
                      {p.organisation} · {p.hasKey ? "encryption key published" : "no encryption key yet"}
                    </p>
                  </div>
                  <div className="row">
                    <span className={`pill ${p.active ? "pill-ok" : "pill-off"}`}>{p.active ? "Verified" : "Suspended"}</span>
                    <button
                      className={`btn btn-sm ${p.active ? "btn-danger" : "btn-ghost"}`}
                      disabled={busy === p.address}
                      onClick={() =>
                        run(p.address, async () => (await contract.setProviderActive(p.address, !p.active)).wait(), p.active ? "Provider suspended" : "Provider reinstated").then(refresh)
                      }
                    >
                      {p.active ? "Suspend" : "Reinstate"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <form
          className="card form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!isAddress(form.address)) return toast("error", "Enter a valid Ethereum address.");
            const ok = await run("register", async () => (await contract.registerProvider(form.address, form.name, form.organisation)).wait(), "Provider verified");
            if (ok) {
              setForm({ address: "", name: "", organisation: "" });
              refresh();
            }
          }}
        >
          <h3>Verify a provider</h3>
          <label>
            Wallet address
            <input required value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="0x…" />
          </label>
          <label>
            Name
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Dr. Jane Doe" />
          </label>
          <label>
            Organisation
            <input value={form.organisation} onChange={(e) => setForm({ ...form, organisation: e.target.value })} placeholder="Hospital or clinic" />
          </label>
          <button className="btn btn-primary" disabled={busy === "register"}>{busy === "register" ? "Saving…" : "Verify provider"}</button>
        </form>
      </div>
    </div>
  );
}
