/**
 * Push eine einzelne Regel-Datei nach Jira Data Center (Automation API).
 * Usage: npm run push-rule -- rules/BDR-913.json
 *
 * Ohne --apply wird ausschließlich ein read-only Preflight ausgeführt.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fetchAutomationRule,
  putAutomationRule,
} from './lib/automation-api.mjs';
import {
  loadGitHeadRule,
  parseJsonFile,
  resolveTrackedRuleFile,
  validateCandidateRule,
} from './lib/rule-repository.mjs';
import {
  performDeployment,
  writeServerBackup,
} from './lib/rule-workflow.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(__dir, '..');
const rulesDir = join(repositoryRoot, 'rules');
const backupsRoot = join(repositoryRoot, 'backups');

function parseArguments(args) {
  const ruleFile = args.find(argument => !argument.startsWith('--'));
  const allowedFields = args
    .filter(argument => argument.startsWith('--allow-field='))
    .map(argument => argument.slice('--allow-field='.length))
    .filter(Boolean);
  return {
    ruleFile,
    apply: args.includes('--apply'),
    allowedFields,
  };
}

function safeErrorMessage(error) {
  const firstLine = String(error?.message || error).split(/\r?\n/, 1)[0];
  return firstLine
    .replace(/(→\s*\d+).*/, '$1')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
}

function formatValue(value) {
  const formatted = JSON.stringify(value);
  if (formatted === undefined) return 'undefined';
  return formatted.length > 180 ? `${formatted.slice(0, 177)}...` : formatted;
}

function printPreflight(preflight) {
  const { summary } = preflight;
  console.log(`Regel: ${summary.rule.name} (ID ${summary.rule.id})`);
  console.log(`Projekt-Scope: ${formatValue(summary.rule.projects)}`);
  console.log(`Trigger: ${summary.rule.trigger?.type || 'nicht vorhanden'}`);
  console.log(`Components hinzugefügt: ${summary.components.added.length}`);
  console.log(`Components entfernt: ${summary.components.removed.length}`);
  console.log(`Components typseitig geändert: ${summary.components.changed.length}`);

  if (summary.guardedFields.length > 0) {
    console.log(`Geschützte Felder geändert: ${summary.guardedFields.map(change => change.field).join(', ')}`);
  }

  console.log('Änderungen:');
  for (const change of summary.changes) {
    console.log(`  ${change.path}: ${formatValue(change.before)} -> ${formatValue(change.after)}`);
  }
  if (summary.changes.length === 0) console.log('  keine');

  for (const error of preflight.errors) console.error(`❌ ${error}`);
  for (const warning of preflight.warnings) {
    console.error(`⚠️  ${warning.file} ${warning.path}: ${warning.message}`);
  }
}

async function main() {
  const {
    ruleFile,
    apply,
    allowedFields,
  } = parseArguments(process.argv.slice(2));
  if (!ruleFile) {
    console.log('Usage: npm run push-rule -- <rule-file.json> [--apply] [--allow-field=<field>]');
    process.exitCode = 1;
    return;
  }

  // mTLS Agent wird zentral durch api-helper.mjs aus der Konfiguration geladen.

  // Regel laden
  const resolved = resolveTrackedRuleFile(repositoryRoot, ruleFile);
  const localRule = parseJsonFile(resolved.absolutePath);
  const baselineRule = loadGitHeadRule(repositoryRoot, resolved.repositoryPath);
  const schema = parseJsonFile(join(rulesDir, 'rule-schema.json'));
  const validation = validateCandidateRule({
    rulesDir,
    schema,
    file: resolved.file,
    rule: localRule,
  });

  const result = await performDeployment({
    localRule,
    baselineRule,
    validation,
    allowedFields,
    apply,
    fetchRemote: fetchAutomationRule,
    putRemote: putAutomationRule,
    createBackup: remoteRule => writeServerBackup(backupsRoot, remoteRule),
  });

  printPreflight(result.preflight);

  if (!result.preflight.ok) {
    process.exitCode = 1;
    return;
  }

  if (!apply) {
    console.log('\nℹ️  Read-only Preflight erfolgreich. Kein PUT wurde ausgeführt.');
    console.log('   Ein Push erfordert eine ausdrückliche Benutzerfreigabe und anschließend --apply.');
    return;
  }

  console.log(`\n✅ Regel aktualisiert und remote verifiziert.`);
  console.log(`   Server-Backup: ${result.backupPath}`);
}

main().catch(error => {
  console.error(`❌ Sicherer Push abgebrochen: ${safeErrorMessage(error)}`);
  process.exitCode = 1;
});
