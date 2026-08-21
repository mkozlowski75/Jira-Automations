# Dokumentationsvorlage

Nutze nur Abschnitte, die sich aus der Regel ableiten lassen. Erhalte bei einem
Update bereits vorhandene Makros, Beispiele und Links außerhalb der beauftragten
Änderung.

## Überblick

Verwende für diese Tabelle das Confluence-Makro `Seiteneigenschaften`
(`ac:name="details"`). Die Tabelle enthält Regel-ID, Name, Zweck, Status,
Projekt, Ausführung, Fehlerbenachrichtigung und zugehörigem Jira-Ticket.
Verlinke Regel-ID und Name auf die Jira-Automation. Übernimm den Namen exakt
aus dem aktuellen Export.

Beschreibe in der Zeile `Zweck` kurz Ziel, Auslöser und fachliches Ergebnis der
Regel.

## Eingangsbedingungen

Nutze diese Tabelle, wenn Bedingungen oder Abhängigkeiten bestimmen, ob die
Regel fortgesetzt wird:

| Eingangsbedingung | Prüfung durch die Regel | Bei Nichterfüllung |
|---|---|---|
| Beispiel | Tatsächliche Bedingung oder Voraussetzung | Tatsächliches Verhalten |

Schließe mit einem Satz ab, der das Ergebnis bei erfüllten Bedingungen nennt.

## Ablauf

Beschreibe die Komponentenreihenfolge als nummerierte Liste. Nenne nur
nachweisbare Trigger, Abfragen, Variablen, Vergleiche, Web Requests und Aktionen.

## Variablen oder Parameter

Dokumentiere erzeugte Variablen oder Webhook-Parameter in einer zweispaltigen
Tabelle. Lasse den Abschnitt aus, wenn die Regel keine fachlich relevanten
Variablen oder Parameter verwendet.

## Ergebnis und Folgeverarbeitung

Erläutere positive und negative Ergebniswege sowie nachgelagerte Regeln, soweit
sie im Export erkennbar sind.

## Schnittstellen und Voraussetzungen

Nenne Systeme, erwartete Artefakte, Jobs, Stages, Branches oder eine allgemein
formulierte geheime Zugriffskonfiguration. Keine Secret-Namen, Tokens, URLs mit
Zugangsdaten oder Zertifikatsdetails aufnehmen.

## Wichtige Betriebsdetails und Links

Halte fachlich entscheidende Filter, Deduplizierung, Idempotenz, Zeitfenster,
fehlende Ergebniswege und weiterführende Jira-/GitLab-Links fest.
