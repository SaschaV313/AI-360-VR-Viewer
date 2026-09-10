import { clamp, degToRad, radToDeg, normalize, shortestAngleDelta, unwrapAngle,
  quaternionFromEulerYXZ, quaternionFromAxisAngle, quaternionMultiply,
  quaternionInvert, quaternionNormalize, rotateVectorByQuaternion } from "./math.js";

export function createControls(viewer, renderer, { showToast, hideGallery }) {
  const gyroButton = document.querySelector("#gyroToggle");
  const fullscreenButton = document.querySelector("#fullscreenToggle");
  let lon = 0, lat = 0, fov = 75, targetLon = 0, targetLat = 0, targetFov = 75;
  let frame = 0, previousTime = 0;
  let gyroEnabled = false, gyroReference = null, lastGyro = null, sensorTimer = 0;
  const pointers = new Map();
  let pinchDistance = 0;

  // Draw only while the view changes, and pause completely in background tabs.
  function invalidate() {
    if (!frame && !document.hidden && !renderer.lost && !renderer.suspended && renderer.texture) frame = requestAnimationFrame(animate);
  }

  function animate(time) {
    frame = 0;
    if (document.hidden || renderer.suspended || renderer.lost || !renderer.texture) return;
    const delta = previousTime ? Math.min(50, time - previousTime) : 16.67;
    previousTime = time;
    const smoothing = 1 - Math.pow(0.88, delta / 16.67);
    lon += shortestAngleDelta(targetLon, lon) * smoothing;
    lat += (targetLat - lat) * smoothing;
    fov += (targetFov - fov) * smoothing;
    const moving = Math.abs(shortestAngleDelta(targetLon, lon)) + Math.abs(targetLat - lat) + Math.abs(targetFov - fov) > 0.01;
    if (!moving) { lon = targetLon; lat = targetLat; fov = targetFov; previousTime = 0; }
    renderer.draw({ lon, lat, fov });
    if (moving) invalidate();
  }

  function reset(showMessage = false) {
    gyroReference = gyroEnabled && lastGyro ? [...lastGyro] : null;
    lon = lat = targetLon = targetLat = 0;
    fov = targetFov = 75;
    invalidate();
    if (showMessage) showToast(gyroEnabled ? "Gyro-Referenz neu gesetzt." : "Ansicht zurückgesetzt.");
  }

  function pause() {
    cancelAnimationFrame(frame); frame = 0; previousTime = 0; pointers.clear();
    viewer.classList.remove("dragging");
  }

  function resize() { renderer.resize(); invalidate(); }
  window.addEventListener("resize", resize);
  window.visualViewport?.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
    else resize();
  });
  window.addEventListener("orientationchange", () => setTimeout(() => {
    resize();
    // Wait for a sample in the new screen coordinate system.
    gyroReference = lastGyro = null;
    if (gyroEnabled) reset();
  }, 250));

  viewer.addEventListener("pointerdown", event => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    hideGallery();
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    viewer.setPointerCapture?.(event.pointerId);
    viewer.classList.add("dragging");
    if (pointers.size === 2) pinchDistance = getPinchDistance();
  });
  viewer.addEventListener("pointermove", event => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const distance = getPinchDistance();
      targetFov = clamp(targetFov - (distance - pinchDistance) * 0.08, 35, 100);
      pinchDistance = distance;
    } else if (pointers.size === 1 && !gyroEnabled) {
      targetLon -= (event.clientX - previous.x) * 0.1;
      targetLat = clamp(targetLat + (event.clientY - previous.y) * 0.1, -89, 89);
    }
    invalidate();
  });
  function release(event) {
    pointers.delete(event.pointerId);
    if (viewer.hasPointerCapture?.(event.pointerId)) viewer.releasePointerCapture(event.pointerId);
    pinchDistance = pointers.size === 2 ? getPinchDistance() : 0;
    if (!pointers.size) viewer.classList.remove("dragging");
  }
  viewer.addEventListener("pointerup", release);
  viewer.addEventListener("pointercancel", release);
  viewer.addEventListener("lostpointercapture", release);
  function getPinchDistance() {
    const [a, b] = pointers.values();
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  viewer.addEventListener("wheel", event => {
    event.preventDefault();
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewer.clientHeight : 1;
    targetFov = clamp(targetFov + event.deltaY * scale * 0.035, 35, 100);
    invalidate();
  }, { passive: false });
  document.querySelector("#resetView").addEventListener("click", () => reset(true));

  const root = document.documentElement;
  const requestFullscreen = root.requestFullscreen || root.webkitRequestFullscreen;
  fullscreenButton.disabled = !requestFullscreen;
  if (!requestFullscreen) fullscreenButton.title = "Vollbild wird von diesem Browser nicht unterstützt.";
  const fullscreenActive = () => Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  function updateFullscreen() {
    const active = fullscreenActive();
    fullscreenButton.setAttribute("aria-label", active ? "Vollbild beenden" : "Vollbild starten");
    fullscreenButton.textContent = active ? "⤢" : "⛶";
    resize();
  }
  fullscreenButton.addEventListener("click", async () => {
    try {
      if (fullscreenActive()) await (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
      else await requestFullscreen?.call(root);
    } catch { showToast("Vollbild konnte nicht gestartet werden."); }
    updateFullscreen();
  });
  document.addEventListener("fullscreenchange", updateFullscreen);
  document.addEventListener("webkitfullscreenchange", updateFullscreen);

  function disableGyro(message = "Gyro aus.") {
    gyroEnabled = false;
    gyroReference = lastGyro = null;
    clearTimeout(sensorTimer);
    window.removeEventListener("deviceorientation", onOrientation, true);
    gyroButton.setAttribute("aria-pressed", "false");
    gyroButton.setAttribute("aria-label", "Gyro einschalten");
    gyroButton.title = "Gyro einschalten";
    showToast(message);
  }

  gyroButton.addEventListener("click", async () => {
    if (gyroEnabled) return disableGyro();
    if (!("DeviceOrientationEvent" in window)) return showToast("Gyro wird von diesem Browser nicht unterstützt.");
    try {
      if (typeof DeviceOrientationEvent.requestPermission === "function") {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (permission !== "granted") return showToast("Bewegungssensor nicht freigegeben.");
      }
      gyroEnabled = true;
      gyroReference = lastGyro = null;
      window.addEventListener("deviceorientation", onOrientation, true);
      gyroButton.setAttribute("aria-pressed", "true");
      gyroButton.setAttribute("aria-label", "Gyro ausschalten");
      gyroButton.title = "Gyro ausschalten";
      sensorTimer = setTimeout(() => { if (!lastGyro) disableGyro("Keine Sensordaten empfangen. Ziehen zum Umschauen bleibt verfügbar."); }, 4000);
      showToast("Gyro aktiv. Reset setzt die Referenz neu.");
    } catch { showToast("Gyro konnte nicht aktiviert werden."); }
  });

  function onOrientation(event) {
    if (document.hidden || renderer.suspended || !gyroEnabled || ![event.alpha, event.beta, event.gamma].every(Number.isFinite)) return;
    const screenAngle = screen.orientation?.angle ?? window.orientation ?? 0;
    let q = quaternionFromEulerYXZ(degToRad(event.beta), degToRad(event.alpha), -degToRad(event.gamma));
    q = quaternionMultiply(q, quaternionFromAxisAngle([1, 0, 0], -Math.PI / 2));
    q = quaternionNormalize(quaternionMultiply(q, quaternionFromAxisAngle([0, 0, 1], -degToRad(screenAngle))));
    lastGyro = q;
    clearTimeout(sensorTimer);
    if (!gyroReference) gyroReference = q;
    const relative = quaternionMultiply(quaternionInvert(gyroReference), q);
    const forward = rotateVectorByQuaternion([0, 0, -1], relative);
    const direction = normalize([-forward[2], forward[1], forward[0]]);
    targetLon = unwrapAngle(targetLon, radToDeg(Math.atan2(direction[2], direction[0])));
    targetLat = clamp(radToDeg(Math.asin(clamp(direction[1], -1, 1))), -89, 89);
    invalidate();
  }

  return { reset, invalidate, resize, pause };
}
