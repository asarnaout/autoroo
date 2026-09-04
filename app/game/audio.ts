import { MUSIC_URLS } from './assets';
import { MAX_SPEED_MPS } from './constants';
import type { GameEvent } from './contracts';

export class AutorooAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineOscillator: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private music: HTMLAudioElement | null = null;
  private musicRequested = false;
  private muted = false;

  constructor(
    private readonly createMusicElement: (
      source: string,
    ) => HTMLAudioElement = (source) => new Audio(source),
  ) {}

  async wake(): Promise<void> {
    if (typeof window === 'undefined') return;
    if (!this.context) this.createGraph();
    if (this.musicRequested && !this.muted && this.music?.paused)
      this.tryPlayMusic();
    const contextResume =
      this.context?.state === 'suspended'
        ? this.context.resume()
        : Promise.resolve();
    await Promise.allSettled([contextResume]);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(
        muted ? 0 : 0.4,
        this.context.currentTime,
        0.025,
      );
    }
    if (muted) this.music?.pause();
    else if (this.musicRequested) this.tryPlayMusic();
  }

  setGameplayActive(active: boolean, restart = false): void {
    const changed = this.musicRequested !== active;
    this.musicRequested = active;
    if (!active) {
      if (changed) this.music?.pause();
      return;
    }
    if (!changed && !restart) return;
    const music = this.ensureMusic();
    if (restart) music.currentTime = 0;
    if (!this.muted) this.tryPlayMusic();
  }

  updateEngine(speedMps: number, running: boolean): void {
    if (!this.context || !this.engineOscillator || !this.engineGain) return;
    const now = this.context.currentTime;
    const speedAmount = Math.max(0, Math.min(1, speedMps / MAX_SPEED_MPS));
    this.engineOscillator.frequency.setTargetAtTime(
      42 + 58 * speedAmount ** 0.8,
      now,
      0.22,
    );
    this.engineFilter?.frequency.setTargetAtTime(
      180 + 180 * speedAmount,
      now,
      0.22,
    );
    this.engineGain.gain.setTargetAtTime(
      running ? 0.008 + speedAmount * 0.014 : 0,
      now,
      0.14,
    );
  }

  play(event: GameEvent): void {
    if (!this.context || !this.master || this.muted) return;
    switch (event.type) {
      case 'jump':
        this.chirp(170, 390, 0.18, 'square', 0.11);
        break;
      case 'lane-change':
        this.chirp(125, 205, 0.085, 'triangle', 0.045);
        this.chirp(225, 145, 0.075, 'sine', 0.03, 0.055);
        break;
      case 'horn':
        this.chirp(155, 132, 0.26, 'triangle', 0.05);
        break;
      case 'warning':
        this.chirp(420, 330, 0.13, 'triangle', 0.04);
        window.setTimeout(
          () => this.chirp(420, 330, 0.13, 'triangle', 0.04),
          180,
        );
        break;
      case 'crash':
        this.noiseBurst();
        this.chirp(120, 38, 0.48, 'sawtooth', 0.16);
        break;
      case 'bonus':
        this.chirp(430, 690, 0.12, 'sine', 0.065);
        break;
    }
  }

  dispose(): void {
    this.musicRequested = false;
    this.music?.pause();
    this.music?.removeAttribute('src');
    this.music?.load();
    this.music = null;
    this.engineOscillator?.stop();
    this.engineOscillator = null;
    void this.context?.close();
    this.context = null;
    this.master = null;
    this.engineFilter = null;
    this.engineGain = null;
  }

  private ensureMusic(): HTMLAudioElement {
    if (this.music) return this.music;
    const music = this.createMusicElement(MUSIC_URLS.peckhamMarketRoute);
    music.loop = true;
    music.preload = 'none';
    music.volume = 0.14;
    this.music = music;
    return music;
  }

  private tryPlayMusic(): void {
    if (!this.music || this.muted || !this.musicRequested) return;
    void this.music.play().catch(() => undefined);
  }

  private createGraph(): void {
    const AudioContextCtor = window.AudioContext;
    const context = new AudioContextCtor();
    const master = context.createGain();
    master.gain.value = this.muted ? 0 : 0.4;
    master.connect(context.destination);

    const oscillator = context.createOscillator();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.value = 42;
    filter.type = 'lowpass';
    filter.frequency.value = 180;
    filter.Q.value = 0.6;
    gain.gain.value = 0;
    oscillator.connect(filter).connect(gain).connect(master);
    oscillator.start();

    this.context = context;
    this.master = master;
    this.engineOscillator = oscillator;
    this.engineFilter = filter;
    this.engineGain = gain;
  }

  private chirp(
    fromHz: number,
    toHz: number,
    durationS: number,
    type: OscillatorType,
    volume: number,
    delayS = 0,
  ): void {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime + delayS;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(fromHz, now);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(1, toHz),
      now + durationS,
    );
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationS);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + durationS + 0.02);
  }

  private noiseBurst(): void {
    if (!this.context || !this.master) return;
    const durationS = 0.32;
    const buffer = this.context.createBuffer(
      1,
      Math.floor(this.context.sampleRate * durationS),
      this.context.sampleRate,
    );
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) {
      const envelope = 1 - index / samples.length;
      samples[index] = (Math.random() * 2 - 1) * envelope;
    }
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    filter.type = 'lowpass';
    filter.frequency.value = 680;
    gain.gain.value = 0.2;
    source.buffer = buffer;
    source.connect(filter).connect(gain).connect(this.master);
    source.start();
  }
}
