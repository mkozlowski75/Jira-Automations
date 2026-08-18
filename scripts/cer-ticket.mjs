#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli as runConfluenceCli } from '../.github/skills/confluence-pages/scripts/confluence-page.mjs';
import {
  jiraGet,
  jiraPost,
  jiraPostMultipart,
  jiraPut,
} from './lib/api-helper.mjs';
import {
  createCerTicketWorkflow,
  digestValue,
  normalizeImageManifest,
  normalizeTicketRequest,
} from './lib/cer-ticket-workflow.mjs';
import { createJiraTicketService } from './lib/ticket-api.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const receiptDirectory = join(repositoryRoot, '.tmp', 'cer-ticket-preflights');
const MAX_PREFLIGHT_AGE_MS = 15 * 60 * 1000;

function usage() {
  return [
    'Usage:',
    '  cer-ticket.mjs metadata --issue-type Story|Bug',
    '  cer-ticket.mjs metadata --issue-key CER-123',
    '  cer-ticket.mjs create --issue-type Story|Bug --request-file <request.json> [--apply --preflight-id <id>]',
    '  cer-ticket.mjs edit <CER-KEY> --request-file <request.json> [--apply --preflight-id <id>]',
    '  cer-ticket.mjs attach-images <CER-KEY> --manifest <images.json> [--apply --preflight-id <id>]',
  ].join('\n');
}

function parseArgs(args) {
  const positional = [];
  const options = {};
  const allowed = new Set([
    'apply',
    'help',
    'issue-key',
    'issue-type',
    'manifest',
    'preflight-id',
    'request-file',
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith('--')) {
      positional.push(argument);
      continue;
    }
    const name = argument.slice(2);
    if (!allowed.has(name)) throw new Error(`Unbekannte Option --${name}.`);
    if (['apply', 'help'].includes(name)) {
      options[name] = true;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Option --${name} benÃ¶tigt einen Wert.`);
    }
    options[name] = value;
    index += 1;
  }
  return { positional, options };
}

async function readJson(path, readText = readFile) {
  if (!path) throw new Error('JSON-Dateipfad fehlt.');
  try {
    return JSON.parse(await readText(path, 'utf8'));
  } catch {
    throw new Error('Datei konnte nicht als UTF-8-JSON gelesen werden.');
  }
}

function assertPreflightId(value) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''))) {
    throw new Error('--apply benÃ¶tigt eine gÃ¼ltige --preflight-id.');
  }
  return value;
}

function assertOnlyOptions(options, allowed) {
  const unexpected = Object.keys(options).filter(name => !allowed.includes(name));
  if (unexpected.length > 0) throw new Error(`Option --${unexpected[0]} ist fÃ¼r diesen Befehl nicht erlaubt.`);
}

function assertApplyPair(options) {
  if (Boolean(options.apply) !== Boolean(options['preflight-id'])) {
    throw new Error('--apply und --preflight-id mÃ¼ssen gemeinsam verwendet werden.');
  }
}

function createReceiptStore(directory = receiptDirectory) {
  const pathFor = preflightId => join(directory, `${assertPreflightId(preflightId)}.json`);
  return {
    async load(preflightId) {
      try {
        return JSON.parse(await readFile(pathFor(preflightId), 'utf8'));
      } catch {
        throw new Error('Kein gÃ¼ltiger, unmittelbar vorheriger Preflight gefunden.');
      }
    },
    async consume(preflightId) {
      await rm(pathFor(preflightId), { force: true });
    },
    async save(receipt) {
      await mkdir(directory, { recursive: true });
      const finalPath = pathFor(receipt.preflightId);
      const temporaryPath = `${finalPath}.${process.pid}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(temporaryPath, finalPath);
    },
  };
}

function assertReceipt(receipt, { preflightId, operation, digest, now }) {
  if (receipt?.preflightId !== preflightId
    || receipt?.operation !== operation
    || receipt?.digest !== digest) {
    throw new Error('Preflight passt nicht zu dieser Operation oder Eingabedatei.');
  }
  const createdAt = Date.parse(receipt.createdAt);
  if (!Number.isFinite(createdAt) || now < createdAt || now - createdAt > MAX_PREFLIGHT_AGE_MS) {
    throw new Error('Preflight ist abgelaufen; bitte erneut ohne --apply ausfÃ¼hren.');
  }
}

function defaultWorkflow() {
  const jiraService = createJiraTicketService({
    get: jiraGet,
    post: jiraPost,
    put: jiraPut,
  });
  return createCerTicketWorkflow({
    jiraService,
    jiraGet,
    jiraPostMultipart,
    readBinary: readFile,
    getConfluencePage: pageId => runConfluenceCli(['get', String(pageId)]),
  });
}

async function runPreflight({ operation, digest, prepare, receipts, now, makeId }) {
  const result = await prepare();
  const preflightId = makeId();
  const receipt = {
    preflightId,
    operation,
    digest,
    createdAt: new Date(now).toISOString(),
    anchor: operation === 'create'
      ? {
        issueTypeId: result.jira.issueType.id,
        reporterName: result.jira.reporter.name,
      }
      : (operation === 'edit'
        ? { expectedUpdated: result.jira.expectedUpdated }
        : {
          expectedUpdated: result.expectedUpdated,
          fileDigest: result.fileDigest,
          existingAttachmentIds: result.existingAttachmentIds,
        }),
  };
  await receipts.save(receipt);
  return { ...result, preflightId, validForMinutes: 15 };
}

async function runApply({ operation, digest, apply, options, receipts, now }) {
  const preflightId = assertPreflightId(options['preflight-id']);
  const receipt = await receipts.load(preflightId);
  assertReceipt(receipt, { preflightId, operation, digest, now });
  await receipts.consume(preflightId);
  return apply(receipt.anchor);
}

async function runCli(args, dependencies = {}) {
  const { positional, options } = parseArgs(args);
  const [command, issueKey, extra] = positional;
  if (options.help || command === 'help') return { usage: usage() };
  if (!command || extra) throw new Error(usage());
  const workflow = dependencies.workflow ?? defaultWorkflow();
  const readText = dependencies.readText ?? readFile;
  const receipts = dependencies.receiptStore ?? createReceiptStore();
  const now = dependencies.now?.() ?? Date.now();
  const makeId = dependencies.randomUUID ?? randomUUID;

  if (command === 'metadata') {
    assertOnlyOptions(options, ['issue-type', 'issue-key']);
    if (options.apply || options['preflight-id'] || issueKey) throw new Error(usage());
    const byType = options['issue-type'];
    const byKey = options['issue-key'];
    if (Boolean(byType) === Boolean(byKey)) throw new Error(usage());
    return byType
      ? workflow.metadataForType(byType)
      : workflow.metadataForIssue(byKey);
  }

  if (command === 'create') {
    assertOnlyOptions(options, ['issue-type', 'request-file', 'apply', 'preflight-id']);
    assertApplyPair(options);
    if (issueKey || !options['issue-type'] || !options['request-file']) throw new Error(usage());
    const request = normalizeTicketRequest(await readJson(options['request-file'], readText));
    const digest = digestValue({ operation: 'create', issueType: options['issue-type'], request });
    if (!options.apply) {
      return runPreflight({
        operation: 'create',
        digest,
        prepare: () => workflow.prepareCreate(options['issue-type'], request),
        receipts,
        now,
        makeId,
      });
    }
    return runApply({
      operation: 'create',
      digest,
      options,
      receipts,
      now,
      apply: anchor => workflow.applyCreate(options['issue-type'], request, anchor),
    });
  }

  if (command === 'edit') {
    assertOnlyOptions(options, ['request-file', 'apply', 'preflight-id']);
    assertApplyPair(options);
    if (!issueKey || !options['request-file'] || options['issue-type']) throw new Error(usage());
    const request = normalizeTicketRequest(await readJson(options['request-file'], readText));
    const digest = digestValue({ operation: 'edit', issueKey, request });
    if (!options.apply) {
      return runPreflight({
        operation: 'edit',
        digest,
        prepare: () => workflow.prepareEdit(issueKey, request),
        receipts,
        now,
        makeId,
      });
    }
    return runApply({
      operation: 'edit',
      digest,
      options,
      receipts,
      now,
      apply: anchor => workflow.applyEdit(issueKey, request, anchor.expectedUpdated),
    });
  }

  if (command === 'attach-images') {
    assertOnlyOptions(options, ['manifest', 'apply', 'preflight-id']);
    assertApplyPair(options);
    if (!issueKey || !options.manifest || options['issue-type'] || options['request-file']) {
      throw new Error(usage());
    }
    const manifest = normalizeImageManifest(await readJson(options.manifest, readText));
    const digest = digestValue({ operation: 'attach-images', issueKey, manifest });
    if (!options.apply) {
      return runPreflight({
        operation: 'attach-images',
        digest,
        prepare: () => workflow.prepareAttachImages(issueKey, manifest),
        receipts,
        now,
        makeId,
      });
    }
    return runApply({
      operation: 'attach-images',
      digest,
      options,
      receipts,
      now,
      apply: anchor => workflow.applyAttachImages(issueKey, manifest, anchor),
    });
  }

  throw new Error(`Unbekannter Befehl "${command}".\n${usage()}`);
}

function safeErrorMessage(error) {
  return String(error?.message || 'Unbekannter Fehler')
    .replace(/https?:\/\/[^\s]+/gi, '[URL]')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/Authorization\s*[:=]\s*\S+/gi, 'Authorization: [REDACTED]');
}

function isMainModule(metaUrl, argvPath) {
  if (!argvPath) return false;
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(argvPath);
  } catch {
    return false;
  }
}

async function main() {
  try {
    console.log(JSON.stringify(await runCli(process.argv.slice(2)), null, 2));
  } catch (error) {
    console.error(`âŒ ${safeErrorMessage(error)}`);
    process.exitCode = 1;
  }
}

if (isMainModule(import.meta.url, process.argv[1])) main();

export {
  MAX_PREFLIGHT_AGE_MS,
  assertReceipt,
  createReceiptStore,
  isMainModule,
  parseArgs,
  readJson,
  runCli,
  safeErrorMessage,
  usage,
};
