import { createContext, useContext } from 'react';
import type { BridgeControl } from '../../lib/status.js';
import type { BridgeAction } from '../../lib/update.js';

/** What the sidecar fix needs from the page: the bridge's control block and a way to send it a request. Absent outside the page. */
export interface SidecarInstall {
  control: BridgeControl | undefined;
  request: (action: BridgeAction) => void;
}

export const SidecarInstallContext = createContext<SidecarInstall | null>(null);

export const useSidecarInstall = () => useContext(SidecarInstallContext);
