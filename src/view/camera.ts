/**
 * 2.5D 镜头：侧视 + 轻微透视跟随，受击震动、终结定帧推近
 */

import * as THREE from 'three';
import { bus } from '../core/bus';
import { clamp, damp } from '../core/math';

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private shakeStrength = 0;
  private shakeFrames = 0;
  private baseDist = 7.6;
  private target = new THREE.Vector3(0, 1.4, 0);
  private lookAt = new THREE.Vector3(0, 1.4, 0);
  private shakeOffset = new THREE.Vector3();
  private zoom = 1;
  private zoomTarget = 1;
  private rng = Math.random;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(40, aspect, 0.1, 120);
    this.camera.position.set(0, 2.35, this.baseDist);
    bus.on('fx:shake', ({ strength, frames }) => {
      this.shakeStrength = Math.max(this.shakeStrength, strength);
      this.shakeFrames = Math.max(this.shakeFrames, frames);
    });
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  punchZoom(amount: number, frames = 40): void {
    this.zoomTarget = amount;
    window.setTimeout(() => {
      this.zoomTarget = 1;
    }, frames * (1000 / 60));
  }

  update(dt: number, p0x: number, p1x: number, p0y: number, p1y: number, active: boolean): void {
    const midX = (p0x + p1x) / 2;
    const span = Math.abs(p1x - p0x);
    const dist = clamp(this.baseDist + span * 0.28, 7.4, 10.4);

    this.zoom = damp(this.zoom, this.zoomTarget, 6, dt);

    const targetX = clamp(midX * 0.55, -2.4, 2.4);
    const targetY = 1.15 + Math.max(p0y, p1y) * 0.32;
    this.target.set(targetX, targetY, 0);
    this.lookAt.x = damp(this.lookAt.x, this.target.x, 7, dt);
    this.lookAt.y = damp(this.lookAt.y, this.target.y, 7, dt);

    if (this.shakeFrames > 0) {
      this.shakeFrames--;
      const s = this.shakeStrength * (this.shakeFrames / 16);
      this.shakeOffset.set(
        (this.rng() - 0.5) * s,
        (this.rng() - 0.5) * s * 0.7,
        (this.rng() - 0.5) * s * 0.3
      );
      if (this.shakeFrames === 0) this.shakeStrength = 0;
    } else {
      this.shakeOffset.multiplyScalar(0.7);
    }

    const camY = active ? 2.25 : 2.9;
    this.camera.position.set(
      this.lookAt.x * 0.9 + this.shakeOffset.x,
      camY + this.shakeOffset.y,
      (dist / this.zoom) * 1.0 + this.shakeOffset.z
    );
    this.camera.lookAt(this.lookAt.x, this.lookAt.y, 0);
  }

  /** 终结 / KO 特写 */
  killCam(pX: number): void {
    this.zoomTarget = 1.28;
    this.target.set(pX * 0.4, 1.1, 0);
    window.setTimeout(() => {
      this.zoomTarget = 1;
    }, 1600);
  }
}
