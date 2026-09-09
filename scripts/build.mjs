import { mkdir, copyFile, rm } from 'node:fs/promises';
const files = ['index.html', 'styles.css', 'placeholder.css', 'gyro.css', 'app.js', 'viewer-app.js', 'app-bootstrap.js', 'placeholder-state.js', 'storage.js', 'images.js', 'renderer.js', 'controls.js', 'math.js', 'service-worker.js', 'manifest.webmanifest', 'icon.svg'];
await rm('dist', { recursive: true, force: true });
await mkdir('dist');
for (const file of files) await copyFile(file, `dist/${file}`);
console.log(`${files.length} public app files copied to dist.`);
