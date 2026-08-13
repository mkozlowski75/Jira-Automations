import Ajv2020 from 'ajv/dist/2020.js';

export const KNOWN_COMPONENTS = Object.freeze({
  'codebarrel.action.log': { component: 'ACTION', schemaVersion: 1 },
  'com.xiplink.jira.git.jira_git_plugin:pull-request-merged-trigger': { component: 'TRIGGER', schemaVersion: 1 },
  'jira.comparator.condition': { component: 'CONDITION', schemaVersion: 1 },
  'jira.condition.container.block': { component: 'CONDITION', schemaVersion: 1 },
  'jira.condition.if.block': { component: 'CONDITION_BLOCK', schemaVersion: 1 },
  'jira.create.variable': { component: 'ACTION', schemaVersion: 1 },
  'jira.incoming.webhook': { component: 'TRIGGER', schemaVersion: 1 },
  'jira.issue.assign': { component: 'ACTION', schemaVersion: 3 },
  'jira.issue.comment': { component: 'ACTION', schemaVersion: 1 },
  'jira.issue.condition': { component: 'CONDITION', schemaVersion: 3 },
  'jira.issue.create': { component: 'ACTION', schemaVersion: 6 },
  'jira.issue.edit': { component: 'ACTION', schemaVersion: 6 },
  'jira.issue.event.trigger:transitioned': { component: 'TRIGGER', schemaVersion: 1 },
  'jira.issue.link': { component: 'ACTION', schemaVersion: 2 },
  'jira.lookup.issues': { component: 'ACTION', schemaVersion: 1 },
  'jira.issue.outgoing.email': { component: 'ACTION', schemaVersion: 3 },
  'jira.issue.outgoing.webhook': { component: 'ACTION', schemaVersion: 2 },
  'jira.issue.related': { component: 'BRANCH', schemaVersion: 1 },
  'jira.issue.transition': { component: 'ACTION', schemaVersion: 6 },
  'jira.jql.scheduled': { component: 'TRIGGER', schemaVersion: 1 },
  'jira.manual.trigger.issue': { component: 'TRIGGER', schemaVersion: 1 },
  'jira.multiple.issue.event': { component: 'TRIGGER', schemaVersion: 1 },
  'jira.sprint.event.trigger:started': { component: 'TRIGGER', schemaVersion: 1 },
  'jira.version.create': { component: 'ACTION', schemaVersion: 1 },
  'msteams.notification': { component: 'ACTION', schemaVersion: 2 },
});

function issue(file, path, message) {
  return { file, path, message };
}

function formatSchemaError(error) {
  const path = error.instancePath || '/';
  if (error.keyword === 'required') {
    return {
      path,
      message: `Pflichtfeld fehlt: "${error.params.missingProperty}"`,
    };
  }

  return {
    path,
    message: error.message || `Schema-Verstoß (${error.keyword})`,
  };
}

function visitComponent(node, context, parent = null, relation = null, path = '') {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return;

  const { file, errors, warnings, componentIds } = context;

  if (typeof node.id === 'string' && /^\d+$/.test(node.id)) {
    const previous = componentIds.get(node.id);
    if (previous) {
      errors.push(issue(
        file,
        `${path}/id`,
        `Component-ID "${node.id}" ist bereits in ${previous.file} (${previous.path}) vergeben.`,
      ));
    } else {
      componentIds.set(node.id, { file, path });
    }
  }

  if (parent === null) {
    if (node.parentId !== undefined || node.conditionParentId !== undefined) {
      errors.push(issue(file, path, 'Top-Level-Component darf keine Elternreferenz enthalten.'));
    }
  } else if (relation === 'children') {
    if (node.parentId !== parent.id) {
      errors.push(issue(
        file,
        `${path}/parentId`,
        `parentId muss auf die Eltern-Component "${parent.id}" zeigen.`,
      ));
    }
    if (node.conditionParentId !== undefined) {
      errors.push(issue(file, `${path}/conditionParentId`, 'Ein Kind unter children darf keine conditionParentId besitzen.'));
    }
  } else if (relation === 'conditions') {
    if (node.conditionParentId !== parent.id) {
      errors.push(issue(
        file,
        `${path}/conditionParentId`,
        `conditionParentId muss auf den Elternblock "${parent.id}" zeigen.`,
      ));
    }
    if (node.parentId !== undefined) {
      errors.push(issue(file, `${path}/parentId`, 'Eine Condition unter conditions darf keine parentId besitzen.'));
    }
  }

  const known = KNOWN_COMPONENTS[node.type];
  if (!known && typeof node.type === 'string') {
    warnings.push(issue(file, `${path}/type`, `Unbekannter Automation-Typ "${node.type}".`));
  } else if (known) {
    if (node.component !== known.component) {
      errors.push(issue(
        file,
        `${path}/component`,
        `Typ "${node.type}" erwartet component "${known.component}", nicht "${node.component}".`,
      ));
    }
    if (node.schemaVersion !== known.schemaVersion) {
      warnings.push(issue(
        file,
        `${path}/schemaVersion`,
        `Unbekannte Schema-Version ${node.schemaVersion} für "${node.type}" (bekannt: ${known.schemaVersion}).`,
      ));
    }
  }

  if (node.type === 'jira.issue.outgoing.webhook' && Array.isArray(node.value?.headers)) {
    node.value.headers.forEach((header, index) => {
      const name = typeof header?.name === 'string' ? header.name : '';
      if (/(authorization|password|secret|token)/i.test(name) && header?.value?.secret !== true) {
        errors.push(issue(
          file,
          `${path}/value/headers/${index}/value/secret`,
          `Sicherheitsrelevanter Header "${name}" muss als Jira-Secret referenziert werden.`,
        ));
      }
    });
  }

  if (Array.isArray(node.children)) {
    node.children.forEach((child, index) => {
      visitComponent(child, context, node, 'children', `${path}/children/${index}`);
    });
  }

  if (Array.isArray(node.conditions)) {
    node.conditions.forEach((condition, index) => {
      visitComponent(condition, context, node, 'conditions', `${path}/conditions/${index}`);
    });
  }
}

export function createRuleSetValidator(schema) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
  });
  const validateSchema = ajv.compile(schema);

  return function validateRuleSet(entries) {
    const errors = [];
    const warnings = [];
    const ruleIds = new Map();
    const componentIds = new Map();

    for (const { file, rule } of entries) {
      const valid = validateSchema(rule);
      if (!valid) {
        for (const schemaError of validateSchema.errors || []) {
          // Ajv ergänzt bei fehlgeschlagenen then-Zweigen eine redundante if-Meldung.
          if (schemaError.keyword === 'if') continue;
          const formatted = formatSchemaError(schemaError);
          errors.push(issue(file, formatted.path, formatted.message));
        }
      }

      if (!rule || typeof rule !== 'object' || Array.isArray(rule)) continue;

      // Pflichtfelder werden durch das JSON-Schema geprüft.

      if (rule.clientKey !== 'com.codebarrel.tenant.global') {
        errors.push(issue(
          file,
          '/clientKey',
          `Nicht unterstützter clientKey "${rule.clientKey}"; erwartet wird ein Data-Center-Code-Barrel-Export.`,
        ));
      }

      if (Array.isArray(rule.projects)) {
        const projectIds = rule.projects
          .map(project => project?.projectId)
          .filter(projectId => typeof projectId === 'string');
        if (new Set(projectIds).size !== projectIds.length) {
          errors.push(issue(file, '/projects', 'Projekt-Scope enthält doppelte projectId-Werte.'));
        }
      }

      // ID-Format
      const filenameMatch = /^BDR-(\d+)\.json$/.exec(file);
      if (filenameMatch && Number(filenameMatch[1]) !== rule.id) {
        errors.push(issue(
          file,
          '/id',
          `Dateiname erwartet Regel-ID ${Number(filenameMatch[1])}, gefunden wurde ${JSON.stringify(rule.id)}.`,
        ));
      }

      if (Number.isInteger(rule.id)) {
        const previous = ruleIds.get(rule.id);
        if (previous) {
          errors.push(issue(file, '/id', `Regel-ID ${rule.id} ist bereits in ${previous} vergeben.`));
        } else {
          ruleIds.set(rule.id, file);
        }
      }

      // Trigger-Type
      if (rule.trigger && typeof rule.trigger === 'object' && rule.trigger.component !== 'TRIGGER') {
        errors.push(issue(file, '/trigger/component', 'Der Regel-Trigger muss component "TRIGGER" verwenden.'));
      }

      // Action-Types und übrige bekannte Component-Typen
      const context = { file, errors, warnings, componentIds };
      visitComponent(rule.trigger, context, null, null, '/trigger');
      if (Array.isArray(rule.components)) {
        rule.components.forEach((component, index) => {
          if (component && typeof component === 'object' && component.component === 'TRIGGER') {
            errors.push(issue(
              file,
              `/components/${index}/component`,
              'Ein TRIGGER ist nur im Top-Level-Feld trigger zulässig.',
            ));
          }
          visitComponent(component, context, null, null, `/components/${index}`);
        });
      }

      // Generische Vorlagen scheitern bereits an Schema und Pflichtfeldern; keine Sonderbehandlung.
    }

    return { errors, warnings };
  };
}
