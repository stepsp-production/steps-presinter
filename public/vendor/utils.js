// utils.js
export function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }
export function fmt(err) {
  if (!err) return 'unknown';
  if (typeof err === 'string') return err;
  if (err.message) return err.message;
  return String(err);
}
