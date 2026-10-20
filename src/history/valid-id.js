// Pure id check shared by the history store and the publish index writer (R4.4, R10.13).
export function validId(value) { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(value); }
