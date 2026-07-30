import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { relative, resolve, sep } from 'node:path';
import { createRuleSetValidator } from './rule-validation.mjs';

export function parseJsonFile(path) {
  const raw = readFileSync(path, 'utf8');
  // Strip BOM if present
  return JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw);
}

export function writeJsonFile(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function loadRuleEntries(rulesDir) {
  return readdirSync(rulesDir)
    .filter(file => /^BDR-\d+\.json$/.test(file))
    .sort((left, right) => left.localeCompare(right, 'de', { numeric: true }))
    .map(file => ({
      file,
      rule: parseJsonFile(resolve(rulesDir, file)),
    }));
}

export function validateCandidateRule({ rulesDir, schema, file, rule }) {
  const entries = loadRuleEntries(rulesDir)
    .filter(entry => entry.file !== file);
  entries.push({ file, rule });
  return createRuleSetValidator(schema)(entries);
}

export function resolveTrackedRuleFile(repositoryRoot, inputPath) {
  const absolutePath = resolve(repositoryRoot, inputPath);
  const rulesRoot = resolve(repositoryRoot, 'rules');
  const relativeToRules = relative(rulesRoot, absolutePath);
  if (
    relativeToRules.startsWith(`..${sep}`)
    || relativeToRules === '..'
    || !/^BDR-\d+\.json$/.test(relativeToRules)
  ) {
    throw new Error('Es sind ausschließlich rules/BDR-{id}.json-Dateien zulässig.');
  }
  return {
    absolutePath,
    file: relativeToRules,
    repositoryPath: relative(repositoryRoot, absolutePath).split(sep).join('/'),
  };
}

function resolveBackupFile(repositoryRoot, inputPath) {
  const absolutePath = resolve(repositoryRoot, inputPath);
  const backupsRoot = resolve(repositoryRoot, 'backups');
  const relativePath = relative(backupsRoot, absolutePath);
  if (
    relativePath.startsWith(`..${sep}`)
    || relativePath === '..'
    || !/^BDR-\d+[\\/].+\.server\.json$/.test(relativePath)
  ) {
    throw new Error('Es sind ausschließlich backups/BDR-{id}/*.server.json-Dateien zulässig.');
  }
  return absolutePath;
}

export function loadBackupRule(repositoryRoot, inputPath) {
  const absolutePath = resolveBackupFile(repositoryRoot, inputPath);
  const relativePath = relative(resolve(repositoryRoot, 'backups'), absolutePath);
  const expectedRuleId = Number(/^BDR-(\d+)[\\/]/.exec(relativePath)?.[1]);
  const rule = parseJsonFile(absolutePath);
  if (!Number.isInteger(rule?.id) || rule.id !== expectedRuleId) {
    throw new Error('Backup-Inhalt und BDR-{id}-Ordner stimmen nicht überein.');
  }
  return { absolutePath, rule };
}

export function loadGitHeadRule(repositoryRoot, repositoryPath) {
  try {
    const raw = execFileSync(
      'git',
      ['show', `HEAD:${repositoryPath}`],
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
