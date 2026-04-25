import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js";

const DB_NAME = "ai-360-vr-viewer";
const STORE_NAME = "panoramas";
const DB_VERSION = 1;

const viewer = document.querySelector("#viewer");
const galleryToggle = document.querySelector("#galleryToggle");
const galleryPanel = document.querySelector("#galleryPanel");
const closeGallery = document.querySelector("#closeGallery");
const fileInput = document.querySelector("#fileInput");
const galleryGrid = document.querySelector("#galleryGrid");
const emptyState = document.querySelector("#emptyState");
const deleteCurrentButton = document.querySelector("#deleteCurrent");
const clearGalleryButton = document.querySelector("#clearGallery");
const dropOverlay = document.querySelector("#dropOverlay");
const toast = document.querySelector("#toast");

let db;
let currentId = null;
let currentObjectUrl = null;
let currentTexture = null;
let currentMaterial = null;

let isPointerDown = false;
let lastPointerX = 0;
let lastPointerY = 0;
let lon = 0;
let lat = 0;
let targetLon = 0;
let targetLat = 0;
let fov = 75;
let targetFov = 75;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(fov, window.innerWidth / window.innerHeight, 0.1, 1100);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
viewer.appendChild(renderer.domElement);

const geometry = new THREE.SphereGeometry(500, 96, 64);
geometry.scale(-1, 1, 1);

const placeholderTexture = createPlaceholderTexture();
currentMaterial = new THREE.MeshBasicMaterial({ map: placeholderTexture });
const sphere = new THREE.Mesh(geometry, currentMaterial);
scene.add(sphere);

init();

async function init() {
  db = await openDatabase();
  bindEvents();
  const items = await getAllPanoramas();
  renderGallery(items);

  if (items.length > 0) {
    await loadPanorama(items[0].id, { hideGallery: false });
  } else {
    showGallery();
    showToast("Lade ein equirektangulares 360°-Panorama hoch.");
  }

  animate();
}

function bindEvents() {
  window.addEventListener("resize", onResize);

  galleryToggle.addEventListener("click", () => {
    galleryPanel.classList.contains("open") ? hideGallery() : showGallery();
  });
  closeGallery.addEventListener("click", hideGallery);

  fileInput.addEventListener("change", async (event) => {
    await saveFiles([...event.target.files]);
    fileInput.value = "";
  });

  deleteCurrentButton.addEventListener("click", async () => {
    if (!currentId) return;
    const confirmed = window.confirm("Aktuelles Panorama wirklich löschen?");
    if (!confirmed) return;
    await deletePanorama(currentId);
    currentId = null;
    const items = await getAllPanoramas();
    renderGallery(items);
    if (items.length > 0) {
      await loadPanorama(items[0].id, { hideGallery: false });
    } else {
      setPlaceholder();
      showGallery();
      showToast("Galerie ist leer.");
    }
  });

  clearGalleryButton.addEventListener("click", async () => {
    const confirmed = window.confirm("Alle gespeicherten Panoramas löschen?");
    if (!confirmed) return;
    await clearPanoramas();
    currentId = null;
    setPlaceholder();
    renderGallery([]);
    showGallery();
    showToast("Galerie geleert.");
  });

  viewer.addEventListener("pointerdown", onPointerDown);
  viewer.addEventListener("pointermove", onPointerMove);
  viewer.addEventListener("pointerup", onPointerUp);
  viewer.addEventListener("pointercancel", onPointerUp);
  viewer.addEventListener("wheel", onWheel, { passive: false });

  window.addEventListener("dragenter", onDragEnter);
  window.addEventListener("dragover", onDragOver);
  window.addEventListener("dragleave", onDragLeave);
  window.addEventListener("drop", onDrop);
}

function onPointerDown(event) {
  if (galleryPanel.classList.contains("open")) {
    hideGallery();
    return;
  }

  isPointerDown = true;
  viewer.classList.add("dragging");
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  viewer.setPointerCapture?.(event.pointerId);
}

function onPointerMove(event) {
  if (!isPointerDown) return;

  const deltaX = event.clientX - lastPointerX;
  const deltaY = event.clientY - lastPointerY;

  targetLon -= deltaX * 0.1;
  targetLat += deltaY * 0.1;
  targetLat = clamp(targetLat, -85, 85);

  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
}

function onPointerUp(event) {
  isPointerDown = false;
  viewer.classList.remove("dragging");
  viewer.releasePointerCapture?.(event.pointerId);
}

function onWheel(event) {
  event.preventDefault();
  targetFov = clamp(targetFov + event.deltaY * 0.035, 35, 100);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function onDragEnter(event) {
  event.preventDefault();
  dropOverlay.classList.add("visible");
}

function onDragOver(event) {
  event.preventDefault();
}

function onDragLeave(event) {
  if (event.clientX <= 0 || event.clientY <= 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight) {
    dropOverlay.classList.remove("visible");
  }
}

async function onDrop(event) {
  event.preventDefault();
  dropOverlay.classList.remove("visible");
  const files = [...event.dataTransfer.files].filter((file) => file.type.startsWith("image/"));
  await saveFiles(files);
}

function animate() {
  requestAnimationFrame(animate);

  lon += (targetLon - lon) * 0.12;
  lat += (targetLat - lat) * 0.12;
  fov += (targetFov - fov) * 0.12;

  camera.fov = fov;
  camera.updateProjectionMatrix();

  const phi = THREE.MathUtils.degToRad(90 - lat);
  const theta = THREE.MathUtils.degToRad(lon);

  const x = 500 * Math.sin(phi) * Math.cos(theta);
  const y = 500 * Math.cos(phi);
  const z = 500 * Math.sin(phi) * Math.sin(theta);

  camera.lookAt(x, y, z);
  renderer.render(scene, camera);
}

async function saveFiles(files) {
  const images = files.filter((file) => file.type.startsWith("image/"));
  if (images.length === 0) {
    showToast("Keine unterstützten Bilddateien gefunden.");
    return;
  }

  let firstSavedId = null;

  for (const file of images) {
    const record = {
      id: crypto.randomUUID(),
      name: file.name || "panorama",
      type: file.type || "image/jpeg",
      size: file.size,
      createdAt: Date.now(),
      blob: file
    };
    await putPanorama(record);
    firstSavedId ??= record.id;
  }

  const items = await getAllPanoramas();
  renderGallery(items);

  if (firstSavedId) {
    await loadPanorama(firstSavedId, { hideGallery: true });
  }

  showToast(`${images.length} Bild${images.length === 1 ? "" : "er"} gespeichert.`);
}

async function loadPanorama(id, options = { hideGallery: true }) {
  const item = await getPanorama(id);
  if (!item) return;

  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);

  currentId = id;
  currentObjectUrl = URL.createObjectURL(item.blob);

  const loader = new THREE.TextureLoader();
  loader.load(
    currentObjectUrl,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;

      if (currentTexture && currentTexture !== placeholderTexture) currentTexture.dispose();

      currentTexture = texture;
      currentMaterial.map = texture;
      currentMaterial.needsUpdate = true;

      targetLon = 0;
      targetLat = 0;
      targetFov = 75;

      markActiveThumb();
      deleteCurrentButton.disabled = false;
      if (options.hideGallery) hideGallery();
    },
    undefined,
    () => {
      showToast("Bild konnte nicht geladen werden.");
    }
  );
}

function setPlaceholder() {
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = null;
  currentId = null;
  if (currentTexture && currentTexture !== placeholderTexture) currentTexture.dispose();
  currentTexture = placeholderTexture;
  currentMaterial.map = placeholderTexture;
  currentMaterial.needsUpdate = true;
  deleteCurrentButton.disabled = true;
}

function renderGallery(items) {
  galleryGrid.innerHTML = "";
  emptyState.style.display = items.length ? "none" : "block";
  clearGalleryButton.disabled = items.length === 0;

  for (const item of items) {
    const objectUrl = URL.createObjectURL(item.blob);
    const button = document.createElement("button");
    button.className = "thumb";
    button.type = "button";
    button.dataset.id = item.id;
    button.title = item.name;

    const img = document.createElement("img");
    img.src = objectUrl;
    img.alt = item.name;
    img.loading = "lazy";
    img.addEventListener("load", () => URL.revokeObjectURL(objectUrl), { once: true });

    const info = document.createElement("span");
    info.className = "info";

    const title = document.createElement("strong");
    title.textContent = item.name;

    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = `${formatBytes(item.size)} · ${formatDate(item.createdAt)}`;

    info.append(title, meta);
    button.append(img, info);
    button.addEventListener("click", () => loadPanorama(item.id, { hideGallery: true }));

    galleryGrid.append(button);
  }

  markActiveThumb();
}

function markActiveThumb() {
  for (const thumb of galleryGrid.querySelectorAll(".thumb")) {
    thumb.classList.toggle("active", thumb.dataset.id === currentId);
  }
}

function showGallery() {
  galleryPanel.classList.add("open");
  galleryPanel.setAttribute("aria-hidden", "false");
  galleryToggle.setAttribute("aria-label", "Galerie schließen");
}

function hideGallery() {
  galleryPanel.classList.remove("open");
  galleryPanel.setAttribute("aria-hidden", "true");
  galleryToggle.setAttribute("aria-label", "Galerie öffnen");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove("visible"), 2600);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transaction(mode = "readonly") {
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

function putPanorama(record) {
  return new Promise((resolve, reject) => {
    const request = transaction("readwrite").put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function getPanorama(id) {
  return new Promise((resolve, reject) => {
    const request = transaction().get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAllPanoramas() {
  return new Promise((resolve, reject) => {
    const request = transaction().getAll();
    request.onsuccess = () => {
      const items = request.result.sort((a, b) => b.createdAt - a.createdAt);
      resolve(items);
    };
    request.onerror = () => reject(request.error);
  });
}

function deletePanorama(id) {
  return new Promise((resolve, reject) => {
    const request = transaction("readwrite").delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function clearPanoramas() {
  return new Promise((resolve, reject) => {
    const request = transaction("readwrite").clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function createPlaceholderTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 1024;
  const context = canvas.getContext("2d");

  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#0f172a");
  gradient.addColorStop(0.5, "#111827");
  gradient.addColorStop(1, "#020617");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.strokeStyle = "rgba(103, 232, 249, 0.18)";
  context.lineWidth = 2;

  for (let x = 0; x <= canvas.width; x += 128) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, canvas.height);
    context.stroke();
  }

  for (let y = 0; y <= canvas.height; y += 128) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(canvas.width, y);
    context.stroke();
  }

  context.fillStyle = "rgba(248, 250, 252, 0.92)";
  context.font = "bold 72px system-ui, sans-serif";
  context.textAlign = "center";
  context.fillText("AI 360 VR Viewer", canvas.width / 2, canvas.height / 2 - 20);

  context.fillStyle = "rgba(148, 163, 184, 0.9)";
  context.font = "36px system-ui, sans-serif";
  context.fillText("Upload an equirectangular panorama", canvas.width / 2, canvas.height / 2 + 48);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, exponent)).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}
