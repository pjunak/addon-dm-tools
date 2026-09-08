/** Coalesce invalidations; a blocked view wakes this queue when interaction ends. */
export class LiveRefresh {
    ready;
    refresh;
    changed;
    #pending = false;
    #disposed = false;
    #timer;
    constructor(ready, refresh, changed = () => undefined) {
        this.ready = ready;
        this.refresh = refresh;
        this.changed = changed;
    }
    get pending() { return this.#pending; }
    invalidate() { if (this.#disposed)
        return; this.#pending = true; this.changed(); this.wake(); }
    wake() {
        if (this.#disposed || !this.#pending || this.#timer !== undefined)
            return;
        this.#timer = setTimeout(() => { this.#timer = undefined; if (!this.#disposed && this.#pending && this.ready())
            this.refresh(); }, 150);
    }
    consume() { this.#pending = false; clearTimeout(this.#timer); this.#timer = undefined; }
    dispose() { this.#disposed = true; this.consume(); }
}
