import { useState } from 'react';
import { DISCORD_URL, REPO_URL } from '../../lib/links.js';

const LOREKIT_KEYS_URL = 'https://www.lorekit.io/settings/api-keys';

/** The viewer's own read-only LoreKit token, so the Plugins tab includes their `user::` records. */
export function LoreKitSetting({ token, onChange }: { token: string | null; onChange: (token: string | null) => void }) {
  const [draft, setDraft] = useState('');
  const trimmed = draft.trim();
  const invalid = trimmed !== '' && !/^lk_ro_[A-Za-z0-9]+$/.test(trimmed);
  return (
    <div className="setting-group">
      <h3>Your plugin knowledge</h3>
      {token ? (
        <div className="lore-connected">
          <span>
            <i className="kdot cov-learned" /> LoreKit connected <span className="mono muted">{token.slice(0, 10)}…</span>
          </span>
          <button className="btn btn-sm" onClick={() => onChange(null)}>
            Disconnect
          </button>
        </div>
      ) : (
        <>
        <ol className="lore-steps">
          <li>
            <a className="btn btn-sm lore-open" href={LOREKIT_KEYS_URL} target="_blank" rel="noreferrer">
              Open LoreKit API keys ↗
            </a>
            <span>Sign in or create a free account</span>
          </li>
          <li>
            Create a key with <b>read-only</b> access and copy it (it starts with <span className="mono">lk_ro_</span>)
          </li>
          <li>Paste it here and connect</li>
        </ol>
        <form
          className="lore-form"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (trimmed && !invalid) {
              onChange(trimmed);
              setDraft('');
            }
          }}
        >
          <input
            className="lore-input mono"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="lk_ro_…"
            value={draft}
            onChange={(ev) => setDraft(ev.target.value)}
            aria-label="LoreKit read-only token"
            aria-invalid={invalid}
          />
          <button className="btn btn-sm" type="submit" disabled={!trimmed || invalid}>
            Connect
          </button>
        </form>
        </>
      )}
      <p className="setting-hint">
        {invalid
          ? 'That isn’t a read-only token. Use one that starts with lk_ro_ here; a write token only goes under Publish to built-in.'
          : token
            ? 'The Plugins tab includes the plugins you taught the mixer. The token stays in this browser and is only sent to LoreKit.'
            : 'The Plugins tab always shows the built-in records. Your token adds the plugins you taught the mixer; it stays in this browser and is only sent to LoreKit.'}
      </p>
    </div>
  );
}

/** A GitHub issue form asking to join the reaper-mcp LoreKit org (.github/ISSUE_TEMPLATE/contributor-request.yml). */
const CONTRIBUTOR_REQUEST_URL = `${REPO_URL}/issues/new?template=contributor-request.yml`;

export function PublishSetting({ token, readToken, onChange }: { token: string | null; readToken: string | null; onChange: (token: string | null) => void }) {
  const [draft, setDraft] = useState('');
  const trimmed = draft.trim();
  const invalid = trimmed !== '' && !/^lk_rw_[A-Za-z0-9]+$/.test(trimmed);
  return (
    <div className="setting-group">
      <h3>Publish to built-in</h3>
      {token ? (
        <div className="lore-connected">
          <span>
            <i className="kdot cov-built-in" /> Publishing enabled <span className="mono muted">{token.slice(0, 10)}…</span>
          </span>
          <button className="btn btn-sm" onClick={() => onChange(null)}>
            Remove
          </button>
        </div>
      ) : (
        <form
          className="lore-form"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (trimmed && !invalid) {
              onChange(trimmed);
              setDraft('');
            }
          }}
        >
          <input
            className="lore-input mono"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="lk_rw_…"
            value={draft}
            onChange={(ev) => setDraft(ev.target.value)}
            aria-label="LoreKit read + write token for publishing"
            aria-invalid={invalid}
          />
          <button className="btn btn-sm" type="submit" disabled={!trimmed || invalid}>
            Enable
          </button>
        </form>
      )}
      <p className="setting-hint">
        {invalid
          ? 'Publishing needs a read + write token, starting with lk_rw_.'
          : token
            ? readToken
              ? 'Your records get a Publish to built-in button. LoreKit only accepts it while you’re a member of the reaper-mcp org.'
              : 'Connect your read-only token above too, so your records (and their Publish button) show up.'
            : 'For members of the reaper-mcp LoreKit org: publish your records for everyone without a GitHub pull request. Create a read + write key limited to project::reaper-mcp and the reaper-mcp org. Everyone else uses Contribute.'}
      </p>
      {!token && (
        <p className="setting-hint">
          Not a member yet? Ask to become a contributor{' '}
          <a className="setting-link" href={DISCORD_URL} target="_blank" rel="noreferrer">
            on Discord ↗
          </a>{' '}
          or{' '}
          <a className="setting-link" href={CONTRIBUTOR_REQUEST_URL} target="_blank" rel="noreferrer">
            on GitHub ↗
          </a>
        </p>
      )}
    </div>
  );
}
