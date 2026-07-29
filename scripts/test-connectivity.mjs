/**
 * Testet die Verbindung zu Jira Data Center und GitLab.
 * Nutzt die Credentials und Client-Zertifikat (.pfx) aus config/.env
 */
import dotenv from 'dotenv';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import https from 'node:https';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', 'config', '.env') });

const JIRA_BASE = process.env.JIRA_BASE_URL;
const JIRA_EMAIL = process.env.JIRA_USER_EMAIL;
const JIRA_PAT = process.env.JIRA_PERSONAL_ACCESS_TOKEN;

const GITLAB_BASE = process.env.GITLAB_BASE_URL;
const GITLAB_TOKEN = process.env.GITLAB_API_TOKEN;

const CERT_PATH = process.env.CLIENT_CERT_PATH;
const CERT_PASS  = process.env.CLIENT_CERT_PASSPHRASE || '';

// ─── SSL Agent (mTLS Client-Zertifikat) ────────────────────
/** @type {https.Agent | undefined} */
let sslAgent;

if (CERT_PATH && existsSync(CERT_PATH)) {
  console.log(`🔐 Lade Client-Zertifikat: ${CERT_PATH}`);
  try {
    const pfx = readFileSync(CERT_PATH);
    sslAgent = new https.Agent({
      pfx,
      passphrase: CERT_PASS,
      rejectUnauthorized: false,
    });
    console.log('   ✅ Zertifikat geladen');
  } catch (err) {
    console.log(`   ⚠️  Zertifikat-Fehler: ${err.message}`);
  }
} else if (CERT_PATH) {
  console.log(`⚠️  Zertifikat nicht gefunden: ${CERT_PATH}`);
}

// ─── HTTP-Request mit nativen https-Modul (mTLS-kompatibel) ─
function httpsRequest(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const mod = isHttps ? https : http;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: opts.method || 'GET',
      headers: opts.headers || {},
      agent: isHttps ? sslAgent : undefined,
      rejectUnauthorized: false,
    };

    const req = mod.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: res.headers,
          text: () => Promise.resolve(body),
          json: () => {
            try { return Promise.resolve(JSON.parse(body)); }
            catch { return Promise.reject(new Error('Invalid JSON')); }
          },
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });

    if (opts.body) {
      req.write(opts.body);
    }
    req.end();
  });
}

// ─── Jira Test ───────────────────────────────────────────────
async function testJira() {
  console.log('\n═══════════════════════════════════════');
  console.log('🔵 JIRA DATA CENTER Verbindungstest');
  console.log(`   URL: ${JIRA_BASE}`);
  console.log(`   User: ${JIRA_EMAIL}`);
  console.log(`   mTLS: ${sslAgent ? '✅ Zertifikat aktiv' : '❌ Kein Zertifikat'}`);
  console.log('═══════════════════════════════════════');

  if (!JIRA_BASE || !JIRA_EMAIL || !JIRA_PAT) {
    console.log('❌ Fehlende Jira-Konfiguration in config/.env');
    return false;
  }

  const headers = {
    'Authorization': `Bearer ${JIRA_PAT}`,
    'Accept': 'application/json',
  };

  try {
    // Test 1: /myself – verschiedene Basis-Pfade probieren
    console.log('\n📡 Suche Jira-API-Endpunkt ...');
    const pathsToTry = [
      '/rest/api/2/myself',
      '/jira/rest/api/2/myself',
      '/rest/api/latest/myself',
    ];
    let meRes;
    let usedPath;
    for (const p of pathsToTry) {
      console.log(`   → ${p} ...`);
      meRes = await httpsRequest(`${JIRA_BASE}${p}`, { headers });
      if (meRes.ok) {
        usedPath = p;
        console.log(`   ✅ Treffer: ${p}`);
        break;
      }
      console.log(`   ⚠️  ${meRes.status}`);
      if (meRes.status !== 404) {
        // Nicht 404 -> Authentifizierungs-/anderer Fehler, zeige Body
        const body = await meRes.text();
        console.log(`   Body: ${body.substring(0, 200)}`);
      }
    }
    if (!meRes || !meRes.ok) {
      console.log('   ❌ Kein gültiger API-Endpunkt gefunden');
      return false;
    }
    const me = await meRes.json();
    console.log(`   ✅ Verbunden als: ${me.displayName} (${me.emailAddress})`);
    console.log(`   Account ID: ${me.accountId}`);

    // Basis-Pfad extrahieren für weitere Tests
    const basePath = usedPath.replace('/myself', '');

    // Test 2: Server-Info abrufen
    console.log('\n📡 Teste serverInfo ...');
    const infoRes = await httpsRequest(`${JIRA_BASE}${basePath}serverInfo`, { headers });
    if (infoRes.ok) {
      const info = await infoRes.json();
      console.log(`   ✅ Version: ${info.version}`);
      console.log(`   Build: ${info.buildNumber}`);
      console.log(`   Title: ${info.serverTitle}`);
    } else {
      console.log(`   ⚠️  Server-Info nicht abrufbar: ${infoRes.status}`);
    }

    // Test 3: Projekt-Zugriff prüfen
    const project = process.env.JIRA_DEFAULT_PROJECT || 'CER';
    console.log(`\n📡 Teste Zugriff auf Projekt "${project}" ...`);
    const projRes = await httpsRequest(`${JIRA_BASE}${basePath}project/${project}`, { headers });
    if (projRes.ok) {
      const proj = await projRes.json();
      console.log(`   ✅ Projekt gefunden: ${proj.name} (Key: ${proj.key})`);
    } else {
      console.log(`   ⚠️  Projekt nicht erreichbar: ${projRes.status} ${projRes.statusText}`);
    }

    return true;
  } catch (err) {
    console.log(`   ❌ Verbindungsfehler: ${err.message}`);
    if (err.cause) console.log(`   Cause: ${err.cause.message}`);
    return false;
  }
}

// ─── GitLab Test ─────────────────────────────────────────────
async function testGitLab() {
  console.log('\n═══════════════════════════════════════');
  console.log('🟠 GITLAB Verbindungstest');
  console.log(`   URL: ${GITLAB_BASE}`);
  console.log(`   mTLS: ${sslAgent ? '✅ Zertifikat aktiv' : '❌ Kein Zertifikat'}`);
  console.log('═══════════════════════════════════════');

  if (!GITLAB_BASE || !GITLAB_TOKEN) {
    console.log('❌ Fehlende GitLab-Konfiguration in config/.env');
    return false;
  }

  const headers = {
    'PRIVATE-TOKEN': GITLAB_TOKEN,
    'Accept': 'application/json',
  };

  try {
    // Test 1: /user (Authentifizierung prüfen)
    console.log('\n📡 Teste /api/v4/user ...');
    const userRes = await httpsRequest(`${GITLAB_BASE}/api/v4/user`, { headers });
    if (!userRes.ok) {
      console.log(`   ❌ Fehler: ${userRes.status} ${userRes.statusText}`);
      const body = await userRes.text();
      console.log(`   Body: ${body.substring(0, 300)}`);
      return false;
    }
    const user = await userRes.json();
    console.log(`   ✅ Verbunden als: ${user.name} (@${user.username})`);
    console.log(`   Email: ${user.email || 'nicht öffentlich'}`);

    // Test 2: GitLab Version
    console.log('\n📡 Teste /api/v4/version ...');
    const verRes = await httpsRequest(`${GITLAB_BASE}/api/v4/version`, { headers });
    if (verRes.ok) {
      const ver = await verRes.json();
      console.log(`   ✅ Version: ${ver.version}`);
      console.log(`   Revision: ${ver.revision}`);
    } else {
      console.log(`   ⚠️  Version nicht abrufbar: ${verRes.status}`);
    }

    // Test 3: Group-Zugriff prüfen
    const group = process.env.GITLAB_DEFAULT_GROUP || 'cer';
    console.log(`\n📡 Teste Zugriff auf Group "${group}" ...`);
    const groupRes = await httpsRequest(`${GITLAB_BASE}/api/v4/groups/${encodeURIComponent(group)}`, { headers });
    if (groupRes.ok) {
      const grp = await groupRes.json();
      console.log(`   ✅ Gruppe gefunden: ${grp.full_name} (ID: ${grp.id})`);
    } else {
      console.log(`   ⚠️  Gruppe nicht erreichbar: ${groupRes.status} ${groupRes.statusText}`);
    }

    return true;
  } catch (err) {
    console.log(`   ❌ Verbindungsfehler: ${err.message}`);
    if (err.cause) console.log(`   Cause: ${err.cause.message}`);
    return false;
  }
}

// ─── Main ────────────────────────────────────────────────────
console.log('╔═══════════════════════════════════════╗');
console.log('║   🔐 API CONNECTIVITY TEST           ║');
console.log('╚═══════════════════════════════════════╝');

const jiraOk = await testJira();
const gitlabOk = await testGitLab();

console.log('\n═══════════════════════════════════════');
console.log('📊 ZUSAMMENFASSUNG');
console.log(`   Jira:   ${jiraOk ? '✅ ERFOLGREICH' : '❌ FEHLGESCHLAGEN'}`);
console.log(`   GitLab: ${gitlabOk ? '✅ ERFOLGREICH' : '❌ FEHLGESCHLAGEN'}`);
console.log('═══════════════════════════════════════');

if (!jiraOk || !gitlabOk) {
  process.exit(1);
}
