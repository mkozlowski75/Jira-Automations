/**
 * Ruft eine einzelne Jira-Automatisierungsregel read-only ab.
 * Usage: node scripts/pull-rule.mjs rules/BDR-913.json [--save]
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAutomationRule } from './lib/automation-api.mjs';
import {
  parseJsonFile,
  resolveTrackedRuleFile,
} from './lib/rule-repository.mjs';
import {
  redactSensitive,
  writeServerBackup,
} from './lib/rule-workflow.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(__dir, '..');
const backupsRoot = join(repositoryRoot, 'backups');

async function main() {
  const args = process.argv.slice(2);
  const ruleFile = args.find(argument => !argument.startsWith('--'));
  if (!ruleFile) {
    console.log('Usage: node scripts/pull-rule.mjs <rule-file.json> [--save]');
    process.exitCode = 1;
    return;
  }

  const resolved = resolveTrackedRuleFile(repositoryRoot, ruleFile);
  const descriptor = parseJsonFile(resolved.absolutePath);
  const remoteRule = await fetchAutomationRule(descriptor);
  const safeRule = redactSensitive(remoteRule);

  console.log(`Regel: ${safeRule.name} (ID ${safeRule.id})`);
  console.log(`State: ${safeRule.state}`);
  console.log(`Projects: ${JSON.stringify(safeRule.projects)}`);
  console.log(`Trigger: ${safeRule.trigger?.type || 'nicht vorhanden'}`);
  console.log(`Components: ${Array.isArray(safeRule.components) ? safeRule.components.length : 0}`);

  if (args.includes('--save')) {
    const backupPath = writeServerBackup(backupsRoot, remoteRule);
    console.log(`Serverstand lokal gesichert: ${backupPath}`);
  } else {
    console.log('Kein lokaler Schreibvorgang; --save legt eine Git-ignorierte Serverkopie an.');
  }
}

main().catch(() => {
  console.error('❌ Read-only Abruf fehlgeschlagen. Es wurden keine Secret- oder Response-Werte ausgegeben.');
  process.exitCode = 1;
});
