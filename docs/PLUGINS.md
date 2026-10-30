# 🎛️ Built-in plugins

reaper-mcp works with **any** plugin REAPER can load (VST, VST3, AU, CLAP, JS). The plugins below
come with a built-in knowledge record: what the plugin is, what each control does, settings that
work and the gotchas. The mix skills read these records before they reach for a plugin, so they
use it well from the first session. No LoreKit account needed.

A plugin that isn't listed still works: the first time the mixer needs it, it researches the
plugin, tests it live and writes a record to your own LoreKit layer. When your record and a
built-in one disagree, yours wins.

**Preference** (0–100) is how readily the mixer picks the plugin for its category when you have
several installed. Your own records can set your own preference.

<!-- plugin-list:start -->
35 plugins.

| Category | Plugin | Vendor | Preference |
| --- | --- | --- | --- |
| amp-sim | Line 6 Helix Native | Line 6 | 82 |
| analyzer | JS Loudness Meter Peak/RMS/LUFS | Cockos | 70 |
| channel-strip | Howard Benson Vocals | Joey Sturgis Tones | 70 |
| composition | Scaler 3 | Scaler Music | 85 |
| compressor | FabFilter Pro-C 2 | FabFilter | 85 |
| compressor | JS 1175 Compressor | Cockos | 50 |
| compressor | ReaComp | Cockos | 35 |
| delay | ReaDelay | Cockos | 38 |
| drum-sampler | XO | XLN Audio | 80 |
| eq | FabFilter Pro-Q 4 | FabFilter | 95 |
| eq | FabFilter Pro-Q 3 | FabFilter | 90 |
| eq | ReaEQ | Cockos | 40 |
| gate | ReaGate | Cockos | 40 |
| instrument | Kontakt 8 | Native Instruments | 95 |
| instrument | Spitfire Audio LABS | Spitfire Audio | 70 |
| limiter | FabFilter Pro-L 2 | FabFilter | 92 |
| limiter, multiband | Ozone 9 | iZotope | 80 |
| limiter | Free Clip 2 | Venn Audio | 62 |
| limiter | Finality Lite | Joey Sturgis Tones | 58 |
| limiter | ReaLimit | Cockos | 38 |
| midi-utility | ReaControlMIDI | Cockos | 70 |
| multiband | FabFilter Pro-MB | FabFilter | 90 |
| pitch-correction | Melodyne | Celemony | 95 |
| pitch-correction | Little AlterBoy | Soundtoys | 80 |
| pitch-correction | Waves Tune Real-Time | Waves | 80 |
| restoration | Clear | Supertone | 80 |
| reverb, delay | ValhallaSupermassive | Valhalla DSP | 50 |
| reverb | ReaVerb | Cockos | 32 |
| saturator | JST Heat | Joey Sturgis Tones | 80 |
| saturator | Pixelator | Joey Sturgis Tones | 55 |
| stem-separator | Acon Digital Remix | Acon Digital | 80 |
| stereo-imager | Sidewidener II | Joey Sturgis Tones | 65 |
| synth | Vital | Vital Audio | 80 |
| synth | The Prince | Cradle | 65 |
| utility | Container | Cockos | 80 |
<!-- plugin-list:end -->

The table is generated from LoreKit's built-in layer by `node scripts/plugin-list.mjs`. Don't edit
it by hand: it is rewritten every time records are published.

## ➕ Add a plugin

Missing a plugin you use? Teach it once, then share it so every reaper-mcp user gets it.

1. **Teach it.** Run `/learn-plugin <plugin name>` in Claude Code (several at once work too:
   `/learn-plugin Pro-R 2, Saturn 2`). It researches the plugin on the web, loads it on a scratch
   track to check its controls, and asks you only what it couldn't work out. The record goes to
   your own LoreKit layer (`user::plugins::<vendor>/<plugin>`).
2. **Share it.** Open the bridge window's **Plugins** tab and press **Contribute**. GitHub opens a
   pull request with your records as one file in
   [`knowledge/contributions/`](../knowledge/contributions/README.md). A check comments what
   would be published.
3. **It's built in.** When the maintainer approves the PR, your records are published to the
   built-in layer and your plugins are added to this list automatically.

**Regular contributors** can publish straight to the built-in layer, without a pull request: ask on
[Discord](https://discord.gg/Eg8tznuXp4) or through the
[contributor request](../.github/ISSUE_TEMPLATE/contributor-request.yml) form. With a publish token
in the bridge window's Settings, your records get a **Publish to built-in** button; `/learn-plugin`
offers to publish too, and updates this list in your clone.

Keep personal details (names, file paths, client projects) out of records: they become visible to
every reaper-mcp user.
