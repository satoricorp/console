"use client";

/*
  PinBoard — React pin-art background component.

  A full-bleed field of pins (Three.js); the cursor pushes them up like a
  pin-impression toy, they hold while hovered, then sink back smoothly.
*/
import { useEffect, useRef, type CSSProperties } from "react";
import * as THREE from "three";
import { cn } from "@/lib/utils";

export type PinBoardProps = {
  theme?: "dark" | "light";
  mouse?: boolean;
  color?: boolean;
  auto?: boolean;
  intensity?: number;
  hue?: number;
  hold?: number;
  decay?: number;
  style?: CSSProperties;
  className?: string;
};

const hash = (x: number, y: number) => {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
};
const smooth = (t: number) => t * t * (3 - 2 * t);
const vnoise = (x: number, y: number) => {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  const u = smooth(xf);
  const v = smooth(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
const fbm = (x: number, y: number) =>
  vnoise(x, y) * 0.55 +
  vnoise(x * 2.13, y * 2.13) * 0.28 +
  vnoise(x * 4.31, y * 4.31) * 0.17;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function PinBoard({
  theme = "dark",
  mouse = true,
  color = true,
  auto = false,
  intensity = 6,
  hue = 210,
  hold = 0,
  decay = 0.6,
  style,
  className,
}: PinBoardProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef({
    theme,
    mouse,
    color,
    auto,
    intensity,
    hue,
    hold,
    decay,
  });
  propsRef.current = { theme, mouse, color, auto, intensity, hue, hold, decay };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let raf = 0;
    let renderer: THREE.WebGLRenderer | null = null;
    let ro: ResizeObserver | null = null;
    let onMove: ((e: PointerEvent) => void) | null = null;
    let geo: THREE.CylinderGeometry | null = null;
    let mat: THREE.MeshStandardMaterial | null = null;

    const probe = document.createElement("canvas");
    const gl =
      probe.getContext("webgl2", { failIfMajorPerformanceCaveat: false }) ||
      probe.getContext("webgl", { failIfMajorPerformanceCaveat: false });
    if (!gl) return;

    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        canvas: document.createElement("canvas"),
      });
    } catch {
      return;
    }
    if (!renderer.getContext()) {
      renderer.dispose();
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.domElement.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;display:block;";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    cam.position.set(7, 6.5, 4.5);
    cam.lookAt(-1.5, 0, -0.8);

    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(3, 6, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.8);
    rim.position.set(-4, 2, -3);
    scene.add(rim);
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));

    const COLS = 280;
    const ROWS = 174;
    const n = COLS * ROWS;
    const H = new Float32Array(n);
    const LP = new Float32Array(n);
    const prev = new Float32Array(n).fill(-1);

    geo = new THREE.CylinderGeometry(0.0095, 0.0095, 1, 6, 3);
    geo.translate(0, 0.5, 0);
    {
      const pos = geo.attributes.position;
      const vcol = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const s = y > 0.96 ? 1 : 0.12 + y * 0.45;
        vcol[i * 3] = vcol[i * 3 + 1] = vcol[i * 3 + 2] = s;
      }
      geo.setAttribute("color", new THREE.BufferAttribute(vcol, 3));
    }
    /* Dark field: a tight highlight blows out to white on the pin tips no matter
       how dark the instance colour is, so the dark theme spreads the specular. */
    mat = new THREE.MeshStandardMaterial({
      metalness: 0.85,
      roughness: 0.65,
      vertexColors: true,
      color: 0xffffff,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(n * 3),
      3,
    );
    scene.add(mesh);

    const dummy = new THREE.Object3D();
    const c = new THREE.Color();

    const rot = 0.38;
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    let spanX = 12;
    let spanZ = 8;
    let cx = 0;
    let cz = 0;
    let lastSpanX = 0;
    let lastSpanZ = 0;
    let lastDark: boolean | null = null;

    const resize = () => {
      if (!renderer) return;
      const r = host.getBoundingClientRect();
      const w = Math.max(1, r.width);
      const h = Math.max(1, r.height);
      renderer.setSize(w, h, false);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
      let minX = 1e9;
      let maxX = -1e9;
      let minZ = 1e9;
      let maxZ = -1e9;
      const v = new THREE.Vector3();
      for (const [nx, ny] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const) {
        v.set(nx, ny, 0.5).unproject(cam);
        const dir = v.sub(cam.position).normalize();
        const s = -cam.position.y / dir.y;
        const px = cam.position.x + dir.x * s;
        const pz = cam.position.z + dir.z * s;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (pz < minZ) minZ = pz;
        if (pz > maxZ) maxZ = pz;
      }
      const mx = (maxX - minX) * 0.28;
      const mz = (maxZ - minZ) * 0.28;
      spanX = maxX - minX + mx * 2;
      spanZ = maxZ - minZ + mz * 2;
      cx = (minX + maxX) / 2;
      cz = (minZ + maxZ) / 2;
    };
    ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    let px: number | null = null;
    let py: number | null = null;
    onMove = (e) => {
      const r = host.getBoundingClientRect();
      if (!r.width || !r.height) return;
      px = (e.clientX - r.left) / r.width;
      py = (e.clientY - r.top) / r.height;
    };
    window.addEventListener("pointermove", onMove);

    const toGrid = (nx: number, ny: number): [number, number] => {
      const v = new THREE.Vector3(nx * 2 - 1, -(ny * 2 - 1), 0.5).unproject(cam);
      const dir = v.sub(cam.position).normalize();
      const s = -cam.position.y / dir.y;
      const wx = cam.position.x + dir.x * s;
      const wz = cam.position.z + dir.z * s;
      const lx = (wx - cx) * cosR + (wz - cz) * sinR;
      const lz = -(wx - cx) * sinR + (wz - cz) * cosR;
      return [(lx / spanX + 0.5) * COLS, (lz / spanZ + 0.5) * ROWS];
    };

    let t = Math.random() * 100;
    let last = performance.now();
    const tick = (now: number) => {
      if (disposed || !renderer) return;
      raf = requestAnimationFrame(tick);
      const p = propsRef.current;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      t += dt;
      const mouseOn = p.mouse !== false;
      const colorOn = p.color !== false;
      const autoOn = p.auto === true;
      const dark = p.theme !== "light";
      const intensityVal = +p.intensity > 0 ? +p.intensity : 6;
      const decayVal = +p.decay > 0 ? +p.decay : 0.6;
      const holdVal = (+p.hold > 0 ? +p.hold : 0) * 1000;
      const baseHue = ((+p.hue >= 0 ? +p.hue : 210) % 360) / 360;

      if (!scene.background) {
        scene.background = new THREE.Color();
      }
      (scene.background as THREE.Color).set(dark ? 0x0b0d12 : 0xf1efe9);

      const near =
        px != null &&
        py != null &&
        px > -0.1 &&
        px < 1.1 &&
        py > -0.1 &&
        py < 1.1;
      const live = mouseOn && near;
      const presses: [number, number, number][] = [];
      if (live && px != null && py != null) {
        const g = toGrid(px, py);
        presses.push([g[0], g[1], 1]);
      }
      if (autoOn) {
        const g = toGrid(
          clamp01((fbm(t * 0.13, 5.31) - 0.15) * 1.4),
          clamp01((fbm(7.77, t * 0.11) - 0.15) * 1.4),
        );
        presses.push([g[0], g[1], 0.7]);
      }

      const R = (2.4 + intensityVal) * 1.6;
      const fade = Math.exp(-dt / decayVal);
      for (let i = 0; i < n; i++) {
        if (now - LP[i]! > holdVal) H[i]! *= fade;
      }
      for (const [bx, by, str] of presses) {
        const x0 = Math.max(0, (bx - R * 2) | 0);
        const x1 = Math.min(COLS - 1, (bx + R * 2) | 0);
        const y0 = Math.max(0, (by - R * 2) | 0);
        const y1 = Math.min(ROWS - 1, (by + R * 2) | 0);
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const dx = x - bx;
            const dy = y - by;
            const pr = Math.exp(-(dx * dx + dy * dy) / (R * R)) * str;
            const i = y * COLS + x;
            if (pr > H[i]!) H[i]! += (pr - H[i]!) * Math.min(1, dt * 6);
            if (pr > 0.05) LP[i] = now;
          }
        }
      }

      const hueDrift = colorOn ? (baseHue + t * 0.015) % 1 : baseHue;
      const spanDirty =
        lastSpanX !== spanX || lastSpanZ !== spanZ || lastDark !== dark;
      if (lastDark !== dark && mat) mat.roughness = dark ? 0.65 : 0.35;
      lastSpanX = spanX;
      lastSpanZ = spanZ;
      lastDark = dark;
      let dirty = spanDirty;
      const cw = spanX / COLS;
      const ch = spanZ / ROWS;
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const i = y * COLS + x;
          const v = clamp01(H[i]!);
          if (!spanDirty && Math.abs(v - prev[i]!) < 0.003) continue;
          prev[i] = v;
          dirty = true;
          const jx = (hash(x * 1.7 + 3.1, y * 2.3) - 0.5) * cw * 0.85;
          const jz = (hash(x * 2.9, y * 1.3 + 7.7) - 0.5) * ch * 0.85;
          const lx = (x / (COLS - 1) - 0.5) * spanX + jx;
          const lz = (y / (ROWS - 1) - 0.5) * spanZ + jz;
          dummy.position.set(
            cx + lx * cosR - lz * sinR,
            0,
            cz + lx * sinR + lz * cosR,
          );
          dummy.scale.set(1, 0.12 + v * v * (3 - 2 * v) * 1.6, 1);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          /* Dark field stays grey end to end: `rest` sinks the idle pins into the
             background and `peak` keeps even a fully raised tip off white. */
          const rest = dark ? 0.015 : 0.58;
          const peak = dark ? 0.095 : 1;
          const L = rest + (peak - rest) * v;
          if (colorOn && v > 0.03) c.setHSL(hueDrift, 0.3 * v * (1 - v), L);
          else c.setHSL(0, 0, L);
          mesh.setColorAt(i, c);
        }
      }
      if (dirty) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
      renderer.render(scene, cam);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      if (onMove) window.removeEventListener("pointermove", onMove);
      if (ro) ro.disconnect();
      if (renderer) {
        renderer.dispose();
        if (renderer.domElement.parentNode) {
          renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
      }
      geo?.dispose();
      mat?.dispose();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className={cn(className)}
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
        ...style,
      }}
      aria-hidden
    />
  );
}
