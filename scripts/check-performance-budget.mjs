import { readFile } from 'node:fs/promises';

const budget = JSON.parse(await readFile(new URL('../performance-budget.json', import.meta.url), 'utf8'));
const files = process.argv.slice(2);
if (files.length === 0) throw new Error('Pass at least one k6 summary JSON file.');

const failures = [];
for (const file of files) {
  const report = JSON.parse(await readFile(file, 'utf8'));
  const values = (metric) => report.metrics[metric]?.values ?? {};
  const assertMaximum = (label, actual, maximum) => {
    if (typeof actual !== 'number') failures.push(`${file}: ${label} is missing`);
    else if (actual >= maximum) failures.push(`${file}: ${label} ${actual.toFixed(2)} >= ${maximum}`);
  };
  assertMaximum('flow error rate', report.summary.errorRate, budget.errorRate);
  assertMaximum('overall p95', report.summary.httpP95Ms, budget.httpP95Ms);
  assertMaximum('overall p99', values('http_req_duration')['p(99)'], budget.httpP99Ms);
  for (const [flow, limits] of Object.entries(budget.flows)) {
    assertMaximum(`${flow} p95`, values(`flow_${flow}_duration`)['p(95)'], limits.p95Ms);
  }
}

if (failures.length > 0) {
  console.error(`Performance budget failed:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.info(`Performance budget passed for ${files.join(', ')}`);
}
