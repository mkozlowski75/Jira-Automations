/**
 * Sichere Service-Schicht für Jira-Tickets.
 * Schreiboperationen werden nur nach erneutem Read und geprüftem updated-Wert ausgeführt.
 */
const DEFAULT_GET_FIELDS = [
  'summary',
  'description',
  'status',
  'priority',
  'assignee',
  'reporter',
  'labels',
  'components',
  'fixVersions',
  'duedate',
  'created',
  'updated',
];

const DEFAULT_SEARCH_FIELDS = [
  'summary',
  'status',
  'priority',
  'assignee',
  'updated',
];

const BLOCKED_EDIT_FIELDS = new Set([
  'key',
  'project',
  'issuetype',
  'reporter',
  'security',
  'status',
]);

const SENSITIVE_NAME = /(authorization|credential|password|secret|token)/i;

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function assertIssueKey(issueKey) {
  if (typeof issueKey !== 'string' || !/^[A-Z][A-Z0-9_]*-\d+$/.test(issueKey)) {
    throw new Error('Ungültiger Jira-Ticket-Key.');
  }
  return issueKey;
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} muss ein JSON-Objekt sein.`);
  }
}

function issuePath(issueKey, fields, expand) {
  const query = new URLSearchParams();
  if (fields?.length) query.set('fields', fields.join(','));
  if (expand) query.set('expand', expand);
  return `/issue/${encodeURIComponent(assertIssueKey(issueKey))}?${query}`;
}

function identifier(value) {
  if (!value || typeof value !== 'object') return value;
  return value.id ?? value.key ?? value.accountId ?? value.name ?? value.value;
}

function valueMatches(actual, expected) {
  if (expected === null || typeof expected !== 'object') return Object.is(actual, expected);
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return expected.every((entry, index) => {
      const expectedIdentifier = identifier(entry);
      const actualIdentifier = identifier(actual[index]);
      return expectedIdentifier !== undefined
        ? Object.is(actualIdentifier, expectedIdentifier)
        : valueMatches(actual[index], entry);
    });
  }
  if (!actual || typeof actual !== 'object') return false;
  return Object.entries(expected).every(([key, value]) => valueMatches(actual[key], value));
}

function summarizeValue(fieldId, fieldName, value) {
  if (SENSITIVE_NAME.test(`${fieldId} ${fieldName || ''}`)) return '[REDACTED]';
  return clone(value);
}

function simplifyIssue(issue, fields = DEFAULT_GET_FIELDS) {
  const selected = {};
  for (const field of fields) selected[field] = clone(issue?.fields?.[field] ?? null);
  return {
    key: issue?.key ?? null,
    fields: selected,
  };
}

function transitionFields(transition) {
  return Object.entries(transition?.fields || {}).map(([id, descriptor]) => ({
    id,
    name: descriptor?.name || id,
    required: descriptor?.required === true,
    schema: clone(descriptor?.schema || null),
    allowedValues: clone(descriptor?.allowedValues || []),
  }));
}

function simplifyTransition(transition) {
  return {
    id: String(transition?.id ?? ''),
    name: transition?.name ?? null,
    to: {
      id: String(transition?.to?.id ?? ''),
      name: transition?.to?.name ?? null,
    },
    fields: transitionFields(transition),
  };
}

function assertExpectedUpdated(expectedUpdated, actualUpdated) {
  if (!expectedUpdated) {
    throw new Error('--apply benötigt --expected-updated aus dem unmittelbar vorherigen Preflight.');
  }
  if (String(expectedUpdated) !== String(actualUpdated)) {
    throw new Error('Ticket-Drift erkannt: updated stimmt nicht mehr mit dem Preflight überein.');
  }
}

function validateFieldsAgainstMetadata(fields, metadata, blockedFields = BLOCKED_EDIT_FIELDS) {
  assertPlainObject(fields, 'Die Felddatei');
  const entries = Object.entries(fields);
  if (entries.length === 0) throw new Error('Die Felddatei enthält keine Änderungen.');

  for (const [fieldId] of entries) {
    if (blockedFields.has(fieldId)) {
      throw new Error(`Feld "${fieldId}" ist für direkte Änderungen gesperrt.`);
    }
    if (!Object.prototype.hasOwnProperty.call(metadata || {}, fieldId)) {
      throw new Error(`Feld "${fieldId}" ist laut Jira-Metadaten nicht editierbar.`);
    }
  }
}

function requiredTransitionFields(transition) {
  return Object.entries(transition?.fields || {})
    .filter(([, descriptor]) => descriptor?.required === true)
    .map(([fieldId]) => fieldId);
}

function validateTransitionFields(fields, transition) {
  assertPlainObject(fields, 'Die Transition-Felddatei');
  const metadata = transition?.fields || {};
  for (const fieldId of Object.keys(fields)) {
    if (!Object.prototype.hasOwnProperty.call(metadata, fieldId)) {
      throw new Error(`Feld "${fieldId}" ist für diese Transition nicht verfügbar.`);
    }
  }
  const missing = requiredTransitionFields(transition)
    .filter(fieldId => !Object.prototype.hasOwnProperty.call(fields, fieldId));
  if (missing.length > 0) {
    throw new Error(`Pflichtfelder für die Transition fehlen: ${missing.join(', ')}.`);
  }
}

export function createJiraTicketService(client) {
  if (!client?.get || !client?.post || !client?.put) {
    throw new Error('Jira-Client muss get, post und put bereitstellen.');
  }

  async function getIssue(issueKey, fields = DEFAULT_GET_FIELDS) {
    const issue = await client.get(issuePath(issueKey, fields));
    return simplifyIssue(issue, fields);
  }

  async function searchIssues({ jql, maxResults = 20, fields = DEFAULT_SEARCH_FIELDS }) {
    if (typeof jql !== 'string' || !jql.trim()) throw new Error('JQL darf nicht leer sein.');
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 100) {
      throw new Error('max-results muss zwischen 1 und 100 liegen.');
    }

    const issues = [];
    let startAt = 0;
    let totalAvailable = null;
    while (issues.length < maxResults) {
      const pageSize = Math.min(50, maxResults - issues.length);
      const query = new URLSearchParams({
        jql,
        startAt: String(startAt),
        maxResults: String(pageSize),
        fields: fields.join(','),
      });
      const page = await client.get(`/search?${query}`);
      if (!Array.isArray(page?.issues)) throw new Error('Jira-Suche lieferte kein Ticket-Array.');
      if (Number.isInteger(page.total)) totalAvailable = page.total;
      issues.push(...page.issues.map(issue => simplifyIssue(issue, fields)));
      startAt += page.issues.length;
      if (page.issues.length === 0 || startAt >= Number(page.total || 0)) break;
    }
    return {
      jql,
      total: totalAvailable,
      returned: issues.length,
      issues: issues.slice(0, maxResults),
    };
  }

  async function getTransitions(issueKey) {
    const response = await client.get(
      `/issue/${encodeURIComponent(assertIssueKey(issueKey))}/transitions?expand=transitions.fields`,
    );
    if (!Array.isArray(response?.transitions)) {
      throw new Error('Jira lieferte keine unterstützte Transition-Liste.');
    }
    return response.transitions.map(simplifyTransition);
  }

  async function prepareComment(issueKey, body) {
    if (typeof body !== 'string' || !body.trim()) throw new Error('Kommentar darf nicht leer sein.');
    const issue = await client.get(issuePath(issueKey, ['summary', 'updated']));
    return {
      operation: 'comment',
      key: issue.key,
      summary: issue.fields?.summary ?? null,
      expectedUpdated: issue.fields?.updated ?? null,
      comment: body.length > 500 ? `${body.slice(0, 500)}…` : body,
      applied: false,
    };
  }

  async function applyComment(issueKey, body, expectedUpdated) {
    const preflight = await prepareComment(issueKey, body);
    assertExpectedUpdated(expectedUpdated, preflight.expectedUpdated);
    const created = await client.post(
      `/issue/${encodeURIComponent(assertIssueKey(issueKey))}/comment`,
      { body },
    );
    if (!created?.id) throw new Error('Jira bestätigte den Kommentar ohne Kommentar-ID.');
    const verified = await client.get(
      `/issue/${encodeURIComponent(issueKey)}/comment/${encodeURIComponent(String(created.id))}`,
    );
    if (verified?.body !== body) throw new Error('Remote-Verifikation des Kommentars ist fehlgeschlagen.');
    return {
      ...preflight,
      applied: true,
      commentId: String(created.id),
    };
  }

  async function prepareEdit(issueKey, fields) {
    const key = assertIssueKey(issueKey);
    const editMeta = await client.get(`/issue/${encodeURIComponent(key)}/editmeta`);
    validateFieldsAgainstMetadata(fields, editMeta?.fields);
    const requestedFields = [...new Set(['summary', 'updated', ...Object.keys(fields)])];
    const issue = await client.get(issuePath(key, requestedFields));
    const changes = Object.entries(fields).map(([fieldId, value]) => {
      const descriptor = editMeta.fields[fieldId];
      return {
        field: fieldId,
        name: descriptor?.name || fieldId,
        from: summarizeValue(fieldId, descriptor?.name, issue.fields?.[fieldId] ?? null),
        to: summarizeValue(fieldId, descriptor?.name, value),
      };
    });
    return {
      operation: 'edit',
      key: issue.key,
      summary: issue.fields?.summary ?? null,
      expectedUpdated: issue.fields?.updated ?? null,
      changes,
      applied: false,
    };
  }

  async function applyEdit(issueKey, fields, expectedUpdated) {
    const preflight = await prepareEdit(issueKey, fields);
    assertExpectedUpdated(expectedUpdated, preflight.expectedUpdated);
    await client.put(`/issue/${encodeURIComponent(assertIssueKey(issueKey))}`, { fields });
    const verified = await client.get(issuePath(issueKey, ['updated', ...Object.keys(fields)]));
    for (const [fieldId, expected] of Object.entries(fields)) {
      if (!valueMatches(verified?.fields?.[fieldId], expected)) {
        throw new Error(`Remote-Verifikation für Feld "${fieldId}" ist fehlgeschlagen.`);
      }
    }
    return {
      ...preflight,
      applied: true,
      verifiedUpdated: verified?.fields?.updated ?? null,
    };
  }

  async function prepareTransition(issueKey, transitionId, fields = {}) {
    const key = assertIssueKey(issueKey);
    if (!/^\d+$/.test(String(transitionId || ''))) throw new Error('Ungültige Transition-ID.');
    const issue = await client.get(issuePath(key, ['summary', 'status', 'updated']));
    const response = await client.get(
      `/issue/${encodeURIComponent(key)}/transitions?expand=transitions.fields`,
    );
    const transition = response?.transitions?.find(
      candidate => String(candidate?.id) === String(transitionId),
    );
    if (!transition) throw new Error(`Transition "${transitionId}" ist aktuell nicht verfügbar.`);
    validateTransitionFields(fields, transition);
    return {
      operation: 'transition',
      key: issue.key,
      summary: issue.fields?.summary ?? null,
      expectedUpdated: issue.fields?.updated ?? null,
      from: clone(issue.fields?.status ?? null),
      to: clone(transition.to ?? null),
      fields: Object.entries(fields).map(([fieldId, value]) => ({
        field: fieldId,
        name: transition.fields?.[fieldId]?.name || fieldId,
        value: summarizeValue(fieldId, transition.fields?.[fieldId]?.name, value),
      })),
      applied: false,
    };
  }

  async function applyTransition(issueKey, transitionId, fields, expectedUpdated) {
    const preflight = await prepareTransition(issueKey, transitionId, fields);
    assertExpectedUpdated(expectedUpdated, preflight.expectedUpdated);
    const body = { transition: { id: String(transitionId) } };
    if (Object.keys(fields).length > 0) body.fields = fields;
    await client.post(`/issue/${encodeURIComponent(assertIssueKey(issueKey))}/transitions`, body);
    const verified = await client.get(issuePath(issueKey, ['status', 'updated']));
    if (String(verified?.fields?.status?.id) !== String(preflight.to?.id)) {
      throw new Error('Remote-Verifikation der Transition ist fehlgeschlagen.');
    }
    return {
      ...preflight,
      applied: true,
      verifiedUpdated: verified?.fields?.updated ?? null,
    };
  }

  return {
    getIssue,
    searchIssues,
    getTransitions,
    prepareComment,
    applyComment,
    prepareEdit,
    applyEdit,
    prepareTransition,
    applyTransition,
  };
}

export {
  BLOCKED_EDIT_FIELDS,
  DEFAULT_GET_FIELDS,
  DEFAULT_SEARCH_FIELDS,
  assertIssueKey,
  valueMatches,
};
