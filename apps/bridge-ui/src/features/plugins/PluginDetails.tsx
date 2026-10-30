import { useEffect, useState } from 'react';
import { Markdown } from '../../components/Markdown.js';
import { ResizeHandle, useDrawerWidth } from '../../components/ResizeHandle.js';
import { fxFormat, lorekitUrl, type KnowledgeFeed, type PluginRecord, type PluginRow } from './plugins.js';
import { COVERAGE_LABEL } from './PluginsView.js';
import { PublishRecord } from './PublishRecord.js';
import { ShareIcon, SparkIcon } from '../../components/icons.js';
import { learnPrompt } from './teach.js';
import { formatAgo } from '../../lib/format.js';

export const order = (r: PluginRow) => (r.coverage === 'learned' ? 0 : r.coverage === 'built-in' ? 1 : 2);

export function PluginDetails({
  row,
  now,
  onClose,
  onContribute,
  publish,
}: {
  row: PluginRow;
  now: number;
  onClose: () => void;
  onContribute: (record: PluginRecord) => void;
  publish?: KnowledgeFeed['publish'];
}) {
  const [copied, setCopied] = useState(false);
  const width = useDrawerWidth();
  const r: PluginRecord | undefined = row.record;

  useEffect(() => {
    // Capture phase on window, so the list's Esc (clear the filter) doesn't also run
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const learnCmd = learnPrompt(row);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(learnCmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard needs a secure context
    }
  };

  return (
    <aside className="drawer" aria-label={`Plugin ${row.label}`} style={width.style}>
      <ResizeHandle fraction={width.fraction} onCommit={width.setFraction} />
      <div className="drawer-head">
        <div className="drawer-title">
          <i className={`kdot cov-${row.coverage}`} />
          <span>{row.label}</span>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close" title="Close (Esc)">
          ✕
        </button>
      </div>
      <div className="drawer-body">
        <div className={`result-badge cov-badge-${row.coverage}`}>{COVERAGE_LABEL[row.coverage]}</div>
        {row.variants.length > 1 && (
          <p className="drawer-note" title={row.variants.map((v) => v.name).join('\n')}>
            Installed as {row.variants.map((v) => fxFormat(v.name) || v.type).join(', ')}, shown as one plugin.
          </p>
        )}
        {r ? (
          <>
            <dl className="facts">
              <dt>Category</dt>
              <dd>
                {r.category}
                {r.style && <span className="muted"> · {r.style}</span>}
              </dd>
              <dt>Preference</dt>
              <dd>{r.preference ?? '—'}/100</dd>
              <dt>Matches FX</dt>
              <dd className="mono">{r.matches.join(', ')}</dd>
              <dt>Record</dt>
              <dd className="mono">{r.key}</dd>
              <dt>Updated</dt>
              <dd>{formatAgo(now - r.updatedAt)}</dd>
            </dl>
            <div className="code-block kn-record">
              <div className="code-head">
                <span>{r.layer === 'user' ? 'Your notes' : 'What the mixer knows'}</span>
              </div>
              <Markdown className="kn-md" source={r.preview} />
            </div>
            {lorekitUrl(r) && (
              <a className="btn btn-block kn-open" href={lorekitUrl(r)} target="_blank" rel="noreferrer">
                Read the full record in LoreKit ↗
              </a>
            )}
            {r.layer === 'user' && r.source && publish && <PublishRecord key={r.key} record={r} shadows={row.shadows} publish={publish} />}
            {r.layer === 'user' && r.source && (
              <button className="btn btn-block kn-contribute" onClick={() => onContribute(r)} title="Opens a pull request on GitHub">
                <ShareIcon /> Contribute this record to everyone
              </button>
            )}
            {row.shadows && (
              <p className="drawer-note">
                Your record overrides the{' '}
                {lorekitUrl(row.shadows) ? (
                  <a href={lorekitUrl(row.shadows)} target="_blank" rel="noreferrer">
                    built-in one
                  </a>
                ) : (
                  'built-in one'
                )}{' '}
                (<span className="mono">{row.shadows.key}</span>).
              </p>
            )}
          </>
        ) : (
          <>
            <p className="drawer-note">
              The mixer has no record for this plugin, so it falls back to a stock plugin in the same category. Teach
              it once and it’ll use this one:
            </p>
            <div className="code-block">
              <div className="code-head">
                <span>Prompt</span>
              </div>
              <pre className="kn-prompt">{learnCmd}</pre>
            </div>
            <button className={`btn btn-block kn-teach-drawer ${copied ? 'kn-teach-done' : ''}`} onClick={copy}>
              {copied ? (
                'Copied'
              ) : (
                <>
                  <SparkIcon /> Teach · copy prompt
                </>
              )}
            </button>
            <p className="drawer-hint">Paste into Claude Code. It researches the plugin and probes it on a scratch track.</p>
          </>
        )}
      </div>
    </aside>
  );
}
