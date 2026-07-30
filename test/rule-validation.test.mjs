import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRuleSetValidator } from '../scripts/lib/rule-validation.mjs';
import { resolveSafeRedirect } from '../scripts/lib/http-policy.mjs';
import { findAutomationPluginInfo } from '../scripts/lib/plugin-info.mjs';
import {
  loadBackupRule,
  parseJsonFile,
} from '../scripts/lib/rule-repository.mjs';
import {
  diffRules,
  nextComponentId,
  performDeployment,
  prepareDeployment,
  redactSensitive,
  synchronizeVerifiedRule,
  writeServerBackup,
} from '../scripts/lib/rule-workflow.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(__dirname, '..');
const rulesDir = join(repositoryRoot, 'rules');
const schema = JSON.parse(readFileSync(join(rulesDir, 'rule-schema.json'), 'utf8'));
const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'minimal-rule.json'), 'utf8'));
const validateRuleSet = createRuleSetValidator(schema);

function cloneFixture() {
  return structuredClone(fixture);
}

function validate(rule, file = `BDR-${rule.id}.json`) {
  return validateRuleSet([{ file, rule }]);
}

function component(id, componentType, schemaVersion, type, value) {
  const result = {
    id: String(id),
    component: componentType,
    schemaVersion,
    type,
    children: [],
    conditions: [],
  };
  if (value !== undefined) result.value = value;
  return result;
}

function withNestedConditionBlock(rule) {
  const result = structuredClone(rule);
  const block = component(
    1001,
    'CONDITION_BLOCK',
    1,
    'jira.condition.if.block',
    { conditionMatchType: 'ALL' },
  );
  block.children = [
    {
      ...component(1002, 'ACTION', 1, 'codebarrel.action.log', 'Test'),
      parentId: '1001',
    },
  ];
  block.conditions = [
    {
      ...component(1003, 'CONDITION', 1, 'jira.issue.condition', { field: 'status' }),
      conditionParentId: '1001',
    },
  ];
  result.components = [block];
  return result;
}

test('validiert alle produktiven Exporte ohne Fehler oder Warnungen', () => {
  const entries = readdirSync(rulesDir)
    .filter(file => /^BDR-\d+\.json$/.test(file))
    .map(file => ({
      file,
      rule: JSON.parse(readFileSync(join(rulesDir, file), 'utf8')),
    }));

  const result = validateRuleSet(entries);

  assert.equal(entries.length, 28);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test('stellt eine eindeutige und vollständige Befehlsoberfläche bereit', () => {
  const packageJson = parseJsonFile(join(repositoryRoot, 'package.json'));

  assert.deepEqual(Object.keys(packageJson.scripts), [
    'test',
    'validate',
    'verify',
    'next-component-id',
    'inspect-environment',
    'pull-rule',
    'push-rule',
    'rollback-rule',
    'jira-ticket',
    'lint',
  ]);
  assert.equal(packageJson.scripts['push-rule'], 'node scripts/push-rule.mjs');
  assert.equal(
    packageJson.scripts['jira-ticket'],
    'node .github/skills/jira-tickets/scripts/jira-ticket.mjs',
  );
  assert.equal(packageJson.scripts.verify, 'npm test && npm run validate');
});

test('akzeptiert optionale Regelfelder, leere Projekte und optionale Component-Felder', () => {
  const rule = cloneFixture();
  rule.trigger = component(1000, 'TRIGGER', 1, 'jira.incoming.webhook', {
    processIssuesInBulk: false,
    searchOrProvide: 'none',
    webhookToken: 'sanitized-test-token',
  });
  rule.components = [
    component(1001, 'ACTION', 2, 'jira.issue.outgoing.webhook', {
      contentType: 'empty',
      headers: [],
      method: 'GET',
      responseEnabled: true,
      sendIssue: false,
      url: 'https://example.invalid/api',
      usedSecretsKeys: [],
    }),
    component(1002, 'ACTION', 3, 'jira.issue.assign', {
      assignType: 'COPY',
      excludedUsers: [],
    }),
    component(1003, 'CONDITION', 3, 'jira.issue.condition', {
      comparison: 'NOT_EMPTY',
      selectedField: {
        type: 'ID',
        value: 'summary'
      },
    }),
    component(1004, 'ACTION', 6, 'jira.issue.create', {
      operations: [],
      sendNotifications: false,
      useLegacyRendering: false,
    }),
  ];

  const result = validate(rule);

  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test('weist das frühere generische Regelformat zurück', () => {
  const genericRule = {
    id: 'BDR-100',
    name: 'Generische Regel',
    enabled: false,
    trigger: {
      type: 'issue_created',
    },
    actions: [],
  };

  const result = validateRuleSet([{ file: 'BDR-100.json', rule: genericRule }]);

  assert.ok(result.errors.some(error => error.message.includes('Pflichtfeld fehlt')));
  assert.ok(result.errors.some(error => error.path === '/id'));
});

test('prüft Dateiname, Feldtypen und bekannte Component-Zuordnungen', () => {
  const rule = cloneFixture();
  rule.created = '0';
  rule.components[0].component = 'CONDITION';

  const result = validate(rule, 'BDR-101.json');

  assert.ok(result.errors.some(error => error.message.includes('Dateiname erwartet Regel-ID 101')));
  assert.ok(result.errors.some(error => error.path === '/created'));
  assert.ok(result.errors.some(error => error.message.includes('erwartet component "ACTION"')));
});

test('erkennt doppelte Component-IDs regelübergreifend', () => {
  const first = cloneFixture();
  const second = cloneFixture();
  second.id = 101;

  const result = validateRuleSet([
    { file: 'BDR-100.json', rule: first },
    { file: 'BDR-101.json', rule: second },
  ]);

  assert.ok(result.errors.some(error => error.message.includes('Component-ID "1000"')));
  assert.ok(result.errors.some(error => error.message.includes('Component-ID "1001"')));
});

test('erkennt falsche parentId und conditionParentId', () => {
  const rule = cloneFixture();
  const container = component(2000, 'CONDITION', 1, 'jira.condition.container.block');
  const ifBlock = component(2001, 'CONDITION_BLOCK', 1, 'jira.condition.if.block', {
    conditionMatchType: 'ALL',
  });
  ifBlock.parentId = '9999';
  const condition = component(2002, 'CONDITION', 1, 'jira.comparator.condition', {
    first: '{{issue.key}}',
    operator: 'EQUALS',
    second: 'TEST-1',
  });
  condition.conditionParentId = '9999';
  ifBlock.conditions.push(condition);
  container.children.push(ifBlock);
  rule.components = [container];

  const result = validate(rule);

  assert.ok(result.errors.some(error => error.path.endsWith('/parentId')));
  assert.ok(result.errors.some(error => error.path.endsWith('/conditionParentId')));
});

test('erlaubt einen Trigger ausschließlich im Top-Level-Feld trigger', () => {
  const rule = cloneFixture();
  rule.components.push(component(1002, 'TRIGGER', 1, 'jira.manual.trigger.issue', {
    groups: [],
  }));

  const result = validate(rule);

  assert.ok(result.errors.some(error => error.message.includes('nur im Top-Level-Feld trigger')));
});

test('meldet unbekannte Typen und Versionen als Warnung', () => {
  const rule = cloneFixture();
  rule.components[0].schemaVersion = 2;
  rule.components.push(component(1002, 'ACTION', 1, 'vendor.future.action', {
    future: true,
  }));

  const result = validate(rule);

  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some(warning => warning.message.includes('Unbekannte Schema-Version 2')));
  assert.ok(result.warnings.some(warning => warning.message.includes('Unbekannter Automation-Typ')));
});

test('blockiert Cloud-clientKey, doppelte Projekte und ungeschützte Auth-Header', () => {
  const rule = cloneFixture();
  rule.clientKey = 'com.atlassian.automation.cloud';
  rule.projects = [
    { projectId: '99999', projectTypeKey: 'software' },
    { projectId: '99999', projectTypeKey: 'software' },
  ];
  rule.components.push(component(1002, 'ACTION', 2, 'jira.issue.outgoing.webhook', {
    contentType: 'empty',
    headers: [
      {
        id: '_header_example',
        name: 'Authorization',
        value: {
          keyOrValue: 'literal-value',
          secret: false,
        },
      },
    ],
    method: 'GET',
    responseEnabled: true,
    sendIssue: false,
    url: 'https://example.invalid/api',
    usedSecretsKeys: [],
  }));

  const result = validate(rule);

  assert.ok(result.errors.some(error => error.path === '/clientKey'));
  assert.ok(result.errors.some(error => error.path === '/projects'));
  assert.ok(result.errors.some(error => error.message.includes('muss als Jira-Secret referenziert werden')));
});

test('redigiert Secret-Werte in Objekten und Diffs', () => {
  const before = {
    webhookToken: 'before-value',
    headers: [
      {
        name: 'Authorization',
        value: {
          keyOrValue: 'before-secret',
          secret: true,
        },
      },
    ],
  };
  const after = structuredClone(before);
  after.webhookToken = 'after-value';
  after.headers[0].value.keyOrValue = 'after-secret';

  const redacted = redactSensitive(after);
  const changes = diffRules(before, after);

  assert.equal(redacted.webhookToken, '[REDACTED]');
  assert.equal(redacted.headers[0].value, '[REDACTED]');
  assert.ok(changes.every(change => change.sensitive));
  assert.ok(changes.every(change => change.before === '[REDACTED]' && change.after === '[REDACTED]'));

  const unsafeBefore = {
    headers: [{
      name: 'Authorization',
      value: { keyOrValue: 'unsafe-before', secret: false },
    }],
  };
  const unsafeAfter = structuredClone(unsafeBefore);
  unsafeAfter.headers[0].value.keyOrValue = 'unsafe-after';
  const unsafeChanges = diffRules(unsafeBefore, unsafeAfter);
  assert.deepEqual(unsafeChanges, [{
    path: '/headers/0/value',
    before: '[REDACTED]',
    after: '[REDACTED]',
    sensitive: true,
  }]);
});

test('ermittelt Component-IDs repositoryweit statt pro Regel', () => {
  const first = cloneFixture();
  const second = cloneFixture();
  second.id = 101;
  second.trigger.id = '7000';
  second.components[0].id = '9000';

  assert.equal(nextComponentId([
    { file: 'BDR-100.json', rule: first },
    { file: 'BDR-101.json', rule: second },
  ]), '9001');
});

test('ermittelt Automation-Version und Build aus einer UPM-Antwort', () => {
  const result = findAutomationPluginInfo({
    plugins: [
      {
        key: 'example.unrelated.plugin',
        name: 'Unrelated Plugin',
        version: '1.0.0',
      },
      {
        key: 'com.example.codebarrel.automation',
        name: 'Automation for Jira',
        version: '9.1.2',
        buildNumber: 90102,
      },
    ],
  });

  assert.deepEqual(result, {
    key: 'com.example.codebarrel.automation',
    version: '9.1.2',
    build: '90102',
  });
  assert.equal(findAutomationPluginInfo({ plugins: [] }), null);
});

test('Redirect-Policy schützt Schreibzugriffe und Authentifizierungsheader', () => {
  assert.equal(
    resolveSafeRedirect('GET', 'https://jira.example.invalid/a', '/b', 0),
    'https://jira.example.invalid/b',
  );
  assert.throws(
    () => resolveSafeRedirect('PUT', 'https://jira.example.invalid/a', '/b', 0),
    /Schreibzugriff blockiert/,
  );
  assert.throws(
    () => resolveSafeRedirect(
      'GET',
      'https://jira.example.invalid/a',
      'https://other.example.invalid/b',
      0,
    ),
    /Cross-origin/,
  );
  assert.throws(
    () => resolveSafeRedirect('GET', 'https://jira.example.invalid/a', '/b', 5),
    /Zu viele HTTP-Redirects/,
  );
});

test('Preflight blockiert Drift, Warnungen, Schutzfelder und Secret-Änderungen', () => {
  const remote = cloneFixture();
  const local = cloneFixture();
  local.state = 'ENABLED';
  local.trigger.value.groups = ['example-group'];

  const result = prepareDeployment({
    localRule: local,
    remoteRule: remote,
    baselineRule: { ...remote, name: 'Abweichender Git-Basisstand' },
    validation: {
      errors: [],
      warnings: [{ file: 'BDR-100.json', path: '/components/0/type', message: 'unbekannt' }],
    },
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('Serverstand')));
  assert.ok(result.errors.some(error => error.includes('0 Validierungswarnungen')));
  assert.ok(result.errors.some(error => error.includes('state')));

  const secretLocal = cloneFixture();
  secretLocal.trigger = component(1000, 'TRIGGER', 1, 'jira.incoming.webhook', {
    webhookToken: 'changed-secret',
    searchOrProvide: 'none',
    processIssuesInBulk: false,
  });
  const secretRemote = structuredClone(secretLocal);
  secretRemote.trigger.value.webhookToken = 'original-secret';
  const secretResult = prepareDeployment({
    localRule: secretLocal,
    remoteRule: secretRemote,
    baselineRule: secretRemote,
    validation: { errors: [], warnings: [] },
  });
  assert.ok(secretResult.errors.some(error => error.includes('Secret- oder Tokenwerte')));
});

test('geschütztes Feld benötigt explizite allow-field-Freigabe', () => {
  const remote = cloneFixture();
  remote.projects = [{ projectId: '99999', projectTypeKey: 'software' }];
  const local = structuredClone(remote);
  local.state = 'ENABLED';

  const blocked = prepareDeployment({
    localRule: local,
    remoteRule: remote,
    baselineRule: remote,
    validation: { errors: [], warnings: [] },
  });
  const allowed = prepareDeployment({
    localRule: local,
    remoteRule: remote,
    baselineRule: remote,
    validation: { errors: [], warnings: [] },
    allowedFields: ['state'],
  });

  assert.equal(blocked.ok, false);
  assert.equal(allowed.ok, true);
});

test('Deployment nutzt lokalen Mock-Endpunkt, sichert und verifiziert', async () => {
  const initial = cloneFixture();
  initial.projects = [{ projectId: '99999', projectTypeKey: 'software' }];
  const desired = structuredClone(initial);
  desired.name = 'Geänderte Testregel';
  let serverRule = structuredClone(initial);
  let putCount = 0;

  const server = createServer((request, response) => {
    if (request.method === 'GET') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(serverRule));
      return;
    }
    if (request.method === 'PUT') {
      const chunks = [];
      request.on('data', chunk => chunks.push(chunk));
      request.on('end', () => {
        serverRule = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        serverRule.updated += 1;
        putCount += 1;
        response.statusCode = 204;
        response.end();
      });
      return;
    }
    response.statusCode = 405;
    response.end();
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/automation-rule`;
  const tempRoot = mkdtempSync(join(tmpdir(), 'jira-rule-workflow-'));

  try {
    const fetchRemote = async () => {
      const response = await fetch(url);
      return response.json();
    };
    const putRemote = async rule => {
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rule),
      });
      assert.equal(response.status, 204);
    };

    const result = await performDeployment({
      localRule: desired,
      baselineRule: initial,
      validation: { errors: [], warnings: [] },
      apply: true,
      fetchRemote,
      putRemote,
      createBackup: rule => writeServerBackup(tempRoot, rule, new Date('2026-07-29T12:00:00Z')),
    });

    assert.equal(result.applied, true);
    assert.equal(putCount, 1);
    assert.equal(serverRule.name, desired.name);
    assert.ok(existsSync(result.backupPath));
    assert.deepEqual(JSON.parse(readFileSync(result.backupPath, 'utf8')), initial);
  } finally {
    await new Promise(resolveClose => server.close(resolveClose));
    const resolvedTempRoot = join(tmpdir(), tempRoot.slice(tmpdir().length + 1));
    assert.equal(resolvedTempRoot, tempRoot);
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('Deployment akzeptiert neue Server-IDs und synchronisiert den lokalen Export', async () => {
  const initial = cloneFixture();
  initial.projects = [{ projectId: '99999', projectTypeKey: 'software' }];
  const desired = withNestedConditionBlock(initial);
  desired.name = 'Regel mit serververwalteten IDs';

  const verified = structuredClone(desired);
  verified.updated = 42;
  verified.trigger.id = '2000';
  verified.components[0].id = '2001';
  verified.components[0].children[0].id = '2002';
  verified.components[0].children[0].parentId = '2001';
  verified.components[0].conditions[0].id = '2003';
  verified.components[0].conditions[0].conditionParentId = '2001';

  let fetchCount = 0;
  let putCount = 0;
  let persistedRule = null;
  const result = await performDeployment({
    localRule: desired,
    baselineRule: initial,
    validation: { errors: [], warnings: [] },
    apply: true,
    fetchRemote: async () => {
      fetchCount += 1;
      return structuredClone(fetchCount === 1 ? initial : verified);
    },
    putRemote: async () => { putCount += 1; },
    createBackup: async () => 'backups/BDR-100/test.server.json',
    persistSynchronizedRule: rule => { persistedRule = structuredClone(rule); },
  });

  assert.equal(result.applied, true);
  assert.equal(fetchCount, 2);
  assert.equal(putCount, 1);
  assert.deepEqual(result.serverManagedChanges, {
    componentIds: 4,
    updated: true,
  });
  assert.equal(persistedRule.updated, 42);
  assert.equal(persistedRule.trigger.id, '2000');
  assert.equal(persistedRule.components[0].id, '2001');
  assert.equal(persistedRule.components[0].children[0].id, '2002');
  assert.equal(persistedRule.components[0].children[0].parentId, '2001');
  assert.equal(persistedRule.components[0].conditions[0].id, '2003');
  assert.equal(persistedRule.components[0].conditions[0].conditionParentId, '2001');
  assert.equal(desired.trigger.id, '1000');
});

test('Remote-Verifikation blockiert falsche serverseitige Elternreferenzen', () => {
  const local = withNestedConditionBlock(cloneFixture());
  const remote = structuredClone(local);
  remote.updated = 1;
  remote.components[0].id = '2001';
  remote.components[0].children[0].id = '2002';
  remote.components[0].children[0].parentId = '9999';
  remote.components[0].conditions[0].id = '2003';
  remote.components[0].conditions[0].conditionParentId = '2001';

  assert.throws(
    () => synchronizeVerifiedRule(local, remote),
    /parentId zeigt nicht auf die direkte Eltern-Component/,
  );
});

test('Deployment führt ohne --apply weder Backup noch PUT aus', async () => {
  const remote = cloneFixture();
  remote.projects = [{ projectId: '99999', projectTypeKey: 'software' }];
  const local = structuredClone(remote);
  local.name = 'Nur Preflight';
  let backupCount = 0;
  let putCount = 0;

  const result = await performDeployment({
    localRule: local,
    baselineRule: remote,
    validation: { errors: [], warnings: [] },
    apply: false,
    fetchRemote: async () => structuredClone(remote),
    putRemote: async () => { putCount += 1; },
    createBackup: async () => {
      backupCount += 1;
      return 'unused';
    },
  });

  assert.equal(result.applied, false);
  assert.equal(result.preflight.ok, true);
  assert.equal(backupCount, 0);
  assert.equal(putCount, 0);
});

test('Deployment bricht bei fehlendem Backup vor dem PUT ab', async () => {
  const remote = cloneFixture();
  remote.projects = [{ projectId: '99999', projectTypeKey: 'software' }];
  const local = structuredClone(remote);
  local.name = 'Backup muss zuerst funktionieren';
  let putCount = 0;

  await assert.rejects(
    performDeployment({
      localRule: local,
      baselineRule: remote,
      validation: { errors: [], warnings: [] },
      apply: true,
      fetchRemote: async () => structuredClone(remote),
      putRemote: async () => { putCount += 1; },
      createBackup: async () => null,
    }),
    /Backup konnte nicht erstellt werden/,
  );
  assert.equal(putCount, 0);
});

test('Deployment blockiert einen Push ohne fachliche Änderung', async () => {
  const remote = cloneFixture();
  remote.projects = [{ projectId: '99999', projectTypeKey: 'software' }];
  let backupCount = 0;
  let putCount = 0;

  const result = await performDeployment({
    localRule: structuredClone(remote),
    baselineRule: remote,
    validation: { errors: [], warnings: [] },
    apply: true,
    fetchRemote: async () => structuredClone(remote),
    putRemote: async () => { putCount += 1; },
    createBackup: async () => {
      backupCount += 1;
      return 'unused';
    },
  });

  assert.equal(result.applied, false);
  assert.ok(result.preflight.errors.some(error => error.includes('keine Änderungen')));
  assert.equal(backupCount, 0);
  assert.equal(putCount, 0);
});

test('Deployment meldet eine fehlgeschlagene Remote-Verifikation', async () => {
  const remote = cloneFixture();
  remote.projects = [{ projectId: '99999', projectTypeKey: 'software' }];
  const local = structuredClone(remote);
  local.name = 'Gewünschter Name';
  let fetchCount = 0;
  let putCount = 0;
  let persistCount = 0;

  await assert.rejects(
    performDeployment({
      localRule: local,
      baselineRule: remote,
      validation: { errors: [], warnings: [] },
      apply: true,
      fetchRemote: async () => {
        fetchCount += 1;
        if (fetchCount === 1) return structuredClone(remote);
        return { ...structuredClone(remote), name: 'Abweichender Serverstand' };
      },
      putRemote: async () => { putCount += 1; },
      createBackup: async () => 'backups/BDR-100/test.server.json',
      persistSynchronizedRule: async () => { persistCount += 1; },
    }),
    /Remote-Verifikation nach dem Push ist fehlgeschlagen/,
  );

  assert.equal(putCount, 1);
  assert.equal(fetchCount, 2);
  assert.equal(persistCount, 0);
});

test('Rollback-Backup muss zur Regel-ID seines BDR-Ordners passen', () => {
  const tempRepository = mkdtempSync(join(tmpdir(), 'jira-rule-backup-identity-'));
  const backupsRoot = join(tempRepository, 'backups');

  try {
    const backupPath = writeServerBackup(
      backupsRoot,
      fixture,
      new Date('2026-07-29T14:00:00Z'),
    );
    assert.equal(loadBackupRule(tempRepository, backupPath).rule.id, fixture.id);

    writeFileSync(
      backupPath,
      `${JSON.stringify({ ...fixture, id: fixture.id + 1 }, null, 2)}\n`,
      'utf8',
    );
    assert.throws(
      () => loadBackupRule(tempRepository, backupPath),
      /Backup-Inhalt und BDR-\{id\}-Ordner stimmen nicht überein/,
    );
  } finally {
    const resolvedTempRepository = join(
      tmpdir(),
      tempRepository.slice(tmpdir().length + 1),
    );
    assert.equal(resolvedTempRepository, tempRepository);
    rmSync(tempRepository, { recursive: true, force: true });
  }
});

test('Rollback nutzt lokalen Mock-Endpunkt, sichert den aktuellen Stand und verifiziert', async () => {
  const current = cloneFixture();
  current.projects = [{ projectId: '99999', projectTypeKey: 'software' }];
  current.name = 'Aktueller Serverstand';
  current.updated = 2000;
  const backupRule = structuredClone(current);
  backupRule.name = 'Gesicherter alter Stand';
  backupRule.updated = 1000;
  const rollbackRule = {
    ...backupRule,
    updated: current.updated,
  };
  let serverRule = structuredClone(current);
  let putCount = 0;

  const server = createServer((request, response) => {
    if (request.method === 'GET') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(serverRule));
      return;
    }
    if (request.method === 'PUT') {
      const chunks = [];
      request.on('data', chunk => chunks.push(chunk));
      request.on('end', () => {
        serverRule = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        serverRule.updated += 1;
        putCount += 1;
        response.statusCode = 204;
        response.end();
      });
      return;
    }
    response.statusCode = 405;
    response.end();
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/automation-rule`;
  const tempRoot = mkdtempSync(join(tmpdir(), 'jira-rule-rollback-'));

  try {
    const result = await performDeployment({
      localRule: rollbackRule,
      baselineRule: current,
      validation: { errors: [], warnings: [] },
      apply: true,
      fetchRemote: async () => {
        const response = await fetch(url);
        return response.json();
      },
      putRemote: async rule => {
        const response = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(rule),
        });
        assert.equal(response.status, 204);
      },
      createBackup: rule => writeServerBackup(
        tempRoot,
        rule,
        new Date('2026-07-29T13:00:00Z'),
      ),
    });

    assert.equal(result.applied, true);
    assert.equal(putCount, 1);
    assert.equal(serverRule.name, backupRule.name);
    assert.deepEqual(JSON.parse(readFileSync(result.backupPath, 'utf8')), current);
  } finally {
    await new Promise(resolveClose => server.close(resolveClose));
    const resolvedTempRoot = join(tmpdir(), tempRoot.slice(tmpdir().length + 1));
    assert.equal(resolvedTempRoot, tempRoot);
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
