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
  const environmentExample = readFileSync(
    resolve(__dirname, '../.env.example'),
    'utf8',
  );

  it('stops existing processes before updating code and migrates before restart', () => {
    const checkout = script.indexOf('git checkout "$deploy_branch"');
    const immutableCheckout = script.indexOf(
      'git checkout --detach "$deploy_sha"',
    );
    const pull = script.indexOf('git pull --ff-only origin "$deploy_branch"');
    const migration = script.indexOf('npm --prefix api run db:migrate:up');
    const firstProcessStop = script.indexOf('pkill ');
    const lastForcedStop = script.lastIndexOf('kill -9');
    const processStart = script.indexOf('setsid nohup npm run all');
    const staleDeploymentGuard = script.indexOf(
      'if [ "$fetched_sha" != "$deploy_sha" ]',
    );

    expect(staleDeploymentGuard).toBeGreaterThanOrEqual(0);
    expect(firstProcessStop).toBeGreaterThan(staleDeploymentGuard);
    expect(firstProcessStop).toBeGreaterThanOrEqual(0);
    expect(lastForcedStop).toBeGreaterThan(firstProcessStop);
    expect(immutableCheckout).toBeGreaterThan(lastForcedStop);
    expect(checkout).toBeGreaterThan(lastForcedStop);
    expect(pull).toBeGreaterThan(checkout);
    expect(migration).toBeGreaterThan(pull);
    expect(processStart).toBeGreaterThan(migration);
  });

  it('gates deployment on API readiness instead of liveness', () => {
    expect(script).toContain(
      'wait_for_url http://localhost:3000/health/ready api',
    );
    expect(script).not.toContain(
      'wait_for_url http://localhost:3000/health api',
    );
  });

  it('checks the AI process directly instead of using the session-protected API proxy', () => {
    expect(script).toContain('wait_for_url http://localhost:8000/health ai');
    expect(script).not.toContain(
      'wait_for_url http://localhost:3000/health/ai ai',
    );
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

  it('pins pull-based deployments to the exact successful CI commit', () => {
    expect(autoDeployScript).toContain('DEPLOY_SHA="$remote_sha"');
    expect(autoDeployScript).toContain(
      'git show "$remote_sha:scripts/deploy-ec2.sh" >"$deploy_script"',
    );
    expect(autoDeployScript).toContain('trap \'rm -f "$deploy_script"\' EXIT');
    expect(autoDeployScript).toContain(
      'if run.get("head_sha") == sha and run.get("name") == workflow_name:',
    );
  });

  it('refuses a pending irreversible auth cutover without a verified backup marker', () => {
    const guardInvocations = [
      ...script.matchAll(/^require_auth_cutover_backup$/gm),
    ];
    const guard = guardInvocations[0]?.index ?? -1;
    const processShutdown = script.indexOf("pkill -f '[n]pm run all'");
    const migration = script.indexOf('npm --prefix api run db:migrate:up');

    expect(script).toContain('auth_migration="1753660802000_auth-hardening"');
    expect(script).toContain('AUTH_CUTOVER_VERIFIED_BACKUP_MARKER');
    expect(script).toContain('backup_verified=true');
    expect(script).toContain('pgmigrations');
    expect(script).toContain('Refusing irreversible auth migration');
    expect(guardInvocations).toHaveLength(1);
    expect(guard).toBeLessThan(migration);
    expect(guard).toBeLessThan(processShutdown);
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
git() { printf '%s\\n' git >>"$COMMAND_LOG"; return 0; }
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
    const configurationGuard = script.lastIndexOf(
      '\nrequire_course_cutover_configuration\n',
    );
    const processShutdown = script.indexOf("pkill -f '[n]pm run all'");

    expect(environmentExample).toContain('COURSE_CUTOVER_MODE=legacy');
    expect(script).toContain(
      'COURSE_CUTOVER_MODE must be explicitly set to legacy, freeze, or course',
    );
    expect(configurationGuard).toBeGreaterThanOrEqual(0);
    expect(configurationGuard).toBeLessThan(processShutdown);
  });

  it('records frozen parity and requires the same release SHA before first Course activation', () => {
    const frozenStart = script.indexOf(
      'COURSE_CUTOVER_MODE="$course_cutover_mode" setsid nohup npm run all',
    );
    const readiness = script.lastIndexOf(
      'wait_for_url http://localhost:3000/health/ready api',
    );
    const deltaBackfill = script.indexOf(
      'npm --prefix api run db:course:backfill',
    );
    const exactVerification = script.indexOf(
      'npm --prefix api run db:course:verify',
    );
    const parityMarker = script.lastIndexOf(
      '\n    write_frozen_parity_marker\n',
    );

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
    const processShutdown = script.indexOf("pkill -f '[n]pm run all'");

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
      '\n  write_course_activation_marker\n',
    );
    const processStart = script.indexOf(
      'COURSE_CUTOVER_MODE="$course_cutover_mode" setsid nohup npm run all',
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
