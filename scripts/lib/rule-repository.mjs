import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { relative, resolve, sep } from 'node:path';
import { createRuleSetValidator } from './rule-validation.mjs';

export function resolveRulesDir(repositoryRoot) {
  const candidates = [
    resolve(repositoryRoot, 'rules'),
    resolve(repositoryRoot, '..', 'jira-automation-rules', 'rules'),
  ];
  return candidates.find(candidate => existsSync(candidate)) ?? candidates[0];
}

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
    .filter(file => /^(?:BDR-|CER-jira-rule-)\d+\.json$/.test(file))
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
  const rulesRoot = resolveRulesDir(repositoryRoot);
  const trimmedPath = String(inputPath || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^rules\//, '')
    .replace(/^\.\.\/jira-automation-rules\/rules\//, '');
  const absolutePath = resolve(rulesRoot, trimmedPath);
  const relativeToRules = relative(rulesRoot, absolutePath);
  if (
    relativeToRules.startsWith(`..${sep}`)
    || relativeToRules === '..'
    || !/^(?:BDR-|CER-jira-rule-)\d+\.json$/.test(relativeToRules)
  ) {
    throw new Error('Es sind ausschließlich rules/BDR-{id}.json- oder rules/CER-jira-rule-{id}.json-Dateien zulässig.');
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
  const absolutePath = resolve(repositoryRoot, repositoryPath);
  const rulesRoot = resolveRulesDir(repositoryRoot);
  const candidateRepoRoots = [
    repositoryRoot,
    resolve(repositoryRoot, '..', 'jira-automation-rules'),
  ];
  const repoRoot = candidateRepoRoots.find(candidate => {
    const rootPath = resolve(candidate);
    return absolutePath === rootPath || absolutePath.startsWith(`${rootPath}${sep}`);
  }) || repositoryRoot;
  const relativePath = relative(repoRoot, absolutePath).split(sep).join('/');
  if (!relativePath || relativePath.startsWith('..')) {
    return null;
  }

  try {
    const raw = execFileSync(
      'git',
      ['show', `HEAD:${relativePath}`],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
