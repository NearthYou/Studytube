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
  const runtimeInstaller = readFileSync(
    resolve(__dirname, '../../scripts/install-production-runtime.sh'),
    'utf8',
  );
  const immutableRunner = readFileSync(
    resolve(__dirname, '../../scripts/ssm-deploy-release.sh'),
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
  const apiProxyBlock = caddyfile.slice(
    caddyfile.indexOf('handle_path /api/* {'),
    caddyfile.indexOf(
      '\n\t\thandle {',
      caddyfile.indexOf('handle_path /api/* {'),
    ),
  );
  const apiUnit = readFileSync(
    resolve(__dirname, '../../infra/systemd/studytube-api.service.in'),
    'utf8',
  );
  const aiUnit = readFileSync(
    resolve(__dirname, '../../infra/systemd/studytube-ai.service.in'),
    'utf8',
  );
  const workerUnit = readFileSync(
    resolve(__dirname, '../../infra/systemd/studytube-worker.service.in'),
    'utf8',
  );
  const caddyUnit = readFileSync(
    resolve(__dirname, '../../infra/systemd/studytube-caddy.service.in'),
    'utf8',
  );
  const workerModule = readFileSync(
    resolve(__dirname, 'work/worker.module.ts'),
    'utf8',
  );
  const validProductionEnvironment = {
    AUTH_EMAIL_AWS_CREDENTIAL_SOURCE: 'instance-role',
    AUTH_EMAIL_AWS_REGION: 'ap-northeast-2',
    AUTH_EMAIL_PROVIDER: 'ses',
    AUTH_EMAIL_SENDER: 'no-reply@studytube.test',
    AUTH_RATE_LIMIT_PEPPER: 'c'.repeat(32),
    AUTH_VERIFICATION_PEPPER: 'b'.repeat(32),
    INTERNAL_AI_API_KEY: 'a'.repeat(32),
    MCP_SERVICE_ASSERTION_SECRET: 'd'.repeat(32),
    POSTGRES_PASSWORD: 'p'.repeat(32),
    STUDYTUBE_PUBLIC_URL: 'https://studytube.test',
  };

  it('prepares the verified release and database before stopping managed services', () => {
    const immutableCheckout = script.indexOf(
      'git checkout --detach "$deploy_sha"',
    );
    const cleanCheckout = script.indexOf(
      'git status --porcelain --untracked-files=all',
    );
    const isolatedPreparation = script.indexOf(
      'bash scripts/install-production-runtime.sh prepare-release',
    );
    const postgresStart = script.indexOf('--no-recreate postgres valkey');
    const cutoverDataStart = script.lastIndexOf(
      'docker compose -f infra/production.compose.yml up -d --wait postgres valkey',
    );
    const migration = script.indexOf(
      'bash scripts/install-production-runtime.sh run-migration',
    );
    const serviceStop = script.search(
      /^\s*seal_deployment_guard_for_cutover$/mu,
    );
    const processStart = script.indexOf(
      'systemctl restart studytube-ai.service studytube-api.service',
    );
    const migrationGuards = [
      ...script.matchAll(/^\s*require_irreversible_migration_backup$/gmu),
    ];
    const staleDeploymentGuard = script.indexOf(
      'if [ "$fetched_sha" != "$deploy_sha" ]',
    );

    expect(staleDeploymentGuard).toBeGreaterThanOrEqual(0);
    expect(immutableCheckout).toBeGreaterThan(staleDeploymentGuard);
    expect(cleanCheckout).toBeGreaterThan(immutableCheckout);
    expect(isolatedPreparation).toBeGreaterThan(immutableCheckout);
    expect(runtimeInstaller).toContain('--require-hashes');
    expect(runtimeInstaller).toContain('--only-binary=:all:');
    expect(runtimeInstaller).toContain('--ignore-scripts');
    expect(runtimeInstaller).toContain('--uid="$build_user"');
    expect(runtimeInstaller).toContain('IPAddressDeny=169.254.169.254/32');
    expect(postgresStart).toBeGreaterThan(cleanCheckout);
    expect(postgresStart).toBeLessThan(isolatedPreparation);
    expect(migrationGuards).toHaveLength(2);
    expect(migrationGuards[0]?.index).toBeGreaterThan(postgresStart);
    expect(migrationGuards[0]?.index).toBeLessThan(isolatedPreparation);
    expect(serviceStop).toBeGreaterThan(migrationGuards[0]?.index ?? -1);
    expect(serviceStop).toBeGreaterThan(isolatedPreparation);
    expect(cutoverDataStart).toBeGreaterThan(serviceStop);
    expect(migrationGuards[1]?.index).toBeGreaterThan(serviceStop);
    expect(migrationGuards[1]?.index).toBeGreaterThan(cutoverDataStart);
    expect(migration).toBeGreaterThan(isolatedPreparation);
    expect(migration).toBeGreaterThan(migrationGuards[1]?.index ?? -1);
    expect(processStart).toBeGreaterThan(migration);
  });

  it('fails closed when the checked-out release contains unverified files', () => {
    const immutableCheckout = script.indexOf(
      'git checkout --detach "$deploy_sha"',
    );
    const cleanCheckout = script.indexOf(
      'git status --porcelain --untracked-files=all',
    );
    const isolatedPreparation = script.indexOf(
      'bash scripts/install-production-runtime.sh prepare-release',
    );

    expect(script).toContain('Refusing to build a dirty deployment checkout');
    expect(cleanCheckout).toBeGreaterThan(immutableCheckout);
    expect(cleanCheckout).toBeLessThan(isolatedPreparation);
  });

  it('gates deployment on API readiness instead of liveness', () => {
    expect(script).toContain(
      'wait_for_unix_url /run/studytube/api.sock http://localhost/health/ready api',
    );
    expect(script).not.toContain(
      'wait_for_url http://127.0.0.1:3000/health/ready api',
    );
  });

  it('checks the AI process directly instead of using the session-protected API proxy', () => {
    expect(script).toContain('wait_for_url http://127.0.0.1:8000/health ai');
    expect(script).not.toContain(
      'wait_for_url http://127.0.0.1:3000/health/ai ai',
    );
  });

  it('uses production builds and managed services instead of development servers', () => {
    expect(script).toContain(
      'bash scripts/install-production-runtime.sh prepare-release',
    );
    expect(runtimeInstaller).toMatch(
      /run_isolated_build_command offline studytube-release-web-build\.service \\\s+"\$npm_bin" --prefix web run build --ignore-scripts/u,
    );
    expect(runtimeInstaller).toMatch(
      /run_isolated_build_command offline studytube-release-api-build\.service \\\s+"\$npm_bin" --prefix api run build --ignore-scripts/u,
    );
    expect(script).not.toContain('npm run all');
    expect(script).not.toContain('setsid nohup');
    expect(script).not.toContain('wait_for_url http://localhost:5173/');
  });

  it('runs Course cutover tools from compiled output after pruning dev dependencies', () => {
    expect(runtimeInstaller).toContain('api/dist/scripts/backfill-courses.js');
    expect(runtimeInstaller).toContain(
      'api/dist/scripts/verify-course-backfill.js',
    );
    expect(runtimeInstaller).not.toContain(
      'true --prefix api run db:course:backfill',
    );
    expect(runtimeInstaller).not.toContain(
      'false --prefix api run db:course:verify',
    );
  });

  it('opens only the host-owned recovery guard before restarting application services', () => {
    const guardRelease = script.lastIndexOf('release_deployment_guard');
    const serviceRestart = script.indexOf(
      'systemctl restart studytube-ai.service studytube-api.service studytube-worker.service',
    );

    expect(script).toContain(
      "readonly deployment_guard_path='/run/studytube-deploy/resume-active'",
    );
    expect(script).toContain(
      "readonly deployment_guard_service='studytube-deploy-resume-guard.service'",
    );
    expect(guardRelease).toBeGreaterThanOrEqual(0);
    expect(serviceRestart).toBeGreaterThan(guardRelease);
  });

  it('keeps the current release live through preparation and seals only for cutover', () => {
    const activationStart = immutableRunner.indexOf('\nactivate_release() {');
    const activationEnd = immutableRunner.indexOf(
      '\nprune_releases() {',
      activationStart,
    );
    const activation = immutableRunner.slice(activationStart, activationEnd);
    const watchdogStart = activation.indexOf('start_deployment_watchdog');
    const releaseDeploy = activation.indexOf(
      'invoke_interlocked_release_deploy',
    );
    const releaseBuild = script.indexOf(
      'bash scripts/install-production-runtime.sh prepare-release',
    );
    const cutoverSeal = script.search(
      /^\s*seal_deployment_guard_for_cutover$/mu,
    );
    const runtimeInstall = script.indexOf(
      'bash scripts/install-production-runtime.sh\n',
    );
    const migration = script.indexOf(
      'bash scripts/install-production-runtime.sh run-migration',
    );

    expect(immutableRunner).toContain('activate_release "$deployment_mode"');
    expect(activation).toContain('local activation_mode="$1"');
    expect(activation).toContain(
      'if [[ "$activation_mode" == \'recovery\' ]]; then',
    );
    expect(watchdogStart).toBeGreaterThanOrEqual(0);
    expect(releaseDeploy).toBeGreaterThan(watchdogStart);
    expect(releaseBuild).toBeGreaterThanOrEqual(0);
    expect(cutoverSeal).toBeGreaterThan(releaseBuild);
    expect(runtimeInstall).toBeGreaterThan(cutoverSeal);
    expect(migration).toBeGreaterThan(cutoverSeal);
    const applicationUnits = immutableRunner.slice(
      immutableRunner.indexOf('readonly -a APPLICATION_UNITS=('),
      immutableRunner.indexOf('readonly -a RELEASE_TRANSIENT_UNITS=('),
    );
    expect(applicationUnits).toContain('studytube-caddy.service');
    expect(immutableRunner).toContain(
      'systemctl stop "${APPLICATION_UNITS[@]}"',
    );
    expect(activation).toContain('finalize_pre_cutover_failure');
    expect(activation).toContain('cutover_state="$(cutover_started_state)"');
    expect(immutableRunner).toContain(
      'STUDYTUBE_CUTOVER_STARTED_PATH="$cutover_started_path"',
    );
    expect(immutableRunner).toContain(
      'Interrupted pre-cutover deployment restored %s.',
    );
    expect(immutableRunner).toContain('COURSE_ACTIVATION_BASELINE');
    expect(immutableRunner).toContain(
      'previous_release_course_activation_state',
    );
    expect(immutableRunner).toContain(
      'pending activation state has no durable Course activation baseline',
    );
    const cutoverSealFunction = script.slice(
      script.indexOf('\nseal_deployment_guard_for_cutover() {'),
      script.indexOf('\nload_deployment_environment() {'),
    );
    expect(
      cutoverSealFunction.indexOf('write_cutover_started_marker'),
    ).toBeLessThan(cutoverSealFunction.indexOf('seal-resume-guard'));
    expect(script).toContain(
      '$state_dir/$deployment_owner_sha-cutover-started',
    );
  });

  it('preserves supported database and authenticated OTLP runtime settings', () => {
    const apiKeys = runtimeInstaller.slice(
      runtimeInstaller.indexOf('api_environment_keys=('),
      runtimeInstaller.indexOf('ai_environment_keys=('),
    );
    const workerKeys = runtimeInstaller.slice(
      runtimeInstaller.indexOf('worker_environment_keys=('),
      runtimeInstaller.indexOf('migration_environment_keys=('),
    );
    const supportedKeys = [
      'DB_QUERY_TIMEOUT_MS',
      'OTEL_SERVICE_NAME',
      'OTEL_EXPORTER_OTLP_HEADERS',
      'OTEL_EXPORTER_OTLP_TRACES_HEADERS',
      'OTEL_EXPORTER_OTLP_PROTOCOL',
      'OTEL_EXPORTER_OTLP_TRACES_PROTOCOL',
      'OTEL_EXPORTER_OTLP_TIMEOUT',
      'OTEL_EXPORTER_OTLP_TRACES_TIMEOUT',
      'OTEL_EXPORTER_OTLP_CERTIFICATE',
      'OTEL_EXPORTER_OTLP_TRACES_CERTIFICATE',
      'OTEL_EXPORTER_OTLP_CLIENT_KEY',
      'OTEL_EXPORTER_OTLP_TRACES_CLIENT_KEY',
      'OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE',
      'OTEL_EXPORTER_OTLP_TRACES_CLIENT_CERTIFICATE',
    ];

    for (const key of supportedKeys) {
      expect(apiKeys).toContain(`  ${key}\n`);
      expect(workerKeys).toContain(`  ${key}\n`);
    }
  });

  it('keeps every stateful or internal port off the public interface', () => {
    expect(productionCompose).toContain('name: studytube');
    expect(productionCompose).toContain('pgdata:/var/lib/postgresql/data');
    expect(productionCompose).toContain('127.0.0.1:5432:5432');
    expect(productionCompose).not.toContain('network_mode: host');
    expect(productionCompose).not.toMatch(/(?:^|["'])3000:3000/mu);
    expect(productionCompose).not.toMatch(/(?:^|["'])8000:8000/mu);
    expect(apiUnit).toContain('API_SOCKET_PATH=/run/studytube/api.sock');
    expect(apiUnit).toContain(
      'NODE_ENV=production AUTH_TRUST_PROXY_ONE_HOP=true',
    );
    expect(apiUnit).toContain('RuntimeDirectory=studytube');
    expect(apiUnit).not.toContain('HOST=127.0.0.1 PORT=3000');
    expect(productionCompose).toContain('/run/studytube:/run/studytube:ro');
    expect(aiUnit).toContain('--host 127.0.0.1 --port 8000 --workers 1');
  });

  it('keeps host-only data ports reachable from host-managed services', () => {
    expect(productionCompose).not.toMatch(
      /postgres_data:\s*\r?\n\s*internal:\s*true/u,
    );
    expect(productionCompose).not.toMatch(
      /valkey_data:\s*\r?\n\s*internal:\s*true/u,
    );
  });

  it('preserves the Caddy bind-mounted runtime directory while the API is stopped', () => {
    expect(apiUnit).toContain('RuntimeDirectoryPreserve=yes');
  });

  it('runs API and AI under restartable production systemd units', () => {
    expect(apiUnit).toContain('NODE_ENV=production');
    expect(apiUnit).toContain('api/dist/src/main.js');
    expect(apiUnit).toContain('Restart=on-failure');
    expect(aiUnit).toContain('-m uvicorn main:app');
    expect(aiUnit).not.toContain('--reload');
    expect(aiUnit).toContain('Restart=on-failure');
  });

  it('gives only the AI service a private writable cache home for BGUtil', () => {
    expect(aiUnit).toContain('CacheDirectory=studytube-ai');
    expect(aiUnit).toContain('CacheDirectoryMode=0700');
    expect(aiUnit).toContain('Environment=HOME=/var/cache/studytube-ai');
    expect(aiUnit).toContain(
      'Environment=XDG_CACHE_HOME=/var/cache/studytube-ai',
    );
    for (const unit of [apiUnit, workerUnit, caddyUnit]) {
      expect(unit).not.toContain('CacheDirectory=studytube-ai');
      expect(unit).not.toContain('HOME=/var/cache/studytube-ai');
    }
  });

  it('recovers every runtime service after the Docker daemon restarts', () => {
    for (const unit of [apiUnit, aiUnit, workerUnit, caddyUnit]) {
      expect(unit).toContain('Wants=network-online.target');
      expect(unit).not.toContain('Wants=network-online.target docker.service');
      expect(unit).toContain('StartLimitIntervalSec=0');
      expect(unit).not.toContain('Requires=docker.service');
    }
    expect(caddyUnit).toContain('Restart=always');
  });

  it('permits only the worker to resolve short-lived IMDSv2 role credentials', () => {
    expect(workerUnit).not.toContain('IPAddressDeny=169.254.169.254/32');
    expect(workerUnit).not.toContain('IPAddressDeny=fd00:ec2::254/128');
    expect(workerUnit).toContain('AWS_EC2_METADATA_V1_DISABLED=true');
    for (const unit of [apiUnit, aiUnit]) {
      expect(unit).toContain('IPAddressDeny=169.254.169.254/32');
      expect(unit).toContain('IPAddressDeny=fd00:ec2::254/128');
    }
  });

  it('uses only the EC2 instance role for SES credentials', () => {
    expect(workerModule).toContain('fromInstanceMetadata({');
    expect(workerModule).toContain('ec2MetadataV1Disabled: true');
    expect(workerModule).not.toContain('config.sesCredentials');
    expect(runtimeInstaller).toMatch(
      /worker_environment_keys=\([\s\S]*AUTH_EMAIL_AWS_CREDENTIAL_SOURCE[\s\S]*\)/u,
    );
    expect(runtimeInstaller).not.toMatch(
      /AUTH_EMAIL_AWS_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)/u,
    );
  });

  it('routes the API, denies internal MCP at the edge, and serves an atomic web release', () => {
    const caddyValidation = script.lastIndexOf(
      'docker compose -f infra/production.compose.yml run --rm --no-deps caddy',
    );
    const webPublication = script.lastIndexOf('\n  publish_web_release\n');

    expect(caddyfile).toContain('handle_path /api/*');
    expect(caddyfile).toContain('reverse_proxy unix//run/studytube/api.sock');
    expect(caddyfile).toContain('/mcp /mcp/*');
    expect(caddyfile).toContain('/.well-known/oauth-protected-resource/*');
    expect(caddyfile).toContain('header @private_api Cache-Control "no-store"');
    expect(caddyfile).toContain('respond @private_api 404');
    expect(caddyfile).not.toContain('reverse_proxy 127.0.0.1:8000');
    expect(caddyfile).not.toContain('flush_interval -1');
    expect(caddyfile).toContain('root * /var/www/studytube/current');
    expect(caddyfile).toContain('max-age=31536000, immutable');
    expect(caddyfile).toContain('Cache-Control "no-store"');
    expect(caddyfile.match(/header Cache-Control "no-store"/gu)).toHaveLength(
      1,
    );
    expect(caddyfile).toContain('header @documents Cache-Control "no-store"');
    expect(script).toContain('sudo mv -Tf -- "$temporary_link"');
    expect(script).toContain('write_deploy_success_marker');
    expect(caddyValidation).toBeGreaterThanOrEqual(0);
    expect(script).toContain(
      'caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile',
    );
    expect(caddyValidation).toBeLessThan(webPublication);
  });

  it('keeps the public edge off the host network and data services isolated', () => {
    expect(productionCompose).not.toContain('network_mode: host');
    expect(productionCompose).toContain('"80:80"');
    expect(productionCompose).toContain('"443:443"');
    expect(productionCompose).toContain('"443:443/udp"');
    expect(productionCompose).toContain('cap_drop:');
    expect(productionCompose).toContain('- ALL');
    expect(productionCompose).toContain('cap_add:');
    expect(productionCompose).toContain('- NET_BIND_SERVICE');
    expect(productionCompose).toContain('${STUDYTUBE_API_SOCKET_GID:-0}');
    expect(script).toContain('export STUDYTUBE_API_SOCKET_GID');
    expect(productionCompose).toMatch(
      /postgres:[\s\S]*networks:\s*\n\s*- postgres_data[\s\S]*valkey:[\s\S]*networks:\s*\n\s*- valkey_data[\s\S]*caddy:[\s\S]*networks:\s*\n\s*- edge/u,
    );
    expect(productionCompose).toMatch(/postgres_data:\s*\n\s*driver: bridge/u);
    expect(productionCompose).toMatch(/valkey_data:\s*\n\s*driver: bridge/u);
    expect(productionCompose).toMatch(
      /caddy:[\s\S]*?restart: "no"[\s\S]*?ports:/u,
    );
    expect(caddyUnit).toContain(
      'ExecStart=/usr/bin/docker start --attach studytube-caddy',
    );
    expect(caddyUnit).toContain('PrivateNetwork=true');
    expect(runtimeInstaller).toContain('studytube-caddy.service');
    expect(script).toContain(
      'docker compose -f infra/production.compose.yml create --force-recreate caddy',
    );
    expect(script).toContain('systemctl restart studytube-caddy.service');
  });

  it('retains request paths and response statuses without logging query values', () => {
    const accessLogBlock = caddyfile.slice(
      caddyfile.indexOf('\n\tlog {'),
      caddyfile.indexOf('\n\theader {'),
    );
    const queryCanary = 'private-study-search';
    const requestUri = `/api/study-board?search=${queryCanary}&page=1`;
    const uriFilterPattern = accessLogBlock.match(
      /request>uri regexp (\\\?\.\*\$) ""/u,
    )?.[1];

    expect(accessLogBlock).toContain('format filter {');
    expect(accessLogBlock).toContain('request>uri regexp \\?.*$ ""');
    expect(accessLogBlock).toContain('request>headers>Referer delete');
    expect(accessLogBlock).toContain('wrap console');
    expect(accessLogBlock).not.toContain('request>uri delete');
    expect(accessLogBlock).not.toMatch(/(?:^|\s)status\s+delete(?:\s|$)/u);
    expect(uriFilterPattern).toBeDefined();
    expect(
      requestUri.replace(new RegExp(uriFilterPattern ?? '', 'u'), ''),
    ).toBe('/api/study-board');
  });

  it('keeps readiness private and rebuilds one trusted forwarding hop', () => {
    const privateApiPaths =
      caddyfile
        .match(/^\s*@private_api path (?<paths>.+)$/mu)
        ?.groups?.paths.trim()
        .split(/\s+/u) ?? [];

    expect(privateApiPaths).toEqual(
      expect.arrayContaining([
        '/api/health/ready',
        '/api/health/ready/*',
        '/api/health/ai',
        '/api/health/ai/*',
        '/api/health/db',
        '/api/health/db/*',
      ]),
    );
    expect(caddyfile).toContain('/api/internal/*');
    expect(caddyfile).toContain('respond @private_api 404');
    expect(apiProxyBlock).toContain(
      'reverse_proxy unix//run/studytube/api.sock',
    );
    expect(apiProxyBlock.match(/header_up -X-Forwarded-For/gu)).toHaveLength(1);
    expect(
      apiProxyBlock.match(/header_up X-Forwarded-For \{remote_host\}/gu),
    ).toHaveLength(1);
    expect(caddyfile).toContain(
      'Strict-Transport-Security "max-age=31536000; includeSubDomains"',
    );
    expect(caddyfile).toContain("Content-Security-Policy \"default-src 'self'");
    expect(caddyfile).toContain('Permissions-Policy "camera=()');
    expect(caddyfile).toContain('X-Frame-Options "DENY"');
    expect(script).toContain(
      'wait_for_url "$public_base_url/api/health/live" public-api',
    );
    expect(script).not.toContain(
      'wait_for_url "$public_base_url/api/health/ready" public-api',
    );
  });

  it('orders private API denial ahead of the API proxy', () => {
    const orderedRouteStart = caddyfile.indexOf('\n\troute {');
    const privateDenial = caddyfile.indexOf(
      'respond @private_api 404',
      orderedRouteStart,
    );
    const apiProxy = caddyfile.indexOf(
      'handle_path /api/* {',
      orderedRouteStart,
    );

    expect(orderedRouteStart).toBeGreaterThanOrEqual(0);
    expect(privateDenial).toBeGreaterThan(orderedRouteStart);
    expect(apiProxy).toBeGreaterThan(privateDenial);
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

  it.each([
    ['missing', undefined],
    ['short', 'too-short'],
    ['placeholder', 'replace-with-a-random-production-secret'],
    ['reused INTERNAL_AI_API_KEY', 'a'.repeat(32)],
    ['reused AUTH_VERIFICATION_PEPPER', 'b'.repeat(32)],
    ['reused AUTH_RATE_LIMIT_PEPPER', 'c'.repeat(32)],
  ])(
    'rejects a %s MCP service assertion secret before checkout',
    (_case, secret) => {
      const workspace = mkdtempSync(join(tmpdir(), 'studytube-mcp-guard-'));
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
    *"checkout"*) return 97 ;;
  esac
  return 0
}
timeout() {
  while [[ "\${1:-}" == --* ]]; do shift; done
  shift
  "$@"
}
flock() {
  case "\${*: -1}" in
    197|198) return 1 ;;
    *) return 0 ;;
  esac
}
readlink() {
  case "\${*: -1}" in
    /proc/*/fd/200) printf '%s\\n' "$STUDYTUBE_WATCHDOG_LEASE_PATH" ;;
    /proc/*/fd/201) printf '%s\\n' "$STUDYTUBE_OWNER_PROOF_PATH" ;;
    *) printf '%s\\n' "\${*: -1}" ;;
  esac
}
stat() {
  case "$*" in
    *'%u'*) printf '0\\n' ;;
    *'%a'*) printf '600\\n' ;;
    *) command stat "$@" ;;
  esac
}
docker() { printf 'docker %s\\n' "$*" >>"$COMMAND_LOG"; return 0; }
sudo() { printf 'sudo %s\\n' "$*" >>"$COMMAND_LOG"; return 0; }
source '${deployScript}'
`;
      const deploymentEnvironment: NodeJS.ProcessEnv = {
        ...process.env,
        ...validProductionEnvironment,
        APP_DIR: workspace,
        COMMAND_LOG: commandLog,
        COURSE_CUTOVER_MODE: 'legacy',
        DATABASE_URL: 'postgresql://unused.invalid/stubbed',
        DEPLOY_LOCK_FILE: join(workspace, 'deploy.lock'),
        DEPLOY_SHA: '0123456789abcdef0123456789abcdef01234567',
        POSTGRES_USER: 'app',
        POSTGRES_DB: 'app',
        STUDYTUBE_PUBLIC_URL: 'https://studytube.example.test',
        STUDYTUBE_SITE_ADDRESS: 'studytube.example.test',
        WEB_ORIGIN: 'https://studytube.example.test',
      };

      if (secret === undefined) {
        delete deploymentEnvironment.MCP_SERVICE_ASSERTION_SECRET;
      } else {
        deploymentEnvironment.MCP_SERVICE_ASSERTION_SECRET = secret;
      }

      try {
        const result = spawnSync(bash, ['-c', harness], {
          cwd: workspace,
          encoding: 'utf8',
          env: deploymentEnvironment,
        });
        const commands = existsSync(commandLog)
          ? readFileSync(commandLog, 'utf8')
          : '';

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('MCP_SERVICE_ASSERTION_SECRET');
        expect(commands).not.toContain('checkout');
        expect(commands).not.toContain('docker');
      } finally {
        rmSync(workspace, { recursive: true, force: true });
      }
    },
  );

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
          ...validProductionEnvironment,
          APP_DIR: shellPath(workspace),
          COMMAND_LOG: shellPath(commandLog),
          COURSE_CUTOVER_MODE: 'legacy',
          DATABASE_URL: 'postgresql://unused.invalid/stubbed',
          DEPLOY_SHA: '0123456789abcdef0123456789abcdef01234567',
          POSTGRES_USER: 'app',
          POSTGRES_DB: 'app',
          STUDYTUBE_PUBLIC_URL: 'https://studytube.example.test',
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

  it('deploys the exact verified artifact through short-lived AWS credentials and SSM', () => {
    expect(workflow).toMatch(
      /aws-actions\/configure-aws-credentials@[0-9a-f]{40} # v\d+\.\d+\.\d+/u,
    );
    expect(workflow).not.toMatch(
      /aws-actions\/configure-aws-credentials@v\d+/u,
    );
    expect(workflow).toContain('id-token: write');
    expect(workflow).toContain('scripts/build-release-artifact.sh');
    expect(workflow).toContain('scripts/send-ssm-deployment.sh');
    expect(workflow).toContain('DEPLOY_SHA: ${{ github.sha }}');
    expect(workflow).toContain('AWS_SSM_INSTANCE_ID');
    expect(workflow).toContain('AWS_RELEASE_BUCKET');
    expect(workflow).not.toContain('EC2_SSH_KEY');
    expect(workflow).not.toContain('ssh-keyscan');
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('timeout-minutes: 175');
    expect(workflow).toMatch(
      /name: deployment-diagnostics-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}[\s\S]*?path: \.deployment-diagnostics\s+include-hidden-files: true/u,
    );
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

  it('refuses pending irreversible migrations without a matching verified backup marker', () => {
    const guardInvocations = [
      ...script.matchAll(/^\s*require_irreversible_migration_backup$/gmu),
    ];
    const guard = guardInvocations[0]?.index ?? -1;
    const finalGuard = guardInvocations[1]?.index ?? -1;
    const processShutdown = script.search(
      /^\s*seal_deployment_guard_for_cutover$/mu,
    );
    const migration = script.indexOf(
      'bash scripts/install-production-runtime.sh run-migration',
    );

    expect(script).toContain('"1753660802000_auth-hardening"');
    expect(script).toContain('"1753660805000_retrieval-source-model-key"');
    expect(script).toContain('IRREVERSIBLE_MIGRATIONS_VERIFIED_BACKUP_MARKER');
    expect(script).toContain('backup_verified=true');
    expect(script).toContain('pgmigrations');
    expect(script).toContain('Refusing irreversible migration');
    expect(guardInvocations).toHaveLength(2);
    expect(guard).toBeLessThan(migration);
    expect(guard).toBeLessThan(processShutdown);
    expect(finalGuard).toBeGreaterThan(processShutdown);
    expect(finalGuard).toBeLessThan(migration);
  });

  it('records the destructive retrieval survivor count and requires zero duplicates afterward', () => {
    const migration = script.indexOf(
      'bash scripts/install-production-runtime.sh run-migration',
    );
    const before = script.indexOf('retrieval_duplicate_rows_before=%s');
    const after = script.indexOf('retrieval_duplicate_rows_after=%s');

    expect(script).toContain('GROUP BY source_kind, source_id, model');
    expect(script).toContain('HAVING count(*) > 1');
    expect(script).toContain(
      'Retrieval duplicate verification failed after migration',
    );
    expect(before).toBeGreaterThanOrEqual(0);
    expect(before).toBeLessThan(migration);
    expect(after).toBeGreaterThan(migration);
  });

  it('rejects a relative backup marker before any release mutation', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'studytube-deploy-guard-'));
    const appDirectory = join(workspace, 'app');
    const commandLog = join(workspace, 'commands.log');
    const markerPath = join(appDirectory, '--help');
    const deploySha = '0123456789abcdef0123456789abcdef01234567';
    const stateDirectory = join(workspace, 'deployment-state');
    const watchdogLease = join(stateDirectory, `${deploySha}-watchdog.lease`);
    const ownerProof = join(stateDirectory, `${deploySha}-owner-proof.lock`);
    const watchdogControl = join(
      stateDirectory,
      `${deploySha}-watchdog-control.lock`,
    );
    const watchdogArmed = join(stateDirectory, `${deploySha}-watchdog-armed`);
    const bash =
      process.platform === 'win32' &&
      existsSync('C:\\Program Files\\Git\\bin\\bash.exe')
        ? 'C:\\Program Files\\Git\\bin\\bash.exe'
        : 'bash';

    mkdirSync(appDirectory);
    mkdirSync(stateDirectory);
    writeFileSync(watchdogLease, '', 'utf8');
    writeFileSync(ownerProof, '', 'utf8');
    writeFileSync(watchdogControl, '', 'utf8');
    writeFileSync(
      watchdogArmed,
      `STUDYTUBE_WATCHDOG_ARMED_FORMAT=1\nDEPLOY_SHA=${deploySha}\nWATCHDOG_PID=4242\n`,
      'utf8',
    );
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
timeout() {
  while [[ "\${1:-}" == --* ]]; do shift; done
  shift
  "$@"
}
flock() {
  case "\${*: -1}" in
    197|198) return 1 ;;
    *) return 0 ;;
  esac
}
readlink() {
  case "\${*: -1}" in
    /proc/*/fd/200) printf '%s\\n' "$STUDYTUBE_WATCHDOG_LEASE_PATH" ;;
    /proc/*/fd/201) printf '%s\\n' "$STUDYTUBE_OWNER_PROOF_PATH" ;;
    *) printf '%s\\n' "\${*: -1}" ;;
  esac
}
stat() {
  case "$*" in
    *'%u'*) printf '0\\n' ;;
    *'%a'*) printf '600\\n' ;;
    *) command stat "$@" ;;
  esac
}
docker() { printf '%s\\n' docker >>"$COMMAND_LOG"; return 0; }
psql() {
  printf '%s\\n' psql >>"$COMMAND_LOG"
  case "$*" in
    *to_regclass*) printf '%s\\n' pgmigrations ;;
    *) printf '%s\\n' f ;;
  esac
}
pkill() { printf '%s\\n' pkill >>"$COMMAND_LOG"; return 0; }
sudo() {
  printf '%s\\n' sudo >>"$COMMAND_LOG"
  if [[ "$*" == *'systemctl show'*'--property=MainPID --value'* ]]; then
    printf '4242\\n'
  fi
  return 0
}
sleep() { printf '%s\\n' sleep >>"$COMMAND_LOG"; return 0; }
npm() { printf '%s\\n' npm >>"$COMMAND_LOG"; return 0; }
python3() { printf '%s\\n' python3 >>"$COMMAND_LOG"; return 0; }
setsid() { printf '%s\\n' setsid >>"$COMMAND_LOG"; return 0; }
curl() { printf '%s\\n' curl >>"$COMMAND_LOG"; return 0; }
exec 200<>"$STUDYTUBE_WATCHDOG_LEASE_PATH"
exec 201<>"$STUDYTUBE_OWNER_PROOF_PATH"
source '${deployScript}'
`;

    try {
      const result = spawnSync(bash, ['-c', harness], {
        cwd: appDirectory,
        encoding: 'utf8',
        env: {
          ...process.env,
          ...validProductionEnvironment,
          APP_DIR: shellPath(appDirectory),
          IRREVERSIBLE_MIGRATIONS_VERIFIED_BACKUP_MARKER: '--help',
          COMMAND_LOG: shellPath(commandLog),
          DATABASE_URL: 'postgresql://unused.invalid/stubbed',
          DEPLOY_SHA: deploySha,
          POSTGRES_USER: 'app',
          POSTGRES_DB: 'app',
          STUDYTUBE_DEPLOYMENT_OWNER_SHA: deploySha,
          STUDYTUBE_SCHEMA_BARRIER_PATH: shellPath(
            join(stateDirectory, `${deploySha}-schema-barrier`),
          ),
          STUDYTUBE_CUTOVER_STARTED_PATH: shellPath(
            join(stateDirectory, `${deploySha}-cutover-started`),
          ),
          STUDYTUBE_WATCHDOG_LEASE_PATH: shellPath(watchdogLease),
          STUDYTUBE_OWNER_PROOF_PATH: shellPath(ownerProof),
          STUDYTUBE_WATCHDOG_CONTROL_PATH: shellPath(watchdogControl),
          STUDYTUBE_WATCHDOG_TRIP_PATH: shellPath(
            join(stateDirectory, `${deploySha}-watchdog-tripped`),
          ),
          STUDYTUBE_WATCHDOG_CANCEL_PATH: shellPath(
            join(stateDirectory, `${deploySha}-watchdog-cancelled`),
          ),
          STUDYTUBE_WATCHDOG_ARMED_PATH: shellPath(watchdogArmed),
          STUDYTUBE_PUBLIC_URL: 'https://studytube.example.test',
          STUDYTUBE_SITE_ADDRESS: 'studytube.example.test',
          WEB_ORIGIN: 'https://studytube.example.test',
        },
      });
      const commands = existsSync(commandLog)
        ? readFileSync(commandLog, 'utf8')
        : '';

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        'must name the root-only host marker at /var/lib/studytube/migration-backup/verified-backup',
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
    const configurationGuard = script.search(
      /^\s*require_course_cutover_configuration$/mu,
    );
    const processShutdown = script.search(
      /^\s*seal_deployment_guard_for_cutover$/mu,
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

  it('loads deployment values literally and rejects process-control environment names', () => {
    expect(script).toContain('load_deployment_environment ./.env');
    expect(script).toContain('load_deployment_environment ./api/.env');
    expect(script).toContain('export "$key=$value"');
    expect(script).toContain('BASH_ENV|BASHOPTS|CDPATH|ENV');
    expect(script).toContain('NODE_OPTIONS|PYTHONHOME|PYTHONPATH');
    expect(script).not.toContain('source ./.env');
    expect(script).not.toContain('source ./api/.env');
  });

  it('records frozen parity and requires the same release SHA before first Course activation', () => {
    const frozenStart = script.indexOf(
      'systemctl restart studytube-ai.service studytube-api.service',
    );
    const readiness = script.lastIndexOf(
      'wait_for_unix_url /run/studytube/api.sock http://localhost/health/ready api',
    );
    const deltaBackfill = script.indexOf(
      'bash scripts/install-production-runtime.sh run-course-backfill',
    );
    const exactVerification = script.indexOf(
      'bash scripts/install-production-runtime.sh run-course-verify',
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

  it('migrates classified pre-immutable Course state before deciding the cutover mode', () => {
    const migration = script.indexOf(
      'run_controlled_deployment_mutation migrate_legacy_course_markers',
    );
    const configurationGuard = script.search(
      /^\s*require_course_cutover_configuration$/mu,
    );

    expect(script).toContain('STUDYTUBE_LEGACY_COURSE_STATE_DIR');
    expect(script).toContain(
      'marker_name in course-activated course-freeze-verified',
    );
    expect(script).toContain(
      'Legacy frozen Course parity belongs to another release; deploy freeze before Course activation',
    );
    expect(migration).toBeGreaterThanOrEqual(0);
    expect(migration).toBeLessThan(configurationGuard);
  });

  it('invalidates stale frozen parity before legacy or replacement freeze traffic starts', () => {
    const invalidation = script.lastIndexOf(
      'run_controlled_deployment_mutation invalidate_frozen_parity_marker',
    );
    const processShutdown = script.search(
      /^\s*seal_deployment_guard_for_cutover$/mu,
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

  it('keeps durable queue storage and worker listeners on loopback', () => {
    expect(productionCompose).toContain('valkey/valkey:9.1.1-alpine');
    expect(productionCompose).toContain('127.0.0.1:6379:6379');
    expect(productionCompose).toContain('--appendonly');
    expect(script).toContain('up -d --wait postgres valkey');
    expect(script).toContain('studytube-worker.service');
    expect(autoDeployScript).toContain(
      'systemctl is-active --quiet studytube-worker.service',
    );
    expect(workerUnit).toContain('api/dist/src/worker.js');
    expect(workerUnit).toContain('NODE_ENV=production');
  });
});
