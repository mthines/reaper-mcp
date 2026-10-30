export interface ListedRecord {
  key: string;
  tags?: string[];
  value?: string;
}

export interface PluginRow {
  key: string;
  name: string;
  vendor: string;
  categories: string[];
  preference?: number;
}

export const LIST_START: string;
export const LIST_END: string;
export function pluginRow(record: ListedRecord): PluginRow | null;
export function renderPluginTable(records: ListedRecord[]): string;
export function updatePluginList(doc: string, records: ListedRecord[]): string;
