# GitLab-REST-Endpunkte und Ausgabe

## Konfiguration

Das Skript lädt die Konfiguration ausschließlich aus `config/.env`:

- `GITLAB_BASE_URL`: HTTPS-URL des GitLab-Servers oder URL mit Suffix `/api/v4`
- `GITLAB_API_TOKEN`: Access Token für den Header `PRIVATE-TOKEN`
- `GITLAB_DEFAULT_GROUP`: optionaler Gruppenpfad für `projects`
- `CLIENT_CERT_PATH`: Pfad zu einem PKCS#12-Zertifikat (`.pfx` oder `.p12`)
- `CLIENT_CERT_PASSPHRASE`: optionale Passphrase
- `SERVER_CA_PATH`: optionale zusätzliche Server-CA

Relative Zertifikats- und CA-Pfade werden relativ zum Repository aufgelöst. Die
TLS-Zertifikatsprüfung bleibt immer aktiviert.

## Befehle und Endpunkte

| Befehl | GET-Endpunkt |
| --- | --- |
| `user` | `/user` |
| `projects` | `/groups/:group/projects` oder `/projects?membership=true` |
| `project <Projekt>` | `/projects/:id` |
| `members <Projekt>` | `/projects/:id/members/all` |
| `branches <Projekt>` | `/projects/:id/repository/branches` |
| `repository-tree <Projekt>` | `/projects/:id/repository/tree` |
| `repository-file <Projekt> <Dateipfad>` | `/projects/:id/repository/files/:file_path` |
| `merge-requests <Projekt>` | `/projects/:id/merge_requests` |
| `merge-request <Projekt> <IID>` | `/projects/:id/merge_requests/:iid` |
| `pipelines <Projekt>` | `/projects/:id/pipelines` |
| `jobs <Projekt> <Pipeline-ID>` | `/projects/:id/pipelines/:pipeline_id/jobs` |

`<Projekt>` darf eine numerische ID oder ein vollständiger Namespace-Pfad sein.
Listen verwenden `per_page` und geben höchstens den mit `--max-results`
angeforderten Umfang aus.

## Optionen

- `--search <Text>`: Projekte, Branches oder Merge Requests filtern
- `--state opened|closed|merged|locked|all`: Merge Requests filtern
- `--ref <Branch-oder-Tag>`: Pipelines nach Ref filtern
- `--path <Repository-Pfad>`: Repository-Baum auf einen Ordner begrenzen
- `--status <Status>`: Pipelines nach Status filtern
- `--max-results <1..100>`: maximale Listengröße, Standard 20

## Normalisierung

Die CLI gibt nur ausgewählte Felder aus. Unter anderem werden Token, Header,
vollständige Benutzerprofile, Berechtigungsstrukturen, Repository-Statistiken,
Commit-Nachrichten, Job-Traces und Artefakte nicht ausgegeben.

`members` gibt ausschließlich Benutzer-ID, Benutzername, Anzeigename,
GitLab-Zugriffsstufe, Status und Profil-URL aus. E-Mail-Adressen und weitere
Profildaten werden nicht ausgegeben.

`repository-file` gibt ausschließlich explizit angeforderte, UTF-8-lesbare
Repository-Dateien bis 1 MiB aus. Binärdateien werden abgewiesen.

Fehlertexte redigieren URLs, Token-Header und tokenähnliche Werte. Eine
ungefilterte Serverantwort darf auch im Fehlerfall nicht an den Benutzer
weitergegeben werden.
