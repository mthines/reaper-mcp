import type { ReactNode } from 'react';

export function Notice({ tone, action, children }: { tone: 'warn' | 'bad' | 'info'; action?: ReactNode; children: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role="status">
      <span className="notice-dot" aria-hidden />
      <span className="notice-text">{children}</span>
      {action}
    </div>
  );
}
