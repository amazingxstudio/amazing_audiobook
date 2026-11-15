// An error that carries a translation key (so the message re-translates when the language is switched)
// plus optional technical detail (HTTP status, raw message) that is shown untranslated.
export class AppError extends Error {
  constructor(key, args = null, detail = '') {
    super(key);
    this.key = key;
    this.args = args;
    this.detail = detail;
  }
}
export class CancelError extends Error {
  constructor() { super('cancelled'); this.name = 'CancelError'; }
}
/** Wrap anything thrown into an AppError (unknown errors become err_unknown with the raw message as detail). */
export function toAppError(e) {
  if (e instanceof AppError) return e;
  if (e && e.name === 'QuotaExceededError') return new AppError('err_storage', null, e.message);
  return new AppError('err_unknown', null, String(e?.message || e));
}
