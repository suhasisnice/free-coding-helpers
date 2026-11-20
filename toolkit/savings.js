'use strict';

const fs = require('node:fs');
const path = require('node:path');

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function tally(rows, { inPerM = 3, outPerM = 15 } = {}) {
  const providers = {};

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const model = typeof row.model === 'string' && row.model ? row.model : null;
    if (!model && row.event !== 'job') continue;
    const provider = model ? model.split('/')[0] : '(no model finished it)';   // a job that failed on every model has no model name

    if (!providers[provider]) {
      providers[provider] = {
        jobs: 0,
        verified: 0,
        failed: 0,
        r429: 0,
        helperTokens: 0,
        savedIn: 0,
        savedOut: 0,
        wastedIn: 0,
        wastedOut: 0,
        dollars: 0,
        reasons: {}
      };
    }

    const p = providers[provider];

    if (row.event === 'job') {
      p.jobs++;
      const status = row.status;
      if (status === 'verified') {
        p.verified++;
        p.savedIn += (row.inlineIn || 0) - (row.delegIn || 0);
        p.savedOut += (row.inlineOut || 0) - (row.delegOut || 0);
      } else if (status === 'failed') {
        p.failed++;
        p.wastedIn += row.delegIn || 0;
        p.wastedOut += row.delegOut || 0;
        const reason = row.reason || 'unknown';
        p.reasons[reason] = (p.reasons[reason] || 0) + 1;
      }
    } else {
      p.helperTokens += row.tokens || 0;
      if (row.status === 429) {
        p.r429++;
      }
    }
  }

  for (const p of Object.values(providers)) {
    const netIn = p.savedIn - p.wastedIn;
    const netOut = p.savedOut - p.wastedOut;
    p.dollars = (netIn * inPerM + netOut * outPerM) / 1e6;
  }

  const total = {
    jobs: 0,
    verified: 0,
    failed: 0,
    r429: 0,
    helperTokens: 0,
    savedIn: 0,
    savedOut: 0,
    wastedIn: 0,
    wastedOut: 0,
    dollars: 0,
    reasons: {}
  };

  for (const p of Object.values(providers)) {
    total.jobs += p.jobs;
    total.verified += p.verified;
    total.failed += p.failed;
    total.r429 += p.r429;
    total.helperTokens += p.helperTokens;
    total.savedIn += p.savedIn;
    total.savedOut += p.savedOut;
    total.wastedIn += p.wastedIn;
    total.wastedOut += p.wastedOut;
    total.dollars += p.dollars;
    for (const [reason, count] of Object.entries(p.reasons)) {
      total.reasons[reason] = (total.reasons[reason] || 0) + count;
    }
  }

  return { providers, total };
}

function renderHtml(t) {
  const { providers, total } = t;

  const providerRows = Object.entries(providers)
    .sort((a, b) => b[1].dollars - a[1].dollars)
    .map(([name, p]) => {
      const topReasons = Object.entries(p.reasons)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([r, c]) => `${escapeHtml(r)} (${c})`)
        .join(', ');
      const tokensSaved = (p.savedIn - p.wastedIn) + (p.savedOut - p.wastedOut);
      return `
        <tr>
          <td>${escapeHtml(name)}</td>
          <td style="text-align:right">${p.jobs}</td>
          <td style="text-align:right">${p.verified}</td>
          <td style="text-align:right">${p.failed}</td>
          <td style="text-align:right">${p.r429}</td>
          <td style="text-align:right">${p.helperTokens.toLocaleString()}</td>
          <td style="text-align:right">${tokensSaved.toLocaleString()}</td>
          <td style="text-align:right">$${p.dollars.toFixed(2)}</td>
          <td>${topReasons || '—'}</td>
        </tr>`;
    })
    .join('');

  const totalTokensSaved = (total.savedIn - total.wastedIn) + (total.savedOut - total.wastedOut);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Delegation savings</title>
  <style>
    :root {
      --bg: #fafafa;
      --fg: #1a1a1a;
      --muted: #666;
      --border: #ddd;
      --table-bg: #fff;
      --row-alt: #f5f5f5;
      --header-bg: #f0f0f0;
      --link: #0066cc;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #1a1a1a;
        --fg: #eaeaea;
        --muted: #aaa;
        --border: #333;
        --table-bg: #222;
        --row-alt: #2a2a2a;
        --header-bg: #2a2a2a;
        --link: #66a3ff;
      }
    }
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--fg);
      margin: 0;
      padding: 2rem;
      line-height: 1.5;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    .summary {
      color: var(--muted);
      margin-bottom: 1.5rem;
      font-size: 0.95rem;
    }
    table { width: 100%; border-collapse: collapse; background: var(--table-bg); }
    th, td { padding: 0.6rem 0.8rem; border-bottom: 1px solid var(--border); text-align: left; }
    th { background: var(--header-bg); font-weight: 600; }
    tr:nth-child(even) td { background: var(--row-alt); }
    td:last-child { max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .right { text-align: right; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Delegation savings</h1>
    <p class="summary">
      Total jobs: <strong>${total.jobs}</strong> |
      Verified: <strong>${total.verified}</strong> |
      Claude tokens saved: <strong>${totalTokensSaved.toLocaleString()}</strong> |
      Dollars saved: <strong>$${total.dollars.toFixed(2)}</strong>
    </p>
    <table>
      <thead>
        <tr>
          <th>Provider</th>
          <th class="right">Jobs</th>
          <th class="right">Verified</th>
          <th class="right">Failed</th>
          <th class="right">429s</th>
          <th class="right">Helper tokens</th>
          <th class="right">Tokens saved</th>
          <th class="right">$ saved</th>
          <th>Top failure reasons</th>
        </tr>
      </thead>
      <tbody>
        ${providerRows}
      </tbody>
    </table>
  </div>
</body>
</html>`;
}

function readJsonlFiles(files) {
  const rows = [];
  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          rows.push(JSON.parse(trimmed));
        } catch {
          // skip bad lines
        }
      }
    } catch {
      // skip unreadable files
    }
  }
  return rows;
}

function getDefaultFiles() {
  const scriptDir = __dirname;
  const runsDir = path.join(scriptDir, '..', 'runs');
  const cliFile = path.join(scriptDir, '..', 'usage', 'cli.jsonl');
  const files = [];

  try {
    const entries = fs.readdirSync(runsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(path.join(runsDir, entry.name));
      }
    }
  } catch {
    // runs dir may not exist
  }

  try {
    fs.accessSync(cliFile, fs.constants.R_OK);
    files.push(cliFile);
  } catch {
    // cli.jsonl may not exist
  }

  return files;
}

function main() {
  const args = process.argv.slice(2);
  let outFile = path.join(__dirname, 'savings.html');
  const inputFiles = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') {
      outFile = args[i + 1];
      i++;
    } else {
      inputFiles.push(args[i]);
    }
  }

  const files = inputFiles.length > 0 ? inputFiles : getDefaultFiles();
  const rows = readJsonlFiles(files);
  const result = tally(rows);
  const html = renderHtml(result);
  fs.writeFileSync(outFile, html, 'utf8');

  const total = result.total;
  const totalTokensSaved = (total.savedIn - total.wastedIn) + (total.savedOut - total.wastedOut);
  console.log(`Total jobs: ${total.jobs}`);
  console.log(`Verified: ${total.verified}`);
  console.log(`Claude tokens saved: ${totalTokensSaved}`);
  console.log(`Dollars saved: $${total.dollars.toFixed(2)}`);
  console.log(`Written to ${outFile}`);
}

if (require.main === module) {
  main();
}

module.exports = { tally, renderHtml };
