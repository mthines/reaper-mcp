import { useState } from 'react';

export function useCopy(): [string | null, (text: string, what: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied((c) => (c === what ? null : c)), 2200);
    } catch {
      // clipboard needs a secure context (localhost is fine)
    }
  };
  return [copied, copy];
}
