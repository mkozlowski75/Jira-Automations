#!/usr/bin/env node
/**
 * Read-only CLI für GitLab Self-Managed mit Token und mTLS aus config/.env.
 */
import dotenv from 'dotenv';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import https from 'node:https';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDir, '..', '..', '..', '..');

function usage() {
  return [
    'Usage:',
    '  gitlab-api.mjs user',
    '  gitlab-api.mjs projects [--search text] [--max-results 20]',
    '  gitlab-api.mjs project <project-id-or-path>',
    '  gitlab-api.mjs branches <project> [--search text] [--max-results 20]',
    '  gitlab-api.mjs merge-requests <project> [--state opened] [--search text] [--max-results 20]',
    '  gitlab-api.mjs merge-request <project> <iid>',
    '  gitlab-api.mjs pipelines <project> [--ref value] [--status value] [--max-results 20]',
    '  gitlab-api.mjs jobs <project> <pipeline-id> [--max-results 20]',
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
    if (name === 'help') {
      options.help = true;
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

function parseMaxResults(value) {
  if (value === undefined) return 20;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error('--max-results muss eine ganze Zahl zwischen 1 und 100 sein.');
  }
  return parsed;
}

function requirePositiveInteger(value, label) {
  if (!/^[1-9]\d*$/.test(String(value || ''))) {
    throw new Error(`${label} muss eine positive Ganzzahl sein.`);
  }
  return String(value);
}

function encodeProject(value) {
  if (!value) throw new Error('Projekt-ID oder Projektpfad fehlt.');
  return /^\d+$/.test(value) ? value : encodeURIComponent(value);
}

function resolveConfiguredPath(value) {
  if (!value) return undefined;
  return isAbsolute(value) ? value : resolve(repositoryRoot, value);
}

function normalizeApiBase(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('GITLAB_BASE_URL ist keine gültige URL.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('GITLAB_BASE_URL muss HTTPS verwenden.');
  }
  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  if (!parsed.pathname.endsWith('/api/v4')) {
    parsed.pathname = `${parsed.pathname}/api/v4`.replace(/\/{2,}/g, '/');
  }
  return parsed.toString().replace(/\/$/, '');
}

function loadConfiguration() {
  dotenv.config({ path: join(repositoryRoot, 'config', '.env') });
  const baseUrl = process.env.GITLAB_BASE_URL;
  const token = process.env.GITLAB_API_TOKEN;
  if (!baseUrl || !token) {
    throw new Error('GitLab-Verbindung ist nicht vollständig konfiguriert.');
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
    baseUrl: normalizeApiBase(baseUrl),
    token,
    defaultGroup: process.env.GITLAB_DEFAULT_GROUP,
    agent: new https.Agent({
      pfx,
      passphrase: process.env.CLIENT_CERT_PASSPHRASE || '',
      ca,
      rejectUnauthorized: true,
    }),
  };
}

function requestJson(configuration, path, query = {}, redirectCount = 0) {
  return new Promise((resolvePromise, reject) => {
    const apiBase = new URL(configuration.baseUrl);
    const url = /^https:\/\//i.test(path)
      ? new URL(path)
      : new URL(`${configuration.baseUrl}${path}`);
    if (url.origin !== apiBase.origin || !url.pathname.startsWith(apiBase.pathname)) {
      reject(new Error('API-Aufruf außerhalb des konfigurierten GitLab-Endpunkts blockiert.'));
      return;
    }
    for (const [name, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') url.searchParams.set(name, String(value));
    }
    const request = https.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'PRIVATE-TOKEN': configuration.token,
        'User-Agent': 'bdr-jira-automations-gitlab-access',
      },
      agent: url.protocol === 'https:' ? configuration.agent : undefined,
      rejectUnauthorized: true,
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if ([301, 302, 303, 307, 308].includes(response.statusCode)
          && response.headers.location) {
          if (redirectCount >= 5) {
            reject(new Error('Zu viele Redirects.'));
            return;
          }
          let redirected;
          try {
            redirected = new URL(response.headers.location, url);
          } catch {
            reject(new Error('Ungültiger Redirect vom GitLab-Server.'));
            return;
          }
          if (redirected.origin !== url.origin || redirected.pathname.includes('/users/sign_in')) {
            reject(new Error('Unsicherer oder nicht authentifizierter Redirect blockiert.'));
            return;
          }
          resolvePromise(requestJson(
            configuration,
            redirected.toString(),
            {},
            redirectCount + 1,
          ));
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`GitLab-API antwortet mit HTTP ${response.statusCode}.`));
          return;
        }
        try {
          resolvePromise(JSON.parse(text));
        } catch {
          reject(new Error('GitLab-API lieferte kein gültiges JSON.'));
        }
      });
    });
    request.on('error', reject);
    request.setTimeout(30000, () => request.destroy(new Error('Timeout nach 30 Sekunden.')));
    request.end();
  });
}

const userView = user => ({
  id: user.id,
  username: user.username,
  name: user.name,
  state: user.state,
  webUrl: user.web_url,
});

const projectView = project => ({
  id: project.id,
  name: project.name,
  pathWithNamespace: project.path_with_namespace,
  visibility: project.visibility,
  archived: project.archived,
  defaultBranch: project.default_branch,
  webUrl: project.web_url,
});

const branchView = branch => ({
  name: branch.name,
  merged: branch.merged,
  protected: branch.protected,
  default: branch.default,
  webUrl: branch.web_url,
});

const mergeRequestView = mergeRequest => ({
  iid: mergeRequest.iid,
  title: mergeRequest.title,
  state: mergeRequest.state,
  draft: mergeRequest.draft ?? mergeRequest.work_in_progress,
  author: mergeRequest.author?.username,
  assignees: (mergeRequest.assignees || []).map(assignee => assignee.username),
  sourceBranch: mergeRequest.source_branch,
  targetBranch: mergeRequest.target_branch,
  mergeStatus: mergeRequest.detailed_merge_status ?? mergeRequest.merge_status,
  updatedAt: mergeRequest.updated_at,
  webUrl: mergeRequest.web_url,
});

const pipelineView = pipeline => ({
  id: pipeline.id,
  iid: pipeline.iid,
  ref: pipeline.ref,
  status: pipeline.status,
  source: pipeline.source,
  createdAt: pipeline.created_at,
  updatedAt: pipeline.updated_at,
  webUrl: pipeline.web_url,
});

const jobView = job => ({
  id: job.id,
  name: job.name,
  stage: job.stage,
  status: job.status,
  ref: job.ref,
  allowFailure: job.allow_failure,
  runnerDescription: job.runner?.description,
  createdAt: job.created_at,
  finishedAt: job.finished_at,
  webUrl: job.web_url,
});

export async function runCli(
  args,
  dependencies = {},
) {
  const { positional, options } = parseArgs(args);
  const [command, project, itemId] = positional;
  if (options.help || command === 'help') return { usage: usage() };
  if (!command) throw new Error(usage());
  const configuration = dependencies.configuration
    ?? (dependencies.loadConfiguration ?? loadConfiguration)();
  const get = dependencies.get ?? requestJson;

  if (command === 'user') {
    return userView(await get(configuration, '/user'));
  }

  if (command === 'projects') {
    const maxResults = parseMaxResults(options['max-results']);
    const path = configuration.defaultGroup
      ? `/groups/${encodeURIComponent(configuration.defaultGroup)}/projects`
      : '/projects';
    const query = {
      membership: configuration.defaultGroup ? undefined : true,
      search: options.search,
      simple: true,
      per_page: maxResults,
    };
    return (await get(configuration, path, query)).map(projectView);
  }

  if (command === 'project') {
    return projectView(await get(configuration, `/projects/${encodeProject(project)}`));
  }

  if (command === 'branches') {
    const maxResults = parseMaxResults(options['max-results']);
    const result = await get(
      configuration,
      `/projects/${encodeProject(project)}/repository/branches`,
      { search: options.search, per_page: maxResults },
    );
    return result.map(branchView);
  }

  if (command === 'merge-requests') {
    const maxResults = parseMaxResults(options['max-results']);
    const state = options.state || 'opened';
    if (!['opened', 'closed', 'merged', 'locked', 'all'].includes(state)) {
      throw new Error('--state besitzt keinen unterstützten Wert.');
    }
    const result = await get(
      configuration,
      `/projects/${encodeProject(project)}/merge_requests`,
      { state, search: options.search, per_page: maxResults },
    );
    return result.map(mergeRequestView);
  }

  if (command === 'merge-request') {
    const iid = requirePositiveInteger(itemId, 'Merge-Request-IID');
    return mergeRequestView(await get(
      configuration,
      `/projects/${encodeProject(project)}/merge_requests/${iid}`,
    ));
  }

  if (command === 'pipelines') {
    const maxResults = parseMaxResults(options['max-results']);
    const result = await get(
      configuration,
      `/projects/${encodeProject(project)}/pipelines`,
      { ref: options.ref, status: options.status, per_page: maxResults },
    );
    return result.map(pipelineView);
  }

  if (command === 'jobs') {
    const pipelineId = requirePositiveInteger(itemId, 'Pipeline-ID');
    const maxResults = parseMaxResults(options['max-results']);
    const result = await get(
      configuration,
      `/projects/${encodeProject(project)}/pipelines/${pipelineId}/jobs`,
      { per_page: maxResults },
    );
    return result.map(jobView);
  }

  throw new Error(`Unbekannter Befehl "${command}".\n${usage()}`);
}

function safeErrorMessage(error) {
  return String(error?.message || 'Unbekannter Fehler')
    .replace(/https?:\/\/[^\s]+/gi, '[URL]')
    .replace(/(PRIVATE-TOKEN|Authorization)\s*[:=]\s*\S+/gi, '$1: [REDACTED]')
    .replace(/\bglpat-[A-Za-z0-9_-]+\b/g, '[REDACTED]');
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
  encodeProject,
  isMainModule,
  normalizeApiBase,
  parseArgs,
  parseMaxResults,
  safeErrorMessage,
};
