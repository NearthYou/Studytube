import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const npmCommand = isWindows ? 'npm.cmd' : 'npm';
const pythonPath = isWindows
  ? path.join(root, 'ai', '.venv', 'Scripts', 'python.exe')
  : path.join(root, 'ai', '.venv', 'bin', 'python');

const services = [
  {
    name: 'api',
    command: npmCommand,
    args: ['--prefix', 'api', 'run', 'start:dev'],
    env: {
      AI_SERVICE_URL: process.env.AI_SERVICE_URL ?? 'http://localhost:8000',
    },
  },
  {
    name: 'ai',
    command: existsSync(pythonPath) ? pythonPath : 'python',
    args: [
      '-m',
      'uvicorn',
      'main:app',
      '--reload',
      '--host',
      '0.0.0.0',
      '--port',
      '8000',
      '--app-dir',
      'ai',
    ],
  },
  {
    name: 'web',
    command: npmCommand,
    args: ['--prefix', 'web', 'run', 'dev', '--', '--host', '0.0.0.0'],
  },
];

const children = new Map();
let stopping = false;
const databaseWaitAttempts = Number(process.env.DB_WAIT_ATTEMPTS ?? 30);
const databaseWaitDelayMs = Number(process.env.DB_WAIT_DELAY_MS ?? 1000);

function prefixLines(name, stream, write) {
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    for (const line of chunk.split(/\r?\n/)) {
      if (line.trim()) {
        write(`[${name}] ${line}\n`);
      }
    }
  });
}

function runDatabase() {
  console.log('[db] docker compose up -d');
  const result = spawnSync('docker', ['compose', 'up', '-d'], {
    cwd: root,
    shell: isWindows,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    console.error('[db] failed to start. Check Docker Desktop and try again.');
    process.exit(result.status ?? 1);
  }
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function waitForDatabase() {
  console.log('[db] waiting for postgres readiness');

  for (let attempt = 1; attempt <= databaseWaitAttempts; attempt += 1) {
    const result = spawnSync(
      'docker',
      ['compose', 'exec', '-T', 'postgres', 'pg_isready', '-U', 'app', '-d', 'app_dev'],
      {
        cwd: root,
        shell: isWindows,
        stdio: 'ignore',
      },
    );

    if (result.status === 0) {
      console.log('[db] postgres is ready');
      return;
    }

    if (attempt < databaseWaitAttempts) {
      sleep(databaseWaitDelayMs);
    }
  }

  console.error('[db] postgres did not become ready in time.');
  process.exit(1);
}

function startService(service) {
  const child = spawn(service.command, service.args, {
    cwd: root,
    env: {
      ...process.env,
      ...service.env,
    },
    shell: isWindows,
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  children.set(service.name, child);
  prefixLines(service.name, child.stdout, process.stdout.write.bind(process.stdout));
  prefixLines(service.name, child.stderr, process.stderr.write.bind(process.stderr));

  child.on('exit', (code, signal) => {
    children.delete(service.name);

    if (!stopping) {
      console.log(
        `[${service.name}] exited with ${signal ?? `code ${code ?? 'unknown'}`}`,
      );
      stopAll(code ?? 1);
    }
  });
}

function stopAll(exitCode = 0) {
  if (stopping) {
    return;
  }

  stopping = true;
  console.log('\n[all] stopping services...');

  for (const [name, child] of children) {
    console.log(`[all] stopping ${name}`);
    if (isWindows && child.pid) {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
      });
    } else {
      child.kill('SIGTERM');
    }
  }

  setTimeout(() => process.exit(exitCode), 600);
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

runDatabase();
waitForDatabase();

for (const service of services) {
  startService(service);
}

console.log('[all] services are starting: web http://0.0.0.0:5173, api http://localhost:3000, ai http://localhost:8000');
