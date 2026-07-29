import {
  jiraConfig,
  jiraGet,
  jiraRawGet,
  jiraRawPut,
} from './api-helper.mjs';
import { findAutomationPluginInfo } from './plugin-info.mjs';

function automationRuleUrl(rule) {
  return `${automationRulesUrl(rule)}/${rule.id}`;
}

function automationRulesUrl(rule) {
  if (!Number.isInteger(rule?.id) || rule.id < 1) {
    throw new Error('Die Regel besitzt keine gültige numerische ID.');
  }
  if (!Array.isArray(rule.projects) || rule.projects.length !== 1) {
    throw new Error('Die Automation-API benötigt genau einen Projekt-Scope.');
  }

  const projectId = rule.projects[0]?.projectId;
  if (typeof projectId !== 'string' || !/^\d+$/.test(projectId)) {
    throw new Error('Die Regel besitzt keine gültige numerische projectId.');
  }

  const { base } = jiraConfig();
  if (!base) throw new Error('JIRA_BASE_URL ist nicht konfiguriert.');
  return `${base}/jira/rest/cb-automation/latest/project/${projectId}/rule`;
}

export async function fetchAutomationRule(rule) {
  const rules = await fetchAutomationRules(rule);
  const match = rules.find(candidate => Number(candidate?.id) === rule.id);
  if (!match) throw new Error(`Regel ${rule.id} wurde im Automation-Listenendpunkt nicht gefunden.`);
  return match;
}

export async function fetchAutomationRules(rule) {
  const response = await jiraRawGet(automationRulesUrl(rule));
  const rules = Array.isArray(response) ? response : response?.values;
  if (!Array.isArray(rules)) {
    throw new Error('Automation-Listenendpunkt lieferte kein unterstütztes Regelarray.');
  }
  return rules;
}

export async function putAutomationRule(rule) {
  return jiraRawPut(automationRuleUrl(rule), rule);
}

export async function inspectJiraEnvironment(rule) {
  let serverInfo = null;
  let automationPlugin = null;
  let serverInfoStatus = 'ok';
  let automationApiStatus = 'ok';
  let automationPluginStatus = 'ok';

  try {
    serverInfo = await jiraGet('/serverInfo');
  } catch (error) {
    serverInfoStatus = safeFailureStatus(error);
  }

  try {
    await fetchAutomationRule(rule);
  } catch (error) {
    automationApiStatus = safeFailureStatus(error);
  }

  try {
    const { base } = jiraConfig();
    if (!base) throw new Error('JIRA_BASE_URL ist nicht konfiguriert.');
    const installedPlugins = await jiraRawGet(
      `${base}/jira/rest/plugins/1.0/?os_authType=basic`,
      { Accept: 'application/vnd.atl.plugins.installed+json' },
    );
    automationPlugin = findAutomationPluginInfo(installedPlugins);
    if (!automationPlugin) automationPluginStatus = 'nicht in UPM-Antwort gefunden';
  } catch (error) {
    automationPluginStatus = safeFailureStatus(error);
  }

  return {
    jiraVersion: serverInfo?.version || null,
    jiraBuildNumber: serverInfo?.buildNumber || null,
    serverInfoStatus,
    automationApiVerified: automationApiStatus === 'ok',
    automationApiStatus,
    automationPluginVersion: automationPlugin?.version || null,
    automationPluginBuild: automationPlugin?.build || null,
    automationPluginKey: automationPlugin?.key || null,
    automationPluginStatus,
  };
}

function safeFailureStatus(error) {
  const message = String(error?.message || '');
  const httpStatus = /→\s*(\d{3})/.exec(message)?.[1];
  if (httpStatus) return `HTTP ${httpStatus}`;
  if (typeof error?.code === 'string') return error.code;
  return 'Netzwerk- oder Berechtigungsfehler';
}
