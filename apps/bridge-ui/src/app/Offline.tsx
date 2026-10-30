import { Mark } from '../components/Mark.js';

export function Offline({ reachable }: { reachable: boolean }) {
  return (
    <section className="offline">
      <div className="offline-icon" aria-hidden>
        <Mark active={false} />
      </div>
      {reachable ? (
        <>
          <h2>The bridge isn’t running</h2>
          <p>REAPER is up, but <code>mcp_bridge.lua</code> hasn’t published a status yet.</p>
          <ol>
            <li>In REAPER: Actions → Show action list → Load ReaScript…</li>
            <li>Select <code>Scripts/mcp_bridge.lua</code> and run it</li>
            <li>This page connects on its own. No reload needed.</li>
          </ol>
        </>
      ) : (
        <>
          <h2>Can’t reach REAPER</h2>
          <p>Open REAPER and start the bridge. This page connects on its own.</p>
          <ol>
            <li>Open REAPER</li>
            <li>
              Run <code>mcp_bridge.lua</code> from the action list (first time: Actions → Show action list → Load
              ReaScript…)
            </li>
            <li>
              Still unreachable? Close REAPER and run <code>reaper-mcp setup</code>. It turns on REAPER’s web
              interface.
            </li>
          </ol>
        </>
      )}
    </section>
  );
}
