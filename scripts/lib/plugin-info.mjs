/**
 * Extrahiert Automation-for-Jira-Metadaten aus einer UPM-Antwort.
 * Diese Funktion ist rein lokal und lädt keine Verbindungsdaten.
 */
export function findAutomationPluginInfo(response) {
  const plugins = Array.isArray(response)
    ? response
    : Array.isArray(response?.plugins)
      ? response.plugins
      : [];
  const plugin = plugins.find(candidate => {
    const identity = [
      candidate?.key,
      candidate?.name,
      candidate?.description,
    ].filter(value => typeof value === 'string').join(' ');
    return /(automation\s+for\s+jira|code\s*barrel|codebarrel)/i.test(identity);
  });
  if (!plugin) return null;

  const version = [
    plugin.version,
    plugin.versionName,
    plugin.pluginVersion,
  ].find(value => typeof value === 'string' || typeof value === 'number');
  const build = [
    plugin.buildNumber,
    plugin.versionBuildNumber,
    plugin.pluginBuildNumber,
  ].find(value => typeof value === 'string' || typeof value === 'number');

  return {
    key: typeof plugin.key === 'string' ? plugin.key : null,
    version: version === undefined ? null : String(version),
    build: build === undefined ? null : String(build),
  };
}
