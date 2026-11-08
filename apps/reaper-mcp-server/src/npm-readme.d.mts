export interface NpmReadmeOptions {
  repo: string;
  ref: string;
}
export function replaceInstallSection(readme: string, installSection: string): string;
export function absoluteUrls(readme: string, options: NpmReadmeOptions): string;
export function buildNpmReadme(readme: string, installSection: string, options: NpmReadmeOptions): string;
