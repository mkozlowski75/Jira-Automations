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

const gitlabSkillRoot = join(__dir, '..', '.github', 'skills', 'gitlab-access');
const gitlabSkillPath = join(gitlabSkillRoot, 'SKILL.md');
const gitlabReferencePath = join(gitlabSkillRoot, 'references', 'rest-api.md');
const gitlabScriptPath = join(gitlabSkillRoot, 'scripts', 'gitlab-api.mjs');
const gitlabAgentPath = join(gitlabSkillRoot, 'agents', 'openai.yaml');

const documentationFiles = [
  ...markdownFiles,
  ...readdirSync(examplesDir).map(file => join(examplesDir, file)),
  gitlabSkillPath,
  gitlabReferencePath,
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

const confluenceSkillRoot = join(__dir, '..', '.github', 'skills', 'confluence-pages');
const confluenceSkillPath = join(confluenceSkillRoot, 'SKILL.md');
const confluenceReferencePath = join(confluenceSkillRoot, 'references', 'rest-api.md');
const confluenceScriptPath = join(confluenceSkillRoot, 'scripts', 'confluence-page.mjs');
const confluenceAgentPath = join(confluenceSkillRoot, 'agents', 'openai.yaml');
const confluenceSkill = readFileSync(confluenceSkillPath, 'utf8');
const confluenceReference = readFileSync(confluenceReferencePath, 'utf8');
const confluenceAgent = readFileSync(confluenceAgentPath, 'utf8');
const confluenceFrontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(confluenceSkill);

if (!confluenceFrontmatter) {
  errors.push('confluence-pages/SKILL.md besitzt kein gültiges YAML-Frontmatter.');
} else {
  const fields = [...confluenceFrontmatter[1].matchAll(/^([a-zA-Z][\w-]*):\s*(.+)$/gm)]
    .map(match => ({ name: match[1], value: match[2].trim() }));
  if (fields.map(field => field.name).join(',') !== 'name,description') {
    errors.push('confluence-pages-Frontmatter muss genau name und description enthalten.');
  }
  if (fields.find(field => field.name === 'name')?.value !== 'confluence-pages') {
    errors.push('confluence-pages-Frontmatter-name muss confluence-pages sein.');
  }
}

for (const [label, content] of [
  ['confluence-pages/SKILL.md', confluenceSkill],
  ['confluence-pages/references/rest-api.md', confluenceReference],
  ['confluence-pages/agents/openai.yaml', confluenceAgent],
]) {
  if (content.includes('TODO')) errors.push(`${label} enthält noch TODO-Platzhalter.`);
}

for (const requiredText of [
  '--apply',
  '--expected-version',
  '--expected-absent',
  '/rest/api',
]) {
  if (!confluenceSkill.includes(requiredText)) {
    errors.push(`confluence-pages/SKILL.md dokumentiert "${requiredText}" nicht.`);
  }
}

if (!existsSync(confluenceScriptPath)) {
  errors.push('confluence-pages/scripts/confluence-page.mjs fehlt.');
}
if (!confluenceAgent.includes('$confluence-pages')) {
  errors.push('confluence-pages/agents/openai.yaml muss $confluence-pages im default_prompt nennen.');
}

for (const match of confluenceSkill.matchAll(/\]\(([^)]+)\)/g)) {
  const target = match[1];
  if (/^(https?:|#)/.test(target)) continue;
  const path = resolve(dirname(confluenceSkillPath), target);
  if (!existsSync(path)) errors.push(`Fehlender Link in ${confluenceSkillPath}: ${target}`);
}

const ruleDocumentationSkillRoot = join(__dir, '..', '.github', 'skills', 'jira-rule-documentation');
const ruleDocumentationSkillPath = join(ruleDocumentationSkillRoot, 'SKILL.md');
const ruleDocumentationReferencePath = join(ruleDocumentationSkillRoot, 'references', 'documentation-template.md');
const ruleDocumentationAgentPath = join(ruleDocumentationSkillRoot, 'agents', 'openai.yaml');
const ruleDocumentationSkill = readFileSync(ruleDocumentationSkillPath, 'utf8');
const ruleDocumentationReference = readFileSync(ruleDocumentationReferencePath, 'utf8');
const ruleDocumentationAgent = readFileSync(ruleDocumentationAgentPath, 'utf8');
const ruleDocumentationFrontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(ruleDocumentationSkill);

if (!ruleDocumentationFrontmatter) {
  errors.push('jira-rule-documentation/SKILL.md besitzt kein gültiges YAML-Frontmatter.');
} else {
  const fields = [...ruleDocumentationFrontmatter[1].matchAll(/^([a-zA-Z][\w-]*):\s*(.+)$/gm)]
    .map(match => ({ name: match[1], value: match[2].trim() }));
  if (fields.map(field => field.name).join(',') !== 'name,description') {
    errors.push('jira-rule-documentation-Frontmatter muss genau name und description enthalten.');
  }
  if (fields.find(field => field.name === 'name')?.value !== 'jira-rule-documentation') {
    errors.push('jira-rule-documentation-Frontmatter-name muss jira-rule-documentation sein.');
  }
}

for (const [label, content] of [
  ['jira-rule-documentation/SKILL.md', ruleDocumentationSkill],
  ['jira-rule-documentation/references/documentation-template.md', ruleDocumentationReference],
  ['jira-rule-documentation/agents/openai.yaml', ruleDocumentationAgent],
]) {
  if (content.includes('TODO')) errors.push(`${label} enthält noch TODO-Platzhalter.`);
}

for (const requiredText of [
  'npm run pull-rule',
  'npm run confluence-page',
  '--apply',
  '--expected-version',
]) {
  if (!ruleDocumentationSkill.includes(requiredText)) {
    errors.push(`jira-rule-documentation/SKILL.md dokumentiert "${requiredText}" nicht.`);
  }
}

if (!ruleDocumentationAgent.includes('$jira-rule-documentation')) {
  errors.push('jira-rule-documentation/agents/openai.yaml muss $jira-rule-documentation im default_prompt nennen.');
}

for (const match of ruleDocumentationSkill.matchAll(/\]\(([^)]+)\)/g)) {
  const target = match[1];
  if (/^(https?:|#)/.test(target)) continue;
  const path = resolve(dirname(ruleDocumentationSkillPath), target);
  if (!existsSync(path)) errors.push(`Fehlender Link in ${ruleDocumentationSkillPath}: ${target}`);
}

const gitlabSkill = readFileSync(gitlabSkillPath, 'utf8');
const gitlabReference = readFileSync(gitlabReferencePath, 'utf8');
const gitlabAgent = readFileSync(gitlabAgentPath, 'utf8');
const gitlabFrontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(gitlabSkill);

if (!gitlabFrontmatter) {
  errors.push('gitlab-access/SKILL.md besitzt kein gültiges YAML-Frontmatter.');
} else {
  const fields = [...gitlabFrontmatter[1].matchAll(/^([a-zA-Z][\w-]*):\s*(.+)$/gm)]
    .map(match => ({ name: match[1], value: match[2].trim() }));
  if (fields.map(field => field.name).join(',') !== 'name,description') {
    errors.push('gitlab-access-Frontmatter muss genau name und description enthalten.');
  }
  if (fields.find(field => field.name === 'name')?.value !== 'gitlab-access') {
    errors.push('gitlab-access-Frontmatter-name muss gitlab-access sein.');
  }
}

for (const [label, content] of [
  ['gitlab-access/SKILL.md', gitlabSkill],
  ['gitlab-access/references/rest-api.md', gitlabReference],
  ['gitlab-access/agents/openai.yaml', gitlabAgent],
]) {
  if (content.includes('TODO')) errors.push(`${label} enthält noch TODO-Platzhalter.`);
}

for (const requiredText of [
  'GITLAB_API_TOKEN',
  'CLIENT_CERT_PATH',
  'read-only',
  'npm run gitlab-api',
]) {
  if (!gitlabSkill.includes(requiredText)) {
    errors.push(`gitlab-access/SKILL.md dokumentiert "${requiredText}" nicht.`);
  }
}

if (!existsSync(gitlabScriptPath)) {
  errors.push('gitlab-access/scripts/gitlab-api.mjs fehlt.');
}
if (!gitlabAgent.includes('$gitlab-access')) {
  errors.push('gitlab-access/agents/openai.yaml muss $gitlab-access im default_prompt nennen.');
}

const cveSkillRoot = join(__dir, '..', '.github', 'skills', 'cve-ticket-factory');
const cveSkillPath = join(cveSkillRoot, 'SKILL.md');
const cveAgentPath = join(cveSkillRoot, 'agents', 'openai.yaml');
const cveScriptPath = join(__dir, 'create-cve-ticket.mjs');
const cveExamplePath = join(__dir, '..', 'examples', 'cve-finding.example.json');
const cveSkill = readFileSync(cveSkillPath, 'utf8');
const cveAgent = readFileSync(cveAgentPath, 'utf8');
const cveFrontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(cveSkill);

if (!cveFrontmatter) {
  errors.push('cve-ticket-factory/SKILL.md besitzt kein gültiges YAML-Frontmatter.');
} else {
  const fields = [...cveFrontmatter[1].matchAll(/^([a-zA-Z][\w-]*):\s*(.+)$/gm)]
    .map(match => ({ name: match[1], value: match[2].trim() }));
  if (fields.map(field => field.name).join(',') !== 'name,description') {
    errors.push('cve-ticket-factory-Frontmatter muss genau name und description enthalten.');
  }
  if (fields.find(field => field.name === 'name')?.value !== 'cve-ticket-factory') {
    errors.push('cve-ticket-factory-Frontmatter-name muss cve-ticket-factory sein.');
  }
}

for (const requiredText of [
  '507095421',
  'npm run create-cve-ticket',
  '--apply',
  '--preflight-id',
  'ausdrücklich',
]) {
  if (!cveSkill.includes(requiredText)) {
    errors.push(`cve-ticket-factory/SKILL.md dokumentiert "${requiredText}" nicht.`);
  }
}

for (const path of [cveScriptPath, cveExamplePath]) {
  if (!existsSync(path)) errors.push(`CVE-Ticket-Factory-Datei fehlt: ${path}`);
}
if (!cveAgent.includes('$cve-ticket-factory')) {
  errors.push('cve-ticket-factory/agents/openai.yaml muss $cve-ticket-factory im default_prompt nennen.');
}
try {
  JSON.parse(readFileSync(cveExamplePath, 'utf8'));
} catch (error) {
  errors.push(`Ungültiges JSON in examples/cve-finding.example.json: ${error.message}`);
}
for (const match of cveSkill.matchAll(/\]\(([^)]+)\)/g)) {
  const target = match[1];
  if (/^(https?:|#)/.test(target)) continue;
  const path = resolve(dirname(cveSkillPath), target);
  if (!existsSync(path)) errors.push(`Fehlender Link in ${cveSkillPath}: ${target}`);
}

const cerTicketSkillRoot = join(__dir, '..', '.github', 'skills', 'cer-jira-tickets');
const cerTicketSkillPath = join(cerTicketSkillRoot, 'SKILL.md');
const cerTicketReferencePath = join(cerTicketSkillRoot, 'references', 'request-contract.md');
const cerTicketAgentPath = join(cerTicketSkillRoot, 'agents', 'openai.yaml');
const cerTicketScriptPath = join(__dir, 'cer-ticket.mjs');
const cerTicketWorkflowPath = join(__dir, 'lib', 'cer-ticket-workflow.mjs');
const cerTicketSkill = readFileSync(cerTicketSkillPath, 'utf8');
const cerTicketReference = readFileSync(cerTicketReferencePath, 'utf8');
const cerTicketAgent = readFileSync(cerTicketAgentPath, 'utf8');
const cerTicketFrontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(cerTicketSkill);

if (!cerTicketFrontmatter) {
  errors.push('cer-jira-tickets/SKILL.md besitzt kein gÃ¼ltiges YAML-Frontmatter.');
} else {
  const fields = [...cerTicketFrontmatter[1].matchAll(/^([a-zA-Z][\w-]*):\s*(.+)$/gm)]
    .map(match => ({ name: match[1], value: match[2].trim() }));
  if (fields.map(field => field.name).join(',') !== 'name,description') {
    errors.push('cer-jira-tickets-Frontmatter muss genau name und description enthalten.');
  }
  if (fields.find(field => field.name === 'name')?.value !== 'cer-jira-tickets') {
    errors.push('cer-jira-tickets-Frontmatter-name muss cer-jira-tickets sein.');
  }
}

for (const [label, content] of [
  ['cer-jira-tickets/SKILL.md', cerTicketSkill],
  ['cer-jira-tickets/references/request-contract.md', cerTicketReference],
  ['cer-jira-tickets/agents/openai.yaml', cerTicketAgent],
]) {
  if (content.includes('TODO')) errors.push(`${label} enthÃ¤lt noch TODO-Platzhalter.`);
}
for (const requiredText of [
  '97796350',
  '97796337',
  '93492170',
  '21074848',
  'npm run cer-ticket',
  '--preflight-id',
  'attach-images',
]) {
  if (!cerTicketSkill.includes(requiredText)) {
    errors.push(`cer-jira-tickets/SKILL.md dokumentiert "${requiredText}" nicht.`);
  }
}
for (const path of [cerTicketScriptPath, cerTicketWorkflowPath]) {
  if (!existsSync(path)) errors.push(`CER-Ticket-Workflow-Datei fehlt: ${path}`);
}
if (!cerTicketAgent.includes('$cer-jira-tickets')) {
  errors.push('cer-jira-tickets/agents/openai.yaml muss $cer-jira-tickets im default_prompt nennen.');
}
for (const markdownFile of [cerTicketSkillPath, cerTicketReferencePath]) {
  const markdown = readFileSync(markdownFile, 'utf8');
  for (const match of markdown.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (/^(https?:|#)/.test(target)) continue;
    const path = resolve(dirname(markdownFile), target);
    if (!existsSync(path)) errors.push(`Fehlender Link in ${markdownFile}: ${target}`);
  }
}

for (const match of gitlabSkill.matchAll(/\]\(([^)]+)\)/g)) {
  const target = match[1];
  if (/^(https?:|#)/.test(target)) continue;
  const path = resolve(dirname(gitlabSkillPath), target);
  if (!existsSync(path)) errors.push(`Fehlender Link in ${gitlabSkillPath}: ${target}`);
}

const forbiddenPatterns = [
  { pattern: /\bJIRAUSER\d+\b/, label: 'produktive Jira-Benutzer-ID' },
  { pattern: /\bcustomfield_\d+\b/, label: 'produktive Customfield-ID' },
  { pattern: /\b[0-9a-f]{40}\b/i, label: 'tokenähnlicher 40-stelliger Hex-Wert' },
  { pattern: /\b(?:gitlab\.)?partner\.bdr\.de\b/i, label: 'produktive interne Host-Adresse' },
  { pattern: /\bzz-sys-[a-z0-9-]+\b/i, label: 'produktiven Secret-Namen' },
];
const checkedDocumentation = [
  documentation,
  ticketSkill,
  ticketReference,
  ticketAgent,
  confluenceSkill,
  confluenceReference,
  confluenceAgent,
  ruleDocumentationSkill,
  ruleDocumentationReference,
  ruleDocumentationAgent,
  cveSkill,
  cveAgent,
  cerTicketSkill,
  cerTicketReference,
  cerTicketAgent,
].join('\n');
for (const { pattern, label } of forbiddenPatterns) {
  if (pattern.test(checkedDocumentation)) errors.push(`Dokumentation enthält ${label}.`);
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
  console.log('✅ GitLab-Skill geprüft: Frontmatter, Links, CLI, Referenz und read-only Schutz gültig.');
  console.log('✅ Confluence-Skill geprüft: Frontmatter, Links, CLI, Referenz und Schutzworkflow gültig.');
  console.log('✅ Jira-Regeldokumentations-Skill geprüft: Frontmatter, Vorlage, Links und Schutzworkflow gültig.');
  console.log('✅ CVE-Ticket-Factory-Skill geprüft: Frontmatter, CLI, Beispiel und Freigabeworkflow gültig.');
  console.log('✅ CER-Jira-Ticket-Skill geprüft: Live-Quellen, CLI, Referenz und Freigabeworkflow gültig.');
}
