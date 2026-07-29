/**
 * Gemeinsamer API-Helper für Jira Data Center und GitLab.
 * Lädt Credentials + Client-Zertifikat (mTLS) aus config/.env.
 */
import dotenv from 'dotenv';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '..', 'config', '.env') });

// ─── Konfiguration ──────────────────────────────────────────
const JIRA_BASE  = process.env.JIRA_BASE_URL;
const JIRA_PATH  = process.env.JIRA_API_PATH || '/jira/rest/api/2';
const JIRA_PAT   = process.env.JIRA_PERSONAL_ACCESS_TOKEN;

const GITLAB_BASE  = process.env.GITLAB_BASE_URL;
const GITLAB_TOKEN = process.env.GITLAB_API_TOKEN;

const CERT_PATH = process.env.CLIENT_CERT_PATH;
const CERT_PASS = process.env.CLIENT_CERT_PASSPHRASE || '';

// ─── SSL Agent (mTLS Client-Zertifikat) ────────────────────
/** @type {https.Agent | undefined} */
let sslAgent;

if (CERT_PATH && existsSync(CERT_PATH)) {
  try {
    const pfx = readFileSync(CERT_PATH);
    sslAgent = new https.Agent({
      pfx,
      passphrase: CERT_PASS,
      rejectUnauthorized: false,
    });
  } catch (err) {
    console.error('⚠️  Konnte Client-Zertifikat nicht laden.');
  }
}

if (!sslAgent) {
  console.warn('⚠️  Kein Client-SSL-Zertifikat geladen – mTLS-Verbindungen werden fehlschlagen.');
}

// ─── HTTP-Request mit nativem https (mTLS-kompatibel) ──────
function request(method, url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const mod = isHttps ? https : http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: method,
      headers: opts.headers || {},
      agent: isHttps ? sslAgent : undefined,
      rejectUnauthorized: false,
    };

    const req = mod.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        // folge Redirects (max 5)
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          const location = res.headers.location;
          // Erkenne Login-/Permission-Redirects
          if (location.includes('login.jsp') || location.includes('permissionViolation')) {
            reject(new Error(`Zugriff verweigert – Berechtigung fehlt für: ${url}`));
            return;
          }
          const redirectUrl = new URL(location, url).toString();
          resolve(request(method, redirectUrl, opts));
          return;
        }
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: res.headers,
          text: () => Promise.resolve(body),
          json: () => {
            try { return Promise.resolve(JSON.parse(body)); }
            catch { return Promise.reject(new Error(`Invalid JSON (Status ${res.statusCode})`)); }
          },
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout nach 30s')); });

    if (opts.body) {
      req.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
    }
    req.end();
  });
}

async function httpGetJson(url, headers = {}) {
  const res = await request('GET', url, { headers });
  if (!res.ok) {
    throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function httpPostJson(url, body, headers = {}) {
  const res = await request('POST', url, {
    headers: { ...headers, 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) {
    throw new Error(`POST ${url} → ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function httpPutJson(url, body, headers = {}) {
  const res = await request('PUT', url, {
    headers: { ...headers, 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) {
    throw new Error(`PUT ${url} → ${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return null;
  const responseBody = await res.text();
  return responseBody ? JSON.parse(responseBody) : null;
}

// ─── Jira API ───────────────────────────────────────────────
const jiraAuthHeaders = {
  'Authorization': `Bearer ${JIRA_PAT}`,
  'Accept': 'application/json',
};

export async function jiraGet(path) {
  const url = `${JIRA_BASE}${JIRA_PATH}${path}`;
  return httpGetJson(url, jiraAuthHeaders);
}

export async function jiraRawGet(url, headers = {}) {
  // Für Endpunkte, die nicht unter JIRA_PATH liegen (z.B. Automation-API)
  return httpGetJson(url, { ...jiraAuthHeaders, ...headers });
}

export async function jiraRawPut(url, body) {
  // Für Endpunkte, die nicht unter JIRA_PATH liegen (z.B. Automation-API)
  return httpPutJson(url, body, jiraAuthHeaders);
}

export function jiraConfig() {
  return { base: JIRA_BASE };
}

// ─── GitLab API ─────────────────────────────────────────────
const gitlabAuthHeaders = {
  'PRIVATE-TOKEN': GITLAB_TOKEN,
  'Accept': 'application/json',
};

export async function gitlabGet(path) {
  const url = `${GITLAB_BASE}/api/v4${path}`;
  return httpGetJson(url, gitlabAuthHeaders);
}

export async function gitlabPost(path, body) {
  const url = `${GITLAB_BASE}/api/v4${path}`;
  return httpPostJson(url, body, gitlabAuthHeaders);
}

export function gitlabConfig() {
  return { base: GITLAB_BASE };
}
