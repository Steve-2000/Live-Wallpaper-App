import { describe, expect, it } from 'vitest';
import { FrameLimiter } from '../src/runtime/loop';

/** Simulates a display refreshing at `hz` for `seconds` and counts rendered frames. */
function renderedFrames(fps: number, hz: number, seconds: number): number {
  const limiter = new FrameLimiter(fps);
  let frames = 0;
  const step = 1000 / hz;
  for (let t = 0; t <= seconds * 1000; t += step) {
    if (limiter.tick(t) !== null) frames++;
  }
  return frames;
}

describe('FrameLimiter', () => {
  it.each([15, 24, 30, 60])('caps a 60 Hz display at %i FPS', (fps) => {
    const frames = renderedFrames(fps, 60, 10);
    expect(frames).toBeGreaterThanOrEqual(fps * 10 - 2);
    expect(frames).toBeLessThanOrEqual(fps * 10 + 2);
  });

  it('caps a 144 Hz display at 30 FPS', () => {
    const frames = renderedFrames(30, 144, 10);
    expect(Math.abs(frames - 300)).toBeLessThanOrEqual(3);
  });

  it('limits the delta after a long pause', () => {
    const limiter = new FrameLimiter(30);
    limiter.tick(0);
    expect(limiter.tick(10_000)).toBe(250);
  });

  it('falls back to 30 FPS for invalid values', () => {
    expect(FrameLimiter.normalize(NaN)).toBe(30);
    expect(FrameLimiter.normalize(-5)).toBe(30);
    expect(FrameLimiter.normalize(1000)).toBe(240);
  });
});
