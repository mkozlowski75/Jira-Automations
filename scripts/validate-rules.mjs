/**
 * Validiert alle produktiven Regel-JSONs unter rules/ gegen rule-schema.json
 * und prüft regelübergreifende Code-Barrel-Invarianten.
 * Usage: npm run validate
 */
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseJsonFile,
  resolveRulesDir,
} from './lib/rule-repository.mjs';
import { createRuleSetValidator } from './lib/rule-validation.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(__dirname, '..');
const rulesDir = resolveRulesDir(repositoryRoot);
const schemaPath = join(rulesDir, 'rule-schema.json');

const schema = parseJsonFile(schemaPath);
const files = readdirSync(rulesDir)
  .filter(file => /^(?:BDR-|CER-jira-rule-)\d+\.json$/.test(file))
  .sort((left, right) => left.localeCompare(right, 'de', { numeric: true }));

const entries = [];
const parseErrors = [];

for (const file of files) {
  try {
    entries.push({
      file,
      rule: parseJsonFile(join(rulesDir, file)),
    });
  } catch (error) {
    parseErrors.push({
      file,
      path: '/',
      message: `Ungültiges JSON: ${error.message}`,
    });
  }
}

const validateRuleSet = createRuleSetValidator(schema);
const result = validateRuleSet(entries);
const errors = [...parseErrors, ...result.errors];
const warnings = result.warnings;

console.log('🔍 Validiere Jira-Automatisierungsregeln …\n');

for (const error of errors) {
  console.log(`  [${error.file}] ❌ ${error.path}: ${error.message}`);
}

for (const warning of warnings) {
  console.log(`  [${warning.file}] ⚠️  ${warning.path}: ${warning.message}`);
}

console.log(`\n📊 Ergebnis: ${files.length} Regeln — ${errors.length} Fehler, ${warnings.length} Warnungen`);
if (errors.length > 0) process.exitCode = 1;
