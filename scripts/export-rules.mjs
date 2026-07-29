/**
 * Exportiert Jira-Issues eines Projekts als strukturiertes JSON.
 * Nützlich für Reporting und Metriken.
 *
 * Usage: node scripts/export-rules.mjs <PROJECT_KEY>
 *
 * Voraussetzung:
 *   config/.env mit JIRA_BASE_URL, JIRA_API_PATH, JIRA_USER_EMAIL,
 *   JIRA_PERSONAL_ACCESS_TOKEN, CLIENT_CERT_PATH, CLIENT_CERT_PASSPHRASE
 */
import { jiraGet } from './lib/api-helper.mjs';

const projectKey = process.argv[2] || process.env.JIRA_DEFAULT_PROJECT || 'BDR';

async function searchIssues(jql, fields = 'summary,status,assignee,created,updated,labels') {
  const issues = [];
  let startAt = 0;
  const maxResults = 100;

  while (true) {
    const data = await jiraGet(
      `/search?jql=${encodeURIComponent(jql)}&fields=${fields}&startAt=${startAt}&maxResults=${maxResults}`
    );
    issues.push(...data.issues);
    if (issues.length >= data.total) break;
    startAt += maxResults;
  }
  return issues;
}

async function main() {
  console.log(`📊 Exportiere Issues für Projekt "${projectKey}" …\n`);

  const issues = await searchIssues(`project = ${projectKey} ORDER BY created DESC`);

  const summary = issues.map(i => ({
    key: i.key,
    summary: i.fields.summary,
    status: i.fields.status?.name,
    assignee: i.fields.assignee?.displayName || 'Unassigned',
    created: i.fields.created,
    updated: i.fields.updated,
    labels: i.fields.labels || [],
  }));

  console.log(JSON.stringify({ project: projectKey, total: issues.length, issues: summary }, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });
