import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const IMMUTABLE_TOP_LEVEL_FIELDS = Object.freeze([
  'id',
  'clientKey',
  'created',
  'authorAccountId',
]);

export const GUARDED_TOP_LEVEL_FIELDS = Object.freeze([
  'actorAccountId',
  'projects',
  'state',
  'canOtherRuleTrigger',
  'notifyOnError',
]);

const SENSITIVE_KEY_PATTERN = /(authorization|password|passphrase|secret|token|webhooktoken|api[-_ ]?key|credential)/i;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalize(value, ignoredKeys = new Set()) {
  if (Array.isArray(value)) {
    return value.map(item => canonicalize(item, ignoredKeys));
  }
  if (!isPlainObject(value)) return value;

  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (ignoredKeys.has(key)) continue;
    result[key] = canonicalize(value[key], ignoredKeys);
  }
  return result;
}

export function rulesEqual(left, right, { ignoreUpdated = false } = {}) {
  const ignoredKeys = ignoreUpdated ? new Set(['updated']) : new Set();
  return JSON.stringify(canonicalize(left, ignoredKeys))
    === JSON.stringify(canonicalize(right, ignoredKeys));
}

function keyIsSensitive(key, parent) {
  if (key === 'secret' && typeof parent?.[key] === 'boolean') return false;
  if (key === 'usedSecretsKeys') return true;
  if (SENSITIVE_KEY_PATTERN.test(key)) return true;
  if (key === 'value' && SENSITIVE_KEY_PATTERN.test(String(parent?.name || ''))) return true;
  return key === 'keyOrValue' && parent?.secret === true;
}

export function redactSensitive(value) {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (!isPlainObject(value)) return value;

  const result = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = keyIsSensitive(key, value) ? '[REDACTED]' : redactSensitive(child);
  }
  return result;
}

function collectChanges(before, after, path = '', parentBefore = null, parentAfter = null, changes = []) {
  if (rulesEqual(before, after)) return changes;

  const key = path.split('/').at(-1) || '';
  if (keyIsSensitive(key, parentBefore) || keyIsSensitive(key, parentAfter)) {
    changes.push({
      path: path || '/',
      before: '[REDACTED]',
      after: '[REDACTED]',
      sensitive: true,
    });
    return changes;
  }

  const beforeObject = isPlainObject(before);
  const afterObject = isPlainObject(after);
  if (beforeObject && afterObject) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const childKey of [...keys].sort()) {
      collectChanges(
        before[childKey],
        after[childKey],
        `${path}/${childKey}`,
        before,
        after,
        changes,
      );
    }
    return changes;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      collectChanges(before[index], after[index], `${path}/${index}`, before, after, changes);
    }
    return changes;
  }

  changes.push({
    path: path || '/',
    before: redactSensitive(before),
    after: redactSensitive(after),
    sensitive: false,
  });
  return changes;
}

export function diffRules(before, after) {
  return collectChanges(before, after);
}

function collectComponents(rule) {
  const components = new Map();

  function visit(node) {
    if (!isPlainObject(node)) return;
    if (typeof node.id === 'string') {
      components.set(node.id, {
        id: node.id,
        component: node.component,
        type: node.type,
        schemaVersion: node.schemaVersion,
      });
    }
    for (const key of ['children', 'conditions']) {
      if (Array.isArray(node[key])) node[key].forEach(visit);
    }
  }

  visit(rule?.trigger);
  if (Array.isArray(rule?.components)) rule.components.forEach(visit);
  return components;
}

export function summarizeRuleChanges(remoteRule, localRule) {
  const beforeComponents = collectComponents(remoteRule);
  const afterComponents = collectComponents(localRule);
  const added = [];
  const removed = [];
  const changed = [];

  for (const [id, component] of afterComponents) {
    if (!beforeComponents.has(id)) {
      added.push(component);
    } else if (!rulesEqual(beforeComponents.get(id), component)) {
      changed.push({ before: beforeComponents.get(id), after: component });
    }
  }

  for (const [id, component] of beforeComponents) {
    if (!afterComponents.has(id)) removed.push(component);
  }

  return {
    rule: {
      id: localRule.id,
      name: localRule.name,
      projects: redactSensitive(localRule.projects),
      trigger: localRule.trigger
        ? {
            id: localRule.trigger.id,
            type: localRule.trigger.type,
            schemaVersion: localRule.trigger.schemaVersion,
          }
        : null,
    },
    components: { added, removed, changed },
    guardedFields: GUARDED_TOP_LEVEL_FIELDS
      .filter(field => !rulesEqual(remoteRule[field], localRule[field]))
      .map(field => ({
        field,
        before: redactSensitive(remoteRule[field]),
        after: redactSensitive(localRule[field]),
      })),
    changes: diffRules(remoteRule, localRule),
  };
}

export function nextComponentId(entries) {
  let maximum = 0;

  function visit(node) {
    if (!isPlainObject(node)) return;
    if (typeof node.id === 'string' && /^\d+$/.test(node.id)) {
      maximum = Math.max(maximum, Number(node.id));
    }
    for (const key of ['children', 'conditions']) {
      if (Array.isArray(node[key])) node[key].forEach(visit);
    }
  }

  for (const entry of entries) {
    visit(entry.rule?.trigger);
    if (Array.isArray(entry.rule?.components)) entry.rule.components.forEach(visit);
  }

  return String(maximum + 1);
}

export function prepareDeployment({
  localRule,
  remoteRule,
  baselineRule,
  validation,
  allowedFields = [],
}) {
  const errors = [];
  const warnings = [...(validation?.warnings || [])];
  const allowed = new Set(allowedFields);
  const summary = summarizeRuleChanges(remoteRule, localRule);

  for (const validationError of validation?.errors || []) {
    errors.push(`Validierung: ${validationError.file} ${validationError.path} ${validationError.message}`);
  }
  if (warnings.length > 0) {
    errors.push('Ein Push ist nur mit 0 Validierungswarnungen zulässig.');
  }

  if (!baselineRule) {
    errors.push('Kein Git-HEAD-Basisstand für die Drift-Prüfung gefunden.');
  } else if (!rulesEqual(remoteRule, baselineRule)) {
    errors.push('Der aktuelle Serverstand weicht vom Git-HEAD-Basisstand ab.');
  }

  for (const field of IMMUTABLE_TOP_LEVEL_FIELDS) {
    if (!rulesEqual(remoteRule?.[field], localRule?.[field])) {
      errors.push(`Unveränderliches Top-Level-Feld geändert: ${field}.`);
    }
  }

  if (!rulesEqual(remoteRule?.updated, localRule?.updated)) {
    errors.push('Das serververwaltete Feld updated darf nicht lokal geändert werden.');
  }

  for (const field of GUARDED_TOP_LEVEL_FIELDS) {
    if (!rulesEqual(remoteRule?.[field], localRule?.[field]) && !allowed.has(field)) {
      errors.push(`Geschütztes Top-Level-Feld ohne Freigabe geändert: ${field}.`);
    }
  }

  if (!Array.isArray(localRule?.projects) || localRule.projects.length !== 1) {
    errors.push('Der sichere Push unterstützt genau einen Projekt-Scope.');
  }

  const sensitiveChanges = diffRules(remoteRule, localRule).filter(change => change.sensitive);
  if (sensitiveChanges.length > 0) {
    errors.push('Secret- oder Tokenwerte dürfen nicht durch den lokalen Push geändert werden.');
  }
  if (summary.changes.length === 0) {
    errors.push('Es liegen keine Änderungen für einen Push vor.');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary,
  };
}

export function backupRelativePath(ruleId, date = new Date()) {
  const timestamp = date.toISOString().replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z');
  return join(`BDR-${ruleId}`, `${timestamp}.server.json`);
}

export function writeServerBackup(backupsRoot, rule, date = new Date()) {
  const path = join(backupsRoot, backupRelativePath(rule.id, date));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(rule, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  return path;
}

export async function performDeployment({
  localRule,
  baselineRule,
  validation,
  allowedFields = [],
  apply = false,
  fetchRemote,
  putRemote,
  createBackup,
}) {
  const remoteRule = await fetchRemote(localRule);
  const preflight = prepareDeployment({
    localRule,
    remoteRule,
    baselineRule,
    validation,
    allowedFields,
  });

  if (!apply || !preflight.ok) {
    return {
      applied: false,
      preflight,
      remoteRule,
    };
  }

  const backupPath = await createBackup(remoteRule);
  if (!backupPath) throw new Error('Backup konnte nicht erstellt werden.');

  await putRemote(localRule);
  const verifiedRule = await fetchRemote(localRule);
  if (!rulesEqual(localRule, verifiedRule, { ignoreUpdated: true })) {
    throw new Error('Remote-Verifikation nach dem Push ist fehlgeschlagen.');
  }

  return {
    applied: true,
    backupPath,
    preflight,
    remoteRule,
    verifiedRule,
  };
}
