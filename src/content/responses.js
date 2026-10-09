export function storedResponses(run, viewportId) {
  const result = Object.create(null);
  for (const capture of run.captures.filter(item => item.viewportId === viewportId && item.state === 'captured')) {
    const target = run.settings.targets.find(item => item.id === capture.targetId);
    const path = target?.paths && Object.hasOwn(target.paths, run.side) ? target.paths[run.side] : target?.path;
    if (typeof path !== 'string' || !Number.isInteger(capture.statusCode) || capture.statusCode < 100 || capture.statusCode > 599) continue;
    if (Object.hasOwn(result, path) && result[path] !== capture.statusCode) result[path] = null;
    else if (!Object.hasOwn(result, path)) result[path] = capture.statusCode;
  }
  return result;
}
