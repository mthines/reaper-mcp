// The command log: calls, tools, agents and the drawer for one call. Import from here, never the files.
import { Details } from './Details.js';
import { Log as LogView } from './Log.js';
import { LogRows } from './LogRows.js';
import { SessionsView } from './SessionsView.js';
import { ToolsView } from './ToolsView.js';

/** The log panel; its parts are `Log.Rows`, `Log.Details`, `Log.Tools` and `Log.Sessions` */
export const Log = Object.assign(LogView, { Rows: LogRows, Details, Tools: ToolsView, Sessions: SessionsView });

export { VIEW_KEY, isSpanOrNull, isView, loadView, type View } from './Log.js';
