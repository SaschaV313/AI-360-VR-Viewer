const MIME_TYPES = {
  jpg: "image/jpeg", jpeg: "image/jpeg", jfif: "image/jpeg", pjpeg: "image/jpeg",
  png: "image/png", webp: "image/webp", avif: "image/avif", gif: "image/gif",
  bmp: "image/bmp", svg: "image/svg+xml", heic: "image/heic", heif: "image/heif",
};

export function imageType(file) {
  const declared = (file.type || "").toLowerCase();
  if (declared.startsWith("image/")) return declared;
  return MIME_TYPES[(file.name || "").split(".").pop().toLowerCase()] || "";
}

export function createId(cryptoProvider = globalThis.crypto) {
  if (typeof cryptoProvider?.randomUUID === "function") return cryptoProvider.randomUUID();
  const bytes = new Uint8Array(16);
  if (cryptoProvider?.getRandomValues) cryptoProvider.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return `${Date.now().toString(36)}-${Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("")}`;
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Datei konnte nicht gelesen werden."));
    reader.onabort = () => reject(new Error("Lesen wurde abgebrochen."));
    reader.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(dataUrl) {
  if (typeof dataUrl !== "string") throw new Error("Ungültige Bilddaten.");
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]*)$/i.exec(dataUrl);
  if (!match) throw new Error("Ungültige Bilddaten.");
  const binary = atob(match[2]);
  if (!binary.length) throw new Error("Leere Bilddatei.");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: match[1] });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = setTimeout(() => finish(new Error("Das Bild konnte nicht rechtzeitig gelesen werden.")), 20000);
    function finish(error) {
      clearTimeout(timer);
      image.onload = image.onerror = null;
      if (error) { image.removeAttribute("src"); reject(error); }
      else resolve(image);
    }
    image.onload = () => image.naturalWidth && image.naturalHeight ? finish() : finish(new Error("Leeres Bild."));
    image.onerror = () => finish(new Error("Bildformat wird nicht unterstützt oder die Datei ist beschädigt."));
    image.src = url;
  });
}

export async function decodeImage(blob) {
  if (!(blob instanceof Blob) || !blob.size) throw new Error("Die Bilddatei ist leer oder nicht lesbar.");
  let url;
  try {
    url = URL.createObjectURL(blob);
    return await loadImage(url);
  } catch {
    // Some browser/storage combinations cannot resolve blob URLs. FileReader
    // also handles a synchronous createObjectURL failure; use it only on failure.
    return await loadImage(await blobToDataUrl(blob));
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

export function fitDimensions(width, height, maxDimension, maxPixels = Infinity) {
  if (![width, height, maxDimension, maxPixels].every(value => value > 0) || !Number.isFinite(width + height + maxDimension)) {
    throw new Error("Ungültige Bildgröße.");
  }
  const scale = Math.min(1, maxDimension / width, maxDimension / height, Math.sqrt(maxPixels / (width * height)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

export function resizeImage(image, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Nicht genug Speicher zur Bildverarbeitung.");
  context.drawImage(image, 0, 0, width, height);
  return canvas;
}

export async function createThumbnail(image) {
  const { width, height } = fitDimensions(image.naturalWidth, image.naturalHeight, 320, 320 * 160);
  const canvas = resizeImage(image, width, height);
  try {
    return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Vorschaubild konnte nicht erstellt werden.")), "image/jpeg", 0.75));
  } finally {
    canvas.width = canvas.height = 1;
  }
}

export async function prepareImage(file, name = file.name || "Panorama") {
  const type = imageType({ type: file.type, name });
  if (!type) throw new Error("Bitte eine Bilddatei auswählen.");
  // Detach from the file picker's temporary file handle before persisting.
  const blob = new Blob([await file.arrayBuffer()], { type });
  let image;
  try {
    image = await decodeImage(blob);
    const thumbnail = await createThumbnail(image);
    return { id: createId(), name, type, size: blob.size, createdAt: Date.now(), blob, thumbnail, width: image.naturalWidth, height: image.naturalHeight };
  } catch (error) {
    if (/hei[cf]/i.test(type)) throw new Error("Dieses HEIC/HEIF-Bild lässt sich hier nicht öffnen. Bitte als JPEG oder PNG exportieren.");
    throw error;
  } finally {
    image?.removeAttribute("src");
  }
}
