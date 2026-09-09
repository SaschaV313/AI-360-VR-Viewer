import { createSphereMesh, makePerspective, makeLookAt, degToRad } from "./math.js";
import { fitDimensions, resizeImage } from "./images.js";

const vertexSource = `attribute vec3 aPosition; attribute vec2 aUv; uniform mat4 uProjection; uniform mat4 uView; varying vec2 vUv; void main(){vUv=aUv;gl_Position=uProjection*uView*vec4(aPosition,1.0);}`;
const fragmentSource = `precision mediump float; uniform sampler2D uTexture; varying vec2 vUv; void main(){gl_FragColor=texture2D(uTexture,vUv);}`;

export class PanoramaRenderer {
  constructor(container, { onLost = () => {}, onRestored = () => {} } = {}) {
    this.canvas = document.createElement("canvas");
    this.container = container;
    // Opening the native picker must not compete with an idle 3D context.
    this.gl = null;
    this.texture = null;
    this.initialized = false;
    this.suspended = false;
    this.canvas.width = this.canvas.height = 1;
    container.append(this.canvas);
    this.mesh = null;
    this.lost = false;
    this.canvas.addEventListener("webglcontextlost", event => {
      event.preventDefault();
      this.lost = true;
      onLost();
    });
    this.canvas.addEventListener("webglcontextrestored", () => {
      try {
        this.texture = null;
        this.initialized = false;
        this.lost = false;
        // The app decides when foreground/picker state permits allocating again.
        onRestored();
      }
      catch (error) { onLost(error); }
    });
  }

  initialize() {
    if (this.initialized) return;
    this.gl ||= this.canvas.getContext("webgl", { antialias: false, alpha: false, depth: false, stencil: false });
    if (!this.gl) throw new Error("WebGL ist in diesem Browser oder auf diesem Gerät nicht verfügbar.");
    this.mesh ||= createSphereMesh(96, 64);
    const gl = this.gl;
    this.texture = null;
    this.program = createProgram(gl, vertexSource, fragmentSource);
    this.buffers = createBuffers(gl, this.mesh);
    this.uniforms = { projection: gl.getUniformLocation(this.program, "uProjection"), view: gl.getUniformLocation(this.program, "uView"), texture: gl.getUniformLocation(this.program, "uTexture") };
    this.attributes = { position: gl.getAttribLocation(this.program, "aPosition"), uv: gl.getAttribLocation(this.program, "aUv") };
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    this.initialized = true;
    this.resize();
  }

  resize() {
    if (!this.gl || this.lost || this.suspended || document.hidden) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(this.container.clientWidth * ratio));
    const height = Math.max(1, Math.floor(this.container.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.gl.viewport(0, 0, width, height);
  }

  setImage(image) {
    if (this.suspended || document.hidden) throw new Error("Die Ansicht pausiert während der Dateiauswahl.");
    if (this.lost) throw new Error("Grafik wird wiederhergestellt. Bitte kurz warten.");
    this.initialize();
    const gl = this.gl;
    if (this.lost || gl.isContextLost()) throw new Error("Grafik wird wiederhergestellt. Bitte kurz warten.");
    const originalWidth = image.naturalWidth || image.width;
    const originalHeight = image.naturalHeight || image.height;
    // Limit both dimensions and decoded texture memory. Originals stay untouched.
    let { width, height } = fitDimensions(originalWidth, originalHeight, Math.min(this.maxTextureSize, 8192), 16 * 1024 * 1024);
    for (;;) {
      let source = image;
      let texture = null;
      try {
        if (width !== originalWidth || height !== originalHeight) source = resizeImage(image, width, height);
        for (let i = 0; i < 32 && gl.getError() !== gl.NO_ERROR; i++) { /* clear stale errors */ }
        texture = gl.createTexture();
        if (!texture) throw new Error("Kein Grafikspeicher verfügbar.");
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        const error = gl.getError();
        if (error !== gl.NO_ERROR || gl.isContextLost()) throw new Error(`Bild konnte nicht in den Grafikspeicher geladen werden (${error}).`);
        const old = this.texture;
        this.texture = texture;
        if (old) gl.deleteTexture(old);
        return { width, height, resized: width !== originalWidth || height !== originalHeight };
      } catch (error) {
        if (texture) gl.deleteTexture(texture);
        if (gl.isContextLost() || Math.max(width, height) <= 1024) throw error;
        width = Math.max(1, Math.floor(width / 2));
        height = Math.max(1, Math.floor(height / 2));
      } finally {
        if (source !== image) source.width = source.height = 1;
      }
    }
  }

  releaseResources() {
    const gl = this.gl;
    if (gl && !gl.isContextLost()) {
      if (this.texture) gl.deleteTexture(this.texture);
      if (this.program) gl.deleteProgram(this.program);
      for (const buffer of Object.values(this.buffers || {})) gl.deleteBuffer(buffer);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.useProgram(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    }
    this.texture = this.program = this.buffers = null;
    this.initialized = false;
    this.canvas.width = this.canvas.height = 1;
    if (gl && !gl.isContextLost()) gl.flush();
  }

  suspend() {
    if (this.suspended) return;
    this.suspended = true;
    this.releaseResources();
  }

  resume() { this.suspended = false; }

  // The empty state is HTML/CSS; it needs no GPU texture or WebGL context.
  placeholder() { this.releaseResources(); }

  draw({ lon, lat, fov }) {
    if (this.lost || this.suspended || !this.texture || document.hidden) return;
    const gl = this.gl;
    const phi = degToRad(90 - lat), theta = degToRad(lon);
    const target = [Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)];
    gl.clearColor(0.02, 0.03, 0.05, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniforms.projection, false, makePerspective(degToRad(fov), this.canvas.width / this.canvas.height, 0.1, 1100));
    gl.uniformMatrix4fv(this.uniforms.view, false, makeLookAt([0, 0, 0], target, [0, 1, 0]));
    gl.uniform1i(this.uniforms.texture, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
    gl.enableVertexAttribArray(this.attributes.position);
    gl.vertexAttribPointer(this.attributes.position, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.uv);
    gl.enableVertexAttribArray(this.attributes.uv);
    gl.vertexAttribPointer(this.attributes.uv, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffers.index);
    gl.drawElements(gl.TRIANGLES, this.mesh.indices.length, gl.UNSIGNED_SHORT, 0);
  }
}

function createProgram(glContext,vertexSource,fragmentSource){
  const vertexShader=compileShader(glContext,glContext.VERTEX_SHADER,vertexSource);
  const fragmentShader=compileShader(glContext,glContext.FRAGMENT_SHADER,fragmentSource);
  const shaderProgram=glContext.createProgram();
  glContext.attachShader(shaderProgram,vertexShader);glContext.attachShader(shaderProgram,fragmentShader);glContext.linkProgram(shaderProgram);
  glContext.deleteShader(vertexShader);glContext.deleteShader(fragmentShader);
  if(!glContext.getProgramParameter(shaderProgram,glContext.LINK_STATUS)) throw new Error(glContext.getProgramInfoLog(shaderProgram));
  return shaderProgram;
}
function compileShader(glContext,type,source){const shader=glContext.createShader(type);glContext.shaderSource(shader,source);glContext.compileShader(shader);if(!glContext.getShaderParameter(shader,glContext.COMPILE_STATUS)) throw new Error(glContext.getShaderInfoLog(shader));return shader;}
function createBuffers(glContext,sphereMesh){
  const position=glContext.createBuffer();glContext.bindBuffer(glContext.ARRAY_BUFFER,position);glContext.bufferData(glContext.ARRAY_BUFFER,new Float32Array(sphereMesh.positions),glContext.STATIC_DRAW);
  const uv=glContext.createBuffer();glContext.bindBuffer(glContext.ARRAY_BUFFER,uv);glContext.bufferData(glContext.ARRAY_BUFFER,new Float32Array(sphereMesh.uvs),glContext.STATIC_DRAW);
  const index=glContext.createBuffer();glContext.bindBuffer(glContext.ELEMENT_ARRAY_BUFFER,index);glContext.bufferData(glContext.ELEMENT_ARRAY_BUFFER,new Uint16Array(sphereMesh.indices),glContext.STATIC_DRAW);
  return{position,uv,index};
}

