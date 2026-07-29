/**
 * Ruft eine einzelne Jira-Automatisierungsregel read-only ab.
 * Usage: npm run pull-rule -- rules/BDR-913.json
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAutomationRule } from './lib/automation-api.mjs';
import {
  parseJsonFile,
  resolveTrackedRuleFile,
} from './lib/rule-repository.mjs';
import { redactSensitive } from './lib/rule-workflow.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(__dir, '..');

async function main() {
  const ruleFile = process.argv.slice(2).find(argument => !argument.startsWith('--'));
  if (!ruleFile) {
    console.log('Usage: npm run pull-rule -- <rule-file.json>');
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
  console.log('Kein lokaler Schreibvorgang.');
}

main().catch(() => {
  console.error('❌ Read-only Abruf fehlgeschlagen. Es wurden keine Secret- oder Response-Werte ausgegeben.');
  process.exitCode = 1;
});
