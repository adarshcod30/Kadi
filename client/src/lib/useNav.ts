// useNav — react-router's useNavigate, with the reader's scope carried along.
//
// Scope lives in the URL (see districtParam in lib/api.ts): every request reads it from there,
// so it survives a reload and a shared link, and the server holds no session to keep it in.
// The cost of that design is that ANY navigation which drops the query string silently widens
// what the reader is looking at -- no error, no warning, just a state view appearing under a
// district officer's heading with the scope chip quietly flipping back to "All Karnataka".
//
// There are around sixty intra-app navigations. Appending the parameter at each one is the
// version of this fix that is wrong: it works until the sixty-first is written, and the two
// places that were missed on the first pass through this bug were missed for exactly that
// reason. So the rule lives here, once, and pages navigate as they always did.
//
// Three cases are deliberately left alone:
//   * non-string targets -- nav(-1) is a history step, not a path
//   * absolute or external URLs -- not ours to rewrite
//   * a target that already names a district -- an explicit scope change beats an implicit one,
//     which is what makes drilling from one district into another still work
import { useNavigate } from 'react-router-dom';
import { districtParam } from './api';

export function useNav() {
  const navigate = useNavigate();
  return (to: string | number, opts?: { replace?: boolean; state?: unknown }) => {
    if (typeof to !== 'string') return navigate(to as number);
    const d = districtParam();
    if (!d || !to.startsWith('/') || /[?&]district=/.test(to)) return navigate(to, opts);
    return navigate(`${to}${to.includes('?') ? '&' : '?'}district=${encodeURIComponent(d)}`, opts);
  };
}
