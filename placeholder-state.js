(() => {
  const DB_NAME = "ai-360-vr-viewer";
  const STORE_NAME = "panoramas";
  const overlay = document.querySelector("#placeholderOverlay");
  const fileInput = document.querySelector("#fileInput");
  const importInput = document.querySelector("#importInput");
  const clearGallery = document.querySelector("#clearGallery");
  const deleteCurrent = document.querySelector("#deleteCurrent");
  const galleryGrid = document.querySelector("#galleryGrid");

  if (!overlay) return;

  updateOverlay();

  fileInput?.addEventListener("change", () => hideOverlay());
  importInput?.addEventListener("change", () => hideOverlay());
  galleryGrid?.addEventListener("click", (event) => {
    if (event.target.closest(".thumb")) hideOverlay();
  });
  clearGallery?.addEventListener("click", () => setTimeout(updateOverlay, 500));
  deleteCurrent?.addEventListener("click", () => setTimeout(updateOverlay, 500));

  function hideOverlay() {
    overlay.classList.add("hidden");
    overlay.setAttribute("aria-hidden", "true");
  }

  function showOverlay() {
    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");
  }

  function updateOverlay() {
    countStoredImages()
      .then((count) => count > 0 ? hideOverlay() : showOverlay())
      .catch(showOverlay);
  }

  function countStoredImages() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.close();
          resolve(0);
          return;
        }
        const transaction = db.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const countRequest = store.count();
        countRequest.onsuccess = () => {
          db.close();
          resolve(countRequest.result);
        };
        countRequest.onerror = () => {
          db.close();
          reject(countRequest.error);
        };
      };
    });
  }
})();
