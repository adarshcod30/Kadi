"""
recompute_metrics.py — Catalyst Job / Signal entry: incremental metric refresh.

Triggered by a Signal / Event Function when a new FIR is inserted, or on a lighter Cron
than the full graph rebuild. For the hackathon build this delegates to the full pipeline
(fast enough at demo scale); production would update only the affected ego-graph +
metrics for the changed case.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pipeline"))
import run_pipeline


def handler(job_request=None, context=None):
    data_dir = os.environ.get("DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "data", "output"))
    summary = run_pipeline.run(os.path.abspath(data_dir))
    print("[recompute_metrics] refreshed:", summary.get("eval"))
    return summary


if __name__ == "__main__":
    handler()
