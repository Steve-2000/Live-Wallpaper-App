export const SUPPORTED_FPS = [15, 24, 30, 60] as const;

/**
 * Decides which animation frames to render so the preset runs at the
 * configured FPS cap regardless of the monitor refresh rate.
 */
export class FrameLimiter {
  private interval: number;
  private last = -Infinity;
  private due = -Infinity;

  constructor(fps: number) {
    this.interval = 1000 / FrameLimiter.normalize(fps);
  }

  static normalize(fps: number): number {
    if (!Number.isFinite(fps) || fps <= 0) return 30;
    return Math.min(240, Math.max(1, Math.round(fps)));
  }

  setFps(fps: number): void {
    this.interval = 1000 / FrameLimiter.normalize(fps);
  }

  /** Returns the elapsed milliseconds when a frame is due, otherwise null. */
  tick(now: number): number | null {
    if (this.last === -Infinity) {
      this.last = now;
      this.due = now + this.interval;
      return 0;
    }
    // 1 ms tolerance so 60 FPS on a 60 Hz display doesn't drop frames to RAF jitter.
    if (now + 1 < this.due) return null;
    const elapsed = now - this.last;
    this.last = now;
    // Advance on a fixed grid so the average rate matches the cap exactly;
    // resynchronise if we fell more than a frame behind.
    this.due += this.interval;
    if (this.due < now) this.due = now + this.interval;
    // A long pause (tab hidden, wallpaper paused) must not produce a huge jump.
    return Math.min(elapsed, 250);
  }

  reset(): void {
    this.last = -Infinity;
    this.due = -Infinity;
  }
}

export interface LoopCallbacks {
  frame(dtSeconds: number): void;
}

/** requestAnimationFrame loop that can be fully stopped (no wakeups while paused). */
export class RenderLoop {
  private handle = 0;
  private running = false;
  readonly limiter: FrameLimiter;

  constructor(fps: number, private readonly callbacks: LoopCallbacks) {
    this.limiter = new FrameLimiter(fps);
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.limiter.reset();
    const step = (now: number) => {
      if (!this.running) return;
      const ms = this.limiter.tick(now);
      if (ms !== null) this.callbacks.frame(ms / 1000);
      this.handle = requestAnimationFrame(step);
    };
    this.handle = requestAnimationFrame(step);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.handle);
  }
}
