# AI 360 VR Viewer

Statische Web-App zum Betrachten KI-generierter equirektangularer 360°-Panoramas – unabhängig von korrekten Metadaten.

## Features

- Vollflächiger 360°-Viewer im Browser-Viewport
- Equirektangulare Bilder werden direkt auf eine invertierte Three.js-Sphäre gemappt
- Upload mehrerer Bilder
- Speicherung im Browser per IndexedDB
- Galerie der hochgeladenen Bilder
- Klick auf Galerie-Bild lädt das Panorama in den Viewer
- Navigation per Maus:
  - Click & Drag: Blickrichtung ändern
  - Mausrad: Zoom
- Galerie über permanentes Icon einblendbar
- Klick/Drag im Panorama blendet die Galerie aus
- Drag & Drop Upload

## Lokaler Start

Da ES-Module verwendet werden, sollte die App über einen lokalen Webserver laufen:

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
2. Source: Deploy from branch
3. Branch: `main`
4. Folder: `/root`

## Technische Hinweise

- Die App liest keine 360°-Metadaten aus. Jedes hochgeladene Bild wird als equirektangulares Panorama behandelt.
- Für saubere Darstellung sollten Panoramas ein 2:1-Seitenverhältnis haben.
- Die Bilder werden lokal im jeweiligen Browser gespeichert. Kein Server-Upload.
- Sehr große Bilder können je nach Gerät Speichergrenzen erreichen.

## Dateistruktur

```text
.
├── index.html
├── styles.css
├── app.js
├── package.json
└── README.md
```
