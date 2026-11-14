import { Component, type ReactNode } from 'react';
import { Notice } from '../components/index.js';
import { trackPageError } from '../lib/analytics.js';

type Props = {
  /** Changes when the bridge does (live, stale, offline, reachable): a broken view is drawn again from scratch then. */
  resetKey: string;
  children: ReactNode;
};
type State = { failed: boolean; failedAt: string };

/** Keeps a render or commit error in the bridge view or offline screen from blanking the page, and redraws that part on the bridge's next change. */
export class BridgeBoundary extends Component<Props, State> {
  override state: State = { failed: false, failedAt: '' };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (!state.failed) return { failedAt: props.resetKey };
    return props.resetKey !== state.failedAt ? { failed: false, failedAt: props.resetKey } : null;
  }

  override componentDidCatch(error: unknown): void {
    trackPageError(error, 'boundary');
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <Notice
        tone="bad"
        action={
          <button type="button" className="btn btn-sm" onClick={() => location.reload()}>
            Reload
          </button>
        }
      >
        Part of this page broke. It is drawn again when the bridge changes state, or reload the page.
      </Notice>
    );
  }
}
