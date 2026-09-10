// Resolve against the page for compatibility with the former bootstrap, which
// may still execute this entry point from a blob URL in an older PWA cache.
// Supply status elements when that cache still serves the previous HTML shell.
for (const [id, tag, parent, className] of [
  ["loadStatus", "div", document.body, "load-status"],
  ["operationStatus", "p", document.querySelector("#galleryPanel"), "operation-status"],
  ["storageNotice", "p", document.querySelector("#galleryPanel"), "storage-notice"],
  ["exportDownload", "a", document.querySelector("#galleryPanel"), "download-link"],
  ["selectionStatus", "p", document.querySelector(".upload-card"), "selection-status"],
]) {
  if (!document.getElementById(id) && parent) {
    const element = document.createElement(tag);
    element.id = id;
    element.className = className;
    if (tag === "a") { element.textContent = "Export herunterladen"; element.hidden = true; }
    else element.setAttribute("role", "status");
    parent.append(element);
  }
}
// Also support the prior cached HTML when a new entry point is loaded.
const uploadCard = document.querySelector(".upload-card");
if (uploadCard && !document.getElementById("openSelected")) {
  const button = document.createElement("button");
  button.id = "openSelected";
  button.type = "button";
  button.className = "ghost-button primary-button";
  button.disabled = true;
  button.textContent = "Öffnen & speichern";
  uploadCard.append(button);
}
import(new URL("./viewer-app.js", document.baseURI).href).catch(error => {
  console.error("AI 360 VR Viewer konnte nicht gestartet werden:", error);
  const message = document.querySelector("#loadStatus") || document.querySelector("#viewer");
  if (message) message.textContent = "Die App konnte nicht geladen werden. Bitte die Seite erneut laden.";
});
