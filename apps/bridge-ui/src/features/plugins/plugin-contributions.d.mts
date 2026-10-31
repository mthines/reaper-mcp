export interface ContributedRecord {
  key: string;
  tags: string[];
  value: string;
}

export const CONTRIBUTIONS_DIR: string;
export const MAX_VALUE_CHARS: number;
export const MAX_RECORDS: number;
export function formatContribution(records: ContributedRecord[]): string;
export function parseContribution(text: string): { records: ContributedRecord[]; errors: string[] };
