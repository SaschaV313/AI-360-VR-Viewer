// Kept as a stable entry point for existing installations. All fixes live in
// ordinary ES modules; no fetched source rewriting or blob-module execution.
import("./app.js").catch(error => {
  console.error("AI 360 VR Viewer konnte nicht gestartet werden:", error);
  const message = document.querySelector("#loadStatus") || document.querySelector("#viewer");
  if (message) message.textContent = "Die App konnte nicht geladen werden. Bitte die Seite erneut laden.";
});
