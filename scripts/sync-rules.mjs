/**
 * Synchronisiert lokale Regel-Definitionen mit Jira Data Center.
 *
 * Usage:
 *   node scripts/sync-rules.mjs --pull          # Regeln aus Jira abrufen
 *   node scripts/sync-rules.mjs --push          # Lokale Regeln nach Jira pushen
 *   node scripts/sync-rules.mjs --diff          # Unterschiede anzeigen
 *
 * Voraussetzung:
 *   config/.env mit JIRA_BASE_URL, JIRA_USER_EMAIL, JIRA_PERSONAL_ACCESS_TOKEN,
 *   CLIENT_CERT_PATH, CLIENT_CERT_PASSPHRASE (mTLS)
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jiraGet, jiraPost, jiraPut, jiraRawGet, jiraConfig } from './lib/api-helper.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rulesDir = join(__dirname, '..', 'rules');

// --- Automation API (Data Center, anderer Basis-Pfad) ---
async function getAutomationRules() {
  const { base } = jiraConfig();
  // Automation for Jira Data Center: /jira/rest/automation/1.0/rule
  const url = `${base}/jira/rest/automation/1.0/rule`;
  const res = await jiraRawGet(url);
  if (res.values) return res.values;
  if (Array.isArray(res)) return res;
  return res;
}

async function getIssueTypes(projectKey) {
  const data = await jiraGet(`/issuetype/project?projectKey=${projectKey}`);
  return data;
}

async function getTransitions(issueKey) {
  const data = await jiraGet(`/issue/${issueKey}/transitions`);
  return data.transitions || [];
}

// --- CLI ---
const mode = process.argv[2];

if (!mode || !['--pull', '--push', '--diff'].includes(mode)) {
  console.log('Usage: node scripts/sync-rules.mjs [--pull | --push | --diff]');
  console.log('  --pull   Regeln aus Jira Data Center abrufen und lokal speichern');
  console.log('  --push   Lokale Regeln nach Jira Data Center übertragen');
  console.log('  --diff   Unterschiede zwischen lokal und Jira anzeigen');
  process.exit(0);
}

async function main() {
  const { base, path, email } = jiraConfig();
  console.log(`🔗 Verbinde mit ${base}${path} …\n`);

  try {
    const myself = await jiraGet('/myself');
    console.log(`✅ Verbunden als ${myself.displayName} (${myself.emailAddress})\n`);
  } catch (err) {
    console.error(`❌ Verbindung fehlgeschlagen: ${err.message}`);
    process.exit(1);
  }

  if (mode === '--pull') {
    console.log('📥 Rufe Automatisierungsregeln aus Jira ab …\n');
    try {
      const rules = await getAutomationRules();
      console.log(`${rules.length} Regeln gefunden.`);
      for (const rule of rules) {
        const filename = `BDR-${String(rule.id).padStart(3, '0')}.json`;
        const targetPath = join(rulesDir, filename);
        writeFileSync(targetPath, JSON.stringify(rule, null, 2));
        console.log(`  ✅ ${filename} — "${rule.name}"`);
      }
    } catch (err) {
      console.error(`⚠️  Konnte Automation-Regeln nicht abrufen: ${err.message}`);
      console.log('   (Möglicherweise hat deine Jira-Instanz keine Automation-API.)');
    }
  }

  if (mode === '--push') {
    console.log('📤 Push-Modus: Lokale Regel-Dateien werden analysiert …\n');
    const files = readdirSync(rulesDir).filter(f => f.endsWith('.json') && !f.startsWith('_') && f !== 'rule-schema.json');
    console.log(`${files.length} lokale Regeln gefunden.`);
    console.log('   (Push-Implementierung folgt – bitte manuell in Jira UI konfigurieren.)');
  }

  if (mode === '--diff') {
    console.log('🔍 Diff-Modus: Vergleiche lokal ↔ Jira Data Center …\n');
    const localFiles = readdirSync(rulesDir).filter(f => f.endsWith('.json') && !f.startsWith('_') && f !== 'rule-schema.json');
    try {
      const remoteRules = await getAutomationRules();
      console.log(`  Lokal:  ${localFiles.length} Regeln`);
      console.log(`  Remote: ${remoteRules.length} Regeln`);
      const onlyLocal = localFiles.length - remoteRules.length;
      const onlyRemote = remoteRules.length - localFiles.length;
      if (onlyLocal > 0) console.log(`  ➕ ${onlyLocal} nur lokal vorhanden`);
      if (onlyRemote > 0) console.log(`  ➖ ${onlyRemote} nur remote vorhanden`);
      if (onlyLocal === 0 && onlyRemote === 0) console.log('  ✅ Synchron');
    } catch (err) {
      if (err.message.includes('Berechtigung') || err.message.includes('Zugriff verweigert')) {
        console.error('⚠️  Keine Berechtigung für Automation-API.');
        console.error('   Der Benutzer benötigt Jira-Admin-Rechte für "Automation for Jira".');
      } else {
        console.error(`⚠️  Diff nicht möglich: ${err.message}`);
      }
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
