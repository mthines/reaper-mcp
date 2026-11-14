import { DocsPage, DocsPageRoute } from './DocsPage.js';
import { Gallery } from './Gallery.js';
import { GuideCommands } from './GuideCommands.js';
import { PromptBox } from './PromptBox.js';
import { VideoEmbed } from './VideoEmbed.js';
import { YourCall } from './YourCall.js';

/** The guides: `Docs.Page` draws one with its data in hand, `Docs.PageRoute` fetches it from the hosted site */
export const Docs = Object.assign(DocsPage, { Page: DocsPage, PageRoute: DocsPageRoute, Video: VideoEmbed, Prompt: PromptBox, YourCall, Gallery });

export { GuideCommands };
export { parseBridgeUrl, useRemoteGuideIndex } from './useDocs.js';
export { groupGuides, neighbours, pageHeadings, parseGuide, renderLlmsFull, renderLlmsTxt, sortGuides, SECTIONS } from './docs.js';
export type { Guide, GuideMeta, SectionKey } from './docs.js';
