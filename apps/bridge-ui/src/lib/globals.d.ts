// Build-time constants: Vite's `define`, from buildConstants() in build-config.mjs, replaces them.
declare const __VERSION__: string;
declare const __DASH0_ENDPOINT__: string;
declare const __DASH0_TOKEN__: string;
declare const __DASH0_DATASET__: string;
declare const __LOREKIT_TOKEN__: string;
declare const __LOREKIT_API__: string;
// The hosted build (public demo + changelog): the demo is always on and releases come from a build-time snapshot
declare const __HOSTED__: boolean;
declare const __RELEASES_SNAPSHOT__: unknown[] | null;
declare const __HIGHLIGHTS_SNAPSHOT__: unknown | null;
// The hosted site's deployment environment and git context, for its telemetry (Vercel's env at build time)
declare const __SITE_ENV__: string;
declare const __SITE_VCS__: { providerName?: string; ownerName?: string; repositoryName?: string; repositoryUrlFull?: string; refHeadName?: string; refHeadRevision?: string; changeId?: string };
