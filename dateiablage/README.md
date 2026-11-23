# Dateiablage (Windows)

Schnellzugriff auf Dateien, Ordner und Webadressen, die man immer wieder braucht. Die Dateien bleiben, wo sie sind;
die App merkt sich nur Verknüpfungen darauf, sortiert in eigene Gruppen. Läuft im Infobereich (Tray), ohne Cloud.
Design wie Zwischenablage und Aufgaben-App (neutral, ein blauer Akzent, Hell/Dunkel nach Windows-Einstellung).

## Bedienung
- **Strg+Alt+D** öffnet bzw. schließt das Fenster. Auch: Klick auf das Tray-Symbol oder die App erneut starten.
- **Hinzufügen:** Dateien, Ordner oder Links (aus dem Browser) ins Fenster ziehen. Auf eine Gruppe links ziehen = direkt in diese Gruppe.
  Oder **Strg+V** (kopierte Dateien bzw. kopierte Webadresse) oder die Knöpfe „+ Dateien …“ / „+ Ordner …“.
- **Öffnen:** Doppelklick oder **Enter**; danach blendet sich das Fenster aus. **Strg+Enter** zeigt die Datei im Explorer.
- **Suchen:** einfach lostippen, sucht in allen Gruppen (Name, Pfad, Gruppe; mehrere Wörter möglich).
- **Gruppen:** „+ Neue Gruppe“ bzw. **Strg+N**, **Strg+1 … 9** wechselt. Rechtsklick: umbenennen, verschieben, löschen.
- **Einträge**, Rechtsklick: im Ordner zeigen, umbenennen (**F2**), neuen Ort zuordnen, in andere Gruppe verschieben,
  nach oben/unten (**Alt+↑/↓**), aus der Ablage entfernen (**Strg+Entf**, die Datei selbst bleibt).
- **Nicht gefunden:** verschobene oder umbenannte Dateien erscheinen blass. Beim Öffnen fragt die App nach dem neuen Ort.
- **Esc** leert die Suche bzw. blendet das Fenster aus. Schließen (×) blendet nur aus; Beenden über das Tray-Menü.
- Tray, Rechtsklick: Öffnen, Mit Windows starten, Beenden.

## Daten
`%APPDATA%\Dateiablage\ablage.json` (lesbares JSON), die vorige Fassung als `ablage.json.bak`.
Ist die Datei beschädigt, lädt die App die `.bak` und sichert die defekte Datei mit Zeitstempel.

## Bauen (Windows)
.NET 10 SDK installieren, dann in diesem Ordner:

```
dotnet run
dotnet publish -c Release -r win-x64 --self-contained false -p:PublishSingleFile=true
```

Ergebnis: `bin\Release\net10.0-windows\win-x64\publish\Dateiablage.exe` (braucht die .NET 10 Desktop Runtime).
Das Symbol `icon.ico` ist selbst gezeichnet (Ordner mit Lesezeichen).

## Grenzen
- Strg+Alt+D entspricht auf deutschen Tastaturen AltGr+D; ist das Kürzel belegt, meldet die App das beim Start.
- Netzlaufwerke, die gerade nicht verbunden sind, erscheinen als „nicht gefunden“, bis sie wieder erreichbar sind.
