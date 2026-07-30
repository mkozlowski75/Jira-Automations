---
name: gitlab-access
description: 'GitLab Self-Managed über die vorhandene REST-API mit Token und mTLS-Zertifikat sicher und read-only untersuchen. Use when: GitLab-Zugriff prüfen, angemeldeten Benutzer anzeigen, Projekte suchen, Projektinformationen lesen, Branches oder Merge Requests auflisten sowie Pipelines und deren Jobs analysieren.'
---

# GitLab Access

## Grundregeln

Verwende das gebündelte Skript `scripts/gitlab-api.mjs`. Es lädt
`GITLAB_BASE_URL`, `GITLAB_API_TOKEN`, `GITLAB_DEFAULT_GROUP`,
`CLIENT_CERT_PATH` und optional `CLIENT_CERT_PASSPHRASE` aus
`config/.env`. Öffne weder die `.env`-Datei noch das Zertifikat. Zeige niemals
Token, Passphrase, Request-Header oder ungefilterte API-Antworten.

Der Skill ist ausschließlich read-only. Verwende ihn nicht für POST-, PUT-,
PATCH- oder DELETE-Aufrufe. Nimm insbesondere keine Änderungen an Projekten,
Branches, Merge Requests, Pipelines, Jobs, Variablen oder Mitgliedschaften vor.

Lies [REST-Endpunkte und Ausgabe](references/rest-api.md), wenn du Parameter,
Projektbezeichner oder die normalisierte Ausgabe beurteilen musst.

## Verbindung prüfen

Prüfe den Zugriff zuerst mit:

```powershell
npm run gitlab-api -- user
```

Melde nur Benutzer-ID, Benutzername, Anzeigename, Status und Web-URL. Stoppe bei
TLS-, Authentifizierungs-, Berechtigungs- oder Konfigurationsfehlern. Deaktiviere
die Zertifikatsprüfung niemals und ersetze das Client-Zertifikat nicht durch
eine unsichere Umgehung.

## Projekte lesen

```powershell
npm run gitlab-api -- projects
npm run gitlab-api -- projects --search "service"
npm run gitlab-api -- project <Projekt-ID-oder-Pfad>
npm run gitlab-api -- branches <Projekt-ID-oder-Pfad> --search "feature/"
```

Ohne `--search` werden höchstens 20 Einträge ausgegeben. Erhöhe den Wert nur
bei Bedarf mit `--max-results`; erlaubt sind maximal 100. Verwende eine
numerische Projekt-ID, wenn sie bekannt ist. Übergib alternativ den vollständigen
Namespace-Pfad; das Skript kodiert ihn für den API-Aufruf.

## Merge Requests analysieren

```powershell
npm run gitlab-api -- merge-requests <Projekt> --state opened
npm run gitlab-api -- merge-requests <Projekt> --search "TICKET-123"
npm run gitlab-api -- merge-request <Projekt> <IID>
```

Verwende bei einem einzelnen Merge Request die projektinterne IID, nicht die
globale Datenbank-ID. Fasse Status, Quell- und Zielbranch, Autor, Assignees,
Merge-Status, Aktualisierungszeit und Web-URL zusammen. Rate keine Projekt-ID
oder IID.

## Pipelines und Jobs analysieren

```powershell
npm run gitlab-api -- pipelines <Projekt>
npm run gitlab-api -- pipelines <Projekt> --ref "develop" --status failed
npm run gitlab-api -- jobs <Projekt> <Pipeline-ID>
```

Grenze Pipeline-Suchen mit `--ref` oder `--status` ein, wenn der Benutzer einen
konkreten Lauf meint. Das Skript gibt nur normalisierte Metadaten aus und lädt
weder Job-Traces noch Artefakte, da diese sensible Inhalte enthalten können.

## Ergebnisse behandeln

- Begrenze die Abfrage auf den Benutzerauftrag.
- Berichte konkrete IDs, Namen, Statuswerte und Web-URLs aus der normalisierten
  Ausgabe.
- Kennzeichne leere Ergebnisse als leere Treffermenge, nicht als Zugriffsfehler.
- Gib bei Fehlern nur die redigierte Fehlermeldung aus.
- Erfinde keine Projekte, Gruppen, Branches, Merge Requests oder Pipeline-IDs.
- Verwende `GITLAB_DEFAULT_GROUP` automatisch nur für die Projektliste; ein
  expliziter Projektbezeichner hat Vorrang.
