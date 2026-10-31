/** A no-store GET's body, or null when REAPER's web interface didn't answer. */
export async function fetchText(url: string): Promise<string | null> {
  try {
    return await (await fetch(url, { cache: 'no-store' })).text();
  } catch {
    return null;
  }
}
