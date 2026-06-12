---
description: "Generate an HTML dashboard from eval results. Usage: /eval-report [run-timestamp]"
allowed-tools: Bash, Read, Write
---

# Eval Report Generator

Generate a visual HTML report from eval run results, similar to a Gradle test report.

## Arguments

`$ARGUMENTS` determines which run to report:

- **Timestamp** (e.g., `2026-05-20_103045`) → report on that specific run
- **`latest`** or **empty** → find the most recent run directory in `evals/results/`
- **`all`** → generate a combined report across all runs (trend view)

## Flow

### 1. Find Results
Look in `evals/results/` for the target run directory. Read all `.json` files in it. If no results found, tell the user to run `/eval-run` first.

### 2. Generate Report
Run the report generator script:

```bash
node evals/scripts/generate-report.cjs evals/results/{timestamp}
```

This reads all JSON result files in the run directory and produces `evals/results/{timestamp}/report.html`.

### 3. Open Report
Open the generated HTML file in the default browser:

```bash
open evals/results/{timestamp}/report.html
```

### 4. Print Summary
Show a brief text summary:
```
Report generated: evals/results/2026-05-20_103045/report.html
Cases: 5 | Passed: 4 | Failed: 1 | Skipped: 0
Overall pass rate: 93% (28/30 criteria)
```

## If the Script Doesn't Exist

If `evals/scripts/generate-report.js` is missing or errors, fall back to generating the HTML inline:

1. Read all JSON result files from the run directory
2. Build the HTML report content directly (use the template structure documented in `evals/scripts/generate-report.js`)
3. Write to `evals/results/{timestamp}/report.html`
4. Open in browser

The HTML report should include:
- **Header**: Run timestamp, total cases, overall pass rate
- **Summary cards**: Per-category pass rates with color-coded indicators
- **Case details**: Expandable sections per case with criteria results (green check / red X), evidence text, step log
- **Trend chart** (if `all` mode): Pass rate over time across runs
- Self-contained (inline CSS, no external dependencies)
