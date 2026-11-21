import type { ActivityItem, ProviderInfo } from "../lib/records";
import { Address, formatDateTime } from "./ui";

export function Activity({ items, providers, patient }: { items: ActivityItem[]; providers: ProviderInfo[]; patient: string }) {
  const name = (a?: string) => providers.find((p) => p.address.toLowerCase() === a?.toLowerCase())?.name;
  const who = (a: string) => (a.toLowerCase() === patient.toLowerCase() ? "Patient" : name(a) ?? a);
  const text = (i: ActivityItem) => {
    switch (i.kind) {
      case "granted":
        return <>granted access to <Address value={i.provider!} name={name(i.provider)} /> until {formatDateTime(i.expiry!)}</>;
      case "revoked":
        return <>revoked access for <Address value={i.provider!} name={name(i.provider)} /></>;
      case "added":
        return <>added record #{i.recordId} ({i.category})</>;
      case "redacted":
        return <>redacted record #{i.recordId}</>;
    }
  };
  return (
    <ol className="timeline">
      {items.map((i) => (
        <li key={`${i.tx}-${i.kind}-${i.recordId ?? ""}`} className={`tl-${i.kind}`}>
          <span className="dot" />
          <div>
            <p>
              <strong>{who(i.actor)}</strong> {text(i)}
            </p>
            <p className="muted small">
              {formatDateTime(i.timestamp)} · block {i.block} · tx <code>{i.tx.slice(0, 10)}…</code>
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
