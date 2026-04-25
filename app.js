const DB_NAME = "ai-360-vr-viewer";
const STORE_NAME = "panoramas";
const DB_VERSION = 1;

const viewer = document.querySelector("#viewer");
const galleryToggle = document.querySelector("#galleryToggle");
const galleryPanel = document.querySelector("#galleryPanel");
const closeGallery = document.querySelector("#closeGallery");
const fileInput = document.querySelector("#fileInput");
const importInput = document.querySelector("#importInput");
const importGalleryButton = document.querySelector("#importGallery");
const exportGalleryButton = document.querySelector("#exportGallery");
const galleryGrid = document.querySelector("#galleryGrid");
const emptyState = document.querySelector("#emptyState");
const deleteCurrentButton = document.querySelector("#deleteCurrent");
const clearGalleryButton = document.querySelector("#clearGallery");
const resetViewButton = document.querySelector("#resetView");
const fullscreenButton = document.querySelector("#fullscreenToggle");
const dropOverlay = document.querySelector("#dropOverlay");
const toast = document.querySelector("#toast");

let db;
let currentId = null;
let currentObjectUrl = null;
let currentTexture = null;

let lon = 0;
let lat = 0;
let targetLon = 0;
let targetLat = 0;
let fov = 75;
let targetFov = 75;

const pointers = new Map();
let isDragging = false;
let lastPointerX = 0;
let lastPointerY = 0;
let lastPinchDistance = 0;

const vertexShaderSource = `
  attribute vec3 aPosition;
  attribute vec2 aUv;
  uniform mat4 uProjection;
  uniform mat4 uView;
  varying vec2 vUv;

  void main() {
    vUv = aUv;
    gl_Position = uProjection * uView * vec4(aPosition, 1.0);
  }
`;

const fragmentShaderSource = `
  precision mediump float;
  uniform sampler2D uTexture;
  varying vec2 vUv;

  void main() {
    gl_FragColor = texture2D(uTexture, vUv);
  }
`;

const gl = createRenderer();
const program = createProgram(gl, vertexShaderSource, fragmentShaderSource);
const mesh = createSphereMesh(96, 64);
const buffers = createBuffers(gl, mesh);
const uniforms = {
  projection: gl.getUniformLocation(program, "uProjection"),
  view: gl.getUniformLocation(program, "uView"),
  texture: gl.getUniformLocation(program, "uTexture")
};
const attributes = {
  position: gl.getAttribLocation(program, "aPosition"),
  uv: gl.getAttribLocation(program, "aUv")
};

init();

async function init() {
  db = await openDatabase();
  bindEvents();
  await registerServiceWorker();

  currentTexture = createTextureFromCanvas(createPlaceholderCanvas());

  const items = await getAllPanoramas();
  renderGallery(items);

  if (items.length > 0) {
    await loadPanorama(items[0].id, { hideGallery: false });
  } else {
    showGallery();
    showToast("Lade ein equirektangulares 360°-Panorama hoch.");
  }

  onResize();
  animate();
}

function createRenderer() {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl", {
    antialias: true,
    alpha: false,
    powerPreference: "high-performance"
  });

  if (!context) {
    viewer.innerHTML = '<div class="fatal-error">WebGL ist in diesem Browser oder auf diesem Gerät nicht verfügbar.</div>';
    throw new Error("WebGL not available");
  }

  viewer.appendChild(canvas);
  context.enable(context.DEPTH_TEST);
  context.depthFunc(context.LEQUAL);
  context.pixelStorei(context.UNPACK_FLIP_Y_WEBGL, true);
  return context;
}

function bindEvents() {
  window.addEventListener("resize", onResize);
  document.addEventListener("fullscreenchange", updateFullscreenLabel);

  galleryToggle.addEventListener("click", () => {
    galleryPanel.classList.contains("open") ? hideGallery() : showGallery();
  });
  closeGallery.addEventListener("click", hideGallery);

  resetViewButton.addEventListener("click", resetView);
  fullscreenButton.addEventListener("click", toggleFullscreen);

  fileInput.addEventListener("change", async (event) => {
    await saveFiles([...event.target.files]);
    fileInput.value = "";
  });

  importGalleryButton.addEventListener("click", () => importInput.click());
  importInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (file) await importGallery(file);
    importInput.value = "";
  });

  exportGalleryButton.addEventListener("click", exportGallery);

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
  viewer.addEventListener("pointerleave", onPointerUp);
  viewer.addEventListener("wheel", onWheel, { passive: false });

  window.addEventListener("dragenter", onDragEnter);
  window.addEventListener("dragover", onDragOver);
  window.addEventListener("dragleave", onDragLeave);
  window.addEventListener("drop", onDrop);
}

function onPointerDown(event) {
  if (galleryPanel.classList.contains("open")) {
    hideGallery();
  }

  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  viewer.setPointerCapture?.(event.pointerId);

  if (pointers.size === 1) {
    isDragging = true;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    viewer.classList.add("dragging");
  }

  if (pointers.size === 2) {
    isDragging = false;
    lastPinchDistance = getPinchDistance();
  }
}

function onPointerMove(event) {
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

  if (pointers.size === 2) {
    const nextDistance = getPinchDistance();
    if (lastPinchDistance > 0) {
      targetFov = clamp(targetFov - (nextDistance - lastPinchDistance) * 0.08, 35, 100);
    }
    lastPinchDistance = nextDistance;
    return;
  }

  if (!isDragging) return;

  const deltaX = event.clientX - lastPointerX;
  const deltaY = event.clientY - lastPointerY;

  targetLon -= deltaX * 0.1;
  targetLat += deltaY * 0.1;
  targetLat = clamp(targetLat, -85, 85);

  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
}

function onPointerUp(event) {
  pointers.delete(event.pointerId);
  viewer.releasePointerCapture?.(event.pointerId);
  lastPinchDistance = 0;

  if (pointers.size === 1) {
    const remainingPointer = [...pointers.values()][0];
    isDragging = true;
    lastPointerX = remainingPointer.x;
    lastPointerY = remainingPointer.y;
  } else {
    isDragging = false;
    viewer.classList.remove("dragging");
  }
}

function onWheel(event) {
  event.preventDefault();
  targetFov = clamp(targetFov + event.deltaY * 0.035, 35, 100);
}

function getPinchDistance() {
  const [a, b] = [...pointers.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function resetView() {
  targetLon = 0;
  targetLat = 0;
  targetFov = 75;
  showToast("Ansicht zurückgesetzt.");
}

async function toggleFullscreen() {
  if (!document.fullscreenElement) {
    await document.documentElement.requestFullscreen?.();
  } else {
    await document.exitFullscreen?.();
  }
  updateFullscreenLabel();
}

function updateFullscreenLabel() {
  const isFullscreen = Boolean(document.fullscreenElement);
  fullscreenButton.setAttribute("aria-label", isFullscreen ? "Vollbild beenden" : "Vollbild starten");
  fullscreenButton.title = isFullscreen ? "Vollbild beenden" : "Vollbild";
  fullscreenButton.textContent = isFullscreen ? "⤢" : "⛶";
}

function onResize() {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.floor(window.innerWidth * pixelRatio);
  const height = Math.floor(window.innerHeight * pixelRatio);

  gl.canvas.width = width;
  gl.canvas.height = height;
  gl.canvas.style.width = `${window.innerWidth}px`;
  gl.canvas.style.height = `${window.innerHeight}px`;
  gl.viewport(0, 0, width, height);
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

  drawScene();
}

function drawScene() {
  const width = gl.canvas.width;
  const height = gl.canvas.height;
  const aspect = width / height;

  const projection = makePerspective(degToRad(fov), aspect, 0.1, 1100);
  const phi = degToRad(90 - lat);
  const theta = degToRad(lon);
  const target = [
    Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta)
  ];
  const view = makeLookAt([0, 0, 0], target, [0, 1, 0]);

  gl.clearColor(0.02, 0.03, 0.05, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  gl.useProgram(program);
  gl.uniformMatrix4fv(uniforms.projection, false, projection);
  gl.uniformMatrix4fv(uniforms.view, false, view);
  gl.uniform1i(uniforms.texture, 0);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, currentTexture);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
  gl.enableVertexAttribArray(attributes.position);
  gl.vertexAttribPointer(attributes.position, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.uv);
  gl.enableVertexAttribArray(attributes.uv);
  gl.vertexAttribPointer(attributes.uv, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.index);
  gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);
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

  try {
    const image = await loadImage(currentObjectUrl);
    const texture = createTextureFromImage(image);

    if (currentTexture) gl.deleteTexture(currentTexture);
    currentTexture = texture;

    resetView();
    markActiveThumb();
    deleteCurrentButton.disabled = false;
    if (options.hideGallery) hideGallery();
  } catch {
    showToast("Bild konnte nicht geladen werden.");
  }
}

function setPlaceholder() {
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = null;
  currentId = null;
  if (currentTexture) gl.deleteTexture(currentTexture);
  currentTexture = createTextureFromCanvas(createPlaceholderCanvas());
  deleteCurrentButton.disabled = true;
}

function renderGallery(items) {
  galleryGrid.innerHTML = "";
  emptyState.style.display = items.length ? "none" : "block";
  clearGalleryButton.disabled = items.length === 0;
  exportGalleryButton.disabled = items.length === 0;

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

async function exportGallery() {
  const items = await getAllPanoramas();
  if (items.length === 0) return;

  showToast("Export wird vorbereitet …");

  const exportedItems = [];
  for (const item of items) {
    exportedItems.push({
      id: item.id,
      name: item.name,
      type: item.type,
      size: item.size,
      createdAt: item.createdAt,
      dataUrl: await blobToDataUrl(item.blob)
    });
  }

  const payload = {
    app: "AI 360 VR Viewer",
    version: 2,
    exportedAt: new Date().toISOString(),
    items: exportedItems
  };

  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ai-360-gallery-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);

  showToast("Galerie exportiert.");
}

async function importGallery(file) {
  try {
    const payload = JSON.parse(await file.text());
    if (!Array.isArray(payload.items)) throw new Error("Invalid import file");

    let imported = 0;
    let firstImportedId = null;

    for (const item of payload.items) {
      if (!item.dataUrl?.startsWith("data:image/")) continue;
      const blob = dataUrlToBlob(item.dataUrl);
      const id = crypto.randomUUID();
      await putPanorama({
        id,
        name: item.name || "imported-panorama",
        type: blob.type || item.type || "image/jpeg",
        size: blob.size,
        createdAt: Date.now() + imported,
        blob
      });
      firstImportedId ??= id;
      imported += 1;
    }

    const items = await getAllPanoramas();
    renderGallery(items);

    if (firstImportedId) await loadPanorama(firstImportedId, { hideGallery: true });
    showToast(`${imported} Bild${imported === 1 ? "" : "er"} importiert.`);
  } catch {
    showToast("Import fehlgeschlagen. Erwartet wird ein Galerie-Export als JSON.");
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
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.createdAt - a.createdAt));
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

function createTextureFromImage(image) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  return texture;
}

function createTextureFromCanvas(canvas) {
  return createTextureFromImage(canvas);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function createPlaceholderCanvas() {
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

  return canvas;
}

function createProgram(glContext, vertexSource, fragmentSource) {
  const vertexShader = compileShader(glContext, glContext.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(glContext, glContext.FRAGMENT_SHADER, fragmentSource);
  const shaderProgram = glContext.createProgram();

  glContext.attachShader(shaderProgram, vertexShader);
  glContext.attachShader(shaderProgram, fragmentShader);
  glContext.linkProgram(shaderProgram);

  if (!glContext.getProgramParameter(shaderProgram, glContext.LINK_STATUS)) {
    throw new Error(glContext.getProgramInfoLog(shaderProgram));
  }

  return shaderProgram;
}

function compileShader(glContext, type, source) {
  const shader = glContext.createShader(type);
  glContext.shaderSource(shader, source);
  glContext.compileShader(shader);

  if (!glContext.getShaderParameter(shader, glContext.COMPILE_STATUS)) {
    throw new Error(glContext.getShaderInfoLog(shader));
  }

  return shader;
}

function createBuffers(glContext, sphereMesh) {
  const position = glContext.createBuffer();
  glContext.bindBuffer(glContext.ARRAY_BUFFER, position);
  glContext.bufferData(glContext.ARRAY_BUFFER, new Float32Array(sphereMesh.positions), glContext.STATIC_DRAW);

  const uv = glContext.createBuffer();
  glContext.bindBuffer(glContext.ARRAY_BUFFER, uv);
  glContext.bufferData(glContext.ARRAY_BUFFER, new Float32Array(sphereMesh.uvs), glContext.STATIC_DRAW);

  const index = glContext.createBuffer();
  glContext.bindBuffer(glContext.ELEMENT_ARRAY_BUFFER, index);
  glContext.bufferData(glContext.ELEMENT_ARRAY_BUFFER, new Uint16Array(sphereMesh.indices), glContext.STATIC_DRAW);

  return { position, uv, index };
}

function createSphereMesh(widthSegments, heightSegments) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const radius = 500;

  for (let y = 0; y <= heightSegments; y += 1) {
    const v = y / heightSegments;
    const phi = v * Math.PI;

    for (let x = 0; x <= widthSegments; x += 1) {
      const u = x / widthSegments;
      const theta = u * Math.PI * 2;

      positions.push(
        -radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta)
      );
      uvs.push(u, 1 - v);
    }
  }

  for (let y = 0; y < heightSegments; y += 1) {
    for (let x = 0; x < widthSegments; x += 1) {
      const a = y * (widthSegments + 1) + x;
      const b = a + widthSegments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  return { positions, uvs, indices };
}

function makePerspective(fieldOfViewRadians, aspect, near, far) {
  const f = Math.tan(Math.PI * 0.5 - 0.5 * fieldOfViewRadians);
  const rangeInv = 1.0 / (near - far);

  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (near + far) * rangeInv, -1,
    0, 0, near * far * rangeInv * 2, 0
  ]);
}

function makeLookAt(cameraPosition, target, up) {
  const zAxis = normalize(subtract(cameraPosition, target));
  const xAxis = normalize(cross(up, zAxis));
  const yAxis = cross(zAxis, xAxis);

  return new Float32Array([
    xAxis[0], yAxis[0], zAxis[0], 0,
    xAxis[1], yAxis[1], zAxis[1], 0,
    xAxis[2], yAxis[2], zAxis[2], 0,
    -dot(xAxis, cameraPosition), -dot(yAxis, cameraPosition), -dot(zAxis, cameraPosition), 1
  ]);
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(v) {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function degToRad(degrees) {
  return degrees * Math.PI / 180;
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

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const [metadata, base64] = dataUrl.split(",");
  const mime = metadata.match(/data:(.*?);base64/)?.[1] || "application/octet-stream";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: mime });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./service-worker.js");
  } catch {
    // PWA enhancement failed silently; the viewer still works online.
  }
}
