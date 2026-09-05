interface Draft {
  readonly revision: number | undefined;
  readonly baseline: Record<string, string>;
  readonly values: Record<string, string>;
}

/** View-local edits keep the revision at which editing began, even after refresh. */
export class PlannerDrafts {
  readonly #changed: () => void;
  #drafts = new Map<string, Draft>();
  #forms = new WeakMap<HTMLFormElement, { key: string; revision: number | undefined }>();

  constructor(changed: () => void = () => undefined) { this.#changed = changed; }

  bind(form: HTMLFormElement, key: string, revision: number | undefined): void {
    const existing = this.#drafts.get(key);
    const baseline = existing?.baseline ?? valuesOf(form);
    const openingRevision = existing ? existing.revision : revision;
    if (existing) {
      for (const control of controlsOf(form)) {
        if (!Object.hasOwn(existing.values, control.name)) continue;
        const value = existing.values[control.name]!;
        // A removed destination must not silently turn into an empty/root choice.
        if (control.tagName === "SELECT" && !Array.from((control as HTMLSelectElement).options).some(option => option.value === value)) {
          const missing = form.ownerDocument.createElement("option"); missing.value = value; missing.textContent = `Unavailable: ${value}`; control.append(missing);
        }
        control.value = value;
      }
    }
    this.#forms.set(form, { key, revision: openingRevision });
    const capture = (): void => {
      const values = valuesOf(form);
      if (JSON.stringify(values) === JSON.stringify(baseline)) this.#drafts.delete(key);
      else this.#drafts.set(key, { revision: openingRevision, baseline, values });
      this.#changed();
    };
    form.addEventListener("input", capture);
    form.addEventListener("change", capture);
  }

  revision(form: HTMLFormElement): number | undefined { return this.#forms.get(form)?.revision; }
  has(key: string): boolean { return this.#drafts.has(key); }
  entries(): IterableIterator<[string, Draft]> { return this.#drafts.entries(); }
  clear(key: string): void { if (this.#drafts.delete(key)) this.#changed(); }
  clearAll(): void { this.#drafts.clear(); this.#changed(); }
}

function controlsOf(form: HTMLFormElement): (HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)[] {
  return Array.from(form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input[name],textarea[name],select[name]"));
}

function valuesOf(form: HTMLFormElement): Record<string, string> {
  return Object.fromEntries(controlsOf(form).map(control => [control.name, control.value]));
}
