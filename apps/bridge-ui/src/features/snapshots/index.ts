// The Snapshots tab: list, load, save, rename and delete mixer snapshots. Import from here, never the files.
import { EditForm } from './EditForm.js';
import { SaveForm, SaveFormPreview } from './SaveForm.js';
import { SnapshotsView } from './SnapshotsView.js';

/** The Snapshots tab; its forms are `Snapshots.SaveForm` (and `.SaveFormPreview`) and `Snapshots.EditForm` */
export const Snapshots = Object.assign(SnapshotsView, { SaveForm, SaveFormPreview, EditForm });

export { blockedBy, demoSnapshots, type RequestState, type RowMode, type SnapshotInfo, type SnapshotOp, type SnapshotsFeed } from './snapshots.js';
export { useSnapshots, type SnapshotsHook } from './useSnapshots.js';
