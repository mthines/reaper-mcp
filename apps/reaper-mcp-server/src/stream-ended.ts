/**
 * True once a stream has delivered its last byte (Ctrl+D at a terminal, `</dev/null`). A readline opened on such a
 * stream never fires `line` or `close`, so a prompt must not open one: it answers with its default instead.
 */
export function streamEnded(stream: NodeJS.ReadableStream): boolean {
  const s = stream as NodeJS.ReadableStream & { readableEnded?: boolean; destroyed?: boolean };
  return s.readableEnded === true || s.destroyed === true;
}
