import { useState, type FormEvent } from 'react';
import { DESCRIPTION_MAX, nameProblem, replacedBy, type SnapshotInfo } from './snapshots.js';

export function SaveForm({
  snapshots,
  blocked,
  saving,
  onSave,
  initial,
}: {
  snapshots: SnapshotInfo[];
  blocked: string | null;
  saving: boolean;
  onSave: (name: string, description: string) => void;
  /** Gallery: start with these values */
  initial?: { name: string; description?: string; confirm?: boolean };
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [confirm, setConfirm] = useState(initial?.confirm ?? false);
  // A blank name saves under the date and time (the hook picks one no snapshot uses)
  const replaces = name.trim() ? replacedBy(snapshots, name) : null;
  const problem = name.trim() ? nameProblem(name) : null;

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (blocked || saving || problem) return;
    if (replaces && !confirm) {
      setConfirm(true);
      return;
    }
    onSave(name.trim(), description.trim());
    setName('');
    setDescription('');
    setConfirm(false);
  };

  return (
    <form className="snap-save" onSubmit={submit} aria-label="Save a snapshot">
      <input
        className="snap-input"
        value={name}
        onChange={(ev) => {
          setName(ev.target.value);
          setConfirm(false);
        }}
        placeholder="Name (blank: date and time)"
        aria-label="Snapshot name"
        aria-invalid={problem ? true : undefined}
        spellCheck={false}
        disabled={Boolean(blocked)}
      />
      <input
        className="snap-input snap-input-desc"
        value={description}
        onChange={(ev) => setDescription(ev.target.value)}
        placeholder="Description (optional)"
        aria-label="Snapshot description"
        maxLength={DESCRIPTION_MAX}
        disabled={Boolean(blocked)}
      />
      <button className={`btn${confirm ? ' btn-warn' : ''}`} type="submit" disabled={Boolean(blocked) || saving || Boolean(problem)}>
        {saving ? 'Saving…' : confirm ? `Replace ${replaces?.name ?? ''}` : 'Save current mix'}
      </button>
      {(problem || (replaces && !confirm)) && (
        <span className={`snap-hint${problem ? ' snap-hint-bad' : ''}`} role="status">
          {problem ?? `Saving replaces “${replaces?.name}”.`}
        </span>
      )}
    </form>
  );
}

/** Gallery: the save form with a name typed that would replace a snapshot */
export function SaveFormPreview(props: { snapshots: SnapshotInfo[]; name: string; confirm?: boolean }) {
  return <SaveForm snapshots={props.snapshots} blocked={null} saving={false} onSave={() => undefined} initial={{ name: props.name, confirm: props.confirm }} />;
}
