/**
 * Prüft Struktur, Links, Beispiele und Typabdeckung des Jira-Automation-Skills.
 * Usage: npm run lint
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KNOWN_COMPONENTS } from './lib/rule-validation.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const skillRoot = join(__dir, '..', '.github', 'skills', 'jira-automation-rules');
const skillPath = join(skillRoot, 'SKILL.md');
const examplesDir = join(skillRoot, 'examples');
const referenceFiles = [
  'triggers.md',
  'actions.md',
  'conditions.md',
].map(file => join(skillRoot, 'references', file));
const errors = [];
const skill = readFileSync(skillPath, 'utf8');
const markdownFiles = [
  skillPath,
  ...readdirSync(join(skillRoot, 'references'))
    .filter(file => file.endsWith('.md'))
    .map(file => join(skillRoot, 'references', file)),
];

const lineCount = skill.split(/\r?\n/).length;
if (lineCount < 100) errors.push(`SKILL.md ist mit ${lineCount} Zeilen kürzer als die vorgesehenen 100 Zeilen.`);
if (lineCount > 150) errors.push(`SKILL.md ist mit ${lineCount} Zeilen länger als 150 Zeilen.`);

const frontmatterMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(skill);
if (!frontmatterMatch) {
  errors.push('SKILL.md besitzt kein gültig abgegrenztes YAML-Frontmatter.');
} else {
  const fields = [...frontmatterMatch[1].matchAll(/^([a-zA-Z][\w-]*):\s*(.+)$/gm)]
    .map(match => ({ name: match[1], value: match[2].trim() }));
  const fieldNames = fields.map(field => field.name);
  if (fieldNames.join(',') !== 'name,description') {
    errors.push('Frontmatter muss genau die Felder name und description in dieser Reihenfolge enthalten.');
  }
  if (fields.find(field => field.name === 'name')?.value !== 'jira-automation-rules') {
    errors.push('Frontmatter-name muss jira-automation-rules sein.');
  }
  if (!fields.find(field => field.name === 'description')?.value) {
    errors.push('Frontmatter-description darf nicht leer sein.');
  }
}

for (const markdownFile of markdownFiles) {
  const markdown = readFileSync(markdownFile, 'utf8');
  for (const match of markdown.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (/^(https?:|#)/.test(target)) continue;
    const path = resolve(dirname(markdownFile), target);
    if (!existsSync(path)) errors.push(`Fehlender Link in ${markdownFile}: ${target}`);
  }
}

for (const file of readdirSync(examplesDir).filter(file => file.endsWith('.json'))) {
  const path = join(examplesDir, file);
  try {
    JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    errors.push(`Ungültiges JSON in examples/${file}: ${error.message}`);
  }
}

const catalog = referenceFiles.map(file => readFileSync(file, 'utf8')).join('\n');
for (const type of Object.keys(KNOWN_COMPONENTS)) {
  if (!catalog.includes(`\`${type}\``)) errors.push(`Component-Typ fehlt in Referenzen: ${type}`);
}

const documentationFiles = [
  ...markdownFiles,
  ...readdirSync(examplesDir).map(file => join(examplesDir, file)),
];
const documentation = [...new Set(documentationFiles)]
  .map(file => readFileSync(file, 'utf8'))
  .join('\n');

const ticketSkillRoot = join(__dir, '..', '.github', 'skills', 'jira-tickets');
const ticketSkillPath = join(ticketSkillRoot, 'SKILL.md');
const ticketReferencePath = join(ticketSkillRoot, 'references', 'rest-api.md');
const ticketScriptPath = join(ticketSkillRoot, 'scripts', 'jira-ticket.mjs');
const ticketAgentPath = join(ticketSkillRoot, 'agents', 'openai.yaml');
const ticketSkill = readFileSync(ticketSkillPath, 'utf8');
const ticketReference = readFileSync(ticketReferencePath, 'utf8');
const ticketAgent = readFileSync(ticketAgentPath, 'utf8');
const ticketFrontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(ticketSkill);

if (!ticketFrontmatter) {
  errors.push('jira-tickets/SKILL.md besitzt kein gültiges YAML-Frontmatter.');
} else {
  const fields = [...ticketFrontmatter[1].matchAll(/^([a-zA-Z][\w-]*):\s*(.+)$/gm)]
    .map(match => ({ name: match[1], value: match[2].trim() }));
  if (fields.map(field => field.name).join(',') !== 'name,description') {
    errors.push('jira-tickets-Frontmatter muss genau name und description enthalten.');
  }
  if (fields.find(field => field.name === 'name')?.value !== 'jira-tickets') {
    errors.push('jira-tickets-Frontmatter-name muss jira-tickets sein.');
  }
}

for (const [label, content] of [
  ['jira-tickets/SKILL.md', ticketSkill],
  ['jira-tickets/references/rest-api.md', ticketReference],
  ['jira-tickets/agents/openai.yaml', ticketAgent],
]) {
  if (content.includes('TODO')) errors.push(`${label} enthält noch TODO-Platzhalter.`);
}

for (const requiredText of [
  '--apply',
  '--expected-updated',
  'editmeta',
  'Transition-ID',
]) {
  if (!ticketSkill.includes(requiredText)) {
    errors.push(`jira-tickets/SKILL.md dokumentiert "${requiredText}" nicht.`);
  }
}

if (!existsSync(ticketScriptPath)) {
  errors.push('jira-tickets/scripts/jira-ticket.mjs fehlt.');
}
if (!ticketAgent.includes('$jira-tickets')) {
  errors.push('jira-tickets/agents/openai.yaml muss $jira-tickets im default_prompt nennen.');
}

for (const match of ticketSkill.matchAll(/\]\(([^)]+)\)/g)) {
  const target = match[1];
  if (/^(https?:|#)/.test(target)) continue;
  const path = resolve(dirname(ticketSkillPath), target);
  if (!existsSync(path)) errors.push(`Fehlender Link in ${ticketSkillPath}: ${target}`);
}

const forbiddenPatterns = [
  { pattern: /\bJIRAUSER\d+\b/, label: 'produktive Jira-Benutzer-ID' },
  { pattern: /\bcustomfield_\d+\b/, label: 'produktive Customfield-ID' },
  { pattern: /\b[0-9a-f]{40}\b/i, label: 'tokenähnlicher 40-stelliger Hex-Wert' },
  { pattern: /\b(?:gitlab\.)?partner\.bdr\.de\b/i, label: 'produktive interne Host-Adresse' },
  { pattern: /\bzz-sys-[a-z0-9-]+\b/i, label: 'produktiven Secret-Namen' },
];
for (const { pattern, label } of forbiddenPatterns) {
  if (pattern.test(documentation)) errors.push(`Dokumentation enthält ${label}.`);
}

if (errors.length > 0) {
  for (const error of errors) console.error(`❌ ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    `✅ Skill geprüft: ${lineCount} Zeilen, Frontmatter, Links und Beispiele gültig, `
    + `${Object.keys(KNOWN_COMPONENTS).length} Typen dokumentiert.`,
  );
  console.log('✅ Jira-Ticket-Skill geprüft: Frontmatter, Links, CLI, Referenz und Schutzworkflow gültig.');
}
