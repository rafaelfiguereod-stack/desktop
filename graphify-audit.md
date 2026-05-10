# Graphify Audit Report

Source: https://github.com/safishamsi/graphify.git  
Version: 0.7.13 (`graphifyy` on PyPI)  
Audited: 2026-05-10

## Installation

```bash
git clone https://github.com/safishamsi/graphify.git graphify
cd graphify
python3 -m venv .venv
.venv/bin/pip install -e ".[mcp,svg,sql]"
```

The `sql` extra (`tree-sitter-sql`) is required by several tests but omitted from
pyproject.toml's `all` group — it must be installed separately to run the full suite.

## Test Results

```
746 passed in 8.65s
```

Before installing `tree-sitter-sql`, 1 test was failing:
`tests/test_multilang.py::test_sql_finds_tables` — `extract_sql` returned empty
nodes because the optional SQL grammar was missing. Fixed by installing the extra.

## Functional Verification

`graphify update .` ran successfully on its own source tree:

```
4064 nodes, 6070 edges, 280 communities
graph.json, graph.html and GRAPH_REPORT.md written to graphify-out/
```

`graphify query "what is the main entry point"` returned correct BFS traversal
anchored at `main()` in `graphify/__main__.py:1115`.

## Security Audit (bandit)

Configuration: `pyproject.toml` skips B404 (subprocess imports).

| Severity | Count | Notes |
|----------|-------|-------|
| High     | 2     | SHA1 for non-security slugs — fixed |
| Medium   | 1     | `ET.fromstring()` on local files — annotated |
| Low      | 26    | subprocess with list args, try/except/pass, assert in llm.py |

### Fixes Applied

**`callflow_html.py` (B324 — SHA1)**  
`hashlib.sha1()` is used twice to generate 6-8 char suffix tokens for Mermaid ID
deduplication. No security sensitivity. Added `usedforsecurity=False` to suppress
the false positive cleanly.

**`extract.py` (B314 — ET.fromstring)**  
Parses Lazarus `.lpk` XML package files from the local filesystem. Python's
`xml.etree.ElementTree` does not expand external entities, so XXE is not a real
risk here. Added `# nosec B314` annotation with an explanatory comment.

### Remaining Low Issues (accepted)

- **B603/B607 subprocess calls**: All use list arguments (not shell=True), and
  inputs come from controlled sources (git URLs, system paths). Low real risk.
- **B110 try/except/pass**: Used throughout for optional-dependency graceful
  degradation (e.g., corrupt graph.json on disk, openpyxl not installed). Each
  instance is intentional.
- **B101 assert**: Two asserts in `llm.py` guard an invariant inside async
  gather loops where `None` results have already been filtered. They will only
  fire in optimised mode if the internal logic is broken — acceptable.

## Code Quality Notes

- `extract.py` is 5700+ lines. It handles 29 languages but has grown organically;
  splitting into per-language modules would improve maintainability.
- `__main__.py` is 2200+ lines of CLI dispatch. Could benefit from a command
  registry pattern, but is otherwise readable.
- No circular imports detected. Module boundaries are clean.
- All public commands are integration-tested via `tests/test_cli_export.py` and
  `tests/test_pipeline.py`.
