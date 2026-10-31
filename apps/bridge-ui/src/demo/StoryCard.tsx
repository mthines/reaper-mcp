import type { ReactNode } from 'react';

/** A titled card for showing one state of a component among others in a story */
export function StoryCard({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <figure className="story-card">
      <figcaption>
        <b>{title}</b>
        {note && <span>{note}</span>}
      </figcaption>
      {children}
    </figure>
  );
}
