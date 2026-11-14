import { Component, type ReactNode } from 'react';
import { Notice } from '../components/index.js';
import { trackPageError } from '../lib/analytics.js';

type Props = {
  /** Changes when the bridge does (live, stale, offline, reachable): a broken view is drawn again from scratch then. */
  resetKey: string;
  children: ReactNode;
};
type State = { failed: boolean; failedAt: string };

/**
 * Keeps an error in the bridge view or the offline screen from blanking the whole page. Without a boundary React 19
 * unmounts the page on an error during render or commit, e.g. the `NotFoundError` a browser translator causes when it
 * has rewritten the text nodes React swaps out as the bridge goes offline. The header and menus stay; the broken part
 * is replaced by a notice and drawn again on the bridge's next change, with fresh DOM nodes.
 */
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
