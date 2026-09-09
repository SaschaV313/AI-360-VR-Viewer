import { PanoramaStore } from "./storage.js";
import { prepareImage, decodeImage, createThumbnail, blobToDataUrl, dataUrlToBlob } from "./images.js";
import { PanoramaRenderer } from "./renderer.js";
import { createControls } from "./controls.js";
import { bindFilePickers } from "./file-picker.js";

const $ = selector => document.querySelector(selector);
const viewer = $("#viewer");
const panel = $("#galleryPanel");
const galleryToggle = $("#galleryToggle");
const grid = $("#galleryGrid");
const fileInput = $("#fileInput");
const importInput = $("#importInput");
const store = new PanoramaStore();
let filePicker, pendingLoad = null;
let renderer, controls, currentId = null, loadToken = 0, galleryToken = 0;
let ready = false, busy = false, itemCount = 0, exportUrl = null;
let toastTimer;
const thumbnailUrls = new Set();
const legacyThumbnails = new Map();

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 5000);
}

function showGallery() {
  panel.classList.add("open");
  panel.removeAttribute("inert");
  panel.setAttribute("aria-hidden", "false");
  galleryToggle.setAttribute("aria-label", "Galerie schließen");
  galleryToggle.setAttribute("aria-expanded", "true");
}

function hideGallery() {
  if (panel.contains(document.activeElement)) galleryToggle.focus();
  panel.classList.remove("open");
  panel.setAttribute("inert", "");
  panel.setAttribute("aria-hidden", "true");
  galleryToggle.setAttribute("aria-label", "Galerie öffnen");
  galleryToggle.setAttribute("aria-expanded", "false");
}

function updateButtons() {
  for (const button of [fileInput, importInput, $("#importGallery")]) button.disabled = !ready || busy;
  $("#deleteCurrent").disabled = !ready || busy || currentId === null;
  $("#clearGallery").disabled = $("#exportGallery").disabled = !ready || busy || !itemCount;
  panel.setAttribute("aria-busy", String(busy || !ready));
}

function updateStorageNotice() {
  const notice = $("#storageNotice");
  const temporary = !store.db || store.temporary.size > 0;
  notice.hidden = !temporary;
  notice.textContent = temporary
    ? `Bilder ${store.db ? "teilweise " : ""}nur für diese Sitzung verfügbar. Bitte vor dem Schließen exportieren. ${store.error?.name === "QuotaExceededError" ? "Der lokale Speicher ist voll." : store.error?.message || "Lokales Speichern ist nicht verfügbar."}`
    : "";
}

function setPlaceholder() {
  ++loadToken;
  pendingLoad = null;
  currentId = null;
  renderer.placeholder();
  controls.reset();
  $("#placeholderOverlay").classList.remove("hidden");
  $("#placeholderOverlay").setAttribute("aria-hidden", "false");
  $("#loadStatus").textContent = "";
  markActive();
  updateButtons();
}

function suspendViewer() {
  if (!renderer || renderer.suspended) return;
  ++loadToken;
  controls?.pause();
  renderer.suspend();
}

function resumeViewer() {
  if (!ready || busy || filePicker.blocked || renderer.lost) return;
  renderer.resume();
  if (pendingLoad) void loadPanorama(pendingLoad.id, pendingLoad.options);
  else if (currentId !== null && !renderer.texture) void loadPanorama(currentId, { close: false, reset: false });
  else controls.invalidate();
}

async function loadPanorama(id, { close = true, reset = true } = {}) {
  pendingLoad = { id, options: { close, reset } };
  if (filePicker.blocked || renderer.lost) return false;
  renderer.resume();
  const token = ++loadToken;
  $("#loadStatus").textContent = "Panorama wird geladen …";
  let image, loaded = false;
  try {
    const record = await store.get(id);
    if (token !== loadToken) return false;
    if (!record) throw new Error("Dieses Panorama ist nicht mehr gespeichert.");
    image = await decodeImage(record.blob);
    if (token !== loadToken) return false;
    const result = renderer.setImage(image);
    // Commit selection only after decoding AND GPU upload have succeeded.
    currentId = id;
    pendingLoad = null;
    loaded = true;
    if (reset) controls.reset();
    else controls.invalidate();
    $("#placeholderOverlay").classList.add("hidden");
    $("#placeholderOverlay").setAttribute("aria-hidden", "true");
    markActive();
    updateButtons();
    if (close) hideGallery();
    if (result.resized) showToast(`Anzeige auf ${result.width} × ${result.height} Pixel angepasst. Das Original bleibt erhalten.`);
    return true;
  } catch (error) {
    if (token === loadToken) {
      pendingLoad = null;
      $("#loadStatus").textContent = error.message || "Bild konnte nicht geladen werden.";
      showToast($("#loadStatus").textContent);
    }
    return false;
  } finally {
    image?.removeAttribute("src");
    if (token === loadToken && loaded) $("#loadStatus").textContent = "";
  }
}

function markActive() {
  for (const thumb of grid.querySelectorAll(".thumb")) {
    const active = thumb.dataset.id === currentId;
    thumb.classList.toggle("active", active);
    thumb.setAttribute("aria-pressed", String(active));
  }
}

function releaseThumbnails() {
  for (const url of thumbnailUrls) URL.revokeObjectURL(url);
  thumbnailUrls.clear();
}

function renderGallery(items) {
  const token = ++galleryToken;
  releaseThumbnails();
  grid.replaceChildren();
  const ids = new Set(items.map(item => item.id));
  for (const id of legacyThumbnails.keys()) if (!ids.has(id)) legacyThumbnails.delete(id);
  itemCount = items.length;
  $("#emptyState").hidden = Boolean(itemCount);
  updateButtons();
  const previews = [];
  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "thumb";
    button.dataset.id = item.id;
    button.title = item.name;
    const image = document.createElement("img");
    image.alt = item.name;
    image.loading = "lazy";
    image.decoding = "async";
    const info = document.createElement("span");
    info.className = "info";
    const title = document.createElement("strong");
    title.textContent = item.name;
    const meta = document.createElement("span");
    meta.className = "meta";
    const date = new Date(item.createdAt);
    meta.textContent = `${formatBytes(item.size)} · ${Number.isFinite(date.getTime()) ? date.toLocaleDateString("de-DE") : ""}${store.temporary.has(item.id) ? " · nur diese Sitzung" : ""}`;
    info.append(title, meta);
    button.append(image, info);
    button.addEventListener("click", event => loadPanorama(event.currentTarget.dataset.id));
    grid.append(button);
    previews.push({ item, image });
  }
  markActive();
  // Old galleries lack small previews. Decode those one at a time, not all
  // full-resolution panoramas simultaneously (especially costly on iPhones).
  void fillPreviews(previews, token);
}

async function fillPreviews(previews, token) {
  for (const { item, image } of previews) {
    if (token !== galleryToken) return;
    try {
      let blob = item.thumbnail || legacyThumbnails.get(item.id);
      if (!blob) {
        const decoded = await decodeImage(item.blob);
        try { blob = await createThumbnail(decoded); }
        finally { decoded.removeAttribute("src"); }
        if (token !== galleryToken) return;
        legacyThumbnails.set(item.id, blob);
      }
      if (token !== galleryToken) return;
      let url;
      try { url = URL.createObjectURL(blob); }
      catch { image.src = await blobToDataUrl(blob); continue; }
      thumbnailUrls.add(url);
      const release = () => { URL.revokeObjectURL(url); thumbnailUrls.delete(url); };
      image.onload = release;
      image.onerror = () => { release(); image.onerror = null; image.alt += " – keine Vorschau"; };
      image.src = url;
    } catch { image.alt = `${item.name} – keine Vorschau`; }
  }
}

async function runOperation(task) {
  if (!ready || busy) return;
  busy = true;
  updateButtons();
  try { await task(); }
  catch (error) {
    $("#operationStatus").textContent = error.message || "Vorgang fehlgeschlagen.";
    showToast($("#operationStatus").textContent);
  } finally {
    busy = false;
    updateButtons();
    updateStorageNotice();
    resumeViewer();
  }
}

async function addImages(entries, verb) {
  if (!entries.length) return;
  const intent = loadToken;
  let firstId = null, added = 0, persisted = 0;
  const failures = [];
  for (let i = 0; i < entries.length; i++) {
    $("#operationStatus").textContent = `Bild ${i + 1} von ${entries.length} wird verarbeitet …`;
    const entry = entries[i];
    try {
      const blob = entry.dataUrl !== undefined ? dataUrlToBlob(entry.dataUrl) : entry;
      const record = await prepareImage(blob, entry.name || "Panorama");
      if (await store.put(record)) persisted++;
      firstId ??= record.id;
      added++;
    } catch (error) { failures.push(`${entry.name || "Bild"}: ${error.message}`); }
  }
  renderGallery(await store.all());
  if (firstId && intent === loadToken) await loadPanorama(firstId);
  const outcome = `${added} Bild${added === 1 ? "" : "er"} ${verb}. ${persisted} dauerhaft gespeichert.${added > persisted ? ` ${added - persisted} nur für diese Sitzung verfügbar.` : ""}`;
  $("#operationStatus").textContent = [outcome, ...failures].join("\n");
  if (failures.length) { showGallery(); showToast(`${failures.length} Datei${failures.length === 1 ? "" : "en"} konnte nicht geöffnet werden. Details in der Galerie.`); }
}

async function importGallery(file) {
  let payload;
  try { payload = JSON.parse(await file.text()); }
  catch { throw new Error("Import fehlgeschlagen. Bitte einen Galerie-Export als JSON auswählen."); }
  if (!payload || !Array.isArray(payload.items)) throw new Error("Diese Datei enthält keinen Galerie-Export.");
  if (payload.items.some(item => !item || typeof item.dataUrl !== "string")) throw new Error("Der Galerie-Export enthält ungültige Einträge.");
  await addImages(payload.items, "importiert");
}

async function exportGallery() {
  const items = await store.all();
  if (!items.length) return;
  $("#operationStatus").textContent = "Export wird vorbereitet …";
  const exported = [];
  for (const item of items) exported.push({ id: item.id, name: item.name, type: item.type, size: item.size, createdAt: item.createdAt, dataUrl: await blobToDataUrl(item.blob) });
  const blob = new Blob([JSON.stringify({ app: "AI 360 VR Viewer", version: 2, exportedAt: new Date().toISOString(), items: exported })], { type: "application/json" });
  if (exportUrl) URL.revokeObjectURL(exportUrl);
  exportUrl = URL.createObjectURL(blob);
  const link = $("#exportDownload");
  link.href = exportUrl;
  link.download = `ai-360-gallery-${new Date().toISOString().slice(0, 10)}.json`;
  link.hidden = false;
  link.click();
  // Keep a real, attached link and its URL alive for browsers requiring a
  // fresh user gesture after asynchronous export preparation.
  $("#operationStatus").textContent = "Export bereit. Falls kein Download startet: „Export herunterladen“ anklicken.";
}

async function deleteCurrent() {
  const id = currentId;
  if (id === null || !confirm("Aktuelles Panorama wirklich löschen?")) return;
  ++loadToken;
  await store.delete(id);
  const items = await store.all();
  setPlaceholder();
  renderGallery(items);
  if (items.length) await loadPanorama(items[0].id, { close: false });
  else showGallery();
}

async function clearGallery() {
  if (!confirm("Alle gespeicherten Panoramas löschen?")) return;
  ++loadToken;
  await store.clear();
  setPlaceholder();
  renderGallery([]);
  showGallery();
  $("#operationStatus").textContent = "Galerie geleert.";
}

function bindEvents() {
  galleryToggle.addEventListener("click", () => panel.classList.contains("open") ? hideGallery() : showGallery());
  $("#closeGallery").addEventListener("click", hideGallery);
  document.addEventListener("keydown", event => { if (event.key === "Escape") hideGallery(); });
  fileInput.addEventListener("change", () => {
    const files = Array.from(fileInput.files || []);
    void runOperation(async () => {
      try { await addImages(files, "hinzugefügt"); }
      finally { fileInput.value = ""; }
    });
  });
  $("#importGallery").addEventListener("click", () => importInput.click());
  importInput.addEventListener("change", () => {
    const file = importInput.files?.[0];
    if (file) void runOperation(async () => {
      try { await importGallery(file); }
      finally { importInput.value = ""; }
    });
  });
  $("#exportGallery").addEventListener("click", () => runOperation(exportGallery));
  $("#deleteCurrent").addEventListener("click", () => runOperation(deleteCurrent));
  $("#clearGallery").addEventListener("click", () => runOperation(clearGallery));
  const isFileDrag = event => Array.from(event.dataTransfer?.types || []).includes("Files");
  let dragDepth = 0;
  window.addEventListener("dragenter", event => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepth++;
    $("#dropOverlay").classList.add("visible");
  });
  window.addEventListener("dragover", event => { if (isFileDrag(event)) event.preventDefault(); });
  window.addEventListener("dragleave", event => {
    if (isFileDrag(event) && --dragDepth <= 0) { dragDepth = 0; $("#dropOverlay").classList.remove("visible"); }
  });
  window.addEventListener("drop", event => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepth = 0;
    $("#dropOverlay").classList.remove("visible");
    const files = Array.from(event.dataTransfer.files || []);
    void runOperation(() => addImages(files, "hinzugefügt"));
  });
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toFixed(exponent ? 1 : 0)} ${units[exponent]}`;
}

async function init() {
  filePicker = bindFilePickers([fileInput, importInput], {
    suspend: suspendViewer,
    resume: resumeViewer,
    interrupted: () => {
      $("#operationStatus").textContent = "Die Seite wurde während der Dateiauswahl neu geladen. Bitte erneut auswählen. Gespeicherte Bilder bleiben erhalten.";
    },
  });
  bindEvents();
  updateButtons();
  showGallery();
  try {
    renderer = new PanoramaRenderer(viewer, {
      onLost: () => {
        ++loadToken; controls?.pause();
        if (!filePicker.blocked) $("#loadStatus").textContent = "Grafik wird wiederhergestellt …";
      },
      onRestored: resumeViewer,
    });
    controls = createControls(viewer, renderer, { showToast, hideGallery });
    setPlaceholder();
  } catch (error) {
    $("#placeholderOverlay").classList.add("hidden");
    const message = document.createElement("div");
    message.className = "fatal-error";
    message.textContent = error.message;
    viewer.replaceChildren(message);
    $("#loadStatus").textContent = error.message;
    return;
  }
  await store.init();
  ready = true;
  updateButtons();
  updateStorageNotice();
  const items = await store.all();
  renderGallery(items);
  if (items.length) await loadPanorama(items[0].id, { close: false });
  // The viewer never waits for service-worker installation or network access.
  if ("serviceWorker" in navigator && window.isSecureContext) {
    void navigator.serviceWorker.register("./service-worker.js").catch(error => console.warn("Offline-Modus nicht verfügbar:", error));
  }
}

void init().catch(error => {
  $("#operationStatus").textContent = error.message || "Die App konnte nicht gestartet werden.";
  showToast($("#operationStatus").textContent);
});
