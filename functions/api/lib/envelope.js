// Consistent API response envelope: { ok:true, data } | { ok:false, error:{code,message} }
function ok(data, meta) {
  const body = { ok: true, data };
  if (meta) body.meta = meta;
  return body;
}
function err(code, message) {
  return { ok: false, error: { code, message } };
}
// Express helper that wraps an async handler and emits the envelope + status codes.
function handle(fn) {
  return async (req, res) => {
    try {
      const result = await fn(req, res);
      if (res.headersSent) return;
      res.json(ok(result));
    } catch (e) {
      const status = e.status || 500;
      const code = e.code || (status === 404 ? 'not_found' : status === 403 ? 'forbidden' : 'internal_error');
      if (status >= 500) console.error('[api error]', e);
      res.status(status).json(err(code, e.message || 'Unexpected error'));
    }
  };
}
class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const notFound = (m = 'Not found') => new ApiError(404, 'not_found', m);
const forbidden = (m = 'Forbidden') => new ApiError(403, 'forbidden', m);
const badRequest = (m = 'Bad request') => new ApiError(400, 'bad_request', m);

module.exports = { ok, err, handle, ApiError, notFound, forbidden, badRequest };
