'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Returns true if the reason indicates an infrastructure failure.
 * @param {string|undefined} reason
 * @returns {boolean}
 */
function isInfraFailure(reason) {
  if (reason === undefined) return false;
  return /429|cooling|\b5\d\d\b|call cap|credential|STOP|402|401|403|timeout|stream cut|neterr|unreachable/i.test(reason);
}

/**
 * Builds routing rules from job rows.
 * @param {Array<Object>} rows
 * @param {{threshold?: number, minJobs?: number}} [options={}]
 * @returns {{threshold: number, minJobs: number, types: Object<string, {ranked: Array<{model: string, passed: number, judged: number, rate: number}>, delegate: boolean}>}}
 */
function buildRules(rows, { threshold = 0.8, minJobs = 3 } = {}) {
  // Filter to job events only
  const jobs = rows.filter(r => r.event === 'job');

  // Group by type and model, counting passed and judged (excluding infra failures)
  const stats = {}; // type -> model -> {passed, judged}
  for (const job of jobs) {
    const { model, type, status, reason } = job;
    if (!model || !type) continue;

    // Skip failed jobs that are infra failures
    if (status === 'failed' && isInfraFailure(reason)) continue;

    if (!stats[type]) stats[type] = {};
    if (!stats[type][model]) stats[type][model] = { passed: 0, judged: 0 };

    stats[type][model].judged++;
    if (status === 'verified') stats[type][model].passed++;
  }

  const types = {};
  for (const [type, models] of Object.entries(stats)) {
    const ranked = Object.entries(models)
      .filter(([, { judged }]) => judged >= minJobs)
      .map(([model, { passed, judged }]) => ({
        model,
        passed,
        judged,
        rate: judged > 0 ? passed / judged : 0
      }))
      .sort((a, b) => {
        if (b.rate !== a.rate) return b.rate - a.rate;
        if (b.judged !== a.judged) return b.judged - a.judged;   // same rate: more evidence first
        return a.model.localeCompare(b.model);
      });

    const delegate = ranked.length > 0 && ranked[0].rate >= threshold;
    types[type] = { ranked, delegate };
  }

  return { threshold, minJobs, types };
}

/**
 * Deep clones an object.
 * @param {any} obj
 * @returns {any}
 */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Applies rules to chains configuration.
 * @param {Object} cfg - Configuration with chains property
 * @param {Object} rules - Rules from buildRules
 * @param {{minRate?: number, exclude?: string[]}} [options={}]
 * @returns {Object} Deep copy of cfg with updated chains
 */
function applyChains(cfg, rules, { minRate = 0.5, exclude = [] } = {}) {
  const out = deepClone(cfg);
  const excludeSet = new Set(exclude);

  if (!out.chains || !rules.types) return out;

  for (const [type, chain] of Object.entries(out.chains)) {
    const typeRules = rules.types[type];
    if (!typeRules || !typeRules.ranked || !Array.isArray(chain)) continue;

    const rankedModels = typeRules.ranked.map(r => r.model);
    const rankedModelsSet = new Set(rankedModels);
    const qualifiedRanked = typeRules.ranked
      .filter(r => r.rate >= minRate)
      .map(r => r.model)
      .filter(m => !excludeSet.has(m));

    if (qualifiedRanked.length > 0) {
      // Models in ranked order that meet minRate, followed by unranked models from original chain
      const unrankedFromChain = chain.filter(m => !rankedModelsSet.has(m) && !excludeSet.has(m));
      out.chains[type] = [...qualifiedRanked, ...unrankedFromChain];
    } else {
      // No ranked model reaches minRate: keep chain unchanged minus excluded
      out.chains[type] = chain.filter(m => !excludeSet.has(m));
    }
  }

  return out;
}

/**
 * Reads all JSONL files matching the prefix in the runs directory.
 * @param {string} runPrefix
 * @param {string} runsDir
 * @returns {Array<Object>}
 */
function readRunFiles(runPrefix, runsDir) {
  const files = fs.readdirSync(runsDir)
    .filter(f => f.startsWith(runPrefix) && f.endsWith('.jsonl'))
    .map(f => path.join(runsDir, f));

  const rows = [];
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    // a bench file pins one model, but a job that failed is logged with model: null; give it the file's model
    const fileModel = (content.match(/"model":"([^"]+)"/) || [])[1];
    for (const line of content.trim().split('\n')) {
      if (line.trim()) {
        try {
          const row = JSON.parse(line);
          if (!row.model && fileModel) row.model = fileModel;
          rows.push(row);
        } catch (e) {
          // Ignore malformed lines
        }
      }
    }
  }
  return rows;
}

/**
 * Loads providers.json and returns a set of model IDs whose provider status is 'paid-now'.
 * @param {string} providersPath
 * @returns {Set<string>}
 */
function loadPaidNowModels(providersPath) {
  // models whose provider now needs payment (providers.json status 'paid-now'), matched by testModel
  try {
    const { providers = [] } = JSON.parse(fs.readFileSync(providersPath, 'utf8'));
    return new Set(providers.filter((p) => p.status === 'paid-now' && p.testModel).map((p) => p.testModel));
  } catch { return new Set(); }
}

/**
 * Test model function - checks if a model ID matches a paid-now provider.
 * @param {string} modelId
 * @param {Set<string>} paidNowModels
 * @returns {boolean}
 */
function testModel(modelId, paidNowModels) {
  return paidNowModels.has(modelId);
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: node rules.js <run-prefix> [--write]');
    process.exit(1);
  }

  const runPrefix = args[0];
  const doWrite = args.includes('--write');

  const scriptDir = __dirname;
  const runsDir = path.join(scriptDir, '..', 'runs');
  const rulesPath = path.join(scriptDir, 'rules.json');
  const routerConfigPath = path.join(scriptDir, 'router.config.json');
  const routerConfigBakPath = path.join(scriptDir, 'router.config.json.bak');
  const providersPath = path.join(scriptDir, 'providers.json');

  // Read run files and build rules
  const rows = readRunFiles(runPrefix, runsDir);
  const rules = buildRules(rows);

  // Write rules.json
  fs.writeFileSync(rulesPath, JSON.stringify(rules, null, 2));

  // Print summary
  for (const [type, { ranked, delegate }] of Object.entries(rules.types)) {
    const best = ranked[0];
    const bestStr = best ? `${best.model} (${(best.rate * 100).toFixed(0)}%)` : 'none';
    console.log(`${type}: delegate=${delegate ? 'yes' : 'no'}, best=${bestStr}`);
  }

  if (doWrite) {
    // Load router config
    let cfg;
    try {
      cfg = JSON.parse(fs.readFileSync(routerConfigPath, 'utf8'));
    } catch (e) {
      console.error('Failed to read router.config.json:', e.message);
      process.exit(1);
    }

    // Backup
    fs.copyFileSync(routerConfigPath, routerConfigBakPath);

    // Load paid-now models
    const paidNowModels = loadPaidNowModels(providersPath);
    const exclude = Array.from(paidNowModels);

    // Apply chains
    const updated = applyChains(cfg, rules, { exclude });

    // Write back
    fs.writeFileSync(routerConfigPath, JSON.stringify(updated, null, 2));
  }
}

module.exports = { isInfraFailure, buildRules, applyChains, testModel };
