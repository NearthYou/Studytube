import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
});
