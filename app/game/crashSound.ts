import { CRASH_LANDING_S } from './crashAnimation';

/** Original cartoon foley: bonk, spring wobble, falling whistle, plop, squeak. */
export function playCartoonCrash(
  context: BaseAudioContext,
  destination: AudioNode,
): () => void {
  const now = context.currentTime;
  const voices = new Set<() => void>();
  const track = (source: AudioScheduledSourceNode, nodes: AudioNode[]) => {
    const disconnect = () => {
      source.onended = null;
      source.disconnect();
      for (const node of nodes) node.disconnect();
      voices.delete(cancel);
    };
    const cancel = () => {
      source.stop(context.currentTime);
      disconnect();
    };
    source.onended = disconnect;
    voices.add(cancel);
  };
  const tone = (
    delay: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    pitches: readonly (readonly [number, number])[],
    attack = 0.006,
  ) => {
    const start = now + delay;
    const source = context.createOscillator();
    const gain = context.createGain();
    source.type = type;
    source.frequency.setValueAtTime(pitches[0][1], start);
    for (const [offset, hz] of pitches.slice(1))
      source.frequency.exponentialRampToValueAtTime(hz, start + offset);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(gain).connect(destination);
    source.start(start);
    source.stop(start + duration + 0.02);
    track(source, [gain]);
  };

  tone(0, 0.16, 'sine', 0.13, [
    [0, 170],
    [0.16, 62],
  ]);
  tone(0.08, 0.54, 'triangle', 0.11, [
    [0, 210],
    [0.07, 620],
    [0.15, 250],
    [0.23, 490],
    [0.32, 230],
    [0.4, 340],
    [0.5, 180],
  ]);
  tone(
    0.34,
    0.55,
    'sine',
    0.055,
    [
      [0, 1050],
      [0.55, 240],
    ],
    0.025,
  );
  tone(CRASH_LANDING_S, 0.12, 'sine', 0.09, [
    [0, 185],
    [0.12, 72],
  ]);
  tone(CRASH_LANDING_S + 0.1, 0.12, 'triangle', 0.035, [
    [0, 430],
    [0.12, 280],
  ]);

  const duration = 0.1;
  const buffer = context.createBuffer(
    1,
    Math.ceil(context.sampleRate * duration),
    context.sampleRate,
  );
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i += 1)
    samples[i] = Math.random() * 2 - 1;
  const noise = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  noise.buffer = buffer;
  filter.type = 'lowpass';
  filter.frequency.value = 700;
  filter.Q.value = 0.6;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.1, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  noise.connect(filter).connect(gain).connect(destination);
  noise.start(now);
  noise.stop(now + duration + 0.02);
  track(noise, [filter, gain]);

  return () => {
    for (const cancel of voices) cancel();
  };
}
