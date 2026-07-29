/**
 * Validiert alle Regel-JSONs unter rules/ gegen rule-schema.json
 * Usage: node scripts/validate-rules.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rulesDir = join(__dirname, '..', 'rules');
const schemaPath = join(rulesDir, 'rule-schema.json');

const raw = readFileSync(schemaPath, 'utf-8');
// Strip BOM if present
const schema = JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw);

const requiredKeys = schema.required;
const triggerTypes = schema.properties.trigger.properties.type.enum;
const actionTypes = schema.properties.actions.items.properties.type.enum;

console.log('🔍 Validiere Jira-Automatisierungsregeln …\n');

const files = readdirSync(rulesDir).filter(f => f.endsWith('.json') && f !== 'rule-schema.json');
let errors = 0;
let warnings = 0;

for (const file of files) {
  const rulePath = join(rulesDir, file);
  const ruleRaw = readFileSync(rulePath, 'utf-8');
  const rule = JSON.parse(ruleRaw.charCodeAt(0) === 0xFEFF ? ruleRaw.slice(1) : ruleRaw);
  const prefix = `  [${file}]`;

  // Pflichtfelder
  for (const key of requiredKeys) {
    if (!(key in rule)) {
      console.log(`${prefix} ❌ Pflichtfeld fehlt: "${key}"`);
      errors++;
    }
  }

  // ID-Format
  if (rule.id && !/^BDR-\d{3}$/.test(rule.id)) {
    console.log(`${prefix} ❌ ID-Format ungültig: "${rule.id}" (erwartet: BDR-NNN)`);
    errors++;
  }

  // Trigger-Type
  if (rule.trigger && !triggerTypes.includes(rule.trigger.type)) {
    console.log(`${prefix} ⚠️  Unbekannter Trigger-Typ: "${rule.trigger.type}"`);
    warnings++;
  }

  // Action-Types
  if (rule.actions) {
    for (const [i, action] of rule.actions.entries()) {
      if (!actionTypes.includes(action.type)) {
        console.log(`${prefix} ⚠️  Unbekannter Action-Typ [${i}]: "${action.type}"`);
        warnings++;
      }
    }
  }

  // Template-Warnung
  if (rule.id === 'BDR-001' && rule.enabled !== false) {
    console.log(`${prefix} ⚠️  Template-Regel sollte enabled: false sein`);
    warnings++;
  }
}

console.log(`\n📊 Ergebnis: ${files.length} Regeln — ${errors} Fehler, ${warnings} Warnungen`);
if (errors > 0) process.exit(1);
