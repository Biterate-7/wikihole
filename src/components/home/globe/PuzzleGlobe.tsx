"use client";

import { useEffect, useRef, useState } from "react";
import { createGlobeRenderer } from "./renderer";
import styles from "../home.module.css";

const TURN = Math.PI * 2;
/** Spin the globe turns in from on load, in radians. */
const INTRO = -1.1;
const INTRO_MS = 1500;
/** Momentum decay per second after a fling, the pause before settling back, and the settle itself. */
const FRICTION = 3.2;
const SETTLE_AFTER_MS = 1400;
const SETTLE_MS = 900;

/**
 * WikiHole's puzzle globe, rendered live in WebGL. It turns in on load, can
 * be dragged (or flung) around its tilted axis, and settles back to its rest
 * pose. Falls back to the static image without WebGL2.
 */
export function PuzzleGlobe({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = createGlobeRenderer(canvas);
    if (!renderer) {
      setFallback(true);
      return;
    }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let spin = reduced ? 0 : INTRO;
    let velocity = 0;
    let dragging: { x: number; t: number } | null = null;
    let lastInput = performance.now();
    let settleFrom: { spin: number; t: number; duration: number } | null = reduced
      ? null
      : { spin, t: performance.now(), duration: INTRO_MS };
    let frame = 0;
    let last = performance.now();

    const draw = () => renderer.render(spin);

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      let active = !!dragging;
      if (!dragging && settleFrom) {
        // Ease back to the nearest whole turn: the rest pose.
        const k = Math.min(1, (now - settleFrom.t) / settleFrom.duration);
        const target = Math.round(settleFrom.spin / TURN) * TURN;
        spin = settleFrom.spin + (target - settleFrom.spin) * (1 - (1 - k) ** 3);
        if (k < 1) active = true;
        else {
          spin = 0;
          settleFrom = null;
        }
      } else if (!dragging) {
        if (Math.abs(velocity) > 0.02) {
          spin += velocity * dt;
          velocity *= Math.exp(-FRICTION * dt);
          lastInput = now;
          active = true;
        } else if (spin !== 0 && !reduced) {
          velocity = 0;
          if (now - lastInput > SETTLE_AFTER_MS) settleFrom = { spin, t: now, duration: SETTLE_MS };
          active = true;
        }
      }
      draw();
      frame = active ? requestAnimationFrame(tick) : 0;
    };
    const wake = () => {
      if (!frame) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };

    const onDown = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const [dx, dy] = [event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2];
      if (Math.hypot(dx, dy) > rect.width / 2) return;
      canvas.setPointerCapture(event.pointerId);
      dragging = { x: event.clientX, t: event.timeStamp };
      settleFrom = null;
      velocity = 0;
      wake();
    };
    const onMove = (event: PointerEvent) => {
      if (!dragging) return;
      const width = canvas.clientWidth || 1;
      const delta = ((event.clientX - dragging.x) / width) * Math.PI;
      const dt = Math.max(1, event.timeStamp - dragging.t) / 1000;
      spin += delta;
      velocity = velocity * 0.6 + (delta / dt) * 0.4;
      dragging = { x: event.clientX, t: event.timeStamp };
      lastInput = performance.now();
    };
    const onUp = (event: PointerEvent) => {
      if (!dragging) return;
      if (reduced || event.timeStamp - dragging.t > 80) velocity = 0;
      dragging = null;
      lastInput = performance.now();
      wake();
    };

    const resize = new ResizeObserver(() => {
      renderer.resize();
      draw();
    });
    resize.observe(canvas);
    const onLost = (event: Event) => {
      event.preventDefault();
      setFallback(true);
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    renderer.resize();
    wake();

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      renderer.dispose();
    };
  }, []);

  if (fallback) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={className} src="/wikihole-globe.svg" width={200} height={200} alt="" />;
  }
  return (
    <div className={className}>
      <canvas ref={canvasRef} className={styles.globeCanvas} aria-hidden="true" />
    </div>
  );
}
