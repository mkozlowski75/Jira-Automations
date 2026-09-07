/**
 * Stellt eine Jira-Automatisierungsregel aus einem lokalen Server-Backup wieder her.
 * Usage: npm run rollback-rule -- backups/BDR-913/<timestamp>.server.json [--apply]
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchAutomationRule,
  putAutomationRule,
} from './lib/automation-api.mjs';
import {
  loadBackupRule,
  parseJsonFile,
  resolveRulesDir,
  resolveTrackedRuleFile,
  validateCandidateRule,
} from './lib/rule-repository.mjs';
import {
  performDeployment,
  writeServerBackup,
} from './lib/rule-workflow.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(__dir, '..');
const rulesDir = resolveRulesDir(repositoryRoot);
const backupsRoot = join(repositoryRoot, 'backups');

async function main() {
  const args = process.argv.slice(2);
  const backupFile = args.find(argument => !argument.startsWith('--'));
  if (!backupFile) {
    console.log('Usage: npm run rollback-rule -- <backup.server.json> [--apply] [--allow-field=<field>]');
    process.exitCode = 1;
    return;
  }

  const apply = args.includes('--apply');
  const allowedFields = args
    .filter(argument => argument.startsWith('--allow-field='))
    .map(argument => argument.slice('--allow-field='.length))
    .filter(Boolean);

  const { rule: backupRule } = loadBackupRule(repositoryRoot, backupFile);
  const trackedRulePath = resolveTrackedRuleFile(
    repositoryRoot,
    join('rules', `BDR-${backupRule.id}.json`),
  );
  const trackedRule = parseJsonFile(trackedRulePath.absolutePath);
  const currentRemote = await fetchAutomationRule(trackedRule);
  const rollbackRule = {
    ...backupRule,
    updated: currentRemote.updated,
  };
  const file = `BDR-${rollbackRule.id}.json`;
  const schema = parseJsonFile(join(rulesDir, 'rule-schema.json'));
  const validation = validateCandidateRule({
    rulesDir,
    schema,
    file,
    rule: rollbackRule,
  });

  const result = await performDeployment({
    localRule: rollbackRule,
    baselineRule: currentRemote,
    validation,
    allowedFields,
    apply,
    fetchRemote: fetchAutomationRule,
    putRemote: putAutomationRule,
    createBackup: remoteRule => writeServerBackup(backupsRoot, remoteRule),
  });

  console.log(`Rollback für Regel ${rollbackRule.name} (ID ${rollbackRule.id})`);
  console.log(`Änderungen: ${result.preflight.summary.changes.length}`);
  console.log(`Components hinzugefügt: ${result.preflight.summary.components.added.length}`);
  console.log(`Components entfernt: ${result.preflight.summary.components.removed.length}`);
  for (const change of result.preflight.summary.changes) {
    console.log(`  ${change.path}: ${change.sensitive ? '[REDACTED]' : 'geändert'}`);
  }
  for (const error of result.preflight.errors) console.error(`❌ ${error}`);

  if (!result.preflight.ok) {
    process.exitCode = 1;
    return;
  }
  if (!apply) {
    console.log('ℹ️  Read-only Rollback-Preflight erfolgreich; kein PUT ausgeführt.');
    return;
  }
  console.log(`✅ Rollback durchgeführt und verifiziert. Vorheriger Serverstand: ${result.backupPath}`);
}

main().catch(() => {
  console.error('❌ Sicherer Rollback abgebrochen. Es wurden keine Secret- oder Response-Werte ausgegeben.');
  process.exitCode = 1;
});
