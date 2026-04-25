# AI 360 VR Viewer

Statische Web-App zum Betrachten KI-generierter equirektangularer 360°-Panoramas – unabhängig von korrekten Metadaten.

## Features

- Vollflächiger 360°-Viewer im Browser-Viewport
- Equirektangulare Bilder werden direkt auf eine WebGL-Sphäre gemappt
- Keine externe Runtime-Abhängigkeit: kein Three.js-CDN, kein Backend, kein Build-Prozess
- Upload mehrerer Bilder
- Speicherung im Browser per IndexedDB
- Galerie der hochgeladenen Bilder
- Klick auf Galerie-Bild lädt das Panorama in den Viewer
- Navigation:
  - Maus: Click & Drag
  - Mausrad: Zoom
  - Touch: Ein-Finger-Drag
  - Touch: Zwei-Finger-Pinch-Zoom
- Fullscreen-Button
- Reset-View-Button
- Galerie über permanentes Icon einblendbar
- Klick/Drag im Panorama blendet die Galerie aus
- Drag & Drop Upload
- Galerie-Export und -Import als JSON
- PWA-Dateien für Installation auf Desktop/iPhone/Android

## Lokaler Start

Da ES-Module und ein Service Worker verwendet werden, sollte die App über einen lokalen Webserver laufen:

```bash
python3 -m http.server 8080
```

Dann öffnen:

```text
http://localhost:8080
```

Alternativ mit Node:

```bash
npx serve .
```

## GitHub Pages

Das Projekt ist als statische Website geeignet.

1. In GitHub: Settings → Pages
2. Source: GitHub Actions
3. Workflow `Deploy static site to GitHub Pages` ausführen oder auf den nächsten Push warten

## Technische Hinweise

- Die App liest keine 360°-Metadaten aus. Jedes hochgeladene Bild wird als equirektangulares Panorama behandelt.
- Für saubere Darstellung sollten Panoramas ein 2:1-Seitenverhältnis haben.
- Die Bilder werden lokal im jeweiligen Browser gespeichert. Kein Server-Upload.
- Sehr große Bilder können je nach Gerät Speichergrenzen erreichen.
- Der Galerie-Export enthält die Bilder base64-kodiert in einer JSON-Datei. Dadurch können Exporte groß werden.

## Dateistruktur

```text
.
├── index.html
├── styles.css
├── app.js
├── manifest.webmanifest
├── service-worker.js
├── icon.svg
├── package.json
└── README.md
```
