import { useState, type ReactNode } from 'react';
import { Details, Mark, Notice, Offline, Toggle } from './App.js';
import { EditViewSection } from './EditViews.js';
import { MeasurementView } from './Measurement.js';
import { DRAWER_STORIES, EDIT_STORIES, GALLERY_NOW, MEASUREMENT_STORIES, SNAPSHOT_STORIES, type Story } from './gallery-stories.js';
import { SaveFormPreview, SnapshotsView } from './SnapshotsView.js';
import type { Session } from './status.js';

/**
 * The component gallery (`?gallery`, developer mode only): the page's real components rendered from fixed
 * example data, every state side by side. Add a story here (and its data in gallery-stories.ts) with every new
 * component or state.
 */

const SESSION: Session = { id: 'gallery', dir: '/Users/you/Music/midnight-drive', client: 'claude-code', first: GALLERY_NOW - 3_600_000, last: GALLERY_NOW, commands: 214, errors: 3, label: 'midnight-drive' };

const SECTIONS = [
  { id: 'measurements', label: 'Measurements' },
  { id: 'edits', label: 'Edit views' },
  { id: 'drawer', label: 'Details drawer' },
  { id: 'snapshots', label: 'Snapshots' },
  { id: 'notices', label: 'Notices' },
  { id: 'controls', label: 'Controls' },
  { id: 'brand', label: 'Logo & offline' },
];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="gallery-section" id={id} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title}</h2>
      <div className="gallery-grid">{children}</div>
    </section>
  );
}

function Card({ title, note, wide, children }: { title: string; note?: string; wide?: boolean; children: ReactNode }) {
  return (
    <figure className={`gallery-card ${wide ? 'gallery-card-wide' : ''}`}>
      <figcaption>
        <b>{title}</b>
        {note && <span>{note}</span>}
      </figcaption>
      <div className="gallery-stage">{children}</div>
    </figure>
  );
}

/** Picking a previous call in a story only logs it: the gallery has no log to move through */
const pick = (s: Story) => () => console.info('[gallery] open previous call of', s.title);

export function Gallery() {
  const [toggles, setToggles] = useState({ a: true, b: false });
  const [seg, setSeg] = useState('calls');

  return (
    <div className="gallery">
      <header className="gallery-head">
        <div>
          <h1>Component gallery</h1>
          <p className="sub">The bridge page’s components from fixed example data. Developer mode only.</p>
        </div>
        <a className="btn btn-sm" href={location.pathname}>
          Back to the bridge
        </a>
      </header>
      <nav className="gallery-nav" aria-label="Sections">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`}>
            {s.label}
          </a>
        ))}
      </nav>

      <Section id="measurements" title="Measurements">
        {MEASUREMENT_STORIES.map((s) => (
          <Card key={s.title} title={s.title} note={s.note}>
            <div className="gallery-measure mono-note">
              <code>{s.entry.c}</code>
            </div>
            <MeasurementView entry={s.entry} history={s.history} now={GALLERY_NOW} onPick={pick(s)} />
          </Card>
        ))}
      </Section>

      <Section id="edits" title="Edit views">
        {EDIT_STORIES.map((s) => (
          <Card key={s.title} title={s.title} note={s.note}>
            <div className="gallery-measure mono-note">
              <code>{s.entry.c}</code>
            </div>
            <EditViewSection entry={s.entry} />
          </Card>
        ))}
      </Section>

      <Section id="drawer" title="Details drawer">
        {DRAWER_STORIES.map((s) => (
          <Card key={s.title} title={s.title} note={s.note}>
            <div className="gallery-drawer">
              <Details
                entry={s.entry}
                session={SESSION}
                now={GALLERY_NOW}
                filtered={false}
                onFilter={() => console.info('[gallery] filter to', s.entry.c)}
                onAddTerm={(term) => console.info('[gallery] add filter term', term)}
                onClose={() => console.info('[gallery] close')}
                history={s.history}
                onPick={pick(s)}
              />
            </div>
          </Card>
        ))}
      </Section>

      <Section id="snapshots" title="Snapshots">
        {SNAPSHOT_STORIES.map((s) => (
          <Card key={s.title} title={s.title} note={s.note} wide={!s.narrow && !s.saveForm}>
            <div className={s.narrow ? 'gallery-narrow' : undefined}>
              {s.saveForm ? (
                <SaveFormPreview snapshots={s.feed?.snapshots ?? []} name={s.saveForm.name} confirm={s.saveForm.confirm} />
              ) : (
                <SnapshotsView
                  feed={s.feed}
                  request={s.request}
                  blocked={s.blocked}
                  now={GALLERY_NOW}
                  keys={false}
                  onSend={(op, name) => console.info('[gallery]', op, name)}
                />
              )}
            </div>
          </Card>
        ))}
      </Section>

      <Section id="notices" title="Notices">
        <Card title="Info" wide>
          <Notice tone="info" action={<button className="btn btn-sm">Rebuild &amp; reload</button>}>
            <b>Source changed since the last install.</b> Rebuild to try it.
          </Notice>
        </Card>
        <Card title="Warning" wide>
          <Notice tone="warn">
            <b>SWS isn’t installed.</b> Some envelope tools fall back to slower paths.
          </Notice>
        </Card>
        <Card title="Error" wide>
          <Notice tone="bad" action={<button className="btn btn-sm">Restart bridge</button>}>
            <b>The bridge script is outdated.</b> Setup installed a newer copy.
          </Notice>
        </Card>
      </Section>

      <Section id="controls" title="Controls">
        <Card title="Buttons">
          <div className="gallery-row">
            <button className="btn">Button</button>
            <button className="btn btn-sm">Small</button>
            <button className="btn btn-sm" disabled>
              Disabled
            </button>
            <button className="link-btn">Link button</button>
          </div>
        </Card>
        <Card title="Segmented">
          <div className="seg" role="tablist" aria-label="Example views">
            {['calls', 'tools', 'sessions'].map((v) => (
              <button key={v} role="tab" aria-selected={seg === v} onClick={() => setSeg(v)}>
                {v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </Card>
        <Card title="Chips & keys">
          <div className="gallery-row">
            <span className="chip">All agents</span>
            <span className="chip">
              midnight-drive <span className="count">479</span>
            </span>
            <kbd>↑</kbd>
            <kbd>↓</kbd>
            <kbd>Esc</kbd>
          </div>
        </Card>
        <Card title="Toggles" wide>
          <div className="gallery-stack">
            <Toggle label="Read-only" hint="Only reads, transport and navigation pass" on={toggles.a} onChange={(a) => setToggles((t) => ({ ...t, a }))} />
            <Toggle label="Open on start" hint="Open this page when the bridge starts" on={toggles.b} onChange={(b) => setToggles((t) => ({ ...t, b }))} />
            <Toggle label="Disabled" hint="Not available on this platform" on={false} disabled onChange={() => undefined} />
          </div>
        </Card>
      </Section>

      <Section id="brand" title="Logo & offline">
        <Card title="Logo · live" note="Click to blink and follow the cursor">
          <Mark active />
        </Card>
        <Card title="Logo · idle">
          <Mark active={false} />
        </Card>
        <Card title="Offline · REAPER up" wide>
          <Offline reachable />
        </Card>
        <Card title="Offline · unreachable" wide>
          <Offline reachable={false} />
        </Card>
      </Section>
    </div>
  );
}
