#!/usr/bin/env python3
"""Programmatic path-filter check for the split deploy workflows.

Created from the OMC test-automator follow-up on PR #185 (R2). This test
asserts the structural contracts that the Issue #157 split relies on:

1. Each deploy workflow's ``on.push.paths`` includes the EXPECTED globs:
   - ``deploy-backend.yml``  -> ``backend/**`` and ``shared-types/**``
   - ``deploy-frontend.yml`` -> ``frontend/**`` and ``shared-types/**``

2. Each workflow's own file path is in its own ``on.push.paths`` trigger,
   so editing the workflow re-runs it (otherwise a workflow change can land
   on main without ever being executed).

3. Cross-contamination check: the backend workflow does NOT trigger on
   ``frontend/**`` and the frontend workflow does NOT trigger on
   ``backend/**``. This is the load-bearing invariant of the split.

The check is intentionally stricter than ``yaml.safe_load`` parse-success
(which we already do elsewhere). It also complements the existing parity
check in ``ci.yml``'s ``workflow-lint`` job, which validates the gated-job
``if:`` expression contract within each workflow.

Wired into CI from ``.github/workflows/ci.yml`` (``workflow-lint`` job).
Run locally with::

    python3 tests/workflows/test_deploy_path_filters.py
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Iterable

import yaml


REPO_ROOT = Path(__file__).resolve().parents[2]


# Expected (workflow_path -> {required_path_glob, ...}) contracts.
EXPECTED: dict[str, set[str]] = {
    ".github/workflows/deploy-backend.yml": {
        "backend/**",
        "shared-types/**",
        ".github/workflows/deploy-backend.yml",
    },
    ".github/workflows/deploy-frontend.yml": {
        "frontend/**",
        "shared-types/**",
        ".github/workflows/deploy-frontend.yml",
    },
}

# Cross-contamination forbidden globs: workflow_path -> globs that MUST
# NOT appear (so the path filters do not over-trigger).
FORBIDDEN: dict[str, set[str]] = {
    ".github/workflows/deploy-backend.yml": {"frontend/**"},
    ".github/workflows/deploy-frontend.yml": {"backend/**"},
}


def _load_paths(workflow_path: Path) -> list[str]:
    """Return the ``on.push.paths`` list from a workflow YAML.

    Handles a YAML quirk: the unquoted bareword ``on:`` parses as the boolean
    ``True`` under PyYAML (because YAML 1.1 treats ``on``/``off``/``yes``/``no``
    as booleans). We accept both the ``True`` key (real-world) and the string
    ``"on"`` key (in case someone quotes it for clarity).
    """
    with workflow_path.open() as f:
        wf = yaml.safe_load(f)

    on_block = wf.get(True, wf.get("on"))
    if on_block is None:
        raise AssertionError(
            f"{workflow_path}: missing 'on:' block (got top-level keys: {list(wf)})"
        )

    push = on_block.get("push") if isinstance(on_block, dict) else None
    if push is None:
        raise AssertionError(f"{workflow_path}: 'on.push' block missing")

    paths = push.get("paths")
    if not isinstance(paths, list):
        raise AssertionError(
            f"{workflow_path}: 'on.push.paths' missing or not a list (got {type(paths).__name__})"
        )

    return paths


def _check_required(workflow_path: str, paths: Iterable[str], required: set[str]) -> list[str]:
    failures: list[str] = []
    paths_set = set(paths)
    missing = required - paths_set
    if missing:
        failures.append(
            f"{workflow_path}: missing required path glob(s) in on.push.paths: "
            f"{sorted(missing)} (have: {sorted(paths_set)})"
        )
    return failures


def _check_forbidden(workflow_path: str, paths: Iterable[str], forbidden: set[str]) -> list[str]:
    failures: list[str] = []
    leak = forbidden & set(paths)
    if leak:
        failures.append(
            f"{workflow_path}: forbidden path glob(s) present in on.push.paths "
            f"(would over-trigger across the split): {sorted(leak)}"
        )
    return failures


def main() -> int:
    failures: list[str] = []

    for rel, required in EXPECTED.items():
        wf_path = REPO_ROOT / rel
        if not wf_path.exists():
            failures.append(f"{rel}: workflow file does not exist at {wf_path}")
            continue

        try:
            paths = _load_paths(wf_path)
        except AssertionError as exc:
            failures.append(str(exc))
            continue

        failures.extend(_check_required(rel, paths, required))
        failures.extend(_check_forbidden(rel, paths, FORBIDDEN.get(rel, set())))

        if not any(rel in f for f in failures):
            print(f"OK ({rel}): on.push.paths = {paths}")

    if failures:
        print("\nPath-filter contract violations:", file=sys.stderr)
        for f in failures:
            # GitHub Actions error annotation: surfaces in the run summary.
            print(f"::error::{f}", file=sys.stderr)
        return 1

    print("\nAll deploy workflow path-filter contracts satisfied.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
