import assert from 'node:assert/strict';
import test from 'node:test';
import {
  encodeProject,
  normalizeApiBase,
  parseArgs,
  parseMaxResults,
  runCli,
  safeErrorMessage,
} from '../.github/skills/gitlab-access/scripts/gitlab-api.mjs';

test('normalisiert GitLab-Server-URLs auf API v4', () => {
  assert.equal(
    normalizeApiBase('https://gitlab.example.invalid/'),
    'https://gitlab.example.invalid/api/v4',
  );
  assert.equal(
    normalizeApiBase('https://gitlab.example.invalid/api/v4/'),
    'https://gitlab.example.invalid/api/v4',
  );
  assert.throws(
    () => normalizeApiBase('http://gitlab.example.invalid'),
    /HTTPS verwenden/,
  );
});

test('kodiert vollständige Projektpfade', () => {
  assert.equal(encodeProject('123'), '123');
  assert.equal(encodeProject('group/subgroup/project'), 'group%2Fsubgroup%2Fproject');
});

test('begrenzt Listengrößen auf 1 bis 100', () => {
  assert.equal(parseMaxResults(undefined), 20);
  assert.equal(parseMaxResults('100'), 100);
  assert.throws(() => parseMaxResults('101'), /zwischen 1 und 100/);
});

test('parst Optionen ohne Shell-Auswertung', () => {
  assert.deepEqual(
    parseArgs(['pipelines', '42', '--ref', 'develop', '--max-results', '5']),
    {
      positional: ['pipelines', '42'],
      options: { ref: 'develop', 'max-results': '5' },
    },
  );
});

test('zeigt Hilfe ohne Laden von Credentials', async () => {
  const result = await runCli(['--help'], {
    loadConfiguration: () => {
      throw new Error('Konfiguration darf für Hilfe nicht geladen werden.');
    },
  });
  assert.match(result.usage, /gitlab-api\.mjs user/);
});

test('normalisiert Projektlisten und verwendet die konfigurierte Gruppe', async () => {
  const requests = [];
  const result = await runCli(
    ['projects', '--search', 'demo', '--max-results', '2'],
    {
      configuration: {
        defaultGroup: 'example/group',
      },
      get: async (configuration, path, query) => {
        requests.push({ configuration, path, query });
        return [{
          id: 7,
          name: 'Demo',
          path_with_namespace: 'example/group/demo',
          visibility: 'private',
          archived: false,
          default_branch: 'main',
          web_url: 'https://gitlab.example.invalid/example/group/demo',
          namespace: { sensitive: 'not returned' },
        }];
      },
    },
  );

  assert.equal(requests[0].path, '/groups/example%2Fgroup/projects');
  assert.equal(requests[0].query.per_page, 2);
  assert.deepEqual(result, [{
    id: 7,
    name: 'Demo',
    pathWithNamespace: 'example/group/demo',
    visibility: 'private',
    archived: false,
    defaultBranch: 'main',
    webUrl: 'https://gitlab.example.invalid/example/group/demo',
  }]);
});

test('liest Projektmitglieder mit normalisierten Rollen', async () => {
  const requests = [];
  const result = await runCli(
    ['members', '327', '--max-results', '10'],
    {
      configuration: {},
      get: async (configuration, path, query) => {
        requests.push({ configuration, path, query });
        return [{
          id: 21,
          username: 'maintainer',
          name: 'Project Maintainer',
          access_level: 40,
          state: 'active',
          web_url: 'https://gitlab.example.invalid/maintainer',
          email: 'must-not-be-returned@example.invalid',
        }];
      },
    },
  );

  assert.equal(requests[0].path, '/projects/327/members/all');
  assert.equal(requests[0].query.per_page, 10);
  assert.deepEqual(result, [{
    id: 21,
    username: 'maintainer',
    name: 'Project Maintainer',
    accessLevel: 40,
    role: 'Maintainer',
    state: 'active',
    webUrl: 'https://gitlab.example.invalid/maintainer',
  }]);
});

test('liest Repository-Baum und explizite Textdateien normalisiert', async () => {
  const requests = [];
  const configuration = {};
  const get = async (receivedConfiguration, path, query) => {
    requests.push({ receivedConfiguration, path, query });
    if (path.endsWith('/repository/tree')) {
      return [{
        id: 'abc',
        name: 'README.md',
        path: 'docs/README.md',
        type: 'blob',
        mode: '100644',
      }];
    }
    return {
      file_path: 'docs/README.md',
      ref: 'main',
      encoding: 'base64',
      content: Buffer.from('# Dokumentation', 'utf8').toString('base64'),
    };
  };

  assert.deepEqual(
    await runCli(
      ['repository-tree', '327', '--path', 'docs', '--ref', 'main'],
      { configuration, get },
    ),
    [{ name: 'README.md', path: 'docs/README.md', type: 'blob' }],
  );
  assert.deepEqual(
    await runCli(
      ['repository-file', '327', 'docs/README.md', '--ref', 'main'],
      { configuration, get },
    ),
    {
      filePath: 'docs/README.md',
      ref: 'main',
      content: '# Dokumentation',
    },
  );
  assert.equal(requests[1].path, '/projects/327/repository/files/docs%2FREADME.md');
});

test('redigiert URL und Token aus Fehlermeldungen', () => {
  const message = safeErrorMessage(
    new Error('GET https://gitlab.example.invalid/api PRIVATE-TOKEN: glpat-secret'),
  );
  assert.doesNotMatch(message, /gitlab\.example/);
  assert.doesNotMatch(message, /glpat-secret/);
});
