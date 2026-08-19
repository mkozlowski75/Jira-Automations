# Inhaltsformat

## Storage-Struktur

Erstelle den Seiteninhalt als Confluence Storage Format in dieser Reihenfolge:

```html
<p><ac:structured-macro ac:name="jira" ac:schema-version="1"><ac:parameter ac:name="key">CER-123</ac:parameter></ac:structured-macro></p>
<h1>Release Summary</h1>
<ac:structured-macro ac:name="details" ac:schema-version="1"><ac:rich-text-body><table>...</table></ac:rich-text-body></ac:structured-macro>
<h1>Release-Inhalt</h1>
<h2>Task</h2>
<ul><li>[<a href="https://partner.bdr.de/jira/browse/CER-123">CER-123</a>] - Ticket-Summary</li></ul>
<h2>Bug</h2>
<ul>...</ul>
<h2>Story</h2>
<ul>...</ul>
```

Setze in jeder Tabellenzeile der Jira-Release-Summary die linke Zelle als
`<th>` und den Tabellenwert als `<td>` um. Bewahre Text, Reihenfolge,
Hervorhebungen, Zeilenumbrüche und Links der Jira-Tabelle semantisch. Ersetze
nur Jira-Wiki-Linksyntax durch sichere Confluence-Storage-Links.

## Ticketlisten

- Jede Zeile enthält genau einen absoluten Jira-Link, Ticket-Key und die
  unveränderte Summary.
- HTML-Sonderzeichen in Summaries werden escaped.
- Leere Ergebnislisten erhalten einen leeren `<ul />`; verschweige keinen der
  drei Vorgangstypen.
- Jira-Makros erhalten keinen `ac:macro-id`; Confluence ergänzt diesen selbst.
