import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRuleSetValidator } from '../scripts/lib/rule-validation.mjs';

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
