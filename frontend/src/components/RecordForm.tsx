import { useState, type FormEvent } from "react";
import { CATEGORIES, type RecordData } from "../lib/records";

interface Props {
  initial?: Partial<RecordData> & { category?: string };
  amending?: number;
  busy: boolean;
  onSubmit: (category: string, data: RecordData) => void;
  onCancel: () => void;
}

export function RecordForm({ initial = {}, amending, busy, onSubmit, onCancel }: Props) {
  const [category, setCategory] = useState(initial.category ?? "Consultation");
  const [f, setF] = useState<RecordData>({
    title: initial.title ?? "",
    patientName: initial.patientName ?? "",
    age: initial.age,
    gender: initial.gender ?? "",
    bloodType: initial.bloodType ?? "",
    allergies: initial.allergies ?? "",
    diagnosis: initial.diagnosis ?? "",
    treatment: initial.treatment ?? "",
    notes: initial.notes ?? "",
  });
  const set = (k: keyof RecordData) => (e: { target: { value: string } }) =>
    setF((prev) => ({ ...prev, [k]: k === "age" ? (e.target.value ? Number(e.target.value) : undefined) : e.target.value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== "" && v !== undefined)) as RecordData;
    onSubmit(category, clean);
  };

  return (
    <form className="card form" onSubmit={submit}>
      <div className="form-head">
        <h3>{amending ? `Amend record #${amending}` : "New record"}</h3>
        <p className="muted small">Encrypted in your browser before it is sent. Only the patient and providers they authorise can read it.</p>
      </div>
      <div className="grid-2">
        <label>
          Title
          <input required value={f.title} onChange={set("title")} placeholder="e.g. Annual check-up" />
        </label>
        <label>
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Patient name
          <input value={f.patientName} onChange={set("patientName")} />
        </label>
        <div className="grid-3">
          <label>
            Age
            <input type="number" min={0} max={130} value={f.age ?? ""} onChange={set("age")} />
          </label>
          <label>
            Gender
            <select value={f.gender} onChange={set("gender")}>
              <option value="">–</option>
              <option>Female</option>
              <option>Male</option>
              <option>Other</option>
            </select>
          </label>
          <label>
            Blood type
            <select value={f.bloodType} onChange={set("bloodType")}>
              <option value="">–</option>
              {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Allergies
          <input value={f.allergies} onChange={set("allergies")} />
        </label>
        <label>
          Diagnosis
          <input value={f.diagnosis} onChange={set("diagnosis")} />
        </label>
        <label className="span-2">
          Treatment
          <input value={f.treatment} onChange={set("treatment")} />
        </label>
        <label className="span-2">
          Notes
          <textarea rows={3} value={f.notes} onChange={set("notes")} />
        </label>
      </div>
      <div className="row end">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" disabled={busy}>{busy ? "Encrypting and saving…" : amending ? "Save amendment" : "Encrypt and save"}</button>
      </div>
    </form>
  );
}
