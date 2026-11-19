import { SidecarFix } from './SidecarFix.js';
import { SidecarToasts } from './SidecarToasts.js';
import { SidecarInstallContext } from './install-context.js';

/** Fixing a missing Python sidecar from the page: `Sidecar.Fix` (button, progress, command) and `Sidecar.Toasts` (the install in the background) and `Sidecar.Provider` (the page's wiring) */
export const Sidecar = { Fix: SidecarFix, Toasts: SidecarToasts, Provider: SidecarInstallContext.Provider };
