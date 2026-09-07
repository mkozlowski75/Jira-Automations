/**
 * Ermittelt die nächste lokal und remote freie numerische Component-ID.
 * Usage: npm run next-component-id -- rules/BDR-913.json
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAutomationRules } from './lib/automation-api.mjs';
import {
  loadRuleEntries,
  parseJsonFile,
  resolveRulesDir,
  resolveTrackedRuleFile,
} from './lib/rule-repository.mjs';
import { nextComponentId } from './lib/rule-workflow.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(__dir, '..');
const rulesDir = resolveRulesDir(repositoryRoot);

async function main() {
  const ruleFile = process.argv.slice(2).find(argument => !argument.startsWith('--'));
  if (!ruleFile) {
    console.error('Usage: npm run next-component-id -- <rule-file.json>');
    process.exitCode = 1;
    return;
  }

  const resolved = resolveTrackedRuleFile(repositoryRoot, ruleFile);
  const descriptor = parseJsonFile(resolved.absolutePath);
  const localEntries = loadRuleEntries(rulesDir);
  const remoteRules = await fetchAutomationRules(descriptor);
  const remoteEntries = remoteRules.map(rule => ({
    file: `remote-BDR-${rule.id}.json`,
    rule,
  }));

  console.log(nextComponentId([...localEntries, ...remoteEntries]));
}

main().catch(() => {
  console.error('❌ ID-Ermittlung fehlgeschlagen; ohne aktuellen Serverstand wird keine ID vorgeschlagen.');
  process.exitCode = 1;
});
