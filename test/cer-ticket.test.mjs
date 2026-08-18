import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertCerIssue,
  createCerTicketWorkflow,
  detectImageType,
  normalizeTicketRequest,
  validateSources,
} from '../scripts/lib/cer-ticket-workflow.mjs';
import { createJiraTicketService } from '../scripts/lib/ticket-api.mjs';
import {
  assertReceipt,
  runCli,
} from '../scripts/cer-ticket.mjs';

const STORY_SOURCE = { id: '97796350', version: 12 };
const BUG_SOURCE = { id: '97796337', version: 18 };
const ROLE_SOURCE = { id: '93492170', version: 8 };

function confluencePage(id, overrides = {}) {
  const titles = {
    97796350: 'Vorlage fÃ¼r Story-Tickets',
    97796337: 'Vorlage fÃ¼r Bug-Tickets',
    93492170: 'Nutzerrollen',
    258746351: 'Fachseite',
  };
  const versions = {
    97796350: 12,
    97796337: 18,
    93492170: 8,
    258746351: 3,
  };
  return {
    id: String(id),
    title: titles[id],
    spaceKey: 'CER',
    status: 'current',
    version: versions[id],
    ancestors: [{ id: '21074848', title: 'Ceroma Home' }],
    ...overrides,
  };
}

function memoryReceipts() {
  const values = new Map();
  return {
    async save(receipt) { values.set(receipt.preflightId, structuredClone(receipt)); },
    async load(id) {
      if (!values.has(id)) throw new Error('missing');
      return structuredClone(values.get(id));
    },
    async consume(id) { values.delete(id); },
    has(id) { return values.has(id); },
  };
}

test('validiert verbindliche Live-Quellen und Ceroma-Unterseiten', async () => {
  const sources = [STORY_SOURCE, ROLE_SOURCE, { id: '258746351', version: 3 }];
  const result = await validateSources(
    'Story',
    sources,
    async id => confluencePage(Number(id)),
  );
  assert.equal(result.length, 3);

  await assert.rejects(
    validateSources('Story', [STORY_SOURCE, ROLE_SOURCE], async id => (
      id === ROLE_SOURCE.id
        ? confluencePage(Number(id), { ancestors: [] })
        : confluencePage(Number(id))
    )),
    /nicht unter Ceroma Home/,
  );
  await assert.rejects(
    validateSources('Story', [STORY_SOURCE, ROLE_SOURCE], async id => (
      id === STORY_SOURCE.id
        ? confluencePage(Number(id), { version: 13 })
        : confluencePage(Number(id))
    )),
    /Confluence-Drift/,
  );
});

test('blockiert falschen Seitentitel, Space und fehlende Pflichtquelle', async () => {
  await assert.rejects(
    validateSources('Bug', [BUG_SOURCE, ROLE_SOURCE], async id => (
      id === BUG_SOURCE.id
        ? confluencePage(Number(id), { title: 'Andere Seite' })
        : confluencePage(Number(id))
    )),
    /erwarteten Titel/,
  );
  await assert.rejects(
    validateSources('Bug', [BUG_SOURCE], async id => confluencePage(Number(id))),
    /93492170 fehlt/,
  );
  await assert.rejects(
    validateSources('Bug', [BUG_SOURCE, ROLE_SOURCE], async id => (
      confluencePage(Number(id), { spaceKey: 'OTHER' })
    )),
    /aktuelle CER-Seite/,
  );
});

test('beschrÃ¤nkt Schreibziele auf CER Story und Bug', () => {
  assert.equal(assertCerIssue({ project: { key: 'CER' }, issueType: { name: 'Story' } }), 'Story');
  assert.throws(
    () => assertCerIssue({ project: { key: 'OTHER' }, issueType: { name: 'Story' } }),
    /nur das Projekt CER/,
  );
  assert.throws(
    () => assertCerIssue({ project: { key: 'CER' }, issueType: { name: 'Task' } }),
    /Story oder Bug/,
  );
});

test('allgemeine Service-Schicht erstellt CER-Feldpayload mit modernen Metadaten', async () => {
  let postBody;
  const client = {
    async get(path) {
      if (path.startsWith('/issue/createmeta?')) throw new Error('HTTP 404');
      if (path === '/project/CER') {
        return { id: '100', key: 'CER', issueTypes: [{ id: '10004', name: 'Bug' }] };
      }
      if (path.startsWith('/issue/createmeta/100/issuetypes/10004')) {
        return {
          total: 5,
          values: [
            { fieldId: 'summary', name: 'Summary', required: true },
            { fieldId: 'description', name: 'Description' },
            { fieldId: 'reporter', name: 'Reporter', required: true },
            {
              fieldId: 'customfield_12003',
              name: 'Severity',
              required: true,
              allowedValues: [{ id: '11905', value: 'SV-1' }],
            },
            {
              fieldId: 'components',
              name: 'Component/s',
              allowedValues: [{ id: '12111', name: 'CeromaCore' }],
            },
          ],
        };
      }
      if (path === '/myself') return { name: 'current-user' };
      if (path.startsWith('/issue/CER-900?')) {
        return {
          key: 'CER-900',
          fields: {
            project: { key: 'CER' },
            issuetype: { id: '10004', name: 'Bug' },
            reporter: { name: 'current-user' },
            summary: '[ST] Fehler',
            description: 'Beschreibung',
            customfield_12003: { id: '11905', value: 'SV-1' },
            components: [{ id: '12111', name: 'CeromaCore' }],
          },
        };
      }
      throw new Error(`Unerwarteter GET ${path}`);
    },
    async post(path, body) {
      postBody = { path, body };
      return { key: 'CER-900' };
    },
    async put() {},
  };
  const service = createJiraTicketService(client);
  const reporter = await service.getCurrentUser();
  const input = {
    projectKey: 'CER',
    issueTypeName: 'Bug',
    reporter,
    fields: {
      summary: '[ST] Fehler',
      description: 'Beschreibung',
      customfield_12003: { id: '11905' },
      components: [{ id: '12111' }],
    },
  };
  const preflight = await service.prepareCreateWithFields(input);
  assert.equal(preflight.issueType.id, '10004');
  const applied = await service.applyCreateWithFields(input, {
    issueTypeId: '10004',
    reporterName: 'current-user',
  });
  assert.equal(postBody.path, '/issue');
  assert.equal(postBody.body.fields.project.key, 'CER');
  assert.equal(applied.verified, true);

  await assert.rejects(
    service.prepareCreateWithFields({
      ...input,
      fields: { ...input.fields, customfield_12003: { id: 'unbekannt' } },
    }),
    /nicht erlaubt/,
  );
});

test('Workflow bereitet Create ohne Mutation mit Live-Quellen vor', async () => {
  let createCalls = 0;
  const workflow = createCerTicketWorkflow({
    jiraService: {
      getCreateMetadata: async () => ({}),
      getEditMetadata: async () => ({}),
      getCurrentUser: async () => ({ name: 'user' }),
      prepareCreateWithFields: async input => {
        createCalls += 1;
        return {
          applied: false,
          issueType: { id: '10001', name: input.issueTypeName },
          reporter: input.reporter,
        };
      },
    },
    getConfluencePage: async id => confluencePage(Number(id)),
    jiraGet: async () => ({}),
    jiraPostMultipart: async () => {},
    readBinary: async () => Buffer.alloc(0),
  });
  const result = await workflow.prepareCreate('Story', {
    fields: { summary: 'Story', description: 'Text' },
    sources: [STORY_SOURCE, ROLE_SOURCE],
  });
  assert.equal(createCalls, 1);
  assert.equal(result.applied, false);
  assert.equal(result.sources[0].version, 12);
});

test('CLI bindet Create-Preflight an Payload und verbraucht ihn beim Apply', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const receipts = memoryReceipts();
  let prepareCount = 0;
  let applyCount = 0;
  const workflow = {
    prepareCreate: async () => {
      prepareCount += 1;
      return {
        jira: { issueType: { id: '10001' }, reporter: { name: 'user' } },
        applied: false,
      };
    },
    applyCreate: async () => {
      applyCount += 1;
      return { applied: true };
    },
  };
  const request = JSON.stringify({
    fields: { summary: 'Story', description: 'Text' },
    sources: [STORY_SOURCE, ROLE_SOURCE],
  });
  const common = {
    workflow,
    receiptStore: receipts,
    readText: async () => request,
    now: () => Date.parse('2026-08-14T10:00:00Z'),
    randomUUID: () => id,
  };
  const preflight = await runCli(
    ['create', '--issue-type', 'Story', '--request-file', 'request.json'],
    common,
  );
  assert.equal(preflight.preflightId, id);
  assert.equal(prepareCount, 1);
  assert.equal(applyCount, 0);
  assert.equal(receipts.has(id), true);

  const applied = await runCli([
    'create', '--issue-type', 'Story', '--request-file', 'request.json',
    '--apply', '--preflight-id', id,
  ], common);
  assert.equal(applied.applied, true);
  assert.equal(applyCount, 1);
  assert.equal(receipts.has(id), false);
});

test('Preflight blockiert geÃ¤nderte Eingabe und Ablauf', () => {
  const receipt = {
    preflightId: '11111111-1111-4111-8111-111111111111',
    operation: 'edit',
    digest: 'abc',
    createdAt: '2026-08-14T10:00:00Z',
  };
  assert.throws(
    () => assertReceipt(receipt, {
      preflightId: receipt.preflightId,
      operation: 'edit',
      digest: 'def',
      now: Date.parse('2026-08-14T10:01:00Z'),
    }),
    /passt nicht/,
  );
  assert.throws(
    () => assertReceipt(receipt, {
      preflightId: receipt.preflightId,
      operation: 'edit',
      digest: 'abc',
      now: Date.parse('2026-08-14T10:16:00Z'),
    }),
    /abgelaufen/,
  );
});

test('CLI verlangt --apply und --preflight-id immer gemeinsam', async () => {
  await assert.rejects(
    runCli([
      'create', '--issue-type', 'Story', '--request-file', 'request.json', '--apply',
    ], {
      workflow: {},
      readText: async () => '{}',
    }),
    /gemeinsam/,
  );
});

test('erkennt Bildsignaturen und lÃ¤dt mehrere Bilder in genau einem POST hoch', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(detectImageType(png), 'image/png');
  assert.throws(() => detectImageType(Buffer.from('<svg/>')), /Nur PNG/);

  let uploaded = false;
  let postCount = 0;
  const jiraService = {
    getCreateMetadata: async () => ({}),
    getEditMetadata: async key => ({
      key,
      summary: 'Bug',
      project: { key: 'CER' },
      issueType: { name: 'Bug' },
    }),
    getIssue: async (key, fields) => {
      if (fields.includes('project')) {
        return {
          key,
          fields: {
            summary: 'Bug',
            project: { key: 'CER' },
            issuetype: { name: 'Bug' },
            updated: 'stand-1',
            attachment: [],
          },
        };
      }
      return {
        key,
        fields: {
          attachment: uploaded
            ? [{ id: '900', filename: 'shot.png', size: png.length, mimeType: 'image/png' }]
            : [],
        },
      };
    },
  };
  const workflow = createCerTicketWorkflow({
    jiraService,
    getConfluencePage: async () => ({}),
    jiraGet: async path => {
      assert.equal(path, '/attachment/meta');
      return { enabled: true, uploadLimit: 1024 };
    },
    jiraPostMultipart: async (path, body, boundary) => {
      postCount += 1;
      assert.match(path, /CER-123\/attachments/);
      assert.equal(Buffer.isBuffer(body), true);
      assert.match(boundary, /^CodexBoundary-/);
      uploaded = true;
      return [{ id: '900' }];
    },
    readBinary: async () => png,
  });
  const manifest = { files: ['shot.png'] };
  const preflight = await workflow.prepareAttachImages('CER-123', manifest);
  assert.equal(preflight.images[0].sha256.length, 64);
  const applied = await workflow.applyAttachImages('CER-123', manifest, {
    expectedUpdated: preflight.expectedUpdated,
    fileDigest: preflight.fileDigest,
    existingAttachmentIds: preflight.existingAttachmentIds,
  });
  assert.equal(postCount, 1);
  assert.equal(applied.verified, true);
});

test('Request-Vertrag lehnt unbekannte Felder ab', () => {
  assert.throws(
    () => normalizeTicketRequest({ fields: {}, sources: [], template: 'statisch' }),
    /Unbekannte Request-Felder/,
  );
});
