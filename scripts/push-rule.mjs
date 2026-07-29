/**
 * Push eine einzelne Regel-Datei nach Jira Data Center (Automation API).
 * Usage: node scripts/push-rule.mjs rules/BDR-913.json
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import dotenv from 'dotenv';

const __dir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dir, '..', 'config', '.env') });

const ruleFile = process.argv[2];
if (!ruleFile) {
  console.log('Usage: node scripts/push-rule.mjs <rule-file.json>');
  process.exit(0);
}

const JIRA_BASE = process.env.JIRA_BASE_URL;
const JIRA_PAT  = process.env.JIRA_PERSONAL_ACCESS_TOKEN;
const CERT_PATH = process.env.CLIENT_CERT_PATH;
const CERT_PASS = process.env.CLIENT_CERT_PASSPHRASE || '';

if (!JIRA_BASE || !JIRA_PAT) {
  console.error('❌ JIRA_BASE_URL oder JIRA_PERSONAL_ACCESS_TOKEN nicht in config/.env gesetzt.');
  process.exit(1);
}

// mTLS Agent
let sslAgent;
if (CERT_PATH && existsSync(CERT_PATH)) {
  sslAgent = new https.Agent({
    pfx: readFileSync(CERT_PATH),
    passphrase: CERT_PASS,
    rejectUnauthorized: false,
  });
}

// Regel laden
const raw = readFileSync(resolve(ruleFile), 'utf-8');
const rule = JSON.parse(raw);
const projectId = rule.projects?.[0]?.projectId;
const ruleId = rule.id;

if (!projectId || !ruleId) {
  console.error('❌ Regel-Datei enthält keine projectId oder ruleId.');
  process.exit(1);
}

const apiPath = `/jira/rest/cb-automation/latest/project/${projectId}/rule/${ruleId}`;
const body = JSON.stringify(rule);
const parsed = new URL(JIRA_BASE);

console.log(`📤 Übertrage Regel ${ruleId} („${rule.name}") nach Jira …`);
console.log(`   PUT ${JIRA_BASE}${apiPath}`);

const options = {
  hostname: parsed.hostname,
  port: parsed.port || 443,
  path: apiPath,
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${JIRA_PAT}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  },
  agent: sslAgent,
  rejectUnauthorized: false,
};

const req = https.request(options, (res) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => {
    const resp = Buffer.concat(chunks).toString('utf-8');
    if (res.statusCode >= 200 && res.statusCode < 300) {
      console.log(`✅ Regel ${ruleId} erfolgreich aktualisiert (Status ${res.statusCode}).`);
    } else if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
      console.error(`❌ Redirect ${res.statusCode} → ${res.headers.location || '?'} – Zugriff verweigert oder Login erforderlich.`);
      process.exit(1);
    } else {
      console.error(`❌ Fehler ${res.statusCode}:`);
      try { console.error(JSON.stringify(JSON.parse(resp), null, 2)); } catch { console.error(resp.substring(0, 1000)); }
      process.exit(1);
    }
  });
});

req.on('error', (err) => {
  console.error(`❌ Verbindungsfehler: ${err.message}`);
  process.exit(1);
});

req.write(body);
req.end();
