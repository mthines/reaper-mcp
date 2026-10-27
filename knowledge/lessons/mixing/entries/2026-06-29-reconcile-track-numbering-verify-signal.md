---
type: process-lesson
seen_count: 1
status: active
expires: 2026-09-27
trigger: [track-indexing, reaper-mcp, routing, metering, folder-bus, verify-target, trust-ears]
---
What happened: The user referred to the guitar bus as "59"; in the reaper-mcp
0-based index it was actually 58 (off by one — REAPER's UI numbers tracks 1-based,
but MCP `list_tracks`/`get_track_properties` are 0-based). Separately, I repeatedly
metered a FOLDER bus that read near-silent and concluded "the guitars aren't on this
bus," which was wrong — I was chasing a measurement artifact instead of the user's
plainly-heard reality.
Why: (1) The 1-based↔0-based mismatch sent me to the wrong track index. (2) Folder-
parent metering via an inserted meter JSFX is unreliable and reads low/silent even
when children carry audio; my short 5s measurement windows also kept landing where
the take wasn't playing. (3) I kept re-metering the same broken way instead of
questioning the method.
Do next time: When a user gives a track NUMBER, reconcile 1-based (REAPER UI) vs
0-based (MCP) and CONFIRM by NAME via `get_track_properties` before processing —
and verify the target actually carries signal. To check a bus, meter a CHILD track
(or trust the arrangement), not the folder parent's inserted meter JSFX. When meter
readings contradict what the user clearly hears, STOP re-metering the same way —
trust the ears and inspect routing + numbering instead of repeating the measurement.
Promotion target: mixer skill → Hard Rules
