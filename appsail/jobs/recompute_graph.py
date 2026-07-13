"""
recompute_graph.py — Catalyst Job entry (nightly Cron): full graph/metric rebuild.

Catalyst invokes this in a Job context (15-min limit). It runs the whole pipeline and
writes the derived read-model. Idempotent — safe to re-run.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pipeline"))
import run_pipeline


def handler(job_request=None, context=None):
    data_dir = os.environ.get("DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "data", "output"))
    summary = run_pipeline.run(os.path.abspath(data_dir))
    print("[recompute_graph] done:", summary.get("counts"), "eval:", summary.get("eval"))
    return summary


if __name__ == "__main__":
    handler()
