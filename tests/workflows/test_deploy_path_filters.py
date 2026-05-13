#!/usr/bin/env python3
"""Programmatic path-filter check for the split deploy workflows.

Created from the OMC test-automator follow-up on PR #185 (R2). This test
asserts the structural contracts that the Issue #157 split relies on:

1. Each deploy workflow's ``on.push.paths`` includes its own file path (so
   edits to the workflow re-run it on merge).

2. Each deploy workflow triggers on ``shared-types/**`` (both halves depend
   on the shared-types package).

3. The ``deploy-backend.yml`` workflow triggers on ``backend/**`` and does NOT
   trigger on ``frontend/**`` (no over-triggering across the split).

4. The ``deploy-frontend.yml`` workflow triggers on ``frontend/**`` and does NOT
   trigger on ``backend/**`` (symmetric over-triggering guard).

Issue #186: auto-discover deploy-*.yml instead of a hardcoded EXPECTED/FORBIDDEN
dict. Adding a new deploy-*.yml automatically participates in checks 1 and 2.
Checks 3 and 4 are still explicit because the cross-contamination rules are
specific to the backend/frontend naming convention; a future ``deploy-docs.yml``
should not be required to exclude ``backend/**``.

The check is intentionally stricter than ``yaml.safe_load`` parse-success
(which we already do elsewhere). It also complements the existing parity
check in ``.github/workflows/ci.yml``'s ``workflow-lint`` job, which validates
the gated-job ``if:`` expression contract within each workflow.

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
WF_DIR = REPO_ROOT / '.github' / 'workflows'

# Explicit cross-contamination rules for the backend/frontend split.
# workflow_path (relative) -> globs that MUST NOT appear in on.push.paths.
# Issue #186: only the backend/frontend split workflows need these guards.
# A future deploy-docs.yml etc. does not automatically get a forbidden list.
FORBIDDEN: dict[str, set[str]] = {
    '.github/workflows/deploy-backend.yml': {'frontend/**'},
    '.github/workflows/deploy-frontend.yml': {'backend/**'},
}

# Explicit required-glob rules for the backend/frontend split.
# These supplement the universal rules (own-path + shared-types).
REQUIRED_EXTRA: dict[str, set[str]] = {
    '.github/workflows/deploy-backend.yml': {'backend/**'},
    '.github/workflows/deploy-frontend.yml': {'frontend/**'},
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

    on_block = wf.get(True, wf.get('on'))
    if on_block is None:
        raise AssertionError(
            f'{workflow_path}: missing \'on:\' block (got top-level keys: {list(wf)})'
        )

    push = on_block.get('push') if isinstance(on_block, dict) else None
    if push is None:
        # Workflow has no on.push trigger — skip path-filter checks.
        return []

    paths = push.get('paths')
    if paths is None:
        # No path filter at all — technically valid but unusual for deploy workflows.
        return []

    if not isinstance(paths, list):
        raise AssertionError(
            f'{workflow_path}: \'on.push.paths\' not a list (got {type(paths).__name__})'
        )

    return paths


def _check_required(workflow_path: str, paths: Iterable[str], required: set[str]) -> list[str]:
    failures: list[str] = []
    paths_set = set(paths)
    missing = required - paths_set
    if missing:
        failures.append(
            f'{workflow_path}: missing required path glob(s) in on.push.paths: '
            f'{sorted(missing)} (have: {sorted(paths_set)})'
        )
    return failures


def _check_forbidden(workflow_path: str, paths: Iterable[str], forbidden: set[str]) -> list[str]:
    failures: list[str] = []
    leak = forbidden & set(paths)
    if leak:
        failures.append(
            f'{workflow_path}: forbidden path glob(s) present in on.push.paths '
            f'(would over-trigger across the split): {sorted(leak)}'
        )
    return failures


def main() -> int:
    failures: list[str] = []

    # Issue #186: auto-discover all deploy-*.yml files.
    deploy_files = sorted(WF_DIR.glob('deploy-*.yml'))

    if not deploy_files:
        failures.append(f'No deploy-*.yml files found in {WF_DIR}')
        print('\nPath-filter contract violations:', file=sys.stderr)
        for f in failures:
            print(f'::error::{f}', file=sys.stderr)
        return 1

    for wf_path in deploy_files:
        rel = str(wf_path.relative_to(REPO_ROOT))

        try:
            paths = _load_paths(wf_path)
        except AssertionError as exc:
            failures.append(str(exc))
            continue

        if not paths:
            # No on.push.paths — print info but don't fail (staging/prod jobs may
            # only respond to workflow_dispatch and have no push trigger).
            print(f'SKIP ({rel}): no on.push.paths found (workflow_dispatch only?)')
            continue

        # Universal rules: every deploy workflow must self-include and include shared-types.
        universal_required = {
            rel,               # own path so edits re-run the workflow
            'shared-types/**', # both halves depend on shared-types
        }
        failures.extend(_check_required(rel, paths, universal_required))

        # Workflow-specific extra required globs (backend/** / frontend/**).
        extra = REQUIRED_EXTRA.get(rel, set())
        if extra:
            failures.extend(_check_required(rel, paths, extra))

        # Cross-contamination guard (only for the backend/frontend split).
        forbidden = FORBIDDEN.get(rel, set())
        if forbidden:
            failures.extend(_check_forbidden(rel, paths, forbidden))

        if not any(rel in f for f in failures):
            print(f'OK ({rel}): on.push.paths = {paths}')

    if failures:
        print('\nPath-filter contract violations:', file=sys.stderr)
        for f in failures:
            # GitHub Actions error annotation: surfaces in the run summary.
            print(f'::error::{f}', file=sys.stderr)
        return 1

    print('\nAll deploy workflow path-filter contracts satisfied.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
