# JSFX performance checklist

The plugin runs in REAPER's audio thread, once per sample. Check every line of `@sample` against this.

1. **Coefficients live in `update()`**, called from `@init`, `@slider` and `@block`. Never `exp`, `sin`, `^`, `pow` or `/ srate` of something that only changes with a knob, inside `@sample`.
2. **Multiply by a reciprocal** you computed once, instead of dividing per sample.
3. **No loops, `memset`, `memcpy` or `strcpy` in `@sample`.** Clear buffers in `@init` or when a parameter changes. A short fixed unrolled sequence beats a loop (the reverb in `mutate-verb.jsfx` calls `comb(0..7)` one by one).
4. **Allocate once, in `@init`, sized for the worst case** (`srate` can be 192000): a delay of `N` seconds is `floor(srate * N)`. Nothing grows while running.
5. **Denormals.** A feedback path that decays to nothing can make the CPU crawl. Keep feedback gain below 1 (clamp it, `0.7 + x * 0.28`), and if a tail can reach silence, snap tiny values to 0 (`abs(y) < 0.0000000001 ? y = 0`).
6. **Skip work that is not needed.** A grain that is not playing costs one test; a section whose amount is 0 can return early.
7. **Oversampling is opt-in and advanced.** It multiplies the cost; offer it as a toggle, never on by default.
8. **Report latency.** A look-ahead needs `pdc_delay = samples;` and `pdc_bot_ch = 0; pdc_top_ch = 2;`.
9. **Smooth with one-pole filters per sample only where a click would be audible** (gain); everything else can change at block rate in `@block`.
10. **The UI is free.** `@gfx` runs on another thread and redraws only when something changed; do not put DSP in it. Share values with `@sample` only as scalars (a peak kept with `max()`).
11. **No scientific notation** (`1e-9`): EEL2 drops the whole plugin. Write `0.000000001`.
12. **Graphs (`ui_freqgraph` and friends): feed the UI cheaply.** `ui_gfeed` wants one FFT every 2048 samples at most (a ring buffer filled in `@sample`, the `fft` run in `@block`, never per sample); `ui_gr` / `ui_glevel` / `ui_kkey` are scalar writes. Use `ui_boot(2)` so silence stops redrawing. The graph widgets never allocate in `@gfx`.
