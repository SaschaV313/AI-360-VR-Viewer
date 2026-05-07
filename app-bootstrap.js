const APP_SOURCE = "./app.js?gyro-axis-fix=2";

const replacements = [
  [
    `const viewerForward=normalize([-deviceForward[2],deviceForward[1],deviceForward[0]]);\n  targetLon=radToDeg(Math.atan2(viewerForward[2],viewerForward[0]));\n  targetLat=clamp(radToDeg(Math.asin(clamp(viewerForward[1],-1,1))),-89,89);`,
    `const viewerForward=normalize([-deviceForward[2],deviceForward[1],deviceForward[0]]);\n  const rawLon=radToDeg(Math.atan2(viewerForward[2],viewerForward[0]));\n  const rawLat=clamp(radToDeg(Math.asin(clamp(viewerForward[1],-1,1))),-89,89);\n  targetLon=unwrapAngle(targetLon,rawLon);\n  targetLat=rawLat;`
  ],
  [
    `lon+=(targetLon-lon)*0.12;`,
    `lon+=shortestAngleDelta(targetLon,lon)*0.12;`
  ],
  [
    `function radToDeg(radians){return radians*180/Math.PI;}`,
    `function radToDeg(radians){return radians*180/Math.PI;}\nfunction shortestAngleDelta(target,current){let delta=target-current;while(delta>180)delta-=360;while(delta<-180)delta+=360;return delta;}\nfunction unwrapAngle(reference,value){return reference+shortestAngleDelta(value,reference);}`
  ],
  [
    `targetLon=0;targetLat=0;\n  if(showMessage) showToast("Gyro-Referenz neu gesetzt.");`,
    `targetLon=0;targetLat=0;lon=0;lat=0;\n  if(showMessage) showToast("Gyro-Referenz neu gesetzt.");`
  ]
];

try {
  const response = await fetch(APP_SOURCE, { cache: "reload" });
  if (!response.ok) throw new Error(`Could not load ${APP_SOURCE}`);

  let source = await response.text();
  for (const [needle, replacement] of replacements) {
    if (!source.includes(needle)) {
      console.warn("AI 360 VR Viewer: expected patch target was not found.");
      continue;
    }
    source = source.replace(needle, replacement);
  }

  const patchedModuleUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  await import(patchedModuleUrl);
  URL.revokeObjectURL(patchedModuleUrl);
} catch (error) {
  console.error("AI 360 VR Viewer: failed to start patched app.", error);
  const viewer = document.querySelector("#viewer");
  if (viewer) {
    viewer.innerHTML = '<div class="fatal-error">Die App konnte nicht geladen werden.</div>';
  }
}
