import { useState } from "react";
import type { LoadedRecord } from "../lib/records";
import { Address, formatDateTime } from "./ui";

interface Props {
  record: LoadedRecord;
  authorName?: string;
  supersededBy?: number;
  onRedact?: () => void;
  onAmend?: () => void;
}

const FIELDS: [keyof NonNullable<LoadedRecord["data"]>, string][] = [
  ["diagnosis", "Diagnosis"],
  ["treatment", "Treatment"],
  ["allergies", "Allergies"],
  ["notes", "Notes"],
];

export function RecordCard({ record, authorName, supersededBy, onRedact, onAmend }: Props) {
  const [raw, setRaw] = useState(false);
  const d = record.data;
  return (
    <article className={`record ${record.redacted ? "record-redacted" : ""}`}>
      <header className="record-head">
        <div>
          <div className="record-tags">
            <span className={`tag tag-${record.category.toLowerCase().replace(/\s+/g, "-")}`}>{record.category}</span>
            {record.supersedes ? <span className="tag tag-outline">Amends #{record.supersedes}</span> : null}
            {supersededBy ? <span className="tag tag-warn">Superseded by #{supersededBy}</span> : null}
            {record.redacted ? <span className="tag tag-warn">Redacted by patient</span> : null}
          </div>
          <h3>{d?.title ?? (record.locked ? "Encrypted record" : "Record")}</h3>
          <p className="muted small">
            #{record.id} · {formatDateTime(record.timestamp)} · added by{" "}
            {record.author === record.patient ? "the patient" : <Address value={record.author} name={authorName} />}
          </p>
        </div>
        <span className={`integrity ${record.verified ? "ok" : "bad"}`} title="keccak256(ciphertext) compared with the hash stored in the contract">
          {record.verified ? "Hash verified" : "Hash mismatch"}
        </span>
      </header>

      {d ? (
        <>
          {(d.patientName || d.age || d.gender || d.bloodType) && (
            <div className="vitals">
              {d.patientName && <span><b>Patient</b>{d.patientName}</span>}
              {d.age ? <span><b>Age</b>{d.age}</span> : null}
              {d.gender && <span><b>Gender</b>{d.gender}</span>}
              {d.bloodType && <span><b>Blood type</b>{d.bloodType}</span>}
            </div>
          )}
          <dl className="fields">
            {FIELDS.filter(([k]) => d[k]).map(([k, label]) => (
              <div key={k}>
                <dt>{label}</dt>
                <dd>{String(d[k])}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : record.locked ? (
        <p className="muted">You do not hold a key for this record. The patient has not shared it with you.</p>
      ) : (
        <p className="error-text">{record.error}</p>
      )}

      <footer className="record-foot">
        <button className="link" onClick={() => setRaw((v) => !v)}>
          {raw ? "Hide on-chain data" : "What the public sees"}
        </button>
        <div className="row">
          {onAmend && <button className="btn btn-ghost btn-sm" onClick={onAmend}>Amend</button>}
          {onRedact && !record.redacted && <button className="btn btn-ghost btn-sm" onClick={onRedact}>Redact</button>}
        </div>
      </footer>
      {raw && (
        <div className="raw">
          <p className="small muted">
            Anyone can read this from the blockchain. Without a wrapped key it is indistinguishable from random bytes.
          </p>
          <div><b>contentHash</b><code>{record.contentHash}</code></div>
          <div><b>ciphertext</b><code>{record.ciphertext.slice(0, 260)}{record.ciphertext.length > 260 ? "…" : ""}</code></div>
          <div><b>size</b><code>{(record.ciphertext.length - 2) / 2} bytes</code></div>
        </div>
      )}
    </article>
  );
}

export function supersededMap(records: LoadedRecord[]) {
  const m = new Map<number, number>();
  for (const r of records) if (r.supersedes) m.set(r.supersedes, r.id);
  return m;
}
