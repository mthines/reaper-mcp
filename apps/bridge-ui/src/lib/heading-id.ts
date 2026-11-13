/** The anchor id of a heading: lower case words joined with dashes (shared by the guide renderer and its page nav). */
export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_'’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}
