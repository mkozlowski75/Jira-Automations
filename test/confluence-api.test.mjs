import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createConfluencePageService,
  normalizeApiBase,
  normalizeStorageForComparison,
  parseMaxResults,
  runCli,
  safeErrorMessage,
} from '../.github/skills/confluence-pages/scripts/confluence-page.mjs';

function page(overrides = {}) {
  return {
    id: '21074848',
    type: 'page',
    status: 'current',
    title: 'Ceroma Home',
    space: { key: 'CER' },
    version: { number: 29 },
    ancestors: [],
    body: { storage: { value: '<p>Alt</p>' } },
    _links: { webui: '/spaces/CER/pages/21074848' },
    ...overrides,
  };
}

test('normalisiert Data-Center-API und blockiert Cloud-API 2', () => {
  assert.equal(
    normalizeApiBase('https://confluence.example.invalid', '/confluence/rest/api'),
    'https://confluence.example.invalid/confluence/rest/api',
  );
  assert.throws(
    () => normalizeApiBase(
      'https://confluence.example.invalid',
      '/confluence/rest/api/2',
    ),
    /Data-Center-API/,
  );
});

test('begrenzt Listengrößen auf 1 bis 100', () => {
  assert.equal(parseMaxResults(undefined), 20);
  assert.equal(parseMaxResults('100'), 100);
  assert.throws(() => parseMaxResults('101'), /zwischen 1 und 100/);
});

test('liest Seiten normalisiert und Inhalt nur auf Wunsch', async () => {
  const service = createConfluencePageService({
    configuration: {},
    request: async () => page(),
  });
  const metadata = await service.getPage('21074848', false);
  const withBody = await service.getPage('21074848', true);

  assert.equal(metadata.title, 'Ceroma Home');
  assert.equal(metadata.bodyStorage, undefined);
  assert.equal(withBody.bodyStorage, '<p>Alt</p>');
});

test('normalisiert nur Confluence-äquivalentes Storage-Markup für Vergleiche', () => {
  assert.equal(normalizeStorageForComparison('<p></p>\r\n'), '<p/>');
  assert.equal(normalizeStorageForComparison('<p />'), '<p/>');
  assert.equal(normalizeStorageForComparison('<p> </p>'), '<p> </p>');
  assert.notEqual(
    normalizeStorageForComparison('<p>Inhalt A</p>'),
    normalizeStorageForComparison('<p>Inhalt B</p>'),
  );
});

test('Create-Preflight ist read-only und erkennt freie Titel', async () => {
  const methods = [];
  const service = createConfluencePageService({
    configuration: {},
    request: async (configuration, method, path) => {
      methods.push(method);
      if (path.startsWith('/space/')) return { key: 'CER' };
      if (path === '/content') return { results: [] };
      return page();
    },
  });

  const result = await service.prepareCreate({
    spaceKey: 'CER',
    title: 'Neue Seite',
    parentId: '21074848',
    bodyStorage: '<p>Neu</p>',
  });

  assert.equal(result.expectedAbsent, true);
  assert.deepEqual(new Set(methods), new Set(['GET']));
});

test('Create-Preflight blockiert vorhandenen Titel', async () => {
  const service = createConfluencePageService({
    configuration: {},
    request: async (configuration, method, path) => {
      if (path.startsWith('/space/')) return { key: 'CER' };
      if (path === '/content') return { results: [page()] };
      throw new Error('Unerwarteter Aufruf.');
    },
  });

  await assert.rejects(
    service.prepareCreate({
      spaceKey: 'CER',
      title: 'Ceroma Home',
      bodyStorage: '<p>Neu</p>',
    }),
    /existiert bereits/,
  );
});

test('Create akzeptiert Confluence-Normalisierung leerer Tags und Schlusszeilen', async () => {
  let reads = 0;
  const service = createConfluencePageService({
    configuration: {},
    request: async (configuration, method, path) => {
      if (path.startsWith('/space/')) return { key: 'CER' };
      if (path === '/content' && method === 'GET') return { results: [] };
      if (method === 'POST') return { id: '21074849' };
      reads += 1;
      return reads === 1
        ? page()
        : page({
          id: '21074849',
          title: 'Neue Seite',
          ancestors: [{ id: '21074848', title: 'Ceroma Home' }],
          body: { storage: { value: '<p />' } },
        });
    },
  });

  const result = await service.applyCreate({
    spaceKey: 'CER',
    title: 'Neue Seite',
    parentId: '21074848',
    bodyStorage: '<p></p>\n',
  }, 'true');

  assert.equal(result.verified, true);
  assert.equal(result.pageId, '21074849');
});

test('Create blockiert weiterhin inhaltlich abweichenden Serverstand', async () => {
  let reads = 0;
  const service = createConfluencePageService({
    configuration: {},
    request: async (configuration, method, path) => {
      if (path.startsWith('/space/')) return { key: 'CER' };
      if (path === '/content' && method === 'GET') return { results: [] };
      if (method === 'POST') return { id: '21074849' };
      reads += 1;
      return reads === 1
        ? page()
        : page({
          id: '21074849',
          title: 'Neue Seite',
          body: { storage: { value: '<p>Anderer Inhalt</p>' } },
        });
    },
  });

  await assert.rejects(
    service.applyCreate({
      spaceKey: 'CER',
      title: 'Neue Seite',
      bodyStorage: '<p>Erwarteter Inhalt</p>\n',
    }, 'true'),
    /Remote-Verifikation/,
  );
});

test('Update-Preflight schreibt nicht und liefert erwartete Version', async () => {
  const methods = [];
  const service = createConfluencePageService({
    configuration: {},
    request: async (configuration, method) => {
      methods.push(method);
      return page();
    },
  });

  const result = await service.prepareUpdate('21074848', {
    title: 'Ceroma Start',
  });

  assert.equal(result.expectedVersion, 29);
  assert.equal(result.newVersion, 30);
  assert.deepEqual(methods, ['GET']);
});

test('Update blockiert Versionsdrift vor dem PUT', async () => {
  const methods = [];
  const service = createConfluencePageService({
    configuration: {},
    request: async (configuration, method) => {
      methods.push(method);
      return page();
    },
  });

  await assert.rejects(
    service.applyUpdate('21074848', { title: 'Neu' }, '28'),
    /Versionsdrift/,
  );
  assert.deepEqual(methods, ['GET']);
});

test('Update führt einen PUT aus und verifiziert den Serverstand', async () => {
  const requests = [];
  let reads = 0;
  const service = createConfluencePageService({
    configuration: {},
    request: async (configuration, method, path, options) => {
      requests.push({ method, path, options });
      if (method === 'PUT') return page({ version: { number: 30 } });
      reads += 1;
      return reads === 1
        ? page()
        : page({
          title: 'Ceroma Start',
          version: { number: 30 },
          body: { storage: { value: '<p>Neu</p>' } },
        });
    },
  });

  const result = await service.applyUpdate(
    '21074848',
    { title: 'Ceroma Start', bodyStorage: '<p>Neu</p>\n' },
    '29',
  );

  assert.equal(requests.filter(request => request.method === 'PUT').length, 1);
  assert.equal(result.verified, true);
  assert.equal(result.version, 30);
});

test('CLI führt ohne --apply nur den Update-Preflight aus', async () => {
  let prepareCount = 0;
  let applyCount = 0;
  const result = await runCli(
    ['update', '21074848', '--title', 'Ceroma Start'],
    {
      configuration: {},
      service: {
        prepareUpdate: async () => {
          prepareCount += 1;
          return { applied: false };
        },
        applyUpdate: async () => {
          applyCount += 1;
          return { applied: true };
        },
      },
    },
  );

  assert.equal(result.applied, false);
  assert.equal(prepareCount, 1);
  assert.equal(applyCount, 0);
});

test('Hilfe lädt keine Credentials', async () => {
  const result = await runCli(['--help'], {
    loadConfiguration: () => {
      throw new Error('Konfiguration darf für Hilfe nicht geladen werden.');
    },
  });
  assert.match(result.usage, /confluence-page\.mjs get/);
});

test('Fehlermeldungen redigieren URLs und Bearer-Werte', () => {
  const message = safeErrorMessage(
    new Error('GET https://confluence.example.invalid/rest Bearer secret fehlgeschlagen'),
  );
  assert.doesNotMatch(message, /confluence\.example/);
  assert.doesNotMatch(message, /secret/);
});
