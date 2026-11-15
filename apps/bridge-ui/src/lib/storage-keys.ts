/**
 * The per-browser random id (never anything that identifies a person). Analytics sends it as `user.id`
 * and feature flags bucket experiments by it, so an exposure event joins the events of the same browser.
 */
export const INSTALL_ID_KEY = 'mcp_bridge.install_id';
