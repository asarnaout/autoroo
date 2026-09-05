import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutorooAudio } from '../app/game/audio';
import { CRASH_DURATION_S, CRASH_LANDING_S } from '../app/game/crashAnimation';
import { playCartoonCrash } from '../app/game/crashSound';

function audioGraph() {
  const parameter = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
  });
  const node = (kind: string) => ({
    kind,
    gain: parameter(),
    frequency: parameter(),
    Q: parameter(),
    type: '',
    buffer: null as unknown,
    onended: null as (() => void) | null,
    connect: vi.fn((destination: unknown) => destination),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  });
  const nodes: ReturnType<typeof node>[] = [];
  const create = (kind: string) => {
    const result = node(kind);
    nodes.push(result);
    return result;
  };
  const context = {
    currentTime: 20,
    sampleRate: 48000,
    state: 'running',
    destination: node('destination'),
    createGain: () => create('gain'),
    createOscillator: () => create('oscillator'),
    createBiquadFilter: () => create('filter'),
    createBufferSource: () => create('noise'),
    createBuffer: vi.fn((_channels: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
    })),
    close: vi.fn(async () => undefined),
  };
  const sources = () =>
    nodes.filter((n) => n.kind === 'oscillator' || n.kind === 'noise');
  return { context, nodes, sources, api: context as unknown as AudioContext };
}

afterEach(() => vi.unstubAllGlobals());

describe('cartoon crash sound', () => {
  it('schedules the landing with the animation and ends every voice before the score panel', () => {
    const graph = audioGraph();
    playCartoonCrash(
      graph.api,
      graph.context.destination as unknown as AudioNode,
    );
    const sources = graph.sources();
    expect(sources.length).toBeLessThanOrEqual(8);
    expect(
      sources.some(
        (source) =>
          Math.abs(source.start.mock.calls[0][0] - 20 - CRASH_LANDING_S) < 1e-9,
      ),
    ).toBe(true);
    for (const source of sources) {
      const start = source.start.mock.calls[0][0];
      const stop = source.stop.mock.calls[0][0];
      expect(start).toBeGreaterThanOrEqual(20);
      expect(stop).toBeGreaterThan(start);
      expect(stop).toBeLessThan(20 + CRASH_DURATION_S);
      expect(source.type).not.toBe('sawtooth');
      source.onended?.();
      expect(source.disconnect).toHaveBeenCalledOnce();
    }
    for (const node of graph.nodes)
      expect(node.disconnect).toHaveBeenCalledOnce();
  });

  it('uses short mono noise and quiet envelopes with soft attacks', () => {
    const graph = audioGraph();
    playCartoonCrash(
      graph.api,
      graph.context.destination as unknown as AudioNode,
    );
    expect(graph.context.createBuffer).toHaveBeenCalledWith(1, 4800, 48000);
    let sumOfPeaks = 0;
    for (const gain of graph.nodes.filter((node) => node.kind === 'gain')) {
      const [initial, start] = gain.gain.setValueAtTime.mock.calls[0];
      const [peak, attackEnd] =
        gain.gain.exponentialRampToValueAtTime.mock.calls[0];
      expect(initial).toBeLessThan(0.001);
      expect(attackEnd - start).toBeGreaterThanOrEqual(0.004);
      expect(peak).toBeLessThanOrEqual(0.15);
      sumOfPeaks += peak;
    }
    // Even summing every peak (including voices that never overlap) leaves headroom.
    expect(sumOfPeaks * 0.4).toBeLessThan(0.25);
  });

  it('cancels scheduled tails on mute, early restart and disposal', async () => {
    const graph = audioGraph();
    vi.stubGlobal('window', {
      AudioContext: function () {
        return graph.context;
      },
    });
    const music = {
      currentTime: 0,
      paused: true,
      play: vi.fn(async () => undefined),
      pause: vi.fn(),
      removeAttribute: vi.fn(),
      load: vi.fn(),
    };
    const audio = new AutorooAudio(() => music as unknown as HTMLAudioElement);
    await audio.wake();
    audio.play({ type: 'crash' });
    const firstVoices = graph.sources().slice(1); // Exclude the persistent engine.
    audio.setMuted(true);
    for (const source of firstVoices) {
      expect(source.stop).toHaveBeenLastCalledWith(20);
      expect(source.disconnect).toHaveBeenCalledOnce();
    }
    const count = graph.sources().length;
    audio.play({ type: 'crash' });
    expect(graph.sources()).toHaveLength(count);
    audio.setMuted(false);
    audio.play({ type: 'crash' });
    const restartVoices = graph.sources().slice(count);
    audio.setGameplayActive(true, true);
    for (const source of restartVoices)
      expect(source.disconnect).toHaveBeenCalledOnce();
    audio.play({ type: 'crash' });
    audio.dispose();
    for (const source of graph.sources().slice(1))
      expect(source.disconnect).toHaveBeenCalledOnce();
    expect(graph.context.close).toHaveBeenCalledOnce();
  });
});
