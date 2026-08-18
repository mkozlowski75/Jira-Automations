import { createHash, randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';

const PROJECT_KEY = 'CER';
const ISSUE_TYPES = new Set(['Story', 'Bug', 'Task']);
const CEROMA_HOME_PAGE_ID = '21074848';
const USER_ROLES_PAGE = {
  id: '93492170',
  title: 'Nutzerrollen',
};
const TEMPLATE_PAGES = {
  Story: { id: '97796350', title: 'Vorlage fÃ¼r Story-Tickets' },
  Bug: { id: '97796337', title: 'Vorlage fÃ¼r Bug-Tickets' },
  Task: { id: '523437222', title: 'Vorlage für Task-Tickets' },
};
const IMAGE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} muss ein JSON-Objekt sein.`);
  }
}

function assertIssueType(issueType) {
  if (!ISSUE_TYPES.has(issueType)) {
    throw new Error('Vorgangstyp muss Story, Bug oder Task sein.');
  }
  return issueType;
}

function assertCerIssue(metadata) {
  if (metadata?.project?.key !== PROJECT_KEY) {
    throw new Error('Der CER-Ticket-Workflow darf nur das Projekt CER bearbeiten.');
  }
  const issueType = metadata?.issueType?.name;
  assertIssueType(issueType);
  return issueType;
}

function normalizeSources(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('request.sources muss mindestens die verbindlichen Confluence-Seiten enthalten.');
  }
  const seen = new Set();
  return value.map((source, index) => {
    assertPlainObject(source, `request.sources[${index}]`);
    const id = String(source.id || '');
    const version = Number(source.version);
    if (!/^[1-9]\d*$/.test(id) || !Number.isInteger(version) || version < 1) {
      throw new Error('Confluence-Quellen benÃ¶tigen eine positive Seiten-ID und Version.');
    }
    if (seen.has(id)) throw new Error(`Confluence-Seite ${id} ist doppelt angegeben.`);
    seen.add(id);
    return { id, version };
  });
}

function normalizeTicketRequest(value) {
  assertPlainObject(value, 'Die Request-Datei');
  const unexpected = Object.keys(value).filter(key => !['fields', 'sources'].includes(key));
  if (unexpected.length > 0) {
    throw new Error(`Unbekannte Request-Felder: ${unexpected.join(', ')}.`);
  }
  assertPlainObject(value.fields, 'request.fields');
  if (Object.keys(value.fields).length === 0) throw new Error('request.fields darf nicht leer sein.');
  return {
    fields: clone(value.fields),
    sources: normalizeSources(value.sources),
  };
}

function normalizeImageManifest(value) {
  assertPlainObject(value, 'Das Bildmanifest');
  const unexpected = Object.keys(value).filter(key => key !== 'files');
  if (unexpected.length > 0) {
    throw new Error(`Unbekannte Manifest-Felder: ${unexpected.join(', ')}.`);
  }
  if (!Array.isArray(value.files) || value.files.length === 0) {
    throw new Error('manifest.files muss mindestens einen Bildpfad enthalten.');
  }
  const files = value.files.map(file => {
    if (typeof file !== 'string' || !file.trim()) {
      throw new Error('Jeder Bildpfad muss ein nicht leerer String sein.');
    }
    return file;
  });
  if (new Set(files).size !== files.length) throw new Error('Bildpfade dÃ¼rfen nicht doppelt vorkommen.');
  return { files };
}

async function validateSources(issueType, sources, getPage) {
  const type = assertIssueType(issueType);
  const normalized = normalizeSources(sources);
  const templatePage = TEMPLATE_PAGES[type];
  const required = type === 'Task'
    ? [templatePage]
    : [templatePage, USER_ROLES_PAGE];
  const knownPages = [templatePage, USER_ROLES_PAGE];
  for (const page of required) {
    if (!normalized.some(source => source.id === page.id)) {
      throw new Error(`Verbindliche Confluence-Seite ${page.id} fehlt.`);
    }
  }

  const pages = [];
  for (const source of normalized) {
    const page = await getPage(source.id);
    const expected = knownPages.find(candidate => candidate.id === source.id);
    if (page?.id !== source.id || page?.spaceKey !== 'CER' || page?.status !== 'current') {
      throw new Error(`Confluence-Seite ${source.id} ist nicht als aktuelle CER-Seite verfÃ¼gbar.`);
    }
    if (expected && page.title !== expected.title) {
      throw new Error(`Confluence-Seite ${source.id} hat nicht mehr den erwarteten Titel.`);
    }
    const underCeromaHome = source.id === CEROMA_HOME_PAGE_ID
      || (page.ancestors || []).some(ancestor => String(ancestor.id) === CEROMA_HOME_PAGE_ID);
    if (!underCeromaHome) {
      throw new Error(`Confluence-Seite ${source.id} liegt nicht unter Ceroma Home.`);
    }
    if (Number(page.version) !== source.version) {
      throw new Error(`Confluence-Drift erkannt: Seite ${source.id} hat jetzt Version ${page.version}.`);
    }
    pages.push({
      id: source.id,
      title: page.title,
      version: source.version,
    });
  }
  return pages;
}

function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new Error('Bildinhalt muss binÃ¤r vorliegen.');
  if (buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  throw new Error('Nur PNG-, JPEG- und WebP-Bilder sind erlaubt.');
}

async function inspectImage(path, readBinary) {
  const buffer = await readBinary(path);
  const name = basename(path);
  if (!name || /[\r\n\0"]/.test(name)) throw new Error('UngÃ¼ltiger Bilddateiname.');
  const mimeType = detectImageType(buffer);
  const expectedMimeType = IMAGE_TYPES[extname(name).toLowerCase()];
  if (mimeType !== expectedMimeType) {
    throw new Error(`Dateiendung und Bildsignatur stimmen fÃ¼r "${name}" nicht Ã¼berein.`);
  }
  return {
    path,
    name,
    mimeType,
    size: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    buffer,
  };
}

function publicImageInfo(image) {
  return {
    name: image.name,
    mimeType: image.mimeType,
    size: image.size,
    sha256: image.sha256,
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function digestValue(value) {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function imageDigest(images) {
  return digestValue(images.map(publicImageInfo));
}

function asciiFilename(name) {
  const value = name.replace(/[^A-Za-z0-9._-]/g, '_');
  return value || 'image';
}

function buildMultipartBody(images, boundary) {
  const parts = [];
  for (const image of images) {
    const encodedName = encodeURIComponent(image.name).replace(/'/g, '%27');
    parts.push(Buffer.from(
      `--${boundary}\r\n`
      + `Content-Disposition: form-data; name="file"; filename="${asciiFilename(image.name)}"; filename*=UTF-8''${encodedName}\r\n`
      + `Content-Type: ${image.mimeType}\r\n\r\n`,
      'utf8',
    ));
    parts.push(image.buffer);
    parts.push(Buffer.from('\r\n', 'ascii'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, 'ascii'));
  return Buffer.concat(parts);
}

function createCerTicketWorkflow({
  jiraService,
  getConfluencePage,
  jiraGet,
  jiraPostMultipart,
  readBinary,
  createBoundary = () => `CodexBoundary-${randomUUID().replace(/-/g, '')}`,
}) {
  if (!jiraService || !getConfluencePage || !jiraGet || !jiraPostMultipart || !readBinary) {
    throw new Error('CER-Ticket-Workflow ist unvollstÃ¤ndig konfiguriert.');
  }

  async function metadataForType(issueType) {
    return jiraService.getCreateMetadata(PROJECT_KEY, assertIssueType(issueType));
  }

  async function metadataForIssue(issueKey) {
    const metadata = await jiraService.getEditMetadata(issueKey);
    assertCerIssue(metadata);
    return metadata;
  }

  async function prepareCreate(issueType, requestValue) {
    const type = assertIssueType(issueType);
    const request = normalizeTicketRequest(requestValue);
    const sources = await validateSources(type, request.sources, getConfluencePage);
    const reporter = await jiraService.getCurrentUser();
    const jira = await jiraService.prepareCreateWithFields({
      projectKey: PROJECT_KEY,
      issueTypeName: type,
      fields: request.fields,
      reporter,
    });
    return { operation: 'create-cer-ticket', issueType: type, sources, jira, applied: false };
  }

  async function applyCreate(issueType, requestValue, expected) {
    const type = assertIssueType(issueType);
    const request = normalizeTicketRequest(requestValue);
    const sources = await validateSources(type, request.sources, getConfluencePage);
    const reporter = await jiraService.getCurrentUser();
    const jira = await jiraService.applyCreateWithFields({
      projectKey: PROJECT_KEY,
      issueTypeName: type,
      fields: request.fields,
      reporter,
    }, expected);
    return { operation: 'create-cer-ticket', issueType: type, sources, jira, applied: true };
  }

  async function prepareEdit(issueKey, requestValue) {
    const metadata = await metadataForIssue(issueKey);
    const type = assertCerIssue(metadata);
    const request = normalizeTicketRequest(requestValue);
    const sources = await validateSources(type, request.sources, getConfluencePage);
    const jira = await jiraService.prepareEdit(issueKey, request.fields);
    return { operation: 'edit-cer-ticket', issueType: type, sources, jira, applied: false };
  }

  async function applyEdit(issueKey, requestValue, expectedUpdated) {
    const metadata = await metadataForIssue(issueKey);
    const type = assertCerIssue(metadata);
    const request = normalizeTicketRequest(requestValue);
    const sources = await validateSources(type, request.sources, getConfluencePage);
    const jira = await jiraService.applyEdit(issueKey, request.fields, expectedUpdated);
    return { operation: 'edit-cer-ticket', issueType: type, sources, jira, applied: true };
  }

  async function inspectManifest(manifestValue) {
    const manifest = normalizeImageManifest(manifestValue);
    const images = [];
    for (const path of manifest.files) images.push(await inspectImage(path, readBinary));
    const duplicateNames = images
      .map(image => image.name)
      .filter((name, index, names) => names.indexOf(name) !== index);
    if (duplicateNames.length > 0) throw new Error('Bilddateinamen dÃ¼rfen nicht doppelt vorkommen.');
    return images;
  }

  async function prepareAttachImages(issueKey, manifestValue) {
    const metadata = await metadataForIssue(issueKey);
    const issue = await jiraService.getIssue(issueKey, [
      'summary', 'project', 'issuetype', 'updated', 'attachment',
    ]);
    assertCerIssue({ project: issue.fields.project, issueType: issue.fields.issuetype });
    const attachmentMeta = await jiraGet('/attachment/meta');
    if (attachmentMeta?.enabled !== true) throw new Error('Jira-AnhÃ¤nge sind nicht aktiviert.');
    const uploadLimit = Number(attachmentMeta.uploadLimit);
    if (!Number.isFinite(uploadLimit) || uploadLimit < 1) {
      throw new Error('Jira lieferte kein gÃ¼ltiges Upload-Limit.');
    }
    const images = await inspectManifest(manifestValue);
    for (const image of images) {
      if (image.size > uploadLimit) {
        throw new Error(`Bild "${image.name}" Ã¼berschreitet das Jira-Upload-Limit.`);
      }
    }
    if (!issue.fields.updated) throw new Error('Jira lieferte keinen stabilen updated-Wert.');
    const existingAttachmentIds = (issue.fields.attachment || []).map(item => String(item.id));
    return {
      operation: 'attach-cer-images',
      key: metadata.key,
      summary: metadata.summary,
      expectedUpdated: issue.fields.updated,
      uploadLimit,
      existingAttachmentIds,
      images: images.map(publicImageInfo),
      fileDigest: imageDigest(images),
      applied: false,
    };
  }

  async function applyAttachImages(issueKey, manifestValue, expected) {
    const preflight = await prepareAttachImages(issueKey, manifestValue);
    if (preflight.expectedUpdated !== expected?.expectedUpdated
      || preflight.fileDigest !== expected?.fileDigest
      || digestValue(preflight.existingAttachmentIds) !== digestValue(expected?.existingAttachmentIds || [])) {
      throw new Error('Ticket, AnhÃ¤nge oder Bilddateien haben sich seit dem Preflight geÃ¤ndert.');
    }
    const images = await inspectManifest(manifestValue);
    const boundary = createBoundary();
    const body = buildMultipartBody(images, boundary);
    const created = await jiraPostMultipart(
      `/issue/${encodeURIComponent(issueKey)}/attachments`,
      body,
      boundary,
    );
    if (!Array.isArray(created) || created.length !== images.length || created.some(item => !item?.id)) {
      throw new Error('Jira bestÃ¤tigte den Bild-Upload nicht vollstÃ¤ndig.');
    }
    const remote = await jiraService.getIssue(issueKey, ['attachment']);
    const remoteById = new Map((remote.fields.attachment || []).map(item => [String(item.id), item]));
    for (let index = 0; index < created.length; index += 1) {
      const attachment = remoteById.get(String(created[index].id));
      const image = images[index];
      if (!attachment
        || attachment.filename !== image.name
        || Number(attachment.size) !== image.size
        || attachment.mimeType !== image.mimeType) {
        throw new Error(`Remote-Verifikation fÃ¼r Bild "${image.name}" ist fehlgeschlagen.`);
      }
    }
    return {
      ...preflight,
      applied: true,
      attachmentIds: created.map(item => String(item.id)),
      verified: true,
    };
  }

  return {
    metadataForType,
    metadataForIssue,
    prepareCreate,
    applyCreate,
    prepareEdit,
    applyEdit,
    prepareAttachImages,
    applyAttachImages,
  };
}

export {
  CEROMA_HOME_PAGE_ID,
  ISSUE_TYPES,
  PROJECT_KEY,
  TEMPLATE_PAGES,
  USER_ROLES_PAGE,
  assertCerIssue,
  assertIssueType,
  buildMultipartBody,
  createCerTicketWorkflow,
  detectImageType,
  digestValue,
  imageDigest,
  normalizeImageManifest,
  normalizeTicketRequest,
  validateSources,
};
