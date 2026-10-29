/**
 * Undo/redo history over immutable states.
 * - commit(state, key): a new step; consecutive commits with the same key within `mergeMs`
 *   (e.g. sliding a slider) merge into one step.
 * - begin()/preview()/end(): an interactive gesture (drag, resize) that becomes a single step.
 */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private gestureStart: T | null = null;
  private lastKey: string | null = null;
  private lastTime = 0;

  constructor(
    private current: T,
    private readonly limit = 200,
    private readonly mergeMs = 800,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get present(): T {
    return this.current;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  commit(next: T, mergeKey?: string): void {
    if (next === this.current) return;
    const t = this.now();
    const merge = mergeKey !== undefined && mergeKey === this.lastKey && t - this.lastTime < this.mergeMs;
    if (!merge) this.pushPast(this.current);
    this.current = next;
    this.future = [];
    this.lastKey = mergeKey ?? null;
    this.lastTime = t;
  }

  begin(): void {
    this.gestureStart = this.current;
  }

  preview(next: T): void {
    this.current = next;
  }

  end(): void {
    if (this.gestureStart !== null && this.gestureStart !== this.current) {
      this.pushPast(this.gestureStart);
      this.future = [];
    }
    this.gestureStart = null;
    this.lastKey = null;
  }

  undo(): T {
    const prev = this.past.pop();
    if (prev !== undefined) {
      this.future.push(this.current);
      this.current = prev;
    }
    this.lastKey = null;
    return this.current;
  }

  redo(): T {
    const next = this.future.pop();
    if (next !== undefined) {
      this.past.push(this.current);
      this.current = next;
    }
    this.lastKey = null;
    return this.current;
  }

  /** Replaces everything (e.g. after loading a project). */
  reset(state: T): void {
    this.current = state;
    this.past = [];
    this.future = [];
    this.lastKey = null;
  }

  private pushPast(state: T): void {
    this.past.push(state);
    if (this.past.length > this.limit) this.past.shift();
  }
}
