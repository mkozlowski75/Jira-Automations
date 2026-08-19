#!/usr/bin/env node
/**
 * Deterministische CLI für den Confluence-Seiten-Skill.
 * Ohne --apply führen alle Änderungsbefehle ausschließlich einen Preflight aus.
 */
import dotenv from 'dotenv';
import {
  existsSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import https from 'node:https';
import {
  dirname,
  isAbsolute,
  join,
  resolve,
} from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDir, '..', '..', '..', '..');

function usage() {
  return [
    'Usage:',
    '  confluence-page.mjs get <page-id> [--include-body]',
    '  confluence-page.mjs search --cql <CQL> [--max-results 20]',
    '  confluence-page.mjs children <page-id> [--max-results 20]',
    '  confluence-page.mjs create --space-key <key> --title <title> --body-file <path> [--parent-id <id>] [--labels label-a,label-b] [--apply --expected-absent true]',
    '  confluence-page.mjs update <page-id> [--title <title>] [--body-file <path>] [--apply --expected-version <number>]',
  ].join('\n');
}

function parseArgs(args) {
  const positional = [];
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith('--')) {
      positional.push(argument);
      continue;
    }
    const name = argument.slice(2);
    if (['apply', 'help', 'include-body'].includes(name)) {
      options[name] = true;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Option --${name} benötigt einen Wert.`);
    }
    options[name] = value;
    index += 1;
  }
  return { positional, options };
}

function requirePositiveInteger(value, label) {
  if (!/^[1-9]\d*$/.test(String(value || ''))) {
    throw new Error(`${label} muss eine positive Ganzzahl sein.`);
  }
  return String(value);
}

function parseMaxResults(value) {
  if (value === undefined) return 20;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error('--max-results muss eine ganze Zahl zwischen 1 und 100 sein.');
  }
  return parsed;
}

function parseLabels(value) {
  if (value === undefined) return [];
  const labels = String(value).split(',').map(label => label.trim());
  if (labels.length === 0 || labels.some(label => !/^[a-z0-9][a-z0-9-]*$/.test(label))) {
    throw new Error('--labels muss kommagetrennte globale Labels in Kleinbuchstaben enthalten.');
  }
  if (new Set(labels).size !== labels.length) {
    throw new Error('--labels darf kein Label mehrfach enthalten.');
  }
  return labels;
}

function normalizeLabels(value) {
  if (Array.isArray(value)) return value.length === 0 ? [] : parseLabels(value.join(','));
  return parseLabels(value);
}

function resolveConfiguredPath(value) {
  if (!value) return undefined;
  return isAbsolute(value) ? value : resolve(repositoryRoot, value);
}

function normalizeApiBase(baseValue, pathValue) {
  let parsed;
  try {
    parsed = new URL(baseValue);
  } catch {
    throw new Error('CONFLUENCE_BASE_URL ist keine gültige URL.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('CONFLUENCE_BASE_URL muss HTTPS verwenden.');
  }
  parsed.search = '';
  parsed.hash = '';
  const configuredPath = `/${String(pathValue || '').replace(/^\/+|\/+$/g, '')}`;
  if (!configuredPath.endsWith('/rest/api') || configuredPath.endsWith('/rest/api/2')) {
    throw new Error('CONFLUENCE_API_PATH muss auf die Data-Center-API /rest/api zeigen.');
  }
  parsed.pathname = configuredPath;
  return parsed.toString().replace(/\/$/, '');
}

function loadConfiguration() {
  dotenv.config({ path: join(repositoryRoot, 'config', '.env') });
  const baseUrl = process.env.CONFLUENCE_BASE_URL;
  const apiPath = process.env.CONFLUENCE_API_PATH;
  const token = process.env.CONFLUENCE_PERSONAL_ACCESS_TOKEN;
  if (!baseUrl || !apiPath || !token) {
    throw new Error('Confluence-Verbindung ist nicht vollständig konfiguriert.');
  }

  const certificatePath = resolveConfiguredPath(process.env.CLIENT_CERT_PATH);
  if (!certificatePath || !existsSync(certificatePath)) {
    throw new Error('Konfiguriertes Client-Zertifikat fehlt.');
  }
  const caPath = resolveConfiguredPath(process.env.SERVER_CA_PATH);
  if (caPath && !existsSync(caPath)) {
    throw new Error('Konfigurierte Server-CA fehlt.');
  }

  let pfx;
  let ca;
  try {
    pfx = readFileSync(certificatePath);
    ca = caPath ? readFileSync(caPath) : undefined;
  } catch {
    throw new Error('TLS-Zertifikatsdatei konnte nicht gelesen werden.');
  }

  return {
    baseUrl: normalizeApiBase(baseUrl, apiPath),
    token,
    agent: new https.Agent({
      pfx,
      passphrase: process.env.CLIENT_CERT_PASSPHRASE || '',
      ca,
      rejectUnauthorized: true,
    }),
  };
}

function requestJson(configuration, method, path, { query = {}, body } = {}, redirectCount = 0) {
  return new Promise((resolvePromise, reject) => {
    const apiBase = new URL(configuration.baseUrl);
    const url = /^https:\/\//i.test(path)
      ? new URL(path)
      : new URL(`${configuration.baseUrl}${path}`);
    if (url.origin !== apiBase.origin || !url.pathname.startsWith(`${apiBase.pathname}/`)) {
      reject(new Error('API-Aufruf außerhalb des konfigurierten Confluence-Endpunkts blockiert.'));
      return;
    }
    for (const [name, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') url.searchParams.set(name, String(value));
    }

    const payload = body === undefined ? undefined : JSON.stringify(body);
    const request = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${configuration.token}`,
        'User-Agent': 'bdr-jira-automations-confluence-pages',
        ...(payload === undefined
          ? {}
          : {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          }),
      },
      agent: configuration.agent,
      rejectUnauthorized: true,
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if ([301, 302, 303, 307, 308].includes(response.statusCode)
          && response.headers.location) {
          if (method !== 'GET' || redirectCount >= 5) {
            reject(new Error('Redirect für diesen Confluence-Aufruf blockiert.'));
            return;
          }
          let redirected;
          try {
            redirected = new URL(response.headers.location, url);
          } catch {
            reject(new Error('Ungültiger Redirect vom Confluence-Server.'));
            return;
          }
          if (redirected.origin !== url.origin
            || redirected.pathname.includes('/login.action')
            || redirected.search.includes('permissionViolation')) {
            reject(new Error('Unsicherer oder nicht authentifizierter Redirect blockiert.'));
            return;
          }
          resolvePromise(requestJson(
            configuration,
            method,
            redirected.toString(),
            {},
            redirectCount + 1,
          ));
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Confluence-API antwortet mit HTTP ${response.statusCode}.`));
          return;
        }
        if (!text) {
          resolvePromise(null);
          return;
        }
        try {
          resolvePromise(JSON.parse(text));
        } catch {
          reject(new Error('Confluence-API lieferte kein gültiges JSON.'));
        }
      });
    });
    request.on('error', reject);
    request.setTimeout(30000, () => request.destroy(new Error('Timeout nach 30 Sekunden.')));
    if (payload !== undefined) request.write(payload);
    request.end();
  });
}

function pageView(page, { includeBody = false } = {}) {
  const ancestors = (page.ancestors || []).map(ancestor => ({
    id: String(ancestor.id),
    title: ancestor.title,
  }));
  const result = {
    id: String(page.id),
    type: page.type,
    status: page.status,
    title: page.title,
    spaceKey: page.space?.key,
    version: page.version?.number,
    parentId: ancestors.at(-1)?.id,
    ancestors,
    webUrl: page._links?.webui,
  };
  if (includeBody) result.bodyStorage = page.body?.storage?.value ?? '';
  return result;
}

function pageSummary(page) {
  return {
    id: String(page.id),
    title: page.title,
    status: page.status,
    spaceKey: page.space?.key,
    version: page.version?.number,
    webUrl: page._links?.webui,
  };
}

function normalizeStorageForComparison(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .replace(/<([A-Za-z][\w:.-]*)([^<>]*)><\/\1>/g, '<$1$2/>')
    .replace(/\s*\/>/g, '/>');
}

function storageValuesEqual(left, right) {
  return normalizeStorageForComparison(left) === normalizeStorageForComparison(right);
}

function createConfluencePageService({ request, configuration }) {
  const getPageRaw = pageId => request(
    configuration,
    'GET',
    `/content/${requirePositiveInteger(pageId, 'Seiten-ID')}`,
    { query: { expand: 'space,version,ancestors,body.storage' } },
  );

  const findTitle = (spaceKey, title) => request(
    configuration,
    'GET',
    '/content',
    {
      query: {
        spaceKey,
        title,
        type: 'page',
        status: 'current',
        limit: 10,
      },
    },
  );

  async function getPage(pageId, includeBody = false) {
    return pageView(await getPageRaw(pageId), { includeBody });
  }

  async function searchPages(cql, maxResults) {
    if (!String(cql || '').trim()) throw new Error('--cql darf nicht leer sein.');
    const response = await request(configuration, 'GET', '/content/search', {
      query: {
        cql,
        limit: maxResults,
        expand: 'space,version',
      },
    });
    return {
      returned: response.results?.length ?? 0,
      size: response.size,
      pages: (response.results || []).map(pageSummary),
    };
  }

  async function getChildren(pageId, maxResults) {
    const id = requirePositiveInteger(pageId, 'Seiten-ID');
    const response = await request(configuration, 'GET', `/content/${id}/child/page`, {
      query: {
        limit: maxResults,
        expand: 'space,version',
      },
    });
    return {
      parentId: id,
      returned: response.results?.length ?? 0,
      pages: (response.results || []).map(pageSummary),
    };
  }

  async function getLabels(pageId) {
    const id = requirePositiveInteger(pageId, 'Seiten-ID');
    const response = await request(configuration, 'GET', `/content/${id}/label`, {
      query: { limit: 200 },
    });
    return (response.results || [])
      .filter(label => label?.prefix === 'global' && typeof label?.name === 'string')
      .map(label => label.name);
  }

  async function addLabels(pageId, labels) {
    const id = requirePositiveInteger(pageId, 'Seiten-ID');
    for (const label of labels) {
      await request(configuration, 'POST', `/content/${id}/label`, {
        body: { prefix: 'global', name: label },
      });
    }
  }

  async function prepareCreate({ spaceKey, title, parentId, bodyStorage, labels = [] }) {
    if (!String(spaceKey || '').trim()) throw new Error('--space-key darf nicht leer sein.');
    if (!String(title || '').trim()) throw new Error('--title darf nicht leer sein.');
    if (!String(bodyStorage || '').trim()) throw new Error('Seitendatei darf nicht leer sein.');
    const normalizedLabels = normalizeLabels(labels);
    await request(configuration, 'GET', `/space/${encodeURIComponent(spaceKey)}`);

    let parent;
    if (parentId !== undefined) {
      parent = await getPageRaw(parentId);
      if (parent.space?.key !== spaceKey) {
        throw new Error('Elternseite liegt nicht im angegebenen Space.');
      }
    }

    const matches = await findTitle(spaceKey, title);
    if ((matches.results || []).length > 0) {
      throw new Error('Im angegebenen Space existiert bereits eine aktuelle Seite mit diesem Titel.');
    }
    return {
      applied: false,
      operation: 'create',
      spaceKey,
      title,
      parentId: parent ? String(parent.id) : undefined,
      parentTitle: parent?.title,
      bodyLength: bodyStorage.length,
      labels: normalizedLabels,
      expectedAbsent: true,
    };
  }

  async function applyCreate(input, expectedAbsent) {
    if (String(expectedAbsent) !== 'true') {
      throw new Error('--expected-absent true aus dem Preflight fehlt.');
    }
    const labels = normalizeLabels(input.labels);
    const preflight = await prepareCreate({ ...input, labels });
    const payload = {
      type: 'page',
      title: input.title,
      space: { key: input.spaceKey },
      body: {
        storage: {
          value: input.bodyStorage,
          representation: 'storage',
        },
      },
      ...(input.parentId
        ? { ancestors: [{ id: requirePositiveInteger(input.parentId, 'Elternseiten-ID') }] }
        : {}),
    };
    const created = await request(configuration, 'POST', '/content', { body: payload });
    const remote = await getPageRaw(created.id);
    const normalized = pageView(remote, { includeBody: true });
    let labelsVerified = labels.length === 0;
    if (labels.length > 0) {
      try {
        await addLabels(created.id, labels);
        const remoteLabels = await getLabels(created.id);
        labelsVerified = labels.every(label => remoteLabels.includes(label));
        if (!labelsVerified) {
          throw new Error('Angeforderte Labels fehlen nach dem Read-back.');
        }
      } catch {
        throw new Error(`Seite ${created.id} wurde erstellt, aber Labels konnten nicht gesetzt oder verifiziert werden.`);
      }
    }
    const verified = normalized.title === input.title
      && normalized.spaceKey === input.spaceKey
      && normalized.parentId === (input.parentId ? String(input.parentId) : undefined)
      && storageValuesEqual(normalized.bodyStorage, input.bodyStorage)
      && labelsVerified;
    if (!verified) throw new Error('Remote-Verifikation der erstellten Seite fehlgeschlagen.');
    return {
      ...preflight,
      applied: true,
      pageId: normalized.id,
      version: normalized.version,
      verified: true,
    };
  }

  async function prepareUpdate(pageId, { title, bodyStorage }) {
    if (title === undefined && bodyStorage === undefined) {
      throw new Error('Update benötigt --title oder --body-file.');
    }
    if (title !== undefined && !String(title).trim()) throw new Error('--title darf nicht leer sein.');
    if (bodyStorage !== undefined && !String(bodyStorage).trim()) {
      throw new Error('Seitendatei darf nicht leer sein.');
    }
    const current = pageView(await getPageRaw(pageId), { includeBody: true });
    return {
      applied: false,
      operation: 'update',
      pageId: current.id,
      spaceKey: current.spaceKey,
      parentId: current.parentId,
      currentTitle: current.title,
      newTitle: title ?? current.title,
      currentBodyLength: current.bodyStorage.length,
      newBodyLength: (bodyStorage ?? current.bodyStorage).length,
      expectedVersion: current.version,
      newVersion: current.version + 1,
    };
  }

  async function applyUpdate(pageId, input, expectedVersion) {
    const expected = Number(expectedVersion);
    if (!Number.isInteger(expected) || expected < 1) {
      throw new Error('--expected-version aus dem Preflight fehlt.');
    }
    const current = pageView(await getPageRaw(pageId), { includeBody: true });
    if (current.version !== expected) {
      throw new Error(`Versionsdrift: erwartet ${expected}, aktuell ${current.version}.`);
    }
    const title = input.title ?? current.title;
    const bodyStorage = input.bodyStorage ?? current.bodyStorage;
    const payload = {
      id: current.id,
      type: 'page',
      title,
      version: { number: current.version + 1 },
      body: {
        storage: {
          value: bodyStorage,
          representation: 'storage',
        },
      },
    };
    await request(configuration, 'PUT', `/content/${current.id}`, { body: payload });
    const remote = pageView(await getPageRaw(current.id), { includeBody: true });
    const verified = remote.version === current.version + 1
      && remote.title === title
      && storageValuesEqual(remote.bodyStorage, bodyStorage);
    if (!verified) throw new Error('Remote-Verifikation der aktualisierten Seite fehlgeschlagen.');
    return {
      applied: true,
      operation: 'update',
      pageId: remote.id,
      spaceKey: remote.spaceKey,
      title: remote.title,
      version: remote.version,
      verified: true,
    };
  }

  return {
    applyCreate,
    applyUpdate,
    getChildren,
    getLabels,
    getPage,
    prepareCreate,
    prepareUpdate,
    searchPages,
  };
}

async function readBodyFile(path, readText) {
  if (!path) return undefined;
  return readText(path, 'utf8');
}

async function runCli(args, dependencies = {}) {
  const { positional, options } = parseArgs(args);
  const [command, pageId] = positional;
  if (options.help || command === 'help') return { usage: usage() };
  if (!command) throw new Error(usage());

  const configuration = dependencies.configuration
    ?? (dependencies.loadConfiguration ?? loadConfiguration)();
  const service = dependencies.service ?? createConfluencePageService({
    configuration,
    request: dependencies.request ?? requestJson,
  });
  const readText = dependencies.readText ?? readFile;

  if (command === 'get') {
    if (!pageId) throw new Error(usage());
    return service.getPage(pageId, Boolean(options['include-body']));
  }
  if (command === 'search') {
    return service.searchPages(options.cql, parseMaxResults(options['max-results']));
  }
  if (command === 'children') {
    if (!pageId) throw new Error(usage());
    return service.getChildren(pageId, parseMaxResults(options['max-results']));
  }
  if (command === 'create') {
    const input = {
      spaceKey: options['space-key'],
      title: options.title,
      parentId: options['parent-id'],
      bodyStorage: await readBodyFile(options['body-file'], readText),
      labels: parseLabels(options.labels),
    };
    if (!options['body-file']) throw new Error(usage());
    return options.apply
      ? service.applyCreate(input, options['expected-absent'])
      : service.prepareCreate(input);
  }
  if (command === 'update') {
    if (!pageId || (!options.title && !options['body-file'])) throw new Error(usage());
    const input = {
      title: options.title,
      bodyStorage: await readBodyFile(options['body-file'], readText),
    };
    return options.apply
      ? service.applyUpdate(pageId, input, options['expected-version'])
      : service.prepareUpdate(pageId, input);
  }
  throw new Error(`Unbekannter Befehl "${command}".\n${usage()}`);
}

function safeErrorMessage(error) {
  return String(error?.message || 'Unbekannter Fehler')
    .replace(/https?:\/\/[^\s]+/gi, '[URL]')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/Authorization\s*[:=]\s*\S+/gi, 'Authorization: [REDACTED]');
}

function isMainModule(metaUrl, argvPath) {
  if (!argvPath) return false;
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(argvPath);
  } catch {
    return false;
  }
}

async function main() {
  try {
    const result = await runCli(process.argv.slice(2));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`❌ ${safeErrorMessage(error)}`);
    process.exitCode = 1;
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  main();
}

export {
  createConfluencePageService,
  isMainModule,
  normalizeApiBase,
  pageView,
  parseArgs,
  parseLabels,
  parseMaxResults,
  runCli,
  safeErrorMessage,
  normalizeStorageForComparison,
};
