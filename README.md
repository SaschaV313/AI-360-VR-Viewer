# AI 360 VR Viewer

Statische Web-App für equirektangulare 360°-Panoramas. Bilder bleiben im jeweiligen Browser; es gibt keinen Server-Upload und keine externe Runtime-Abhängigkeit.

## Bedienung

Bilder in der Galerie auswählen oder per Drag & Drop öffnen. Umschauen mit Maus oder einem Finger, Zoom mit Mausrad oder zwei Fingern. Gyro benötigt einen Bewegungssensor und gegebenenfalls eine Freigabe. Vollbild steht nur zur Verfügung, wenn der Browser die API anbietet.

JPEG, PNG und WebP sind die empfohlenen Formate. Weitere Bildformate funktionieren, sofern der Browser sie decodieren kann. Für HEIC/HEIF gibt es keine eingebaute Konvertierung; bei fehlender Browserunterstützung erklärt die App den Export als JPEG/PNG. 2:1-Bilder ergeben eine unverzerrte Kugelprojektion.

## Speicherung und Kompatibilität

- Originalbilder werden als unveränderte Binärdaten in IndexedDB gespeichert und beim Lesen wieder als Blobs bereitgestellt. Bestehende Blob-Einträge bleiben lesbar. Vorhandene Galerien bleiben bei der Migration auf Datenbankversion 2 erhalten. Auch leere Version-1-Datenbanken aus dem früheren Startfehler werden repariert.
- Ein fehlender oder generischer MIME-Typ wird durch die Dateiendung ergänzt. Erst erfolgreich decodierte Bilder werden aufgenommen. Beschädigte Dateien brechen einen Mehrfach-Upload nicht ab.
- Wenn IndexedDB blockiert oder der Speicher voll ist, bleiben neue Bilder für die laufende Sitzung verfügbar. Der Hinweis in der Galerie unterscheidet dies ausdrücklich von dauerhaft gespeicherten Bildern. Vor dem Schließen exportieren.
- Die Anzeige wird an `MAX_TEXTURE_SIZE` und ein Budget von 16 Megapixeln angepasst; bei Grafikfehlern wird eine kleinere Textur versucht. Gespeicherte Originale und Exporte werden nicht verkleinert. Das vollständige Original muss zunächst decodierbar sein: extrem große Dateien können weiterhin die Arbeitsspeichergrenzen eines Geräts überschreiten.
- Die Galerie nutzt kleine Vorschaubilder. Alte Bilder ohne Vorschau werden nacheinander verarbeitet. Bei schnellen Bildwechseln gewinnt die zuletzt gewählte Ansicht.
- Rendering pausiert bei ruhender Ansicht und in Hintergrund-Tabs. Der Gyro verwendet die korrigierten Achsen und überquert die ±180°-Naht ohne Rundumsprung.
- Nach erfolgreicher Service-Worker-Installation funktionieren App und gespeicherte Bilder offline. Die Shell ist vollständig versioniert; fremde App-Caches und Panoramas werden nicht gelöscht.
- Import/Export verwendet das bestehende JSON-Format mit Base64-Bildern. Große Galerien benötigen entsprechend viel Arbeitsspeicher. Ein Downloadlink bleibt für Browser verfügbar, die nach der Vorbereitung einen weiteren Klick verlangen.

Bilder sind pro Browser und Website-Adresse getrennt. Browserdaten löschen entfernt auch die Galerie. Ein Export dient als übertragbare Sicherung.

## Lokal starten

```bash
npm start
# http://localhost:8080
```

Node-Server für Entwicklung und Tests:

```bash
npm run dev
# http://localhost:4173
```

Die App selbst benötigt weder npm-Installation noch einen Build-Schritt. Für eine Veröffentlichung kopiert `npm run build` ausschließlich die öffentlichen App-Dateien nach `dist/`. GitHub Pages veröffentlicht dieses Verzeichnis erst nach erfolgreichen Regressionstests.

## Tests

```bash
npm ci
npm test
npx playwright install --with-deps
npm run test:browser
```

Die Tests prüfen die Datenbankmigration, Upload und Wiederöffnen, fehlende MIME-/UUID-Unterstützung, FileReader-Fallback, blockierten Speicher, beschädigte Dateien, Texturgrenzen, Mehrfach-Upload, Lade-Rennen, Import/Export, Löschen, mobiles Layout und Offline-Start unter dem GitHub-Pages-Unterpfad. GitHub Actions führt die Browserfälle in Chromium, Firefox und WebKit aus. WebKit-Tests ersetzen keine Prüfung von Dateiauswahl und Bewegungssensoren auf einem physischen iPhone.

Für eine Geräteprüfung: JPEG/PNG aus „Fotos“ und „Dateien“ öffnen, dieselbe Datei erneut auswählen, Galerie nach Neustart wieder öffnen, Gyro in Hoch- und Querformat prüfen, anschließend im installierten Offline-Modus wiederholen. Bei HEIC das vom Browser tatsächlich bereitgestellte Format beachten.

## Struktur

| Datei | Verantwortung |
|---|---|
| `app.js` | Einstieg und Übergang von alten PWA-Installationen |
| `viewer-app.js` | Galerie, UI-Zustand, Upload, Import/Export |
| `storage.js` | Datenbankmigration, Transaktionen, Sitzungsspeicher |
| `images.js` | Bildtypen, Decodieren, Vorschauen, Größenbegrenzung |
| `renderer.js` | WebGL, Textur-Lebenszyklus und Wiederherstellung |
| `controls.js` | Maus, Touch, Gyro, Vollbild, bedarfsgesteuertes Rendering |
| `math.js` | Geometrie, Matrizen, Quaternionen, Winkelnormalisierung |
| `service-worker.js` | Versionierte Offline-Shell |
| `tests/` | Kern- und Browser-Regressionstests |

`app-bootstrap.js` und `placeholder-state.js` bleiben als kompatible Einstiegspunkte für alte HTML-Caches erhalten. Sie verändern keinen Quelltext mehr und öffnen keine zweite Datenbank.


### iPhone-Dateiauswahl

Die leere Galerie startet keinen WebGL-Kontext. Beim Öffnen der nativen
Dateiauswahl werden Rendering, Textur und Zeichenpuffer freigegeben. Erst
`change` oder `cancel` beendet die Auswahlpause; `focus`, `pageshow` oder
`visibilitychange` allein reichen nicht. Im Hintergrund wird keine Textur
wiederhergestellt. Eine zurückgegebene Datei kann bereits gespeichert werden;
die Anzeige wartet auf die Rückkehr zur Seite. Bei Abbruch wird das bisherige
Panorama mit seiner Blickrichtung wiederhergestellt.

Eine Sitzungsmarkierung ohne Dateiinhalte erkennt eine durch Neuladen
unterbrochene Auswahl. Der konkrete vom iPhone gemeldete Seitenneustart ist
noch nicht auf physischer Hardware reproduziert. Die Änderung reduziert
vermeidbare Grafiklast und sichert die Ereignisreihenfolge ab; sie beweist
keine bestimmte Ursache des iOS-Neustarts. Automatisierte Dateiauswahltests
ersetzen den Test mit der nativen iPhone-Fotomediathek nicht.

Hintergrund: [WebGL-Ressourcen zeitnah freigeben](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices#delete_objects_eagerly)
und [Abbruchereignis der Dateiauswahl](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/cancel_event).
