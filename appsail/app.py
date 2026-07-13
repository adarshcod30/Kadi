"""
app.py — KADI AppSail service (Catalyst managed Python runtime).

Hosts the heavy analytics compute that must NOT run in a 30s serverless Function:
entity resolution, graph build, community detection, risk/health/anomaly/spatial.
Exposed as internal endpoints, invoked by Catalyst Jobs (nightly Cron) or Signals
(incremental, on new-FIR insert). Reads source tables, writes the derived read-model
that the Node API serves from NoSQL/Cache.

Local run:  python appsail/app.py   (PORT env, default 9001)
"""
from __future__ import annotations

import os
import sys
import threading
import traceback
from datetime import datetime

from flask import Flask, jsonify, request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "pipeline"))
import run_pipeline  # noqa: E402

app = Flask(__name__)

DATA_DIR = os.environ.get("DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "data", "output"))
_state = {"running": False, "lastRun": None, "lastSummary": None, "error": None}


@app.get("/")
@app.get("/health")
def health():
    return jsonify({"ok": True, "service": "kadi-appsail", "running": _state["running"],
                    "lastRun": _state["lastRun"]})


@app.get("/status")
def status():
    return jsonify({"ok": True, **_state})


def _do_run(data_dir):
    _state.update(running=True, error=None)
    try:
        summary = run_pipeline.run(os.path.abspath(data_dir))
        _state.update(lastSummary=summary, lastRun=datetime.now().isoformat(timespec="seconds"))
    except Exception as e:  # surface failures for observability
        _state["error"] = f"{e}\n{traceback.format_exc()}"
    finally:
        _state["running"] = False


@app.post("/run-pipeline")
def run_pipeline_endpoint():
    """Trigger a full recompute. Async so the HTTP call returns immediately (the job
    itself runs to completion in the background; Catalyst Jobs allow up to 15 min)."""
    if _state["running"]:
        return jsonify({"ok": False, "error": "pipeline already running"}), 409
    data_dir = (request.json or {}).get("dataDir", DATA_DIR) if request.is_json else DATA_DIR
    if request.args.get("sync") == "1":
        _do_run(data_dir)
        return jsonify({"ok": _state["error"] is None, "summary": _state["lastSummary"], "error": _state["error"]})
    threading.Thread(target=_do_run, args=(data_dir,), daemon=True).start()
    return jsonify({"ok": True, "message": "pipeline started", "dataDir": data_dir})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", os.environ.get("X_ZOHO_CATALYST_LISTEN_PORT", 9001)))
    app.run(host="0.0.0.0", port=port)
