import { Notice } from '../components/index.js';

/** REAPER quit: this window closes in a few seconds unless the viewer keeps it */
export function CloseNotice({ secondsLeft, onCancel }: { secondsLeft: number; onCancel: () => void }) {
  return (
    <Notice
      tone="warn"
      action={
        <button type="button" className="btn btn-sm" onClick={onCancel}>
          Keep open <span className="muted">(Enter)</span>
        </button>
      }
    >
      REAPER closed. This window closes in {secondsLeft} {secondsLeft === 1 ? 'second' : 'seconds'}.
    </Notice>
  );
}
