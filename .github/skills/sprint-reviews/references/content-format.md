# Inhaltsformat

## Struktur

Verwende Confluence Storage Format mit den Bereichen `Allgemein`,
`Sprint-Übersicht` und optional `Ausblick Sprint <Folgesprint>`. Der Abschnitt
`Allgemein` enthält Sprintschwerpunkte, Besonderheiten und das
Verzögerungs-Makro. Die Sprint-Übersicht enthält produktionsrelevante Tickets,
eine kuratierte Tabelle `Weitere Tickets` und das vollständige Makro für alle
weiteren Vorgänge.

Bei neuen Reviews steht nach dem TOC und vor `Allgemein` dieses Info-Makro:

```html
<ac:structured-macro ac:name="info" ac:schema-version="1">
  <ac:parameter ac:name="title">Weiterführende Links</ac:parameter>
  <ac:rich-text-body><ul>
    <li><ac:link><ri:page ri:content-title="Ceroma &lt;Release-Version&gt; Changelog" /></ac:link></li>
    <li><ac:link><ri:page ri:content-title="Ceroma Releaseplan" /></ac:link></li>
  </ul></ac:rich-text-body>
</ac:structured-macro>
```

Ersetze `<Release-Version>` nur durch die aus Fix-Versionen und dem
CEROMA-Release-Ticket bestätigte Version. Prüfe beide Linkziele vorher live in
Confluence. Füge bei Updates kein zweites Panel hinzu und überschreibe kein
vorhandenes manuell gepflegtes Panel.

## Jira-Makros und Filter

- Verwende für Verzögerungen `Sprint in (<Sprint-ID>) AND labels = Sprint_Delay`.
- Produktiv relevante Vorgänge haben mindestens eines dieser Labels:
  `BATCH-MA`, `CB-MA`, `FREI-MA`, `POA-MA`, `POE-MA`, `ProdKonfig-MA`,
  `PRO-Leiter`, `QM-MA`, `RECH-MA`, `SERVI-MA`, `SP-MA`, `VALI-MA`, `VERI-MA`.
- Die vollständige Liste weiterer Vorgänge verwendet die inverse Bedingung:
  `Type in ("Epic", "Story", "Bug", "Task") AND (labels NOT in (...) OR Labels is EMPTY)`.
- Die kuratierte Tabelle darf ausschließlich Ticket-Keys aus genau diesem
  nicht-produktionsrelevanten Ergebnis enthalten. Sie ist keine zweite Liste
  produktionsrelevanter Tickets.

## Kuratierte Tabelle

Jede Zeile enthält ein Jira-Makro mit `key` und eine kurze, sachliche
Beschreibung der Nutzer- oder Betriebswirkung. Übernimm Key und Summary aus
Jira unverändert; formuliere keine abgeschlossene Wirkung für Vorgänge, die
nicht abgeschlossen sind. Jira-Makros erhalten keinen `ac:macro-id`.
