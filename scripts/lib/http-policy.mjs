/**
 * Prüft Redirects, bevor Authentifizierungsheader weiterverwendet werden.
 */
export function resolveSafeRedirect(method, currentUrl, location, redirectCount) {
  if (redirectCount >= 5) throw new Error('Zu viele HTTP-Redirects.');
  if (!['GET', 'HEAD'].includes(method)) {
    throw new Error('HTTP-Redirect bei Schreibzugriff blockiert.');
  }

  const current = new URL(currentUrl);
  const target = new URL(location, current);
  if (target.origin !== current.origin) {
    throw new Error('Cross-origin HTTP-Redirect blockiert.');
  }
  return target.toString();
}
