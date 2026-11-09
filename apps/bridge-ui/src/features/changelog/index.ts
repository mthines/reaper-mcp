import { ChangelogPanel } from './ChangelogPanel.js';
import { HighlightCard } from './HighlightCard.js';
import { ChangelogPage, ChangelogPageRoute } from './ChangelogPage.js';

/** What's new: the waiting update and the repo's releases; `Changelog.Highlight` is one hand-made entry */
export const Changelog = Object.assign(ChangelogPanel, { Highlight: HighlightCard, Page: ChangelogPage, PageRoute: ChangelogPageRoute });

export { availableUpdate, parseReleases, useReleases, type ChangelogRelease, type ReleasesState } from './changelog.js';
export { highlightsFor, parseHighlights, useHighlights, type Highlight } from './highlights.js';
