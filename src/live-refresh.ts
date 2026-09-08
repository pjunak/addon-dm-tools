/** Coalesce invalidations; a blocked view wakes this queue when interaction ends. */
export class LiveRefresh {
  #pending = false;
  #disposed = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  constructor(readonly ready: () => boolean, readonly refresh: () => void, readonly changed: () => void = () => undefined) {}
  get pending(): boolean { return this.#pending; }
  invalidate(): void { if (this.#disposed) return; this.#pending = true; this.changed(); this.wake(); }
  wake(): void {
    if (this.#disposed || !this.#pending || this.#timer !== undefined) return;
    this.#timer = setTimeout(() => { this.#timer = undefined; if (!this.#disposed && this.#pending && this.ready()) this.refresh(); }, 150);
  }
  consume(): void { this.#pending = false; clearTimeout(this.#timer); this.#timer = undefined; }
  dispose(): void { this.#disposed = true; this.consume(); }
}
