"""
app.py — KADI analytics service on Catalyst AppSail (managed Python runtime).

WHY THIS IS STDLIB-ONLY
-----------------------
Deployed AppSail containers here start fine on the standard library but cannot import
anything from requirements.txt: a Flask/pandas build answers "Execution failed. Please
check the startup command or port." for every request and writes no logs at all, while a
stdlib-only build on the identical config serves immediately. Both were deployed to
confirm it, so this service takes no third-party dependency.

That costs little, because the analytics it hosts were already dependency-free —
socio.py and forecast.py import only math/collections/datetime. The one pandas use was
common.load_tables, replaced here by a csv reader exposing just the two behaviours those
modules rely on (itertuples, and set_index(...).to_dict()).

WHAT THIS DELIBERATELY DOES NOT HOST
------------------------------------
AppSail caps a request at 30 seconds; the Zoho team confirmed in the KSP Datathon
workshop that this matches Functions and cannot be raised. The full pipeline runs ~25s
and peaks near 740MB, so it would time out on a slower container and only in production.
It stays in a Catalyst Job (15-minute budget) on a nightly Cron.

Endpoints
    GET /                     service banner
    GET /health               liveness
    GET /status               what is loaded
    GET /analytics/socio      per-capita rates + socio-economic correlation
    GET /analytics/forecast   3-month district projections
"""
import csv
import json
import os
import sys
import time
from collections import namedtuple
from datetime import date
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "pipeline"))
import socio      # noqa: E402  (stdlib-only)
import forecast   # noqa: E402  (stdlib-only)

TODAY = date(2026, 7, 13)
DATA_DIR = os.environ.get("DATA_DIR") or os.path.join(os.path.dirname(__file__), "data")
PORT = int(os.environ.get("X_ZOHO_CATALYST_LISTEN_PORT") or os.environ.get("PORT") or 9000)


class Column(list):
    """Result of frame[col] — supports .to_dict() against the paired key column."""

    def __init__(self, values, keys):
        super().__init__(values)
        self._keys = keys

    def to_dict(self):
        return dict(zip(self._keys, self))


class Indexed:
    """Result of frame.set_index(col), so frame.set_index(a)[b].to_dict() works."""

    def __init__(self, rows, key):
        self._rows = rows
        self._key = key

    def __getitem__(self, col):
        return Column([r.get(col, "") for r in self._rows],
                      [r.get(self._key, "") for r in self._rows])


class Frame:
    """Minimal stand-in for the pandas surface socio/forecast actually use."""

    def __init__(self, rows):
        self._rows = rows
        self._Row = namedtuple("Row", [c.replace(" ", "_") for c in rows[0].keys()]) if rows else None

    def __len__(self):
        return len(self._rows)

    def itertuples(self, index=False):  # noqa: ARG002 - parity with the pandas signature
        if not self._rows:
            return iter(())
        R = self._Row
        return (R(**{k.replace(" ", "_"): v for k, v in r.items()}) for r in self._rows)

    def set_index(self, key):
        return Indexed(self._rows, key)


def load_tables(data_dir):
    tables = {}
    for name in ("CaseMaster", "Unit", "CrimeHead", "District", "CrimeSubHead", "CaseStatusMaster"):
        path = os.path.join(data_dir, name + ".csv")
        if os.path.exists(path):
            with open(path, newline="", encoding="utf-8") as f:
                tables[name] = Frame(list(csv.DictReader(f)))
    return tables


_CACHE = {"tables": None, "unit_district": None, "loadedMs": None}


def tables():
    if _CACHE["tables"] is None:
        t0 = time.time()
        t = load_tables(DATA_DIR)
        if "CaseMaster" not in t:
            raise RuntimeError("CaseMaster.csv not found under " + DATA_DIR)
        _CACHE["tables"] = t
        _CACHE["unit_district"] = (
            t["Unit"].set_index("UnitID")["DistrictID"].to_dict() if "Unit" in t else {}
        )
        _CACHE["loadedMs"] = round((time.time() - t0) * 1000)
        print("[appsail] loaded %d tables in %dms" % (len(t), _CACHE["loadedMs"]), flush=True)
    return _CACHE["tables"], _CACHE["unit_district"]


def route(path):
    if path in ("/", ""):
        return 200, {
            "service": "kadi-appsail",
            "description": "KADI sociological and predictive analytics (Catalyst AppSail)",
            "runtime": "python_3_11, standard library only",
            "endpoints": ["/health", "/status", "/analytics/socio", "/analytics/forecast"],
        }
    if path == "/health":
        return 200, {"status": "ok", "service": "kadi-appsail"}
    if path == "/status":
        t, ud = tables()
        return 200, {"status": "ok", "dataDir": DATA_DIR, "tables": sorted(t.keys()),
                     "cases": len(t["CaseMaster"]), "units": len(ud),
                     "loadedMs": _CACHE["loadedMs"]}
    if path == "/analytics/socio":
        t0 = time.time()
        t, ud = tables()
        out = socio.compute(t, ud)
        out["computedMs"] = round((time.time() - t0) * 1000)
        return 200, out
    if path == "/analytics/forecast":
        t0 = time.time()
        t, ud = tables()
        out = forecast.compute(t, ud, TODAY)
        out["computedMs"] = round((time.time() - t0) * 1000)
        return 200, out
    if path == "/run-pipeline":
        # An explicit refusal beats a route that silently times out at the 30s cap.
        return 410, {"error": "not_available_here",
                     "message": ("The full pipeline runs ~25s and peaks near 740MB; AppSail "
                                 "caps a request at 30s, so it runs as a Catalyst Job."),
                     "runsIn": "Catalyst Job 'refreshanalytics'"}
    return 404, {"error": "not_found", "path": path}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):  # noqa: N802
        path = self.path.split("?")[0].rstrip("/") or "/"
        try:
            status, payload = route(path)
        except Exception as e:  # noqa: BLE001
            import traceback
            traceback.print_exc()
            status, payload = 500, {"error": type(e).__name__, "message": str(e)}
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    do_POST = do_GET

    def log_message(self, fmt, *args):
        print("[appsail] " + (fmt % args), flush=True)


if __name__ == "__main__":
    print("[appsail] listening on %d (data: %s)" % (PORT, DATA_DIR), flush=True)
    HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
