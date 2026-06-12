#!/usr/bin/env node
/**
 * Generate a single HTML eval report from ALL runs in evals/results/.
 *
 * Usage: node generate-report.cjs [results-dir]
 *   Default results-dir: evals/results
 *
 * Supports star-based grading (1-5 per dimension) from LLM-as-judge evals.
 */

const fs = require('fs');
const path = require('path');

const resultsRoot = path.resolve(process.argv[2] || 'evals/results');

if (!fs.existsSync(resultsRoot)) {
  console.error(`Results directory not found: ${resultsRoot}`);
  process.exit(1);
}

const runDirs = fs.readdirSync(resultsRoot)
  .filter(d => fs.statSync(path.join(resultsRoot, d)).isDirectory() && d !== '.git')
  .sort()
  .reverse();

const allRuns = [];

for (const dir of runDirs) {
  const runPath = path.join(resultsRoot, dir);
  const jsonFiles = fs.readdirSync(runPath).filter(f => f.endsWith('.json'));
  if (jsonFiles.length === 0) continue;

  const cases = jsonFiles.map(f => {
    try {
      return JSON.parse(fs.readFileSync(path.join(runPath, f), 'utf-8'));
    } catch { return null; }
  }).filter(Boolean);

  if (cases.length > 0) {
    allRuns.push({ dir, timestamp: dir, cases });
  }
}

if (allRuns.length === 0) {
  console.error('No eval results found. Run /eval-run first.');
  process.exit(1);
}

function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function stars(n) {
  const full = Math.round(n);
  return '★'.repeat(full) + '☆'.repeat(5 - full);
}

function starColor(n) {
  if (n >= 4.5) return '#2d8a4e';
  if (n >= 3.5) return '#3a7bd5';
  if (n >= 2.5) return '#d4a017';
  return '#c0392b';
}

function badge(status) {
  const colors = { completed: '#2d8a4e', skipped: '#7f8c8d', failed: '#c0392b' };
  return `<span style="background:${colors[status] || '#7f8c8d'};color:#fff;padding:2px 8px;border-radius:3px;font-size:0.75rem;font-weight:600;text-transform:uppercase;">${esc(status)}</span>`;
}

function getOverallStars(c) {
  if (c.grading?.overall?.stars) return c.grading.overall.stars;
  if (c.grading?.dimensions) {
    const dims = Object.values(c.grading.dimensions);
    if (dims.length > 0) return dims.reduce((s, d) => s + (d.stars || 0), 0) / dims.length;
  }
  return 0;
}

function getDimensions(c) {
  return c.grading?.dimensions || {};
}

const allCases = allRuns.flatMap(r => r.cases.map(c => ({ ...c, _run: r.dir })));
const caseStars = allCases.map(getOverallStars).filter(s => s > 0);
const avgStars = caseStars.length > 0 ? (caseStars.reduce((a, b) => a + b, 0) / caseStars.length) : 0;
const completedCount = allCases.filter(r => r.status === 'completed').length;

const categories = {};
for (const r of allCases) {
  const cat = r.category || r.case?.split('-')[0] || 'uncategorized';
  if (!categories[cat]) categories[cat] = { stars: [], cases: 0 };
  const s = getOverallStars(r);
  if (s > 0) categories[cat].stars.push(s);
  categories[cat].cases++;
}

let categoryCards = '';
for (const [cat, data] of Object.entries(categories)) {
  const avg = data.stars.length > 0 ? (data.stars.reduce((a, b) => a + b, 0) / data.stars.length) : 0;
  categoryCards += `
    <div class="stat-card">
      <div class="stat-label">${esc(cat)}</div>
      <div class="stat-value" style="color:${starColor(avg)}">${stars(avg)}</div>
      <div class="stat-detail">${avg.toFixed(1)}/5 &middot; ${data.cases} case${data.cases > 1 ? 's' : ''}</div>
    </div>`;
}

let runSections = '';
for (const run of allRuns) {
  const runStars = run.cases.map(getOverallStars).filter(s => s > 0);
  const runAvg = runStars.length > 0 ? (runStars.reduce((a, b) => a + b, 0) / runStars.length) : 0;

  let caseSections = '';
  for (const r of run.cases) {
    const overall = getOverallStars(r);
    const dims = getDimensions(r);

    const dimRows = Object.entries(dims).map(([name, d]) => `
      <tr>
        <td class="dim-name">${esc(name)}</td>
        <td class="dim-stars" style="color:${starColor(d.stars)}">${stars(d.stars)}</td>
        <td class="dim-score">${d.stars}/5</td>
        <td class="dim-evidence">${esc(d.evidence || '')}</td>
      </tr>`).join('\n');

    const entitiesList = (r.entities || []).map(e => `<span class="entity-tag">${esc(e)}</span>`).join(' ');

    caseSections += `
      <div class="case-card expanded">
        <div class="case-header" onclick="this.parentElement.classList.toggle('expanded')">
          <div class="case-title">
            <span class="case-name">${esc(r.case)}</span>
            ${badge(r.status)}
          </div>
          <div class="case-score">
            <span class="score-stars" style="color:${starColor(overall)}">${stars(overall)}</span>
            <span class="score-num" style="color:${starColor(overall)}">${overall.toFixed(1)}/5</span>
            <span class="expand-icon">&#x25BC;</span>
          </div>
        </div>
        <div class="case-body">
          ${r.grading?.overall?.summary ? `<div class="case-summary">${esc(r.grading.overall.summary)}</div>` : ''}
          ${r.source_url ? `<div class="case-meta"><strong>Source:</strong> <a href="${esc(r.source_url)}" target="_blank">${esc(r.source_url)}</a></div>` : ''}
          ${r.created ? `<div class="case-meta"><strong>Created:</strong> ${r.created.nodes} nodes, ${r.created.edges} edges</div>` : ''}
          ${r.duration_ms ? `<div class="case-meta"><strong>Duration:</strong> ${(r.duration_ms / 1000).toFixed(1)}s</div>` : ''}

          <h4>Dimensions</h4>
          <table class="dim-table">
            <thead><tr><th>Dimension</th><th>Rating</th><th>Score</th><th>Evidence</th></tr></thead>
            <tbody>${dimRows}</tbody>
          </table>

          ${entitiesList ? `<h4>Entities Extracted</h4><div class="entities-list">${entitiesList}</div>` : ''}
          ${r.notes ? `<div class="case-notes"><strong>Notes:</strong> ${esc(r.notes)}</div>` : ''}
        </div>
      </div>`;
  }

  runSections += `
    <div class="run-group">
      <div class="run-header" onclick="this.parentElement.classList.toggle('collapsed')">
        <span class="run-timestamp">${esc(run.dir)}</span>
        <span class="run-summary">${run.cases.length} case${run.cases.length > 1 ? 's' : ''} &middot;
          <span style="color:${starColor(runAvg)}">${stars(runAvg)} ${runAvg.toFixed(1)}/5</span>
        </span>
        <span class="expand-icon">&#x25BC;</span>
      </div>
      <div class="run-body">
        ${caseSections}
      </div>
    </div>`;
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Synapse Eval Report</title>
  <style>
    :root {
      --bg: #f5f5f7; --surface: #ffffff; --border: #e5e5ea;
      --text: #1d1d1f; --text-muted: #86868b;
      --green: #2d8a4e; --green-bg: #eaf7ef;
      --blue: #3a7bd5; --blue-bg: #e8f0fe;
      --red: #c0392b; --red-bg: #fdeaea;
      --yellow: #d4a017; --yellow-bg: #fdf6e3;
      --radius: 10px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif;
      background: var(--bg); color: var(--text); line-height: 1.5;
    }
    .header {
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #fff; padding: 2rem 2.5rem;
    }
    .header h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.25rem; }
    .header .subtitle { opacity: 0.7; font-size: 0.9rem; }
    .container { max-width: 1100px; margin: 0 auto; padding: 1.5rem; }

    .summary-bar { display: flex; gap: 1rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
    .summary-card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 1.25rem 1.5rem;
      flex: 1; min-width: 140px; text-align: center;
    }
    .summary-card .big-number { font-size: 2.25rem; font-weight: 700; line-height: 1.1; }
    .summary-card .big-stars { font-size: 1.5rem; letter-spacing: 2px; }
    .summary-card .label {
      font-size: 0.8rem; color: var(--text-muted);
      text-transform: uppercase; letter-spacing: 0.05em; margin-top: 0.25rem;
    }

    .category-section { margin-bottom: 1.5rem; }
    .category-section h2, .runs-section h2 {
      font-size: 1.1rem; font-weight: 600; margin-bottom: 0.75rem; color: var(--text-muted);
    }
    .stat-grid { display: flex; gap: 0.75rem; flex-wrap: wrap; }
    .stat-card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 1rem 1.25rem; min-width: 160px; flex: 1;
    }
    .stat-label { font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
    .stat-value { font-size: 1.25rem; margin: 0.15rem 0; letter-spacing: 2px; }
    .stat-detail { font-size: 0.8rem; color: var(--text-muted); }

    .run-group {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: var(--radius); margin-bottom: 1rem; overflow: hidden;
    }
    .run-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 0.75rem 1.25rem; cursor: pointer; user-select: none;
      background: #fafafa; border-bottom: 1px solid var(--border);
    }
    .run-header:hover { background: #f0f0f2; }
    .run-timestamp { font-weight: 600; font-size: 0.9rem; font-family: monospace; }
    .run-summary { font-size: 0.85rem; color: var(--text-muted); }
    .run-body { padding: 0.75rem; }
    .run-group.collapsed .run-body { display: none; }
    .run-group.collapsed .expand-icon { transform: rotate(-90deg); }

    .case-card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: var(--radius); margin-bottom: 0.5rem; overflow: hidden;
    }
    .case-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 0.7rem 1rem; cursor: pointer; user-select: none;
    }
    .case-header:hover { background: #fafafa; }
    .case-title { display: flex; align-items: center; gap: 0.75rem; }
    .case-name { font-weight: 600; font-size: 0.9rem; }
    .case-score { display: flex; align-items: center; gap: 0.75rem; }
    .score-stars { font-size: 1rem; letter-spacing: 1px; }
    .score-num { font-size: 0.85rem; font-weight: 700; }
    .expand-icon { font-size: 0.7rem; color: var(--text-muted); transition: transform 0.2s; }
    .case-card.expanded .expand-icon { transform: rotate(180deg); }
    .case-body {
      display: none; padding: 0 1rem 1rem; border-top: 1px solid var(--border);
    }
    .case-card.expanded .case-body { display: block; }
    .case-body h4 {
      font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em;
      color: var(--text-muted); margin: 0.75rem 0 0.4rem;
    }
    .case-summary {
      background: var(--blue-bg); padding: 0.6rem 0.8rem;
      border-radius: 6px; font-size: 0.85rem; margin-top: 0.6rem; line-height: 1.6;
    }
    .case-notes {
      background: var(--yellow-bg); padding: 0.4rem 0.6rem;
      border-radius: 4px; font-size: 0.8rem; margin-top: 0.6rem;
    }
    .case-meta { font-size: 0.8rem; color: var(--text-muted); margin-top: 0.3rem; }
    .case-meta a { color: var(--blue); }

    table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
    th {
      text-align: left; font-size: 0.65rem; text-transform: uppercase;
      letter-spacing: 0.04em; color: var(--text-muted);
      padding: 0.3rem 0.4rem; border-bottom: 1px solid var(--border);
    }
    td { padding: 0.4rem; border-bottom: 1px solid #f0f0f2; vertical-align: top; }
    .dim-name { font-weight: 600; text-transform: capitalize; min-width: 100px; }
    .dim-stars { letter-spacing: 1px; white-space: nowrap; }
    .dim-score { white-space: nowrap; font-weight: 600; min-width: 40px; }
    .dim-evidence { color: var(--text-muted); font-size: 0.75rem; }

    .entities-list { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.3rem; }
    .entity-tag {
      background: var(--bg); border: 1px solid var(--border); padding: 2px 8px;
      border-radius: 4px; font-size: 0.75rem; font-weight: 500;
    }

    .footer { text-align: center; padding: 2rem; color: var(--text-muted); font-size: 0.8rem; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Synapse Eval Report</h1>
    <div class="subtitle">${allRuns.length} run${allRuns.length > 1 ? 's' : ''} &middot; ${allCases.length} total case${allCases.length > 1 ? 's' : ''}</div>
  </div>

  <div class="container">
    <div class="summary-bar">
      <div class="summary-card">
        <div class="big-stars" style="color:${starColor(avgStars)}">${stars(avgStars)}</div>
        <div class="big-number" style="color:${starColor(avgStars)}">${avgStars.toFixed(1)}<span style="color:var(--text-muted);font-size:1rem;">/5</span></div>
        <div class="label">Average Score</div>
      </div>
      <div class="summary-card">
        <div class="big-number">${allCases.length}</div>
        <div class="label">Cases</div>
      </div>
      <div class="summary-card">
        <div class="big-number" style="color:var(--green)">${completedCount}</div>
        <div class="label">Completed</div>
      </div>
      <div class="summary-card">
        <div class="big-number">${allRuns.length}</div>
        <div class="label">Runs</div>
      </div>
    </div>

    <div class="category-section">
      <h2>By Category</h2>
      <div class="stat-grid">${categoryCards}</div>
    </div>

    <div class="runs-section">
      <h2>Runs</h2>
      ${runSections}
    </div>
  </div>

  <div class="footer">
    Generated by Synapse Eval &middot; ${new Date().toISOString().replace('T', ' ').slice(0, 19)}
  </div>
</body>
</html>`;

const outPath = path.join(resultsRoot, 'report.html');
fs.writeFileSync(outPath, html, 'utf-8');
console.log(`Report: ${outPath}`);
console.log(`Runs: ${allRuns.length} | Cases: ${allCases.length} | Avg: ${stars(avgStars)} ${avgStars.toFixed(1)}/5`);
