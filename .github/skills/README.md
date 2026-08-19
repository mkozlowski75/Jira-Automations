# Workspace-Skills

Diese Übersicht hilft beim Formulieren natürlichsprachlicher Aufträge in Codex.
Die Beispiele nennen keinen Skillnamen: Die hervorgehobenen Fachbegriffe machen
den passenden Workflow eindeutig. Die vollständigen Arbeits- und
Sicherheitsregeln stehen jeweils in der verlinkten `SKILL.md`.

| Bereich | Kurzbeschreibung | Beispiel-Prompt |
| --- | --- | --- |
| [Jira-Tickets](jira-tickets/SKILL.md) | Jira-Tickets suchen, lesen, zusammenfassen und nach Freigabe bearbeiten. | „Öffne das Jira-Ticket `CER-123` und fasse Beschreibung, Status, Bearbeiter und offene Punkte zusammen.“ |
| [CER-Tickets](cer-jira-tickets/SKILL.md) | CER-Storys, -Bugs und -Tasks anhand der aktuellen Confluence-Vorlagen erstellen oder überarbeiten. | „Erstelle aus diesen Anforderungen einen Entwurf für ein **CER-Task-Ticket** anhand der aktuellen Confluence-Vorlage. Noch nicht in Jira anlegen.“ |
| [Confluence-Seiten](confluence-pages/SKILL.md) | Confluence-Data-Center-Seiten suchen, lesen und nach Freigabe veröffentlichen oder aktualisieren. | „Suche in Confluence nach einer Seite zur CVE-Ticketvorlage und fasse den aktuellen Inhalt zusammen.“ |
| [Jira-Automatisierungsregeln](jira-automation-rules/SKILL.md) | Lokale Automation-for-Jira-Regeln im Code-Barrel-JSON analysieren, ändern, validieren und nach Freigabe deployen. | „Prüfe die lokale **Automation-for-Jira-Regel** `BDR-1029`: Welche Trigger, Bedingungen und Aktionen enthält sie?“ |
| [Jira-Regeldokumentation](jira-rule-documentation/SKILL.md) | Eine BDR-Regel aus dem aktuellen Export als Confluence-Unterseite dokumentieren oder mit ihr abgleichen. | „Gleiche die bestehende **Confluence-Dokumentation** der BDR-Regel `1029` mit dem aktuellen Jira-Regel-Export ab. Noch nichts veröffentlichen.“ |
| [GitLab-Zugriff](gitlab-access/SKILL.md) | GitLab-Projekte, Branches, Merge Requests, Pipelines und Jobs schreibgeschützt untersuchen. | „Untersuche die letzten **GitLab-Pipelines** des Projekts und nenne fehlgeschlagene Jobs mit ihrer Ursache.“ |
| [CVE-Tickets](cve-ticket-factory/SKILL.md) | Trivy- oder Dependency-Scan-Funde bewerten, deduplizieren und als CER-CVE-Task vorbereiten. | „Bewerte diesen **Trivy-Scan-Fund**, prüfe auf ein mögliches Duplikat und bereite einen Entwurf für ein CER-CVE-Task-Ticket vor. Nicht anlegen.“ |
| [Release-Changelogs](release-changelogs/SKILL.md) | Neue Changelog-Seiten für Ceroma, Mediator, PostidentService und Contracts aus einem CER-Release und dessen Fix-Version-Tickets vorbereiten und nach Freigabe veröffentlichen. | „Erstelle einen **Changelog für Ceroma Version 2.4.0** unter der CER-Changelog-Übersicht. Lies zuerst das zugehörige Release-Ticket und lege die Seite noch nicht an.“ |
| [Sprint-Reviews](sprint-reviews/SKILL.md) | CER-Sprint-Reviews aus bestätigten Jira-Sprints vorbereiten, gezielt ergänzen und nach Freigabe veröffentlichen. | „Erstelle ein **Sprint Review für Sprint 5.64** mit Ausblick auf Sprint 5.65. Die Jira-Sprint-IDs sind 8185 und 8422. Noch nicht veröffentlichen.“ |

## Hinweise zur Auswahl

- Für vorhandene Jira-Vorgänge verwende Wörter wie „Ticket öffnen“, „JQL-Suche“
  oder „Status zusammenfassen“. Für das Formulieren eines CER-Vorgangs nenne
  dagegen ausdrücklich „CER-Story“, „CER-Bug“ oder „CER-Task-Ticket“.
- „Automation-for-Jira-Regel ändern oder validieren“ betrifft die Regel selbst.
  „Regel in Confluence dokumentieren oder abgleichen“ betrifft ihre
  Dokumentation.
- Für Änderungen oder Veröffentlichungen gilt weiterhin der jeweilige
  Freigabe- und Preflight-Ablauf. Eine Formulierung wie „noch nichts anlegen“
  oder „noch nichts veröffentlichen“ beschränkt den Auftrag auf Vorbereitung
  beziehungsweise Lesen.
