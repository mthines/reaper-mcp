import * as protocol from './index.js';

describe('protocol exports', () => {
  it('exports BridgeCommand type fields are accessible at compile time', () => {
    // This test validates that the re-exports work correctly.
    // If any export is missing from index.ts, this file won't compile.
    const commandTypes: protocol.CommandType[] = [
      'get_project_info',
      'list_tracks',
      'get_track_properties',
      'set_track_property',
      'add_fx',
      'remove_fx',
      'get_fx_parameters',
      'set_fx_parameter',
      'read_track_meters',
      'read_track_spectrum',
      'play',
      'stop',
      'record',
      'get_transport_state',
      'set_cursor_position',
    ];
    expect(commandTypes).toHaveLength(15);
  });

  it('exports response types', () => {
    // Compile-time check: if these types don't exist, TS will error
    const response: protocol.BridgeResponse = {
      id: 'test',
      success: true,
      timestamp: Date.now(),
    };
    expect(response.success).toBe(true);
  });

  it('exports ProjectInfo shape', () => {
    const info: protocol.ProjectInfo = {
      name: 'Test',
      path: '/tmp',
      trackCount: 0,
      tempo: 120,
      timeSignatureNumerator: 4,
      timeSignatureDenominator: 4,
      sampleRate: 44100,
      isPlaying: false,
      isRecording: false,
      cursorPosition: 0,
    };
    expect(info.name).toBe('Test');
  });

  it('exports TransportState shape', () => {
    const state: protocol.TransportState = {
      playing: false,
      recording: false,
      paused: false,
      cursorPosition: 0,
      playPosition: 0,
      tempo: 120,
      timeSignatureNumerator: 4,
      timeSignatureDenominator: 4,
    };
    expect(state.playing).toBe(false);
  });

  it('exports TrackMeters shape', () => {
    const meters: protocol.TrackMeters = {
      trackIndex: 0,
      peakL: -12,
      peakR: -12,
      rmsL: -18,
      rmsR: -18,
    };
    expect(meters.trackIndex).toBe(0);
  });

  it('exports TrackSpectrum shape', () => {
    const spectrum: protocol.TrackSpectrum = {
      trackIndex: 0,
      fftSize: 4096,
      sampleRate: 44100,
      binCount: 2048,
      frequencyResolution: 10.77,
      peakDb: -6,
      rmsDb: -12,
      bins: [],
    };
    expect(spectrum.binCount).toBe(2048);
  });
});
