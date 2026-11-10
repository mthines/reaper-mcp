/**
 * -1, 0 or 1 for two `x.y.z` versions (a leading `v` and any `-pre` suffix are ignored).
 * The same comparison as the bridge page's `compareVersions` (apps/bridge-ui/src/lib/update.ts),
 * which an app cannot import from another app.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.replace(/^v/, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const [pa, pb] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}
