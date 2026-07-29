import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

function shellPath(path: string): string {
  const normalized = path.replaceAll('\\', '/');
  const windowsDrive = normalized.match(/^([A-Za-z]):(\/.*)$/);

  return windowsDrive
    ? `/${windowsDrive[1]?.toLowerCase()}${windowsDrive[2]}`
    : normalized;
}

describe('EC2 deployment script', () => {
  const script = readFileSync(
    resolve(__dirname, '../../scripts/deploy-ec2.sh'),
    'utf8',
  );
  const workflow = readFileSync(
    resolve(__dirname, '../../.github/workflows/ci-cd.yml'),
    'utf8',
  );
  const autoDeployScript = readFileSync(
    resolve(__dirname, '../../scripts/ec2-autodeploy.sh'),
    'utf8',
  );
  const autoDeployInstaller = readFileSync(
    resolve(__dirname, '../../scripts/install-ec2-autodeploy.sh'),
    'utf8',
  );
  const environmentExample = readFileSync(
    resolve(__dirname, '../.env.example'),
    'utf8',
  );
  const productionCompose = readFileSync(
    resolve(__dirname, '../../infra/production.compose.yml'),
    'utf8',
  );
  const caddyfile = readFileSync(
    resolve(__dirname, '../../infra/Caddyfile'),
    'utf8',
  );
  const apiUnit = readFileSync(
    resolve(__dirname, '../../infra/systemd/studytube-api.service.in'),
    'utf8',
  );
  const aiUnit = readFileSync(
    resolve(__dirname, '../../infra/systemd/studytube-ai.service.in'),
    'utf8',
  );

  it('prepares the verified release and database before stopping managed services', () => {
    const immutableCheckout = script.indexOf(
      'git checkout --detach "$deploy_sha"',
    );
    const cleanCheckout = script.indexOf(
      'git status --porcelain --untracked-files=all',
    );
    const webBuild = script.indexOf('npm --prefix web run build');
    const apiBuild = script.indexOf('npm --prefix api run build');
    const aiInstall = script.indexOf(
      'ai/.venv/bin/python -m pip install -r ai/requirements.txt',
    );
    const postgresStart = script.indexOf(
      'docker compose -f infra/production.compose.yml up -d --wait postgres',
    );
    const migration = script.indexOf('npm --prefix api run db:migrate:up');
    const serviceStop = script.indexOf(
      'systemctl stop studytube-api.service studytube-ai.service',
    );
    const processStart = script.indexOf(
      'systemctl restart studytube-ai.service studytube-api.service',
    );
    const authGuards = [...script.matchAll(/^require_auth_cutover_backup$/gm)];
    const staleDeploymentGuard = script.indexOf(
      'if [ "$fetched_sha" != "$deploy_sha" ]',
    );

    expect(staleDeploymentGuard).toBeGreaterThanOrEqual(0);
    expect(immutableCheckout).toBeGreaterThan(staleDeploymentGuard);
    expect(cleanCheckout).toBeGreaterThan(immutableCheckout);
    expect(webBuild).toBeGreaterThan(immutableCheckout);
    expect(apiBuild).toBeGreaterThan(immutableCheckout);
    expect(postgresStart).toBeGreaterThan(cleanCheckout);
    expect(postgresStart).toBeLessThan(webBuild);
    expect(postgresStart).toBeLessThan(apiBuild);
    expect(authGuards).toHaveLength(2);
    expect(authGuards[0]?.index).toBeGreaterThan(postgresStart);
    expect(authGuards[0]?.index).toBeLessThan(webBuild);
    expect(serviceStop).toBeGreaterThan(authGuards[0]?.index ?? -1);
    expect(serviceStop).toBeGreaterThan(webBuild);
    expect(serviceStop).toBeGreaterThan(apiBuild);
    expect(serviceStop).toBeGreaterThan(aiInstall);
    expect(authGuards[1]?.index).toBeGreaterThan(serviceStop);
    expect(migration).toBeGreaterThan(webBuild);
    expect(migration).toBeGreaterThan(apiBuild);
    expect(migration).toBeGreaterThan(authGuards[1]?.index ?? -1);
    expect(processStart).toBeGreaterThan(migration);
  });

  it('fails closed when the checked-out release contains unverified files', () => {
    const immutableCheckout = script.indexOf(
      'git checkout --detach "$deploy_sha"',
    );
    const cleanCheckout = script.indexOf(
      'git status --porcelain --untracked-files=all',
    );
    const webBuild = script.indexOf('npm --prefix web run build');

    expect(script).toContain('Refusing to build a dirty deployment checkout');
    expect(cleanCheckout).toBeGreaterThan(immutableCheckout);
    expect(cleanCheckout).toBeLessThan(webBuild);
  });

  it('gates deployment on API readiness instead of liveness', () => {
    expect(script).toContain(
      'wait_for_url http://127.0.0.1:3000/health/ready api',
    );
    expect(script).not.toContain(
      'wait_for_url http://127.0.0.1:3000/health api',
    );
  });

  it('checks the AI process directly instead of using the session-protected API proxy', () => {
    expect(script).toContain('wait_for_url http://127.0.0.1:8000/health ai');
    expect(script).not.toContain(
      'wait_for_url http://127.0.0.1:3000/health/ai ai',
    );
  });

  it('uses production builds and managed services instead of development servers', () => {
    expect(script).toContain('npm --prefix web run build');
    expect(script).toContain('npm --prefix api run build');
    expect(script).not.toContain('npm run all');
    expect(script).not.toContain('setsid nohup');
    expect(script).not.toContain('wait_for_url http://localhost:5173/');
  });

  it('keeps every stateful or internal port off the public interface', () => {
    expect(productionCompose).toContain('name: studytube');
    expect(productionCompose).toContain('pgdata:/var/lib/postgresql/data');
    expect(productionCompose).toContain('127.0.0.1:5432:5432');
    expect(productionCompose).toContain('network_mode: host');
    expect(productionCompose).not.toMatch(/(?:^|["'])3000:3000/mu);
    expect(productionCompose).not.toMatch(/(?:^|["'])8000:8000/mu);
    expect(apiUnit).toContain('HOST=127.0.0.1 PORT=3000');
    expect(aiUnit).toContain('--host 127.0.0.1 --port 8000 --workers 1');
  });

  it('runs API and AI under restartable production systemd units', () => {
    expect(apiUnit).toContain('NODE_ENV=production');
    expect(apiUnit).toContain('api/dist/main.js');
    expect(apiUnit).toContain('Restart=on-failure');
    expect(aiUnit).toContain('-m uvicorn main:app');
    expect(aiUnit).not.toContain('--reload');
    expect(aiUnit).toContain('Restart=on-failure');
  });

  it('routes only the API prefix to Nest and serves an atomic web release', () => {
    const caddyValidation = script.lastIndexOf(
      'docker compose -f infra/production.compose.yml run --rm --no-deps caddy',
    );
    const webPublication = script.lastIndexOf('\npublish_web_release\n');

    expect(caddyfile).toContain('handle_path /api/*');
    expect(caddyfile).toContain('reverse_proxy 127.0.0.1:3000');
    expect(caddyfile).not.toContain('8000');
    expect(caddyfile).toContain('root * /var/www/studytube/current');
    expect(caddyfile).toContain('max-age=31536000, immutable');
    expect(caddyfile).toContain('Cache-Control "no-store"');
    expect(script).toContain('sudo mv -Tf -- "$temporary_link"');
    expect(script).toContain('write_deploy_success_marker');
    expect(caddyValidation).toBeGreaterThanOrEqual(0);
    expect(caddyValidation).toBeLessThan(webPublication);
  });

  it('requires one HTTPS origin for the edge and public smoke checks', () => {
    const originGuard = script.lastIndexOf('\nrequire_production_origins\n');
    const immutableCheckout = script.indexOf(
      'git checkout --detach "$deploy_sha"',
    );

    expect(script).toContain('STUDYTUBE_SITE_ADDRESS must use HTTPS');
    expect(script).toContain('STUDYTUBE_PUBLIC_URL must match WEB_ORIGIN');
    expect(script).toContain('public_base_url="$production_web_origin"');
    expect(originGuard).toBeGreaterThanOrEqual(0);
    expect(originGuard).toBeLessThan(immutableCheckout);
  });

  it('rejects a plaintext production edge before checkout or runtime mutation', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'studytube-origin-guard-'));
    const commandLog = join(workspace, 'commands.log');
    const bash =
      process.platform === 'win32' &&
      existsSync('C:\\Program Files\\Git\\bin\\bash.exe')
        ? 'C:\\Program Files\\Git\\bin\\bash.exe'
        : 'bash';
    const deployScript = shellPath(
      resolve(__dirname, '../../scripts/deploy-ec2.sh'),
    );
    const harness = `
git() {
  printf 'git %s\\n' "$*" >>"$COMMAND_LOG"
  case "$*" in
    *"rev-parse origin/"*) printf '%s\\n' "$DEPLOY_SHA" ;;
  esac
  return 0
}
flock() { return 0; }
docker() { printf 'docker %s\\n' "$*" >>"$COMMAND_LOG"; return 0; }
sudo() { printf 'sudo %s\\n' "$*" >>"$COMMAND_LOG"; return 0; }
source '${deployScript}'
`;

    try {
      const result = spawnSync(bash, ['-c', harness], {
        cwd: workspace,
        encoding: 'utf8',
        env: {
          ...process.env,
          APP_DIR: shellPath(workspace),
          COMMAND_LOG: shellPath(commandLog),
          COURSE_CUTOVER_MODE: 'legacy',
          DATABASE_URL: 'postgresql://unused.invalid/stubbed',
          DEPLOY_SHA: '0123456789abcdef0123456789abcdef01234567',
          POSTGRES_USER: 'app',
          POSTGRES_PASSWORD: 'app',
          POSTGRES_DB: 'app',
          STUDYTUBE_SITE_ADDRESS: 'http://studytube.example.test',
          WEB_ORIGIN: 'https://studytube.example.test',
        },
      });
      const commands = existsSync(commandLog)
        ? readFileSync(commandLog, 'utf8')
        : '';

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('STUDYTUBE_SITE_ADDRESS must use HTTPS');
      expect(commands).not.toContain('checkout');
      expect(commands).not.toContain('docker');
      expect(commands).not.toContain('systemctl');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('bounds health-check requests and always cleans their temporary output', () => {
    expect(script).toContain(
      'curl -fsS --connect-timeout 2 --max-time 5 "$url"',
    );
    expect(script).toContain('healthcheck_output="$(mktemp ');
    expect(script).toContain('rm -f "$healthcheck_output"');
    expect(script).toContain('trap cleanup_healthcheck_output EXIT');
    expect(script).not.toContain('/tmp/studytube-healthcheck.out');
  });

  it('runs the fetched deploy script before the workflow mutates watched source', () => {
    expect(workflow).toContain(
      'git show "$DEPLOY_SHA:scripts/deploy-ec2.sh" >"$deploy_script"',
    );
    expect(workflow).toContain('DEPLOY_SHA: ${{ github.sha }}');
    expect(workflow).toContain('if [ "$fetched_sha" != "$DEPLOY_SHA" ]');
    expect(workflow).not.toContain('git checkout "$DEPLOY_BRANCH"');
    expect(workflow).not.toContain(
      'git pull --ff-only origin "$DEPLOY_BRANCH"',
    );
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('timeout-minutes: 30');
  });

  it('syntax-checks every production runtime script independently', () => {
    expect(workflow).toContain('for script in');
    expect(workflow).toContain('bash -n "$script"');
    expect(workflow).not.toContain('run: >-\n          bash -n\n');
  });

  it('deploys the canonical main branch used by the standalone repository', () => {
    expect(script).toContain('deploy_branch="${1:-${DEPLOY_BRANCH:-main}}"');
    expect(autoDeployScript).toContain(
      'deploy_branch="${DEPLOY_BRANCH:-main}"',
    );
    expect(autoDeployInstaller).toContain(
      'deploy_branch="${DEPLOY_BRANCH:-main}"',
    );
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).not.toContain("github.ref == 'refs/heads/sw'");
    expect(workflow).not.toMatch(/^\s*- sw$/mu);
  });

  it('pins pull-based deployments to the exact successful CI commit', () => {
    expect(autoDeployScript).toContain('DEPLOY_SHA="$remote_sha"');
    expect(autoDeployScript).toContain(
      'git show "$remote_sha:scripts/deploy-ec2.sh" >"$deploy_script"',
    );
    expect(autoDeployScript).toContain('trap \'rm -f "$deploy_script"\' EXIT');
    expect(autoDeployScript).toContain(
      'if run.get("head_sha") == sha and run.get("name") == workflow_name:',
    );
    expect(autoDeployScript).toContain('deploy-success');
    expect(autoDeployScript).toContain(
      'systemctl is-active --quiet studytube-api.service',
    );
    expect(autoDeployScript).not.toContain(
      'current_sha="$(git rev-parse HEAD)"',
    );
  });

  it('refuses a pending irreversible auth cutover without a verified backup marker', () => {
    const guardInvocations = [
      ...script.matchAll(/^require_auth_cutover_backup$/gm),
    ];
    const guard = guardInvocations[0]?.index ?? -1;
    const finalGuard = guardInvocations[1]?.index ?? -1;
    const processShutdown = script.indexOf(
      'systemctl stop studytube-api.service studytube-ai.service',
    );
    const migration = script.indexOf('npm --prefix api run db:migrate:up');

    expect(script).toContain('auth_migration="1753660802000_auth-hardening"');
    expect(script).toContain('AUTH_CUTOVER_VERIFIED_BACKUP_MARKER');
    expect(script).toContain('backup_verified=true');
    expect(script).toContain('pgmigrations');
    expect(script).toContain('Refusing irreversible auth migration');
    expect(guardInvocations).toHaveLength(2);
    expect(guard).toBeLessThan(migration);
    expect(guard).toBeLessThan(processShutdown);
    expect(finalGuard).toBeGreaterThan(processShutdown);
    expect(finalGuard).toBeLessThan(migration);
  });

  it('treats a regular marker named --help as a filename and refuses its invalid contents', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'studytube-deploy-guard-'));
    const appDirectory = join(workspace, 'app');
    const commandLog = join(workspace, 'commands.log');
    const markerPath = join(appDirectory, '--help');
    const bash =
      process.platform === 'win32' &&
      existsSync('C:\\Program Files\\Git\\bin\\bash.exe')
        ? 'C:\\Program Files\\Git\\bin\\bash.exe'
        : 'bash';

    mkdirSync(appDirectory);
    const virtualenvBin = join(appDirectory, 'ai', '.venv', 'bin');
    const virtualenvPython = join(virtualenvBin, 'python');
    mkdirSync(virtualenvBin, { recursive: true });
    writeFileSync(virtualenvPython, '#!/usr/bin/env bash\nexit 0\n', 'utf8');
    chmodSync(virtualenvPython, 0o755);
    writeFileSync(markerPath, 'not-a-verified-backup\n', 'utf8');
    const deployScript = shellPath(
      resolve(__dirname, '../../scripts/deploy-ec2.sh'),
    );
    const harness = `
git() {
  printf '%s\\n' git >>"$COMMAND_LOG"
  case "$*" in
    *"rev-parse origin/"*) printf '%s\\n' "$DEPLOY_SHA" ;;
  esac
  return 0
}
flock() { return 0; }
docker() { printf '%s\\n' docker >>"$COMMAND_LOG"; return 0; }
psql() {
  printf '%s\\n' psql >>"$COMMAND_LOG"
  case "$*" in
    *to_regclass*) printf '%s\\n' pgmigrations ;;
    *) printf '%s\\n' f ;;
  esac
}
pkill() { printf '%s\\n' pkill >>"$COMMAND_LOG"; return 0; }
sudo() { printf '%s\\n' sudo >>"$COMMAND_LOG"; return 0; }
sleep() { printf '%s\\n' sleep >>"$COMMAND_LOG"; return 0; }
npm() { printf '%s\\n' npm >>"$COMMAND_LOG"; return 0; }
python3() { printf '%s\\n' python3 >>"$COMMAND_LOG"; return 0; }
setsid() { printf '%s\\n' setsid >>"$COMMAND_LOG"; return 0; }
curl() { printf '%s\\n' curl >>"$COMMAND_LOG"; return 0; }
source '${deployScript}'
`;

    try {
      const result = spawnSync(bash, ['-c', harness], {
        cwd: appDirectory,
        encoding: 'utf8',
        env: {
          ...process.env,
          APP_DIR: shellPath(appDirectory),
          AUTH_CUTOVER_VERIFIED_BACKUP_MARKER: '--help',
          COMMAND_LOG: shellPath(commandLog),
          DATABASE_URL: 'postgresql://unused.invalid/stubbed',
          DEPLOY_SHA: '0123456789abcdef0123456789abcdef01234567',
          POSTGRES_USER: 'app',
          POSTGRES_PASSWORD: 'app',
          POSTGRES_DB: 'app',
          STUDYTUBE_SITE_ADDRESS: 'studytube.example.test',
          WEB_ORIGIN: 'https://studytube.example.test',
        },
      });
      const commands = existsSync(commandLog)
        ? readFileSync(commandLog, 'utf8')
        : '';

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        'Refusing irreversible auth migration: the verified backup marker does not match',
      );
      expect(commands).not.toContain('pkill');
      expect(commands).not.toContain('npm');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('rehearses rollback only for the earlier concurrent-index migration in a disposable database', () => {
    expect(workflow).toContain('migration_rollback_test');
    expect(workflow).toContain('db:migrate:up -- 2');
    expect(workflow).toContain('db:migrate:down -- 1');
    expect(workflow).not.toContain(
      'Rehearse latest concurrent index rollback and reapply',
    );
  });

  it('fails closed on an unspecified production Course cutover mode before shutdown', () => {
    const configurationGuard = script.indexOf(
      '\nrequire_course_cutover_configuration\n',
    );
    const processShutdown = script.indexOf(
      'systemctl stop studytube-api.service studytube-ai.service',
    );

    expect(environmentExample).toContain('COURSE_CUTOVER_MODE=legacy');
    expect(script).toContain(
      'COURSE_CUTOVER_MODE must be explicitly set to legacy, freeze, or course',
    );
    expect(configurationGuard).toBeGreaterThanOrEqual(0);
    expect(configurationGuard).toBeLessThan(processShutdown);
  });

  it('keeps an explicit cutover mode authoritative over env-file defaults', () => {
    expect(script).toContain(
      'requested_course_cutover_mode="${COURSE_CUTOVER_MODE:-}"',
    );
    expect(script).toContain(
      'export COURSE_CUTOVER_MODE="$requested_course_cutover_mode"',
    );
  });

  it('records frozen parity and requires the same release SHA before first Course activation', () => {
    const frozenStart = script.indexOf(
      'systemctl restart studytube-ai.service studytube-api.service',
    );
    const readiness = script.lastIndexOf(
      'wait_for_url http://127.0.0.1:3000/health/ready api',
    );
    const deltaBackfill = script.indexOf(
      'npm --prefix api run db:course:backfill',
    );
    const exactVerification = script.indexOf(
      'npm --prefix api run db:course:verify',
    );
    const parityMarker = script.lastIndexOf('write_frozen_parity_marker');

    expect(script).toContain('COURSE_CUTOVER_STATE_DIR');
    expect(script).toContain('parity_verified=true');
    expect(script).toContain('deploy_sha=$deploy_sha');
    expect(script).toContain('database_identity=$course_database_identity');
    expect(script).toContain(
      'Refusing Course activation: frozen parity was not verified for DEPLOY_SHA=$deploy_sha',
    );
    expect(frozenStart).toBeGreaterThanOrEqual(0);
    expect(deltaBackfill).toBeGreaterThan(readiness);
    expect(exactVerification).toBeGreaterThan(deltaBackfill);
    expect(parityMarker).toBeGreaterThan(exactVerification);
  });

  it('invalidates stale frozen parity before legacy or replacement freeze traffic starts', () => {
    const invalidation = script.lastIndexOf(
      '\n  invalidate_frozen_parity_marker\n',
    );
    const processShutdown = script.indexOf(
      'systemctl stop studytube-api.service studytube-ai.service',
    );

    expect(invalidation).toBeGreaterThanOrEqual(0);
    expect(invalidation).toBeLessThan(processShutdown);
    expect(script).toContain(
      'if [ "$course_cutover_mode" != "course" ] && [ "$course_already_activated" = "false" ]',
    );
  });

  it('keeps post-activation recovery on freeze or Course without replaying legacy backfill', () => {
    expect(script).toContain('course_already_activated');
    expect(script).toContain(
      'Refusing legacy rollback after Course activation; native Course writes may already exist.',
    );
    expect(script).toContain(
      'Post-activation freeze: automatic legacy backfill is disabled; diagnose and roll forward.',
    );
    expect(script).toContain('write_course_activation_marker');
  });

  it('persists the irreversible activation boundary before Course traffic can start', () => {
    const activationMarker = script.lastIndexOf(
      'write_course_activation_marker',
    );
    const processStart = script.indexOf(
      'systemctl restart studytube-ai.service studytube-api.service',
    );

    expect(activationMarker).toBeGreaterThanOrEqual(0);
    expect(activationMarker).toBeLessThan(processStart);

    const activationWriterStart = script.indexOf(
      'write_course_activation_marker()',
    );
    const activationWriter = script.slice(
      activationWriterStart,
      script.indexOf('\n}', activationWriterStart) + 2,
    );
    expect(activationWriter).toContain(
      'database_identity=$course_database_identity',
    );
  });

  it('runs explicit Course migration and concurrency evidence in CI', () => {
    expect(workflow).toContain('Verify Course schema invariants');
    expect(workflow).toContain('course-schema.e2e-spec.ts');
    expect(workflow).toContain('Backfill and exactly verify legacy Courses');
    expect(workflow).toContain('ALLOW_COURSE_BACKFILL: "true"');
    expect(workflow).toContain('npm run db:course:backfill');
    expect(workflow).toContain('npm run db:course:verify');
    expect(workflow).toContain('Verify Course HTTP and concurrency contracts');
    expect(workflow).toContain('course-http.e2e-spec.ts');
    expect(workflow).toContain('course-concurrency.e2e-spec.ts');
  });
});
