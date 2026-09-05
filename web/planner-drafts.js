/** View-local edits keep the revision at which editing began, even after refresh. */
export class PlannerDrafts {
    #drafts = new Map();
    #forms = new WeakMap();
    bind(form, key, revision) {
        const existing = this.#drafts.get(key);
        const baseline = existing?.baseline ?? valuesOf(form);
        const openingRevision = existing ? existing.revision : revision;
        if (existing) {
            for (const control of controlsOf(form)) {
                if (Object.hasOwn(existing.values, control.name))
                    control.value = existing.values[control.name];
            }
        }
        this.#forms.set(form, { key, revision: openingRevision });
        const capture = () => {
            const values = valuesOf(form);
            if (JSON.stringify(values) === JSON.stringify(baseline))
                this.#drafts.delete(key);
            else
                this.#drafts.set(key, { revision: openingRevision, baseline, values });
        };
        form.addEventListener("input", capture);
        form.addEventListener("change", capture);
    }
    revision(form) { return this.#forms.get(form)?.revision; }
    has(key) { return this.#drafts.has(key); }
    entries() { return this.#drafts.entries(); }
    clear(key) { this.#drafts.delete(key); }
    clearAll() { this.#drafts.clear(); }
}
function controlsOf(form) {
    return Array.from(form.querySelectorAll("input[name],textarea[name],select[name]"));
}
function valuesOf(form) {
    return Object.fromEntries(controlsOf(form).map(control => [control.name, control.value]));
}
