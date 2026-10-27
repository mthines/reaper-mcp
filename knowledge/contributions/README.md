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

A contribution PR may only add files here. The format (one or more records, each after a
`<!-- lorekit-record … -->` header with its `key` and `tags`) is defined and checked by
[`scripts/lib/plugin-contributions.mjs`](../../scripts/lib/plugin-contributions.mjs).
Keep personal details (names, file paths, client projects) out of records: they become
visible to every reaper-mcp user.
