import { spawnSync } from 'node:child_process';

const run = (command, args) => {
  const label = [command, ...args].join(' ');
  console.info(`\n> ${label}`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} exited with status ${result.status ?? 'unknown'}`);
  }
};

const hasRunningLocalStack = () => {
  const result = spawnSync('docker', ['compose', 'ps', '--status', 'running', '--quiet'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  return result.status === 0 && result.stdout.trim().length > 0;
};

const stackWasRunning = hasRunningLocalStack();
let stackStarted = false;

try {
  run('npm', ['run', 'format:check']);
  run('npm', ['run', 'lint']);
  run('npm', ['run', 'typecheck']);
  run('npm', ['run', 'test:coverage']);
  run('npm', ['--prefix', 'frontend', 'run', 'typecheck']);
  run('npm', ['--prefix', 'frontend', 'run', 'build']);
  run('npm', ['run', 'infra:typecheck']);
  run('npm', ['run', 'infra:synth']);
  stackStarted = true;
  run('npm', ['run', 'local:up']);
  run('npm', ['run', 'test:integration']);
  console.info('\nCloudFleet verification passed.');
} finally {
  if (stackStarted && !stackWasRunning) {
    console.info('\n> npm run local:down');
    spawnSync('npm', ['run', 'local:down'], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    });
  }
}
