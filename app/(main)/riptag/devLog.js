"use client";
// Dev-only ring buffer of render-lifecycle events.
//
// The <DEV> panel reads this so "what did the Render button actually do" is
// answerable without the console open — and so the answer survives the page
// being scrolled, unlike a console line.
//
// Nothing here runs in a production build: push() is a no-op, and the only
// reader is DevPanel, which returns null outside development.

const IS_DEV = process.env.NODE_ENV !== "production";
const LIMIT = 120;

let entries = [];
let seq = 0;
const listeners = new Set();

const emit = () => { listeners.forEach(fn => { try { fn(entries); } catch {} }); };

/**
 * @param {"info"|"ok"|"warn"|"error"} level
 * @param {string} message
 * @param {*} [data] rendered as a compact JSON tail
 */
export function push(level, message, data) {
  if (!IS_DEV) return;
  entries = [...entries, { id: ++seq, at: Date.now(), level, message, data }].slice(-LIMIT);
  emit();
}

export function subscribe(fn) {
  listeners.add(fn);
  try { fn(entries); } catch {}
  return () => listeners.delete(fn);
}

export function clear() {
  entries = [];
  emit();
}

export function snapshot() { return entries; }
