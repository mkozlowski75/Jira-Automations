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
  resolveRulesDir,
  resolveTrackedRuleFile,
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
const rulesDir = join(repositoryRoot, '..', 'jira-automation-rules', 'rules');
const schema = JSON.parse(readFileSync(join(rulesDir, 'rule-schema.json'), 'utf8'));
const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'minimal-rule.json'), 'utf8'));
const validateRuleSet = createRuleSetValidator(schema);

function readRuleFile(id) {
  const file = `CER-jira-rule-${id}.json`;
  return JSON.parse(readFileSync(join(rulesDir, file), 'utf8'));
}

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
    .filter(file => /^(?:BDR-|CER-jira-rule-)\d+\.json$/.test(file))
    .map(file => ({
      file,
      rule: JSON.parse(readFileSync(join(rulesDir, file), 'utf8')),
    }));

  const result = validateRuleSet(entries);

  assert.equal(entries.length, 30);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test('auflöst Regeln aus dem separaten Regel-Repository und akzeptiert CER-Namensmuster', () => {
  const siblingRulesRoot = join(repositoryRoot, '..', 'jira-automation-rules', 'rules');
  const resolved = resolveTrackedRuleFile(repositoryRoot, 'rules/CER-jira-rule-913.json');

  assert.equal(resolveRulesDir(repositoryRoot), siblingRulesRoot);
  assert.equal(resolved.absolutePath, join(siblingRulesRoot, 'CER-jira-rule-913.json'));
  assert.equal(resolved.repositoryPath, '../jira-automation-rules/rules/CER-jira-rule-913.json');
});

test('Security-Worker 914 erstellt nur für valide, nicht duplizierte HIGH/CRITICAL-CVE- oder -GHSA-Funde und benachrichtigt danach', () => {
  const rule = readRuleFile(914);
  const flatten = components => components.flatMap(component => [
    component,
    ...flatten(component.children ?? []),
    ...flatten(component.conditions ?? []),
  ]);
  const components = flatten(rule.components);
  const validationBlock = components.find(component =>
    component.type === 'jira.condition.if.block'
      && component.conditions?.some(condition =>
        condition.value?.first === '{{webhookData.findingId}}'
          && condition.value?.operator === 'REGEX_MATCHES'),
  );
  const lookup = components.find(component => component.type === 'jira.lookup.issues');
  const create = components.find(component => component.type === 'jira.issue.create');
  const createdKey = components.find(component =>
    component.type === 'jira.create.variable'
      && component.value?.name?.value === 'createdSecurityFindingKey',
  );
  const email = components.find(component => component.type === 'jira.issue.outgoing.email');
  const duplicateLog = components.find(component =>
    component.type === 'codebarrel.action.log'
      && component.value?.includes('offenes Sicherheitsfund-Duplikat'),
  );
  const receivedLog = rule.components.find(component =>
    component.type === 'codebarrel.action.log'
      && component.value?.includes('WebHook-Fund empfangen:'),
  );
  const invalidPayloadBlock = components.find(component =>
    component.type === 'jira.condition.if.block'
      && component.value?.conditionMatchType === 'ANY'
      && component.conditions?.some(condition =>
        condition.value?.first === '{{webhookData.findingId}}'
          && condition.value?.operator === 'REGEX_NOT_MATCHES'),
  );
  const invalidPayloadLog = components.find(component =>
    component.type === 'codebarrel.action.log'
      && component.value?.includes('WebHook-Fund abgewiesen'),
  );

  assert.equal(rule.state, 'ENABLED');
  assert.equal(rule.trigger.type, 'jira.incoming.webhook');
  assert.equal(rule.projects[0].projectId, '11215');
  assert.equal(receivedLog, rule.components[0]);
  for (const field of ['findingId', 'library', 'installedVersion', 'severity', 'source']) {
    assert.match(receivedLog.value, new RegExp(`\\{\\{webhookData\\.${field}\\}\\}`));
  }
  assert.equal(validationBlock.conditions.length, 5);
  assert.deepEqual(
    validationBlock.conditions.map(condition => condition.value.first).sort(),
    [
      '{{webhookData.findingId}}',
      '{{webhookData.installedVersion}}',
      '{{webhookData.library}}',
      '{{webhookData.severity}}',
      '{{webhookData.source}}',
    ],
  );
  assert.match(
    lookup.value.query.value,
    /statusCategory != Done.*summary.*description/s,
  );
  assert.match(lookup.value.query.value, /\{\{webhookData\.findingId\}\}/);
  assert.equal(lookup.parentId, validationBlock.id);
  assert.equal(create.parentId, createdKey.parentId);
  assert.equal(createdKey.parentId, email.parentId);
  assert.equal(createdKey.value.query.value, '{{createdIssue.key}}');
  assert.equal(email.schemaVersion, 3);
  assert.deepEqual(email.value.to, [
    {
      type: 'FREE',
      value: '"Kozlowski, Matthias (extern)" <Matthias.Kozlowski.extern@BDR.de>',
    },
    {
      type: 'FREE',
      value: '"Kiepke, Gerald" <Gerald.Kiepke@BDR.de>',
    },
    {
      type: 'FREE',
      value: '"Laska, Adrian" <Adrian.Laska@bdr.de>',
    },
    {
      type: 'FREE',
      value: '"Kühl, Alexander" <Alexander.Kuehl@BDR.de>',
    },
  ]);
  assert.deepEqual(email.value.cc, []);
  assert.deepEqual(email.value.bcc, []);
  assert.match(email.value.subject, /\{\{createdSecurityFindingKey\}\}.*\{\{webhookData\.findingId\}\}/);
  assert.match(email.value.body, /browse\/\{\{createdSecurityFindingKey\}\}/);
  assert.match(email.value.body, /CVERecord\?id=\{\{webhookData\.findingId\}\}/);
  assert.match(email.value.body, /github\.com\/advisories\/\{\{webhookData\.findingId\}\}/);
  assert.match(email.value.body, /href="\{\{webhookData\.source\}\}"/);
  assert.match(email.value.body, /<h3>Details<\/h3>/);
  assert.match(email.value.body, /<h3>Ergebnis<\/h3>/);
  assert.match(email.value.body, /<h3>Nächste Schritte<\/h3>/);
  assert.match(
    email.value.body,
    /AutomationProjectAdminAction!default\.jspa\?projectKey=CER#\/rule\/914/,
  );
  assert.match(email.value.body, /Jira-Automation-Regel <strong>\{\{rule\.name\}\}<\/strong>/);
  assert.equal(
    create.value.operations.find(operation => operation.fieldId === 'labels').value[0].value,
    'Security',
  );
  assert.equal(
    create.value.operations.find(operation => operation.fieldId === 'issuetype').value.value,
    '10002',
  );
  assert.ok(duplicateLog);
  assert.notEqual(duplicateLog.parentId, email.parentId);
  assert.equal(invalidPayloadBlock.parentId, validationBlock.parentId);
  assert.equal(invalidPayloadBlock.conditions.length, 5);
  assert.ok(invalidPayloadBlock.conditions.every(condition =>
    condition.value.operator === 'REGEX_NOT_MATCHES'));
  assert.equal(invalidPayloadLog.parentId, invalidPayloadBlock.id);
  assert.match(invalidPayloadLog.value, /mindestens ein Parameter entspricht nicht den Vorgaben/);
  assert.match(invalidPayloadLog.value, /Kein Ticket und keine E-Mail erstellt/);
  const findingIdPattern = '^(?:CVE-\\d{4}-\\d{4,24}|GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})$';
  assert.equal(validationBlock.conditions[0].value.second, findingIdPattern);
  assert.equal(invalidPayloadBlock.conditions[0].value.second, findingIdPattern);
  const findingIdExpression = new RegExp(findingIdPattern);
  assert.equal(findingIdExpression.test('CVE-2026-40985'), true);
  assert.equal(findingIdExpression.test('GHSA-7wwv-79xw-rvvg'), true);
  assert.equal(findingIdExpression.test('GHSA-invalid'), false);
  assert.equal(findingIdExpression.test('OTHER-2026-40985'), false);
  assert.match(create.value.operations.find(operation => operation.fieldId === 'summary').value, /^\[CVE\] \{\{webhookData\.findingId\}\}/);
  assert.match(create.value.operations.find(operation => operation.fieldId === 'description').value, /github\.com\/advisories\/\{\{webhookData\.findingId\}\}/);
});

test('Trivy-Alert 1029 übergibt höchstens fünf eindeutige HIGH/CRITICAL-CVE- oder -GHSA-Funde an Worker 914', () => {
  const rule = readRuleFile(1029);
  const flatten = components => components.flatMap(component => [
    component,
    ...flatten(component.children ?? []),
    ...flatten(component.conditions ?? []),
  ]);
  const components = flatten(rule.components);
  const variables = components.filter(component => component.type === 'jira.create.variable');
  const securityFindingTicketRows = variables.find(component =>
    component.value?.name?.value === 'securityFindingTicketRows');
  const email = components.find(component =>
    component.type === 'jira.issue.outgoing.email'
      && component.value?.subject?.includes('Ceroma Security Alert'),
  );
  const workerCalls = components.filter(component =>
    component.type === 'jira.issue.outgoing.webhook'
      && component.value?.customBody?.includes('"installedVersion"')
      && component.value?.customBody?.includes('"source"'),
  );
  const workerBlocks = components.filter(component =>
    component.type === 'jira.condition.if.block'
      && component.conditions?.some(condition =>
        condition.value?.first?.includes('securityFindingTicketRows')
          && condition.value?.operator === 'NOT_EQUALS'),
  );
  const overflowLog = components.find(component =>
    component.type === 'codebarrel.action.log'
      && component.value?.includes('Fünferlimits'),
  );

  assert.ok(securityFindingTicketRows);
  assert.match(securityFindingTicketRows.value.query.value, /VulnerabilityID\.startsWith\(\"CVE-\"\)/);
  assert.match(securityFindingTicketRows.value.query.value, /VulnerabilityID\.startsWith\(\"GHSA-\"\)/);
  assert.match(securityFindingTicketRows.value.query.value, /Severity\.toUpperCase,\"HIGH\"/);
  assert.match(securityFindingTicketRows.value.query.value, /Severity\.toUpperCase,\"CRITICAL\"/);
  assert.equal(workerCalls.length, 5);
  assert.equal(workerBlocks.length, 5);
  for (const [index, workerCall] of workerCalls.entries()) {
    assert.equal(workerCall.value.method, 'POST');
    assert.equal(workerCall.value.contentType, 'custom');
    assert.equal(workerCall.value.responseEnabled, false);
    assert.match(workerCall.value.customBody, new RegExp(`get\\(${index}\\)`));
    assert.match(workerCall.value.customBody, /\.asJsonString/);
    assert.match(workerCall.value.customBody, /"findingId"/);
    assert.doesNotMatch(workerCall.value.customBody, /"cve"/);
    assert.match(workerCall.value.customBody, /\{\{trivyJobUrl\.asJsonString\}\}/);
  }
  assert.match(email.value.body, /ersten fünf eindeutigen HIGH\/CRITICAL-CVE- oder -GHSA-Funde/);
  assert.match(email.value.body, /sofern kein offenes Dubletten-Ticket vorhanden ist/);
  assert.match(overflowLog.value, /- 5/);
});

test('Regel 1079 validiert Ticketdaten und übergibt sie an den Release-Worker', () => {
  const rule = readRuleFile(1079);
  const worker = readRuleFile(875);
  const variables = rule.components.filter(component => component.type === 'jira.create.variable');
  const variableQuery = name => variables.find(component => component.value?.name?.value === name)?.value?.query?.value;
  const containers = rule.components.filter(component => component.type === 'jira.condition.container.block');
  const allComponents = containers.flatMap(container => [container, ...container.children, ...container.children.flatMap(block => [...block.children, ...block.conditions])]);
  const webhook = allComponents.find(component => component.type === 'jira.issue.outgoing.webhook');
  const comparators = allComponents.filter(component => component.type === 'jira.comparator.condition');
  const flattenWorkerComponents = components => components.flatMap(component => [
    component,
    ...flattenWorkerComponents(component.children ?? []),
    ...flattenWorkerComponents(component.conditions ?? [])
  ]);
  const successEmail = flattenWorkerComponents(worker.components).find(component => component.type === 'jira.issue.outgoing.email' && component.value?.subject?.startsWith('Release-Ticket erstellt:'));

  assert.deepEqual(rule.trigger.value.groups, ['prj-cer-pa']);
  assert.match(rule.description, /erste Komponente, Fix-Version und Sprint-ID/);
  assert.equal(variableQuery('component'), '{{issue.components.first.name}}');
  assert.equal(variableQuery('releaseVersion'), '{{issue.fixVersions.last.name.replaceAll("^.*\\s+([0-9]+(?:\\.[0-9]+)+)$", "$1")}}');
  assert.equal(variableQuery('workerFixVersion'), '{{issue.fixVersions.last.name}}');
  assert.equal(variableQuery('workerSprintId'), '{{issue.sprint.last.id}}');
  const versionWithOptionalPrefix = /^.*\s+([0-9]+(?:\.[0-9]+)+)$/;
  assert.equal('Mediator 1.40.0'.replace(versionWithOptionalPrefix, '$1'), '1.40.0');
  assert.equal('PostIdentService 1.15.0'.replace(versionWithOptionalPrefix, '$1'), '1.15.0');
  assert.equal('WeitereKomponente 1.2.3'.replace(versionWithOptionalPrefix, '$1'), '1.2.3');
  assert.equal('1.2.3'.replace(versionWithOptionalPrefix, '$1'), '1.2.3');
  assert.equal(webhook.value.method, 'POST');
  assert.match(webhook.value.customBody, /"component": "\{\{component\}\}"/);
  assert.match(webhook.value.customBody, /"sourceIssueKey": "\{\{issue\.key\}\}"/);
  assert.ok(comparators.some(component => component.value.operator === 'REGEX_MATCHES'));
  assert.ok(comparators.some(component => component.value.operator === 'REGEX_NOT_MATCHES'));
  assert.ok(comparators.every(component => component.value.second.includes('Benutzerhandbuch')));
  assert.equal(worker.components.some(component => component.value?.name?.value === 'releaseComponent'), false);
  assert.equal(successEmail.value.to.length, 3);
  assert.match(successEmail.value.body, /https:\/\/partner\.bdr\.de\/jira\/browse\/\{\{createdReleaseKey\}\}/);
  assert.equal(JSON.stringify(worker).includes('CeromaManual'), false);
  assert.equal(JSON.stringify(rule).toLowerCase().includes('product'), false);
  assert.equal(JSON.stringify(worker).toLowerCase().includes('product'), false);
});

test('Release-Worker stellt die Fix-Version vor dem Duplikat-Lookup zentral bereit', () => {
  const worker = readRuleFile(875);
  const flattenComponents = components => components.flatMap(component => [
    component,
    ...flattenComponents(component.children ?? []),
    ...flattenComponents(component.conditions ?? []),
  ]);
  const allComponents = flattenComponents(worker.components);
  const versionActions = allComponents.filter(component => component.type === 'jira.version.create');
  const versionActionIndex = worker.components.findIndex(component => component.type === 'jira.version.create');
  const duplicateJqlIndex = worker.components.findIndex(component => component.value?.name?.value === 'releaseDuplicateJql');
  const lookupIndex = worker.components.findIndex(component => component.type === 'jira.lookup.issues');

  assert.equal(versionActions.length, 1);
  assert.match(versionActions[0].id, /^\d+$/);
  assert.equal(versionActions[0].parentId, undefined);
  assert.equal(versionActions[0].value.versionName, '{{workerFixVersion}}');
  assert.equal(versionActions[0].value.project.value, '11215');
  assert.ok(versionActionIndex > worker.components.findIndex(component => component.value?.name?.value === 'workerFixVersion'));
  assert.ok(versionActionIndex < duplicateJqlIndex);
  assert.ok(duplicateJqlIndex < lookupIndex);
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
    'cer-ticket',
    'create-cve-ticket',
    'gitlab-api',
    'confluence-page',
    'lint',
  ]);
  assert.equal(packageJson.scripts['push-rule'], 'node scripts/push-rule.mjs');
  assert.equal(
    packageJson.scripts['jira-ticket'],
    'node .github/skills/jira-tickets/scripts/jira-ticket.mjs',
  );
  assert.equal(packageJson.scripts['cer-ticket'], 'node scripts/cer-ticket.mjs');
  assert.equal(packageJson.scripts['create-cve-ticket'], 'node scripts/create-cve-ticket.mjs');
  assert.equal(
    packageJson.scripts['gitlab-api'],
    'node .github/skills/gitlab-access/scripts/gitlab-api.mjs',
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

  const hookBefore = { url: 'https://partner.example/jira/rest/cb-automation/latest/hooks/before-token' };
  const hookAfter = { url: 'https://partner.example/jira/rest/cb-automation/latest/hooks/after-token' };
  assert.equal(redactSensitive(hookAfter).url, '[REDACTED]');
  assert.deepEqual(diffRules(hookBefore, hookAfter), [{
    path: '/url',
    before: '[REDACTED]',
    after: '[REDACTED]',
    sensitive: false,
  }]);

  assert.deepEqual(diffRules({}, { usedSecretsKeys: [] }), [{
    path: '/usedSecretsKeys',
    before: undefined,
    after: [],
    sensitive: false,
  }]);
  assert.deepEqual(diffRules(
    { usedSecretsKeys: ['existing-secret'] },
    { usedSecretsKeys: [] },
  ), [{
    path: '/usedSecretsKeys',
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

test('Drift blockiert ohne --force-drift', () => {
  const baseline = cloneFixture();
  baseline.projects = [{ projectId: '99999', projectTypeKey: 'software' }];
  const remote = structuredClone(baseline);
  remote.name = 'Serverseitig geänderte Regel';
  remote.updated += 1;
  const local = structuredClone(baseline);
  local.name = 'Lokal gewünschte Regel';

  const result = prepareDeployment({
    localRule: local,
    remoteRule: remote,
    baselineRule: baseline,
    validation: { errors: [], warnings: [] },
  });

  assert.equal(result.ok, false);
  assert.equal(result.summary.serverDrift, true);
  assert.ok(result.errors.some(error => error.includes('Serverstand')));
});

test('--force-drift ohne --apply wird abgewiesen', async () => {
  let fetchCount = 0;

  await assert.rejects(
    performDeployment({
      localRule: cloneFixture(),
      baselineRule: cloneFixture(),
      validation: { errors: [], warnings: [] },
      apply: false,
      forceDrift: true,
      fetchRemote: async () => {
        fetchCount += 1;
        return cloneFixture();
      },
    }),
    /--force-drift darf nur zusammen mit --apply/,
  );

  assert.equal(fetchCount, 0);
});

test('Force-Drift-Deployment erzeugt Backup, PUT und Verifikation', async () => {
  const baseline = cloneFixture();
  baseline.projects = [{ projectId: '99999', projectTypeKey: 'software' }];
  const remote = structuredClone(baseline);
  remote.name = 'Serverseitig geänderte Regel';
  remote.updated = 20;
  const local = structuredClone(baseline);
  local.name = 'Bewusst gewünschte lokale Regel';
  const verified = structuredClone(local);
  verified.updated = 21;

  let fetchCount = 0;
  let backupRule = null;
  let putRule = null;
  let persistedRule = null;
  const events = [];
  const result = await performDeployment({
    localRule: local,
    baselineRule: baseline,
    validation: { errors: [], warnings: [] },
    apply: true,
    forceDrift: true,
    fetchRemote: async () => {
      fetchCount += 1;
      events.push(`fetch-${fetchCount}`);
      return structuredClone(fetchCount === 1 ? remote : verified);
    },
    putRemote: async rule => {
      events.push('put');
      putRule = structuredClone(rule);
    },
    createBackup: async rule => {
      events.push('backup');
      backupRule = structuredClone(rule);
      return 'backups/BDR-100/force-drift.server.json';
    },
    persistSynchronizedRule: async rule => {
      events.push('persist');
      persistedRule = structuredClone(rule);
    },
    reportPreflight: async preflight => {
      events.push('preflight');
      assert.equal(preflight.summary.serverDrift, true);
    },
  });

  assert.equal(result.applied, true);
  assert.equal(result.preflight.summary.serverDrift, true);
  assert.equal(fetchCount, 2);
  assert.deepEqual(backupRule, remote);
  assert.equal(putRule.name, local.name);
  assert.equal(putRule.updated, remote.updated);
  assert.equal(persistedRule.name, local.name);
  assert.equal(persistedRule.updated, verified.updated);
  assert.deepEqual(events, [
    'fetch-1',
    'preflight',
    'backup',
    'put',
    'fetch-2',
    'persist',
  ]);
});

test('Fehlgeschlagene Force-Drift-Verifikation synchronisiert keine lokale Regel', async () => {
  const baseline = cloneFixture();
  baseline.projects = [{ projectId: '99999', projectTypeKey: 'software' }];
  const remote = structuredClone(baseline);
  remote.name = 'Serverseitig geänderte Regel';
  remote.updated = 20;
  const local = structuredClone(baseline);
  local.name = 'Bewusst gewünschte lokale Regel';

  let fetchCount = 0;
  let putCount = 0;
  let persistCount = 0;
  await assert.rejects(
    performDeployment({
      localRule: local,
      baselineRule: baseline,
      validation: { errors: [], warnings: [] },
      apply: true,
      forceDrift: true,
      fetchRemote: async () => {
        fetchCount += 1;
        if (fetchCount === 1) return structuredClone(remote);
        return { ...structuredClone(local), name: 'Nicht übernommener Serverstand', updated: 21 };
      },
      putRemote: async () => { putCount += 1; },
      createBackup: async () => 'backups/BDR-100/force-drift.server.json',
      persistSynchronizedRule: async () => { persistCount += 1; },
    }),
    /Remote-Verifikation nach dem Push ist fehlgeschlagen/,
  );

  assert.equal(fetchCount, 2);
  assert.equal(putCount, 1);
  assert.equal(persistCount, 0);
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

test('CER-7287 erstellt nur bei Commits einen Release-Merge-Request', () => {
  const rule = readRuleFile(1059);
  const outerBlock = rule.components.find(component => component.children?.some(child =>
    child.children?.some(nested => nested.value === 'Ein offener Merge Request für den Branch {{SourceBranch}} existiert bereits in GitLab.'),
  ));
  const createBlock = outerBlock.children.find(component => component.conditions?.some(condition =>
    condition.value?.first === '{{webhookResponse.body.size}}'
      && condition.value?.second === '0'
      && condition.value?.operator === 'EQUALS',
  ));
  const compareAction = createBlock.children.find(component =>
    component.value?.url?.includes('/repository/compare?'),
  );
  const decisionBlock = createBlock.children.find(component =>
    component.type === 'jira.condition.container.block',
  );
  const commitsPresent = decisionBlock.children.find(component => component.conditions?.some(condition =>
    condition.value?.first === '{{webhookResponse.body.commits.size}}' && condition.value?.operator === 'GREATER_THAN',
  ));
  const noChanges = decisionBlock.children.find(component => component.conditions?.some(condition =>
    condition.value?.first === '{{webhookResponse.body.commits.size}}' && condition.value?.operator === 'EQUALS',
  ));

  assert.equal(createBlock.conditions[0].value.first, '{{webhookResponse.body.size}}');
  assert.equal(createBlock.conditions[0].value.second, '0');
  assert.equal(compareAction.value.method, 'GET');
  assert.equal(
    compareAction.value.url,
    'https://gitlab.partner.bdr.de/api/v4/projects/{{GitlabProjectId}}/repository/compare?from=develop&to={{SourceBranch.urlEncode}}&straight=true',
  );
  assert.equal(commitsPresent.conditions[0].value.first, '{{webhookResponse.body.commits.size}}');
  assert.equal(commitsPresent.conditions[0].value.operator, 'GREATER_THAN');
  assert.ok(commitsPresent.children.some(component => component.value?.method === 'POST'));
  assert.equal(noChanges.conditions[0].value.operator, 'EQUALS');
  assert.match(noChanges.children[0].value, /Kein Merge Request erstellt/);
});
