"use client";
// Background render queue for RipTag.
//
// Jobs live at module scope, not in component state, so switching projects (or
// unmounting the step-5 UI) never interrupts a running encode. The page
// subscribes to get progress for whichever project it is currently showing,
// plus a roll-up of everything else that is running or waiting.
//
// Only one job executes at a time. Two concurrent ffmpeg.wasm instances each
// want up to ~2 GB of wasm heap, which reliably OOMs on a real album render, so
// additional renders queue and start automatically as slots free up.
//
// Scope note: these jobs are page-lifetime. A reload or tab close kills the
// worker along with the page — callers should keep the "don't navigate away"
// warning visible while anything is active.

// Keyed by jobId, not projectId: a batch render puts many jobs on one project.
// jobId defaults to projectId, so a project's single "Render Video" job keeps
// the project id as its key and stays addressable by it.
const jobs = new Map(); // jobId -> job
const listeners = new Set();
let pumping = false;

const LOG_LIMIT = 300;

const publicView = (j) => ({
  jobId: j.jobId,
  projectId: j.projectId,
  projectName: j.projectName,
  label: j.label,
  batch: j.batch,
  status: j.status,
  progress: j.progress,
  logs: j.logs,
  error: j.error,
  result: j.result,
  queuedAt: j.queuedAt,
  startedAt: j.startedAt,
  endedAt: j.endedAt,
  queuePosition: j.status === "queued" ? queuedOrder().indexOf(j.jobId) + 1 : 0,
});

const queuedOrder = () =>
  [...jobs.values()].filter(j => j.status === "queued").sort((a, b) => a.queuedAt - b.queuedAt).map(j => j.jobId);

export function snapshot() {
  return [...jobs.values()]
    .sort((a, b) => b.queuedAt - a.queuedAt)
    .map(publicView);
}

function emit() {
  const snap = snapshot();
  listeners.forEach(fn => { try { fn(snap); } catch {} });
}

export function subscribe(fn) {
  listeners.add(fn);
  try { fn(snapshot()); } catch {}
  return () => listeners.delete(fn);
}

export function getJob(jobId) {
  const j = jobs.get(jobId);
  return j ? publicView(j) : null;
}

export const jobsForProject = (projectId) =>
  [...jobs.values()].filter(j => j.projectId === projectId).map(publicView);

export const activeJob = () => {
  const j = [...jobs.values()].find(x => x.status === "running");
  return j ? publicView(j) : null;
};

export const isBusy = () => [...jobs.values()].some(j => j.status === "running");
export const pendingCount = () => [...jobs.values()].filter(j => j.status === "running" || j.status === "queued").length;

/**
 * Queue a render. `run` receives a context and must resolve to the finished
 * Blob; it is invoked at most once, when a slot opens.
 *
 *   run({ onLog, onProgress, registerFfmpeg, isCancelled })
 *
 * `registerFfmpeg` hands the live FFmpeg instance to the queue so cancel() can
 * terminate its worker. `onDone(result)` is invoked on the *job*, not here —
 * callers read the result off the job snapshot or via the onSettled callback.
 */
export function enqueue({ jobId, projectId, projectName, label, batch = false, run, onSettled }) {
  const key = jobId || projectId;
  const existing = jobs.get(key);
  if (existing && (existing.status === "queued" || existing.status === "running")) {
    return publicView(existing);
  }
  const job = {
    jobId: key,
    projectId,
    projectName,
    label: label || projectName,
    batch,
    status: "queued",
    progress: null,
    logs: [],
    error: null,
    result: null,
    queuedAt: Date.now(),
    startedAt: null,
    endedAt: null,
    _run: run,
    _onSettled: onSettled,
    _ffmpeg: null,
    _cancelled: false,
  };
  jobs.set(key, job);
  emit();
  pump();
  return publicView(job);
}

export function rename(projectId, projectName) {
  let changed = false;
  for (const job of jobs.values()) {
    if (job.projectId !== projectId || job.projectName === projectName) continue;
    if (job.label === job.projectName) job.label = projectName;
    job.projectName = projectName;
    changed = true;
  }
  if (changed) emit();
}

export function cancel(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;
  if (job.status === "done" || job.status === "error" || job.status === "cancelled") return;
  job._cancelled = true;
  job.status = "cancelled";
  job.endedAt = Date.now();
  job.progress = null;
  job.logs = [...job.logs, "— Render cancelled —"].slice(-LOG_LIMIT);
  // Terminating the worker normally makes the in-flight exec() reject, which
  // unwinds the runner. But a job killed between exec calls (or before its
  // FFmpeg instance was registered) may never settle at all, so the runner also
  // races an abort signal — otherwise one cancel would wedge the queue forever.
  try { job._ffmpeg?.terminate(); } catch {}
  job._ffmpeg = null;
  job._abort?.();
  emit();
}

// Forget a finished job (clears it from the queue panel). No-op while active.
export function clear(jobId) {
  const job = jobs.get(jobId);
  if (!job || job.status === "running" || job.status === "queued") return;
  jobs.delete(jobId);
  emit();
}

// Cancels everything belonging to a project and forgets it — used when the
// project itself is deleted.
export function purgeProject(projectId) {
  for (const job of [...jobs.values()]) {
    if (job.projectId !== projectId) continue;
    if (job.status === "running" || job.status === "queued") cancel(job.jobId);
    jobs.delete(job.jobId);
  }
  emit();
}

export function clearFinished() {
  let changed = false;
  for (const [id, j] of jobs) {
    if (j.status !== "running" && j.status !== "queued") { jobs.delete(id); changed = true; }
  }
  if (changed) emit();
}

async function pump() {
  if (pumping) return;
  if (isBusy()) return;
  const nextId = queuedOrder()[0];
  if (!nextId) return;
  const job = jobs.get(nextId);
  if (!job) return;

  pumping = true;
  job.status = "running";
  job.startedAt = Date.now();
  job.progress = 0;
  emit();

  // Let the browser paint the "running" state before the encoder starts. pump()
  // is called synchronously from enqueue(), which is called from the click
  // handler, so without this yield the first expensive thing run() does happens
  // in the same task as the click and the progress bar only appears after it.
  await new Promise(resolve => setTimeout(resolve, 0));
  if (job._cancelled) {
    pumping = false;
    job._run = null;
    job.endedAt = job.endedAt || Date.now();
    emit();
    try { job._onSettled?.({ status: "cancelled" }, publicView(job)); } catch {}
    pump();
    return;
  }

  // Progress and log updates arrive far faster than the UI needs them; batch
  // them onto animation frames so a chatty ffmpeg log can't thrash React.
  let dirty = false;
  const flush = () => { if (dirty) { dirty = false; emit(); } };
  const timer = setInterval(flush, 150);

  const ctx = {
    onLog: (line) => {
      job.logs = job.logs.length >= LOG_LIMIT
        ? [...job.logs.slice(1), line]
        : [...job.logs, line];
      dirty = true;
    },
    onProgress: (p) => { job.progress = p; dirty = true; },
    registerFfmpeg: (ff) => { job._ffmpeg = ff; },
    isCancelled: () => job._cancelled,
  };

  // Resolved by cancel() so the slot frees immediately, even if the abandoned
  // run promise never settles.
  const CANCELLED = Symbol("cancelled");
  const aborted = new Promise(resolve => { job._abort = () => resolve(CANCELLED); });

  let settled;
  try {
    const runPromise = job._run(ctx);
    // The abandoned promise can still reject later; swallow it so it doesn't
    // surface as an unhandled rejection after the queue has moved on.
    runPromise.catch(() => {});
    const result = await Promise.race([runPromise, aborted]);
    if (job._cancelled || result === CANCELLED) {
      settled = { status: "cancelled" };
    } else {
      job.status = "done";
      job.progress = 1;
      job.result = result;
      settled = { status: "done", result };
    }
  } catch (err) {
    if (job._cancelled) {
      settled = { status: "cancelled" };
    } else {
      job.status = "error";
      job.progress = null;
      job.error = err?.oom
        ? { message: "__OOM__", oom: true, signal: err.signal, dimensions: err.dimensions }
        : { message: err?.message || String(err) };
      settled = { status: "error", error: job.error };
    }
  } finally {
    clearInterval(timer);
    job.endedAt = job.endedAt || Date.now();
    job._ffmpeg = null;
    job._run = null;
    job._abort = null;
    pumping = false;
    emit();
  }

  try { job._onSettled?.(settled, publicView(job)); } catch {}
  pump();
}
