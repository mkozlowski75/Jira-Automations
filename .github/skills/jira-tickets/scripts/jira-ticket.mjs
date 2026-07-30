#!/usr/bin/env node
/**
 * Deterministische CLI für den Jira-Ticket-Skill.
 * Ohne --apply führen alle Änderungsbefehle ausschließlich einen Preflight aus.
 */
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  jiraGet,
  jiraPost,
  jiraPut,
} from '../../../../scripts/lib/api-helper.mjs';
import { createJiraTicketService } from '../../../../scripts/lib/ticket-api.mjs';

function usage() {
  return [
    'Usage:',
    '  jira-ticket.mjs get <KEY> [--fields a,b]',
    '  jira-ticket.mjs search --jql <JQL> [--max-results 20] [--fields a,b]',
    '  jira-ticket.mjs transitions <KEY>',
    '  jira-ticket.mjs comment <KEY> --body-file <path> [--apply --expected-updated <value>]',
    '  jira-ticket.mjs edit <KEY> --fields-file <path> [--apply --expected-updated <value>]',
    '  jira-ticket.mjs transition <KEY> --transition-id <id> [--fields-file <path>] [--apply --expected-updated <value>]',
  ].join('\n');
}

function parseArgs(args) {
  const positional = [];
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith('--')) {
      positional.push(argument);
      continue;
    }
    const name = argument.slice(2);
    if (name === 'apply' || name === 'help') {
      options[name] = true;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Option --${name} benötigt einen Wert.`);
    }
    options[name] = value;
    index += 1;
  }
  return { positional, options };
}

function parseFieldsOption(value) {
  if (!value) return undefined;
  const fields = value.split(',').map(field => field.trim()).filter(Boolean);
  if (fields.length === 0) throw new Error('--fields darf nicht leer sein.');
  return fields;
}

async function readJsonObject(path, readText) {
  if (!path) return {};
  let value;
  try {
    value = JSON.parse(await readText(path, 'utf8'));
  } catch {
    throw new Error('Felddatei konnte nicht als JSON gelesen werden.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Felddatei muss ein JSON-Objekt enthalten.');
  }
  return value;
}

function safeErrorMessage(error) {
  return String(error?.message || 'Unbekannter Fehler')
    .replace(/https?:\/\/[^\s]+/gi, '[URL]')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]');
}

function isMainModule(metaUrl, argvPath) {
  if (!argvPath) return false;
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(argvPath);
  } catch {
    return false;
  }
}

export async function runCli(
  args,
  {
    service = createJiraTicketService({
      get: jiraGet,
      post: jiraPost,
      put: jiraPut,
    }),
    readText = readFile,
  } = {},
) {
  const { positional, options } = parseArgs(args);
  const [command, issueKey] = positional;
  if (options.help || command === 'help') return { usage: usage() };
  if (!command) throw new Error(usage());

  if (command === 'get') {
    if (!issueKey) throw new Error(usage());
    return service.getIssue(issueKey, parseFieldsOption(options.fields));
  }

  if (command === 'search') {
    const maxResults = options['max-results'] === undefined
      ? 20
      : Number(options['max-results']);
    return service.searchIssues({
      jql: options.jql,
      maxResults,
      fields: parseFieldsOption(options.fields),
    });
  }

  if (command === 'transitions') {
    if (!issueKey) throw new Error(usage());
    return service.getTransitions(issueKey);
  }

  if (command === 'comment') {
    if (!issueKey || !options['body-file']) throw new Error(usage());
    const body = await readText(options['body-file'], 'utf8');
    return options.apply
      ? service.applyComment(issueKey, body, options['expected-updated'])
      : service.prepareComment(issueKey, body);
  }

  if (command === 'edit') {
    if (!issueKey || !options['fields-file']) throw new Error(usage());
    const fields = await readJsonObject(options['fields-file'], readText);
    return options.apply
      ? service.applyEdit(issueKey, fields, options['expected-updated'])
      : service.prepareEdit(issueKey, fields);
  }

  if (command === 'transition') {
    if (!issueKey || !options['transition-id']) throw new Error(usage());
    const fields = await readJsonObject(options['fields-file'], readText);
    return options.apply
      ? service.applyTransition(
        issueKey,
        options['transition-id'],
        fields,
        options['expected-updated'],
      )
      : service.prepareTransition(issueKey, options['transition-id'], fields);
  }

  throw new Error(`Unbekannter Befehl "${command}".\n${usage()}`);
}

async function main() {
  try {
    const result = await runCli(process.argv.slice(2));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`❌ ${safeErrorMessage(error)}`);
    process.exitCode = 1;
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  main();
}

export {
  isMainModule,
  parseArgs,
  safeErrorMessage,
};
