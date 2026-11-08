// The orders a job needs: every order that CHANGED between the start of the
// requested range and the moment the job was created. A return or exchange today
// belongs to an older order, so the orders export and the events export both use
// this window; sharing the same upper bound keeps the two files describing the
// same set of orders even though they run minutes apart.
const parseParams = (text) => {
  try {
    return JSON.parse(text ?? "{}");
  } catch {
    return {};
  }
};

// { start, cutoff } as ISO strings; a comparison job (two periods) also has `periods`,
// the two periods' own { start, end }, so the export skips the gap between them.
export function jobWindow(job) {
  const params = parseParams(job.params);
  const start = params.range?.start;
  if (!start) throw new Error("The job has no date range recorded");
  const window = { start, cutoff: params.cutoff ?? new Date(job.createdAt).toISOString() };
  if (params.periods?.previous && params.periods?.current) window.periods = [params.periods.previous, params.periods.current].map(({ start: from, end }) => ({ start: from, end }));
  return window;
}
