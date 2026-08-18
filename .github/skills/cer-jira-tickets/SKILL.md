---
name: cer-jira-tickets
description: 'Erstellt und Ã¼berarbeitet Storys, Bugs und Tasks im Jira-Projekt CER anhand der bei jedem Auftrag live gelesenen Confluence-Vorlagen, bei Bedarf der Nutzerrollen, Ceroma-Dokumentation und relevanten bestehenden Tickets. Use when: CER-Story, CER-Bug oder CER-Task formulieren, prÃ¼fen, auf die aktuelle Vorlage bringen, ZusammenhÃ¤nge oder Duplikate recherchieren, nach konkreter Freigabe in Jira anlegen beziehungsweise Ã¤ndern oder zugehÃ¶rige Bilder hochladen.'
---

# CER Jira-Tickets

## Verbindliche Werkzeuge und Grenzen

Verwende `npm run cer-ticket` fÃ¼r Metadaten, Create, Edit und BildanhÃ¤nge.
Befolge auÃŸerdem [`jira-tickets`](../jira-tickets/SKILL.md) und
[`confluence-pages`](../confluence-pages/SKILL.md). Nutze ausschlieÃŸlich deren
vorhandene PAT-, mTLS- und CA-Verbindung. Ã–ffne niemals `config/.env`, Tokens,
Passphrasen oder Zertifikate.

Schreibe ausschlieÃŸlich Storys, Bugs und Tasks im Projekt `CER`. Lies andere
CER-Tickets nur als Kontext. Erstelle keine Issue-Links, Kommentare oder
Statuswechsel. Ã„ndere keine vorhandenen AnhÃ¤nge. Lade mit diesem Skill nur
bereitgestellte PNG-, JPEG- oder WebP-Bilder hoch.

Lies [Request- und CLI-Vertrag](references/request-contract.md), bevor du eine
Request- oder Manifestdatei erstellst.

## Aktuelle Regeln live laden

Lies bei jedem Auftrag die passende Vorlage vollstÃ¤ndig neu; verwende keine
Erinnerung, lokale Kopie oder frÃ¼here Ausgabe:

```powershell
npm run confluence-page -- get 97796350 --include-body
npm run confluence-page -- get 97796337 --include-body
npm run confluence-page -- get 523437222 --include-body
npm run confluence-page -- get 93492170 --include-body
```

Lade nur die Story-, Bug- oder Task-Vorlage, die zum Zielvorgang gehÃ¶rt. Lade
fÃ¼r Storys und Bugs immer die Nutzerrollen. Lade sie fÃ¼r Tasks nur, wenn der
konkrete Task tatsÃ¤chlich eine Nutzerrolle betrifft. PrÃ¼fe jeweils ID,
erwarteten Titel, Status `current`, Space `CER` und die Ahnenlinie unter
`21074848`. Erfasse ID und aktuelle Version jeder verwendeten Seite fÃ¼r
`request.sources`.

Werte die live gelesenen Inhalte als allein verbindliche Redaktionsregeln aus.
Kopiere sie nicht in Skilldateien. Wenn eine Seite fehlt, umbenannt, nicht
aktuell oder unzugÃ¤nglich ist, stoppe vor dem Jira-Preflight.

## Fachkontext ermitteln

1. Lies beim Ãœberarbeiten zuerst das Zielticket mit Summary, Description,
   Vorgangstyp, Projekt, Komponenten, Labels, Versionen, Severity, `issuelinks`
   und `updated`.
2. Leite wenige prÃ¤zise Suchbegriffe aus Benutzerauftrag und Ticket ab. Suche
   passende Dokumentation im gesamten CER-Space, zum Beispiel:

```powershell
npm run confluence-page -- search --cql 'space = "CER" AND type = page AND status = current AND text ~ "Suchbegriff"' --max-results 20
```

3. Lade nur relevante Treffer. Verwende sie ausschlieÃŸlich, wenn ihre
   `ancestors` die Seite `21074848` enthalten. Nimm jede tatsÃ¤chlich verwendete
   Seite mit ihrer Live-Version in `request.sources` auf.
4. Suche bestehende Tickets projektweit nach SchlÃ¼sselbegriffen und erwÃ¤hnten
   Keys. Begrenze die erste Suche auf 20 Treffer und lade nur relevante
   Kandidaten detailliert:

```powershell
npm run jira-ticket -- search --jql 'project = CER AND (summary ~ "Suchbegriff" OR description ~ "Suchbegriff") ORDER BY updated DESC' --max-results 20
```

5. Behandle bestehende Tickets als Kontext, niemals als Regelquelle. Nenne
   wahrscheinliche Duplikate und fachliche AbhÃ¤ngigkeiten. Stoppe bei einem
   wahrscheinlichen Duplikat und frage, ob stattdessen das vorhandene Ticket
   Ã¼berarbeitet werden soll.

Leite fehlende Angaben nur aus eindeutigen Quellen ab und nenne die Herkunft.
Kennzeichne jede Herleitung als solche. Frage bei Widerspruch oder verbleibender
Mehrdeutigkeit nach, bevor du einen Preflight erzeugst.

## Ticket entwerfen und prÃ¼fen

Rufe vor dem Schreiben die aktuellen Jira-Metadaten ab:

```powershell
npm run cer-ticket -- metadata --issue-type Story
npm run cer-ticket -- metadata --issue-type Bug
npm run cer-ticket -- metadata --issue-type Task
npm run cer-ticket -- metadata --issue-key CER-123
```

Verwende nur live angebotene Feld- und Options-IDs. Formuliere auf Deutsch im
Jira-Data-Center-Wiki-Markup. ErfÃ¼lle die aktuelle Vorlage vollstÃ¤ndig. Bewahre
beim Ãœberarbeiten alle nicht verlangten Felder sowie Kommentare, Links, Status
und vorhandene AnhÃ¤nge unverÃ¤ndert.

Formuliere Stories aus der Perspektive eines Endbenutzers. Verwende Tasks fÃ¼r
notwendige, fÃ¼r Benutzer nicht unmittelbar sichtbare System- oder
Entwicklungsarbeit. Empfehle das kanonische Label `DEV_ONLY` nur fÃ¼r
ausschlieÃŸlich interne Entwicklungszwecke wie Infrastruktur, CI/CD-Pipelines,
Jira-Automatisierungsregeln oder Entwicklerwerkzeuge. Setze es nicht allein
deshalb, weil ein Ceroma-Prozess im Hintergrund ablÃ¤uft.

Zeige vor dem technischen Preflight:

- vollstÃ¤ndige geplante Feldwerte beziehungsweise Alt-/Neu-Werte,
- verwendete Confluence-Seiten mit ID und Version,
- hergeleitete Angaben mit Quelle,
- erkannte verwandte oder mÃ¶glicherweise doppelte Tickets,
- noch fehlende Bilder oder fachliche Angaben.

Erzeuge keinen Preflight, solange nach der aktuellen Vorlage erforderliche
Angaben oder Bilder fehlen.

## Preflight und konkrete Freigabe

Lege Requestdateien in einem geeigneten temporÃ¤ren Arbeitsbereich an. FÃ¼hre
zuerst immer ohne `--apply` aus:

```powershell
npm run cer-ticket -- create --issue-type Story|Bug|Task --request-file <request.json>
npm run cer-ticket -- edit CER-123 --request-file <request.json>
```

Zeige die vollstÃ¤ndige normalisierte Ausgabe einschlieÃŸlich `preflightId` und
GÃ¼ltigkeitsdauer. Frage danach ausdrÃ¼cklich, ob exakt dieser Create- oder
Edit-Preflight jetzt ausgefÃ¼hrt werden soll. Eine allgemeine Freigabe, ein
frÃ¼herer Auftrag oder das Erzeugen des Preflights genÃ¼gt nicht.

Erst nach eindeutiger BestÃ¤tigung in derselben Unterhaltung dieselbe Datei mit
der ausgegebenen ID verwenden:

```powershell
npm run cer-ticket -- create --issue-type Story|Bug|Task --request-file <request.json> --apply --preflight-id <id>
npm run cer-ticket -- edit CER-123 --request-file <request.json> --apply --preflight-id <id>
```

Die CLI verbraucht den Nachweis einmalig, prÃ¼ft Jira- und Confluence-Drift und
verifiziert den Serverstand. Bei Ablauf, Drift, geÃ¤nderter Datei oder Fehler
immer einen neuen Preflight erzeugen und erneut freigeben lassen.

## Bilder separat hochladen

Erstelle nach vorhandener beziehungsweise erfolgreicher Ticketanlage ein
Manifest und fÃ¼hre einen eigenen Preflight aus:

```powershell
npm run cer-ticket -- attach-images CER-123 --manifest <images.json>
```

Zeige Ticket, Dateiname, MIME-Typ, GrÃ¶ÃŸe und SHA-256 jedes Bildes. Frage separat,
ob exakt diese Bilder hochgeladen werden sollen. Verwende erst danach:

```powershell
npm run cer-ticket -- attach-images CER-123 --manifest <images.json> --apply --preflight-id <id>
```

Lade keine Logs, Dokumente, SVGs oder andere Dateien hoch. Wenn Upload oder
Remote-Verifikation nach der Ticketanlage fehlschlÃ¤gt, melde das bereits
existierende Ticket und wiederhole den Upload nicht ohne neuen Preflight.
