/**
 * Standard MIDI File (SMF type 0/1) reader for import_midi_file: notes, controllers,
 * track names, the first tempo and time signature. Times come back in quarter notes
 * from the file start, so the bridge places them on the project grid. SMPTE time
 * division is refused (no quarter-note grid); sysex, pitch bend, aftertouch and
 * program changes are skipped.
 */

export interface SmfNote {
  /** Start, quarter notes from the file start */
  start: number;
  length: number;
  channel: number;
  pitch: number;
  velocity: number;
}

export interface SmfCc {
  time: number;
  channel: number;
  cc: number;
  value: number;
}

export interface SmfTrack {
  name: string;
  notes: SmfNote[];
  cc: SmfCc[];
}

export interface SmfFile {
  format: number;
  ppq: number;
  /** Tracks holding notes or controllers, in file order (conductor tracks dropped) */
  tracks: SmfTrack[];
  /** First tempo in the file (BPM), null when it has none */
  tempo: number | null;
  /** Number of tempo changes in the file */
  tempoChanges: number;
  timeSignature: [number, number] | null;
  /** Length in quarter notes: the end of the last note or event */
  lengthQN: number;
  /** Events the import does not carry, counted by kind (only kinds that occur) */
  skipped: Partial<Record<'sysex' | 'programChange' | 'channelPressure' | 'polyPressure' | 'pitchBend', number>>;
}

class Reader {
  pos = 0;
  constructor(private readonly buf: Uint8Array, private readonly end = buf.length) {}
  get done() { return this.pos >= this.end; }
  byte(): number {
    if (this.pos >= this.end) throw new Error('unexpected end of a track');
    return this.buf[this.pos++];
  }
  u16(): number { return (this.byte() << 8) | this.byte(); }
  u32(): number { return ((this.byte() << 24) >>> 0) + (this.byte() << 16) + (this.byte() << 8) + this.byte(); }
  varlen(): number {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.byte();
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
    throw new Error('malformed variable-length number');
  }
  bytes(n: number): Uint8Array {
    if (this.pos + n > this.end) throw new Error('unexpected end of a track');
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  ascii(n: number): string { return String.fromCharCode(...this.bytes(n)); }
}

/** A meta text: UTF-8 when it is valid UTF-8, else Latin-1 (older files); NUL padding dropped. */
function text(body: Uint8Array): string {
  let s: string;
  try {
    s = new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    s = String.fromCharCode(...body);
  }
  return s.replaceAll('\u0000', '').trim();
}

/** Parse an SMF; throws an Error that says what is wrong with the file. */
export function parseSmf(data: Uint8Array): SmfFile {
  const r = new Reader(data);
  if (data.length < 14 || r.ascii(4) !== 'MThd') throw new Error('not a MIDI file (no MThd header)');
  const headerLen = r.u32();
  const format = r.u16();
  const trackCount = r.u16();
  const division = r.u16();
  r.pos = 8 + headerLen;
  if (format > 2) throw new Error(`unsupported MIDI file format ${format}`);
  if (format === 2) throw new Error('MIDI file format 2 (independent patterns) is not supported');
  if (division & 0x8000) throw new Error('SMPTE time division is not supported (the file has no quarter-note grid)');
  const ppq = division;
  if (ppq === 0) throw new Error('the file has a time division of 0');

  const tracks: SmfTrack[] = [];
  let tempo: number | null = null;
  let tempoChanges = 0;
  let timeSignature: [number, number] | null = null;
  let endTicks = 0;

  const skipped: SmfFile['skipped'] = {};
  const skip = (kind: keyof SmfFile['skipped']) => { skipped[kind] = (skipped[kind] ?? 0) + 1; };
  for (let t = 0; t < trackCount && !r.done; t++) {
    const id = r.ascii(4);
    const len = r.u32();
    const start = r.pos;
    if (id !== 'MTrk') {
      r.pos = start + len; // unknown chunk
      t--;
      continue;
    }
    const tr = new Reader(data, Math.min(start + len, data.length));
    tr.pos = start;
    const track: SmfTrack = { name: '', notes: [], cc: [] };
    // Open notes per channel*128+pitch, oldest first (FIFO for overlapping same-pitch notes)
    const open = new Map<number, { tick: number; velocity: number }[]>();
    let tick = 0;
    let status = 0;
    const close = (key: number, at: number) => {
      const q = open.get(key);
      const on = q?.shift();
      if (!on) return;
      track.notes.push({
        start: on.tick / ppq,
        length: Math.max(at - on.tick, 1) / ppq,
        channel: key >> 7,
        pitch: key & 0x7f,
        velocity: on.velocity,
      });
    };
    while (!tr.done) {
      tick += tr.varlen();
      let b = tr.byte();
      if (b === 0xff) {
        const type = tr.byte();
        const body = tr.bytes(tr.varlen());
        if (type === 0x03 && !track.name) track.name = text(body);
        else if (type === 0x51 && body.length === 3) {
          tempoChanges++;
          if (tempo === null) tempo = Math.round(60_000_000 / ((body[0] << 16) | (body[1] << 8) | body[2]) * 1000) / 1000;
        } else if (type === 0x58 && body.length >= 2 && !timeSignature) timeSignature = [body[0], 2 ** body[1]];
        else if (type === 0x2f) break;
        continue;
      }
      if (b === 0xf0 || b === 0xf7) {
        tr.bytes(tr.varlen());
        skip('sysex');
        continue;
      }
      if (b & 0x80) status = b;
      else {
        if (!status) throw new Error('running status with no previous status byte');
        tr.pos--; // b was the first data byte
        b = status;
      }
      const kind = status & 0xf0;
      const channel = status & 0x0f;
      if (kind === 0xc0 || kind === 0xd0) {
        tr.byte();
        skip(kind === 0xc0 ? 'programChange' : 'channelPressure');
        continue;
      }
      const d1 = tr.byte() & 0x7f;
      const d2 = tr.byte() & 0x7f;
      if (kind === 0x90 && d2 > 0) {
        const key = (channel << 7) | d1;
        const q = open.get(key) ?? [];
        q.push({ tick, velocity: d2 });
        open.set(key, q);
      } else if (kind === 0x80 || kind === 0x90) {
        close((channel << 7) | d1, tick);
      } else if (kind === 0xb0) {
        track.cc.push({ time: tick / ppq, channel, cc: d1, value: d2 });
      } else {
        skip(kind === 0xe0 ? 'pitchBend' : 'polyPressure');
      }
    }
    // Notes never released end at the track's last event
    for (const key of open.keys()) while (open.get(key)?.length) close(key, Math.max(tick, (open.get(key)?.[0].tick ?? 0) + 1));
    endTicks = Math.max(endTicks, tick);
    for (const n of track.notes) endTicks = Math.max(endTicks, Math.round((n.start + n.length) * ppq));
    track.notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    if (track.notes.length || track.cc.length) tracks.push(track);
    r.pos = start + len;
  }

  return { format, ppq, tracks, tempo, tempoChanges, timeSignature, lengthQN: endTicks / ppq, skipped };
}
