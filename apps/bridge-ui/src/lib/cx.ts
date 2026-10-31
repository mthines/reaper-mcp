/** Joins class names, skipping the falsy ones: `cx(styles.row, selected && styles.rowSelected)`. */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}
