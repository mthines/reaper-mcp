// The shared UI: no bridge knowledge, used across the app and every feature. Import from here, never the files.
import { Combobox as ComboboxRoot, GroupedCombobox } from './Combobox.js';
import { ChevronIcon, CloseIcon, FocusIcon, GearIcon, GitHubIcon, SearchIcon, ShareIcon, SparkIcon, WholeIcon } from './icons.js';

/** A listbox picker; `Combobox.Grouped` lists actions and choices in headed groups */
export const Combobox = Object.assign(ComboboxRoot, { Grouped: GroupedCombobox });

/** The page's icons: `<Icon.Gear />` */
export const Icon = { GitHub: GitHubIcon, Gear: GearIcon, Close: CloseIcon, Search: SearchIcon, Spark: SparkIcon, Chevron: ChevronIcon, Share: ShareIcon, Focus: FocusIcon, Whole: WholeIcon };

export type { ComboboxOption } from './combobox-logic.js';
export type { GroupedComboboxItem } from './Combobox.js';
export { Mark } from './Mark.js';
export { Markdown } from './Markdown.js';
export { Notice } from './Notice.js';
export { ResizeHandle, useDrawerWidth } from './ResizeHandle.js';
export { Toggle } from './Toggle.js';
export { HoverTip } from './HoverTip.js';
