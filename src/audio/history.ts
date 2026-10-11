/** Simple undo/redo stack of immutable snapshots. */
export interface History<T> {
  states: T[];
  index: number;
}

export const MAX_HISTORY = 20;

export function createHistory<T>(initial: T): History<T> {
  return { states: [initial], index: 0 };
}

export function current<T>(h: History<T>): T {
  return h.states[h.index];
}

/** Add a new state, dropping any redo states and the oldest states past the limit. */
export function push<T>(h: History<T>, next: T, max = MAX_HISTORY): History<T> {
  const states = [...h.states.slice(0, h.index + 1), next];
  const overflow = Math.max(0, states.length - max);
  const trimmed = overflow > 0 ? states.slice(overflow) : states;
  return { states: trimmed, index: trimmed.length - 1 };
}

export function canUndo<T>(h: History<T>): boolean {
  return h.index > 0;
}

export function canRedo<T>(h: History<T>): boolean {
  return h.index < h.states.length - 1;
}

export function undo<T>(h: History<T>): History<T> {
  return canUndo(h) ? { ...h, index: h.index - 1 } : h;
}

export function redo<T>(h: History<T>): History<T> {
  return canRedo(h) ? { ...h, index: h.index + 1 } : h;
}
