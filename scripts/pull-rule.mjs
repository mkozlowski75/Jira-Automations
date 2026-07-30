/**
 * Ruft eine einzelne Jira-Automatisierungsregel read-only ab.
 * Usage: npm run pull-rule -- rules/BDR-913.json [--apply]
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAutomationRule } from './lib/automation-api.mjs';
import {
  parseJsonFile,
  resolveTrackedRuleFile,
  validateCandidateRule,
  writeJsonFile,
} from './lib/rule-repository.mjs';
import { redactSensitive } from './lib/rule-workflow.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(__dir, '..');

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const ruleFile = args.find(argument => !argument.startsWith('--'));
  if (!ruleFile) {
    console.log('Usage: npm run pull-rule -- <rule-file.json> [--apply]');
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

  if (!apply) {
    console.log('Kein lokaler Schreibvorgang.');
    return;
  }

  const validation = validateCandidateRule({
    rulesDir: join(repositoryRoot, 'rules'),
    schema: parseJsonFile(join(repositoryRoot, 'rules', 'rule-schema.json')),
    file: resolved.file,
    rule: remoteRule,
  });
  if (validation.errors.length > 0 || validation.warnings.length > 0) {
    console.error(`❌ Serverexport wird nicht übernommen: ${validation.errors.length} Fehler, ${validation.warnings.length} Warnungen.`);
    process.exitCode = 1;
    return;
  }

  writeJsonFile(resolved.absolutePath, remoteRule);
  console.log('✅ Aktueller Serverexport wurde lokal übernommen.');
}

main().catch(() => {
  console.error('❌ Read-only Abruf fehlgeschlagen. Es wurden keine Secret- oder Response-Werte ausgegeben.');
  process.exitCode = 1;
});
