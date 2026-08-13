/**
 * Sichere Service-Schicht für Jira-Tickets.
 * Schreiboperationen werden nur nach erneutem Read und passender Preflight-Prüfung ausgeführt.
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

function createMetadataPath(projectKey, issueTypeName) {
  const query = new URLSearchParams({
    projectKeys: projectKey,
    issuetypeNames: issueTypeName,
    expand: 'projects.issuetypes.fields',
  });
  return `/issue/createmeta?${query}`;
}

function isNotFoundError(error) {
  return /\b404\b/.test(String(error?.message || ''));
}

function modernCreateMetadataPath(projectId, issueTypeId) {
  const query = new URLSearchParams({ maxResults: '100' });
  return `/issue/createmeta/${encodeURIComponent(projectId)}/issuetypes/${encodeURIComponent(issueTypeId)}?${query}`;
}

function modernCreateMetadata(response, project, issueType) {
  const fields = Object.fromEntries((response?.values || []).map(field => [field?.fieldId, field]));
  if (!Array.isArray(response?.values) || Object.keys(fields).length !== response.values.length) {
    throw new Error('Jira lieferte keine unterstÃ¼tzten Erstellmetadaten-Felder.');
  }
  if (Number(response.total) > response.values.length) {
    throw new Error('Jira-Erstellmetadaten sind unvollstÃ¤ndig.');
  }
  return {
    projects: [{
      key: project.key,
      issuetypes: [{ id: String(issueType.id), name: issueType.name, fields }],
    }],
  };
}

function resolveCreateMetadata(response, projectKey, issueTypeName, suppliedFields = []) {
  const project = response?.projects?.find(candidate => candidate?.key === projectKey);
  if (!project) throw new Error(`Jira-Projekt "${projectKey}" ist nicht für die Ticketanlage verfügbar.`);
  const issueType = project.issuetypes?.find(candidate => candidate?.name === issueTypeName);
  if (!issueType?.id) {
    throw new Error(`Jira-Vorgangstyp "${issueTypeName}" ist im Projekt "${projectKey}" nicht verfügbar.`);
  }
  const metadata = issueType.fields || {};
  for (const fieldId of ['summary', 'description']) {
    if (!Object.prototype.hasOwnProperty.call(metadata, fieldId)) {
      throw new Error(`Pflichtfeld "${fieldId}" ist laut Jira-Erstellmetadaten nicht verfügbar.`);
    }
  }
  const unsupportedRequired = Object.entries(metadata)
    .filter(([fieldId, descriptor]) => (
      !['project', 'issuetype', 'summary', 'description', ...suppliedFields].includes(fieldId)
      && descriptor?.required === true
      && descriptor?.hasDefaultValue !== true
    ))
    .map(([fieldId]) => fieldId);
  if (unsupportedRequired.length > 0) {
    throw new Error(`Jira verlangt weitere Pflichtfelder: ${unsupportedRequired.join(', ')}.`);
  }
  return { project, issueType };
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

  async function getCurrentUser() {
    const user = await client.get('/myself');
    if (typeof user?.name !== 'string' || !user.name.trim()) {
      throw new Error('Jira lieferte keinen gültigen aktuellen Benutzer.');
    }
    return { name: user.name };
  }

  async function prepareCreateIssue({ projectKey, issueTypeName, summary, description, reporter }) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(String(projectKey || ''))) {
      throw new Error('Ungültiger Jira-Projekt-Key.');
    }
    if (typeof issueTypeName !== 'string' || !issueTypeName.trim()) {
      throw new Error('Jira-Vorgangstyp darf nicht leer sein.');
    }
    if (typeof summary !== 'string' || !summary.trim()) {
      throw new Error('Summary darf nicht leer sein.');
    }
    if (typeof description !== 'string' || !description.trim()) {
      throw new Error('Description darf nicht leer sein.');
    }
    if (reporter !== undefined && (typeof reporter !== 'object' || !reporter || !reporter.name)) {
      throw new Error('Reporter muss einen Jira-Benutzernamen enthalten.');
    }
    let createMetadata;
    try {
      createMetadata = await client.get(createMetadataPath(projectKey, issueTypeName));
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      const project = await client.get(`/project/${encodeURIComponent(projectKey)}`);
      const issueType = project?.issueTypes?.find(candidate => candidate?.name === issueTypeName);
      if (!project?.id || !project?.key || !issueType?.id) {
        throw new Error(`Jira-Erstellmetadaten fÃ¼r ${projectKey}/${issueTypeName} sind nicht verfÃ¼gbar.`);
      }
      const response = await client.get(modernCreateMetadataPath(project.id, issueType.id));
      createMetadata = modernCreateMetadata(response, project, issueType);
    }
    const metadata = resolveCreateMetadata(
      createMetadata,
      projectKey,
      issueTypeName,
      reporter ? ['reporter'] : [],
    );
    if (metadata.issueType.fields?.reporter?.required === true && !reporter) {
      throw new Error('Jira verlangt das Pflichtfeld "reporter".');
    }
    return {
      operation: 'create',
      applied: false,
      project: { key: projectKey },
      issueType: { id: String(metadata.issueType.id), name: metadata.issueType.name },
      summary,
      description,
      reporter: reporter ? { name: reporter.name } : undefined,
    };
  }

  async function applyCreateIssue(input, expectedIssueTypeId, beforeCreate) {
    if (!expectedIssueTypeId) {
      throw new Error('--apply benötigt die Vorgangstyp-ID aus dem unmittelbar vorherigen Preflight.');
    }
    const preflight = await prepareCreateIssue(input);
    if (String(preflight.issueType.id) !== String(expectedIssueTypeId)) {
      throw new Error('Jira-Erstellmetadaten haben sich seit dem Preflight geändert.');
    }
    const fields = {
      project: { key: input.projectKey },
      issuetype: { id: preflight.issueType.id },
      summary: input.summary,
      description: input.description,
    };
    if (preflight.reporter) fields.reporter = preflight.reporter;
    if (beforeCreate) await beforeCreate();
    const created = await client.post('/issue', { fields });
    if (!created?.key) throw new Error('Jira bestätigte die Ticketanlage ohne Ticket-Key.');
    const remote = await client.get(issuePath(
      created.key,
      ['summary', 'description', 'issuetype', 'project', 'reporter'],
    ));
    const verified = remote?.key === created.key
      && remote?.fields?.summary === input.summary
      && remote?.fields?.description === input.description
      && (!preflight.reporter || remote?.fields?.reporter?.name === preflight.reporter.name)
      && String(remote?.fields?.issuetype?.id) === String(preflight.issueType.id)
      && remote?.fields?.issuetype?.name === input.issueTypeName
      && remote?.fields?.project?.key === input.projectKey;
    if (!verified) throw new Error('Remote-Verifikation des erstellten Tickets ist fehlgeschlagen.');
    return {
      ...preflight,
      applied: true,
      key: created.key,
      verified: true,
    };
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
    getCurrentUser,
    prepareCreateIssue,
    applyCreateIssue,
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
