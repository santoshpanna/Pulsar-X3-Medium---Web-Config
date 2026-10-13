export type Listener<T> = (state: T) => void;
export type Patch<T> = Partial<T> | ((state: T) => Partial<T>);

/** A minimal observable state container: shallow-merged patches, synchronous listeners. */
export class Store<T extends object> {
  private listeners = new Set<Listener<T>>();

  constructor(private state: T) {}

  get(): T {
    return this.state;
  }

  set(patch: Patch<T>): void {
    const p = typeof patch === 'function' ? patch(this.state) : patch;
    this.state = { ...this.state, ...p };
    for (const l of this.listeners) l(this.state);
  }

  subscribe(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
