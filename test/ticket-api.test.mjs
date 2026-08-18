import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createJiraTicketService,
  valueMatches,
} from '../scripts/lib/ticket-api.mjs';
import {
  isMainModule,
  runCli,
  safeErrorMessage,
} from '../.github/skills/jira-tickets/scripts/jira-ticket.mjs';

function mockClient(overrides = {}) {
  return {
    get: async () => { throw new Error('Unerwarteter GET.'); },
    post: async () => { throw new Error('Unerwarteter POST.'); },
    put: async () => { throw new Error('Unerwarteter PUT.'); },
    ...overrides,
  };
}

function issue(fields = {}) {
  return {
    key: 'BDR-123',
    fields: {
      summary: 'Bereinigtes Testticket',
      updated: '2026-07-30T08:00:00.000+0000',
      ...fields,
    },
  };
}

test('liest ein Ticket mit ausgewählten Feldern', async () => {
  let requestedPath;
  const service = createJiraTicketService(mockClient({
    get: async path => {
      requestedPath = path;
      return issue({ status: { id: '1', name: 'Open' } });
    },
  }));

  const result = await service.getIssue('BDR-123', ['summary', 'status', 'updated']);

  assert.match(requestedPath, /^\/issue\/BDR-123\?/);
  assert.equal(result.key, 'BDR-123');
  assert.equal(result.fields.status.id, '1');
  assert.equal(result.fields.description, undefined);
});

test('paginiert JQL-Suchen bis zum gewünschten Maximum', async () => {
  const paths = [];
  const service = createJiraTicketService(mockClient({
    get: async path => {
      paths.push(path);
      const startAt = Number(new URL(`https://example.invalid${path}`).searchParams.get('startAt'));
      return startAt === 0
        ? { total: 3, issues: [issue(), { ...issue(), key: 'BDR-124' }] }
        : { total: 3, issues: [{ ...issue(), key: 'BDR-125' }] };
    },
  }));

  const result = await service.searchIssues({
    jql: 'project = BDR',
    maxResults: 3,
  });

  assert.equal(paths.length, 2);
  assert.equal(result.total, 3);
  assert.equal(result.returned, 3);
  assert.deepEqual(result.issues.map(entry => entry.key), ['BDR-123', 'BDR-124', 'BDR-125']);
});

test('listet Transitionen mit Pflichtfeldern auf', async () => {
  const service = createJiraTicketService(mockClient({
    get: async () => ({
      transitions: [{
        id: '31',
        name: 'Resolve',
        to: { id: '5', name: 'Resolved' },
        fields: {
          resolution: {
            name: 'Resolution',
            required: true,
            schema: { type: 'resolution' },
            allowedValues: [{ id: '1', name: 'Fixed' }],
          },
        },
      }],
    }),
  }));

  const result = await service.getTransitions('BDR-123');

  assert.equal(result[0].id, '31');
  assert.equal(result[0].fields[0].required, true);
});

test('Edit-Preflight ist read-only und redigiert sensible Feldnamen', async () => {
  let putCount = 0;
  let getCount = 0;
  const service = createJiraTicketService(mockClient({
    get: async path => {
      getCount += 1;
      if (path.endsWith('/editmeta')) {
        return {
          fields: {
            summary: { name: 'Summary' },
            customfield_10000: { name: 'API Token Hint' },
          },
        };
      }
      return issue({ customfield_10000: 'alt' });
    },
    put: async () => { putCount += 1; },
  }));

  const result = await service.prepareEdit('BDR-123', {
    summary: 'Neu',
    customfield_10000: 'geheim',
  });

  assert.equal(getCount, 2);
  assert.equal(putCount, 0);
  assert.equal(result.changes[1].from, '[REDACTED]');
  assert.equal(result.changes[1].to, '[REDACTED]');
});

test('blockiert geschützte und nicht editierbare Felder auch vor apply', async () => {
  const service = createJiraTicketService(mockClient({
    get: async () => ({ fields: { project: {}, summary: {} } }),
  }));

  await assert.rejects(
    service.prepareEdit('BDR-123', { project: { key: 'OTHER' } }),
    /gesperrt/,
  );
  await assert.rejects(
    service.prepareEdit('BDR-123', { labels: ['test'] }),
    /nicht editierbar/,
  );
});

test('blockiert Edit bei Drift ohne PUT', async () => {
  let putCount = 0;
  const service = createJiraTicketService(mockClient({
    get: async path => path.endsWith('/editmeta')
      ? { fields: { summary: { name: 'Summary' } } }
      : issue(),
    put: async () => { putCount += 1; },
  }));

  await assert.rejects(
    service.applyEdit('BDR-123', { summary: 'Neu' }, 'anderer-stand'),
    /Drift/,
  );
  assert.equal(putCount, 0);
});

test('führt Edit aus und verifiziert den Remote-Wert', async () => {
  let putBody;
  let getCount = 0;
  const service = createJiraTicketService(mockClient({
    get: async path => {
      if (path.endsWith('/editmeta')) return { fields: { priority: { name: 'Priority' } } };
      getCount += 1;
      return getCount === 1
        ? issue({ priority: { id: '2', name: 'Medium' } })
        : issue({
          updated: '2026-07-30T08:01:00.000+0000',
          priority: { id: '3', name: 'High' },
        });
    },
    put: async (path, body) => { putBody = { path, body }; },
  }));

  const result = await service.applyEdit(
    'BDR-123',
    { priority: { id: '3' } },
    '2026-07-30T08:00:00.000+0000',
  );

  assert.deepEqual(putBody, {
    path: '/issue/BDR-123',
    body: { fields: { priority: { id: '3' } } },
  });
  assert.equal(result.applied, true);
});

test('Kommentar-Preflight schreibt nicht und apply verifiziert die Kommentar-ID', async () => {
  let postCount = 0;
  const client = mockClient({
    get: async path => path.includes('/comment/')
      ? { id: '900', body: 'Testkommentar' }
      : issue(),
    post: async () => {
      postCount += 1;
      return { id: '900' };
    },
  });
  const service = createJiraTicketService(client);

  const preflight = await service.prepareComment('BDR-123', 'Testkommentar');
  assert.equal(postCount, 0);
  const applied = await service.applyComment(
    'BDR-123',
    'Testkommentar',
    preflight.expectedUpdated,
  );

  assert.equal(postCount, 1);
  assert.equal(applied.commentId, '900');
});

test('Transition verlangt Pflichtfelder und verifiziert Zielstatus', async () => {
  let postBody;
  let issueReads = 0;
  const transitionResponse = {
    transitions: [{
      id: '31',
      name: 'Resolve',
      to: { id: '5', name: 'Resolved' },
      fields: {
        resolution: { name: 'Resolution', required: true },
      },
    }],
  };
  const service = createJiraTicketService(mockClient({
    get: async path => {
      if (path.includes('/transitions?')) return transitionResponse;
      issueReads += 1;
      return issue({
        status: issueReads === 1
          ? { id: '1', name: 'Open' }
          : { id: '5', name: 'Resolved' },
      });
    },
    post: async (path, body) => { postBody = { path, body }; },
  }));

  await assert.rejects(
    service.prepareTransition('BDR-123', '31', {}),
    /Pflichtfelder/,
  );
  const result = await service.applyTransition(
    'BDR-123',
    '31',
    { resolution: { id: '1' } },
    '2026-07-30T08:00:00.000+0000',
  );

  assert.equal(postBody.path, '/issue/BDR-123/transitions');
  assert.equal(result.applied, true);
});

test('CLI führt ohne --apply nur den Preflight aus', async () => {
  let prepareCount = 0;
  let applyCount = 0;
  const service = {
    prepareEdit: async () => { prepareCount += 1; return { applied: false }; },
    applyEdit: async () => { applyCount += 1; return { applied: true }; },
  };

  const result = await runCli(
    ['edit', 'BDR-123', '--fields-file', 'fields.json'],
    {
      service,
      readText: async () => '{"summary":"Neu"}',
    },
  );

  assert.equal(result.applied, false);
  assert.equal(prepareCount, 1);
  assert.equal(applyCount, 0);
});

test('CLI reicht apply und expected-updated explizit weiter', async () => {
  let received;
  const service = {
    applyEdit: async (...args) => {
      received = args;
      return { applied: true };
    },
  };

  await runCli(
    [
      'edit',
      'BDR-123',
      '--fields-file',
      'fields.json',
      '--apply',
      '--expected-updated',
      'stand-1',
    ],
    {
      service,
      readText: async () => '{"summary":"Neu"}',
    },
  );

  assert.deepEqual(received, ['BDR-123', { summary: 'Neu' }, 'stand-1']);
});

test('CLI zeigt --help ohne wertpflichtige Option', async () => {
  const result = await runCli(['--help'], { service: {} });

  assert.match(result.usage, /jira-ticket\.mjs search/);
});

test('CLI erkennt ihren realen Skriptpfad als Hauptmodul', () => {
  const scriptPath = new URL(
    '../.github/skills/jira-tickets/scripts/jira-ticket.mjs',
    import.meta.url,
  );

  assert.equal(isMainModule(scriptPath.href, scriptPath.pathname.slice(1)), true);
});

test('validiert Ergebniswerte als Jira-angereicherte Teilmengen', () => {
  assert.equal(
    valueMatches({ id: '3', name: 'High' }, { id: '3' }),
    true,
  );
  assert.equal(
    valueMatches([{ id: '1', name: 'A' }], [{ id: '2' }]),
    false,
  );
  assert.equal(
    valueMatches([{ id: '2' }, { id: '1' }], [{ id: '1' }, { id: '2' }]),
    true,
  );
});

test('Fehlermeldungen redigieren URLs und Bearer-Werte', () => {
  const message = safeErrorMessage(
    new Error('GET https://jira.example.invalid/rest Bearer sensitive-value fehlgeschlagen'),
  );

  assert.equal(message.includes('jira.example.invalid'), false);
  assert.equal(message.includes('sensitive-value'), false);
});
