/**
 * Prüft Jira-Version und Automation-API ausschließlich read-only.
 * Usage: node scripts/inspect-environment.mjs rules/BDR-913.json
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectJiraEnvironment } from './lib/automation-api.mjs';
import {
  parseJsonFile,
  resolveTrackedRuleFile,
} from './lib/rule-repository.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(__dir, '..');

async function main() {
  const ruleFile = process.argv.slice(2).find(argument => !argument.startsWith('--'));
  if (!ruleFile) {
    console.log('Usage: node scripts/inspect-environment.mjs <rule-file.json>');
    process.exitCode = 1;
    return;
  }

  const resolved = resolveTrackedRuleFile(repositoryRoot, ruleFile);
  const descriptor = parseJsonFile(resolved.absolutePath);
  const info = await inspectJiraEnvironment(descriptor);

  console.log(`Jira-Version: ${info.jiraVersion || 'nicht ermittelt'}`);
  console.log(`Jira-Build: ${info.jiraBuildNumber || 'nicht ermittelt'}`);
  console.log(`Jira serverInfo: ${info.serverInfoStatus}`);
  console.log(`Automation-API read-only verifiziert: ${info.automationApiVerified ? 'ja' : 'nein'}`);
  console.log(`Automation-API Status: ${info.automationApiStatus}`);
  console.log(`Automation-Plugin-Version: ${info.automationPluginVersion || 'nicht ermittelt'}`);
  console.log(`Automation-Plugin-Build: ${info.automationPluginBuild || 'nicht ermittelt'}`);
  console.log(`Automation-Plugin-UPM-Status: ${info.automationPluginStatus}`);
  if (info.serverInfoStatus !== 'ok' || !info.automationApiVerified) process.exitCode = 1;
}

main().catch(() => {
  console.error('❌ Umgebungsprüfung fehlgeschlagen. Es wurden keine Credential- oder Response-Werte ausgegeben.');
  process.exitCode = 1;
});
