// Build the README npm shows from the repository README.
//
// The root README is written for GitHub: relative images and links, and a clone-based install.
// npm renders neither, so this swaps the install section for the npm one
// (apps/reaper-mcp-server/NPM_INSTALL.md) and makes every relative image and link absolute.

const INSTALL_HEADING = '## 🚀 Install in 3 steps';
const IMAGE = /\.(svg|png|gif|jpe?g|webp)(\?.*)?$/i;
const ABSOLUTE = /^([a-z][a-z0-9+.-]*:|\/\/|#)/i;

export function replaceInstallSection(readme, installSection) {
  const start = readme.indexOf(INSTALL_HEADING);
  if (start === -1) throw new Error(`README.md has no "${INSTALL_HEADING}" section to replace`);
  const next = readme.indexOf('\n## ', start + INSTALL_HEADING.length);
  if (next === -1) throw new Error('README.md has no section after the install section');
  return readme.slice(0, start) + installSection.trimEnd() + '\n' + readme.slice(next);
}

export function absoluteUrls(readme, { repo, ref }) {
  const target = (path) => {
    const clean = path.replace(/^\.?\//, '');
    return IMAGE.test(clean)
      ? `https://raw.githubusercontent.com/${repo}/${ref}/${clean}`
      : `https://github.com/${repo}/blob/${ref}/${clean}`;
  };
  const fix = (path) => (ABSOLUTE.test(path) ? path : target(path));

  let fenced = false;
  return readme
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) return line;
      return line
        .replace(/(\]\()([^)\s]+)/g, (_, open, path) => open + fix(path))
        .replace(/\b(src|srcset|href)="([^"]+)"/g, (_, attr, path) => `${attr}="${fix(path)}"`);
    })
    .join('\n');
}

export function buildNpmReadme(readme, installSection, options) {
  return absoluteUrls(replaceInstallSection(readme, installSection), options);
}
