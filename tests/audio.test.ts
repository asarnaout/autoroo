import { describe, expect, it, vi } from 'vitest';
import { MUSIC_URLS } from '../app/game/assets';
import { AutorooAudio } from '../app/game/audio';

function fakeMusic(rejectPlay = false) {
  const music = {
    currentTime: 12,
    loop: false,
    paused: true,
    preload: '',
    volume: 1,
    play: vi.fn(() => {
      if (rejectPlay) return Promise.reject(new Error('autoplay blocked'));
      music.paused = false;
      return Promise.resolve();
    }),
    pause: vi.fn(() => {
      music.paused = true;
    }),
    removeAttribute: vi.fn(),
    load: vi.fn(),
  };
  return music;
}

describe('looping background music', () => {
  it('loops during play and follows restart, pause, and mute state', () => {
    const music = fakeMusic();
    const createMusic = vi.fn(() => music as unknown as HTMLAudioElement);
    const audio = new AutorooAudio(createMusic);

    audio.setGameplayActive(true, true);
    expect(createMusic).toHaveBeenCalledWith(MUSIC_URLS.peckhamMarketRoute);
    expect(music.loop).toBe(true);
    expect(music.preload).toBe('none');
    expect(music.volume).toBe(0.14);
    expect(music.currentTime).toBe(0);
    expect(music.play).toHaveBeenCalledTimes(1);

    audio.setGameplayActive(true);
    expect(music.play).toHaveBeenCalledTimes(1);
    audio.setGameplayActive(false);
    expect(music.pause).toHaveBeenCalledTimes(1);
    audio.setGameplayActive(true);
    expect(music.play).toHaveBeenCalledTimes(2);

    music.currentTime = 30;
    audio.setGameplayActive(true, true);
    expect(music.currentTime).toBe(0);
    expect(music.play).toHaveBeenCalledTimes(3);

    audio.setMuted(true);
    expect(music.pause).toHaveBeenCalledTimes(2);
    audio.setMuted(false);
    expect(music.play).toHaveBeenCalledTimes(4);

    audio.dispose();
    expect(music.pause).toHaveBeenCalledTimes(3);
    expect(music.removeAttribute).toHaveBeenCalledWith('src');
    expect(music.load).toHaveBeenCalledOnce();
  });

  it('swallows autoplay rejection and can retry on the next gesture', async () => {
    const music = fakeMusic(true);
    const audio = new AutorooAudio(() => music as unknown as HTMLAudioElement);

    audio.setGameplayActive(true);
    await Promise.resolve();
    expect(music.play).toHaveBeenCalledOnce();

    audio.setMuted(true);
    audio.setMuted(false);
    await Promise.resolve();
    expect(music.play).toHaveBeenCalledTimes(2);
  });
});
