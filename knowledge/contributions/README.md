# Plugin contributions

Pull requests that share plugin knowledge with everyone land here. The **Contribute** button
in the bridge page's Plugins tab opens one for you, with the plugins you taught the mixer
(your `user::plugins::…` LoreKit records) as one Markdown file in this folder.

What happens next:

1. The **Plugin contributions** workflow checks the file and comments on the PR with what
   would be published, either a new record or one that replaces a built-in record.
2. The maintainer reviews it and adds the `publish-to-lorekit` label.
3. The workflow writes the records into LoreKit's built-in layer (the `reaper-mcp` org) and
   closes the PR. The records live in LoreKit, so nothing is merged into this folder.
4. The **Plugin list** workflow then adds the plugins to the
   [built-in plugin list](../../docs/PLUGINS.md) (`docs/PLUGINS.md`, rebuilt from the built-in
   layer by `node scripts/plugin-list.mjs`). It also runs daily, which picks up records published
   straight from the bridge page.

If the records don't fit in GitHub's URL, the file opens with a paste prompt instead: your
records are on the clipboard, so paste over the prompt (⌘A, ⌘V) and propose the file.

**Maintainers** with write access can also commit a file straight to `main` here. Publish it
by running the workflow by hand: Actions → **Plugin contributions** → **Run workflow**
(`gh workflow run plugin-contributions.yml`). It publishes every file in this folder, then
deletes them in one commit, so git history keeps the originals. Tick `dry_run` to see what it
would publish without writing anything. One invalid file stops the run before any write; a
failed write keeps the files, so you can just run it again.

A contribution PR may only add files here. The format (one or more records, each after a
`<!-- lorekit-record … -->` header with its `key` and `tags`) is defined and checked by
[`apps/bridge-ui/src/features/plugins/plugin-contributions.mjs`](../../apps/bridge-ui/src/features/plugins/plugin-contributions.mjs).
Keep personal details (names, file paths, client projects) out of records: they become
visible to every reaper-mcp user.
