import { useState, type FormEvent } from 'react';
import { DESCRIPTION_MAX, nameProblem, replacedBy, type SnapshotInfo } from './snapshots.js';

/** Rename a snapshot and change its description, in place of its row */
export function EditForm({
  snapshot,
  snapshots,
  onSave,
  onCancel,
}: {
  snapshot: SnapshotInfo;
  snapshots: SnapshotInfo[];
  onSave: (newName: string, description: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(snapshot.name);
  const [description, setDescription] = useState(snapshot.description);
  const problem = nameProblem(name);
  // Another snapshot already saves to that file (the bridge refuses it too); its own file is fine
  const taken = !problem ? replacedBy(snapshots.filter((s) => s.name !== snapshot.name), name) : null;
  const unchanged = name.trim() === snapshot.name && description.trim() === snapshot.description;

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (problem || taken) return;
    if (unchanged) return onCancel();
    onSave(name.trim(), description.trim());
  };

  return (
    <form
      className="snap-save snap-edit"
      onSubmit={submit}
      onKeyDown={(ev) => {
        if (ev.key === 'Escape') onCancel();
      }}
      aria-label={`Edit ${snapshot.name}`}
    >
      <input
        className="snap-input"
        value={name}
        onChange={(ev) => setName(ev.target.value)}
        aria-label="New name"
        aria-invalid={problem || taken ? true : undefined}
        spellCheck={false}
        autoFocus
      />
      <input
        className="snap-input snap-input-desc"
        value={description}
        onChange={(ev) => setDescription(ev.target.value)}
        placeholder="Description (optional)"
        aria-label="Description"
        maxLength={DESCRIPTION_MAX}
      />
      <button className="btn" type="submit" disabled={Boolean(problem || taken)}>
        Save
      </button>
      <button className="btn" type="button" onClick={onCancel}>
        Cancel
      </button>
      {(problem || taken) && (
        <span className="snap-hint snap-hint-bad" role="status">
          {problem ?? `“${taken?.name}” already uses that name.`}
        </span>
      )}
    </form>
  );
}
