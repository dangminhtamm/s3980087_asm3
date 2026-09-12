import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const budget = JSON.parse(readFileSync(path.join(root, 'quality-budget.json'), 'utf8'));
const failures = [];

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  return result;
};

const isProductionFile = (file) =>
  /^(src|frontend\/src|infra\/lib)\/.+\.(?:js|mjs|ts|tsx)$/.test(file) &&
  !/(?:^|\/)(?:test|tests|__tests__)\//.test(file) &&
  !/\.(?:test|spec)\.[^.]+$/.test(file) &&
  !file.endsWith('.d.ts');

const listed = run('git', [
  'ls-files',
  '--cached',
  '--others',
  '--exclude-standard',
  '--',
  'src',
  'frontend/src',
  'infra/lib',
]);
if (listed.status !== 0) throw new Error(listed.stderr);
const productionFiles = [
  ...new Set(
    listed.stdout
      .trim()
      .split('\n')
      .filter((file) => isProductionFile(file) && existsSync(path.join(root, file))),
  ),
];

for (const file of productionFiles) {
  const content = readFileSync(path.join(root, file), 'utf8');
  const lineCount = content === '' ? 0 : content.replace(/\r?\n$/, '').split(/\r?\n/).length;
  const maximum = budget.grandfatheredFileLineLimits[file] ?? budget.maximumNewProductionFileLines;
  if (lineCount > maximum) failures.push(`${file}: ${lineCount} lines exceeds ${maximum}`);
}

const complexity = run('npx', [
  'eslint',
  ...productionFiles,
  '--format',
  'json',
  '--rule',
  `complexity:[error,${budget.maximumCyclomaticComplexity}]`,
]);
if (!complexity.stdout.trim()) throw new Error(complexity.stderr || 'ESLint produced no JSON');
const complexityResults = JSON.parse(complexity.stdout);
const exemptions = new Set(
  budget.complexityExemptions.map(([file, line, value]) => `${file}:${line}:${value}`),
);
for (const result of complexityResults) {
  const file = path.relative(root, result.filePath).replaceAll(path.sep, '/');
  for (const message of result.messages.filter((item) => item.ruleId === 'complexity')) {
    const value = Number(message.message.match(/complexity of (\d+)/)?.[1]);
    const fingerprint = `${file}:${message.line}:${value}`;
    if (!exemptions.has(fingerprint)) {
      failures.push(`${fingerprint} exceeds complexity ${budget.maximumCyclomaticComplexity}`);
    }
  }
}

const parseLcov = (file, sourcePrefix = '') => {
  const coverage = new Map();
  let source;
  for (const line of readFileSync(path.join(root, file), 'utf8').split(/\r?\n/)) {
    if (line.startsWith('SF:')) {
      const raw = line.slice(3).replaceAll('\\', '/');
      source = raw.startsWith('/') ? path.relative(root, raw).replaceAll(path.sep, '/') : raw;
      if (sourcePrefix && !source.startsWith(`${sourcePrefix}/`))
        source = `${sourcePrefix}/${source}`;
    } else if (source && line.startsWith('DA:')) {
      const [lineNumber, hits] = line.slice(3).split(',').map(Number);
      coverage.set(`${source}:${lineNumber}`, hits ?? 0);
    }
  }
  return coverage;
};

const coverage = new Map([
  ...parseLcov('coverage/lcov.info'),
  ...parseLcov('frontend/coverage/lcov.info', 'frontend'),
]);
const base = process.env.QUALITY_BASE_REF?.trim() || 'HEAD';
const diff = run('git', ['diff', '--unified=0', '--no-color', base, '--', 'src', 'frontend/src']);
if (diff.status !== 0) throw new Error(diff.stderr);
let currentFile;
const changedCoverableLines = [];
for (const line of diff.stdout.split('\n')) {
  if (line.startsWith('+++ b/')) currentFile = line.slice(6);
  const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
  if (!hunk || !currentFile) continue;
  const start = Number(hunk[1]);
  const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
  for (let lineNumber = start; lineNumber < start + count; lineNumber += 1) {
    const key = `${currentFile}:${lineNumber}`;
    if (coverage.has(key)) changedCoverableLines.push(coverage.get(key));
  }
}
const covered = changedCoverableLines.filter((hits) => hits > 0).length;
const changedCoveragePercent = changedCoverableLines.length
  ? (covered / changedCoverableLines.length) * 100
  : 100;
if (changedCoveragePercent < budget.minimumChangedCodeCoveragePercent) {
  failures.push(
    `changed-code coverage ${changedCoveragePercent.toFixed(2)}% is below ${budget.minimumChangedCodeCoveragePercent}%`,
  );
}

if (failures.length) {
  console.error(`Quality budget failed:\n- ${failures.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.info(
    `Quality budget passed: ${changedCoveragePercent.toFixed(2)}% changed-code coverage, complexity ≤ ${budget.maximumCyclomaticComplexity}, new files ≤ ${budget.maximumNewProductionFileLines} lines.`,
  );
}
