/**
 * 3D 打击特效：火花、冲击环、尘土（对象池，受性能档位限制规模）
 */

import * as THREE from 'three';
import { bus } from '../core/bus';
import { clamp, mulberry32 } from '../core/math';
import type { Budget } from '../core/perf';

function sparkTexture(): THREE.Texture {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,252,240,0.92)');
  g.addColorStop(0.3, 'rgba(255,232,190,0.5)');
  g.addColorStop(0.62, 'rgba(255,196,120,0.16)');
  g.addColorStop(1, 'rgba(255,180,100,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

interface Burst {
  sprite: THREE.Sprite;
  life: number;
  maxLife: number;
  vx: number;
  vy: number;
  scale: number;
  grow: number;
}

interface Ring {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  grow: number;
}

export class FxSystem {
  private bursts: Burst[] = [];
  private rings: Ring[] = [];
  private budget: Budget;
  private rng = mulberry32(0x5eed);
  private sparkTex = sparkTexture();
  private ringGeo = new THREE.RingGeometry(0.36, 0.5, 18);
  private audioDust = 0;

  constructor(
    private scene: THREE.Scene,
    budget: Budget
  ) {
    this.budget = budget;
    for (let i = 0; i < 26; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.sparkTex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.scale.setScalar(1);
      this.scene.add(sprite);
      this.bursts.push({ sprite, life: 0, maxLife: 0.3, vx: 0, vy: 0, scale: 1, grow: 0 });
    }
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffe9c0,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(this.ringGeo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.rings.push({ mesh, life: 0, maxLife: 0.36, grow: 6 });
    }

    bus.on('fx:hit', ({ x, y, z, level }) => this.spawnHit(x, y, z, level));
    bus.on('fx:impact', ({ x, y, kind }) => this.spawnImpact(x, y, kind));
  }

  applyBudget(budget: Budget): void {
    this.budget = budget;
  }

  private takeBurst(): Burst | null {
    const free = this.bursts.find((b) => b.life <= 0);
    return free ?? null;
  }

  spawnHit(x: number, y: number, z: number, level: 0 | 1 | 2 | 3): void {
    const count = Math.round((level >= 2 ? 7 : level === 1 ? 4 : 2) * this.budget.particleScale) + 1;
    for (let i = 0; i < count; i++) {
      const b = this.takeBurst();
      if (!b) break;
      const mat = b.sprite.material as THREE.SpriteMaterial;
      const color = level >= 3 ? 0xffd28a : level === 2 ? 0xffe9c0 : 0xfff6e6;
      mat.color.setHex(color);
      mat.opacity = 0.62;
      b.sprite.position.set(
        x + (this.rng() - 0.5) * 0.3,
        y + (this.rng() - 0.5) * 0.3,
        z + (this.rng() - 0.5) * 0.2
      );
      b.scale = (0.2 + this.rng() * 0.16) * (level >= 2 ? 1.45 : 1);
      b.sprite.scale.setScalar(b.scale);
      b.maxLife = 0.15 + this.rng() * 0.14;
      b.life = b.maxLife;
      b.vx = (this.rng() - 0.5) * 0.12;
      b.vy = (this.rng() - 0.3) * 0.12;
      b.grow = 1.6 + this.rng() * 1.4;
      b.sprite.visible = true;
    }
    if (level >= 2) {
      const ring = this.rings.find((r) => r.life <= 0);
      if (ring) {
        ring.mesh.position.set(x, y, z + 0.1);
        ring.mesh.visible = true;
        ring.mesh.scale.setScalar(0.5 + this.rng() * 0.3);
        (ring.mesh.material as THREE.MeshBasicMaterial).opacity = 0.5;
        (ring.mesh.material as THREE.MeshBasicMaterial).color.setHex(level >= 3 ? 0xffb066 : 0xffe6b0);
        ring.life = ring.maxLife;
        ring.grow = level >= 3 ? 4.6 : 3.2;
      }
    }
    this.audioDust++;
  }

  spawnImpact(x: number, y: number, kind: 'block' | 'hit' | 'heavy'): void {
    const b = this.takeBurst();
    if (!b) return;
    const mat = b.sprite.material as THREE.SpriteMaterial;
    mat.color.setHex(kind === 'block' ? 0xbfe6ff : 0xfff0d0);
    mat.opacity = 0.6;
    b.sprite.position.set(x, y, 0.15);
    b.scale = kind === 'block' ? 0.34 : 0.46;
    b.sprite.scale.setScalar(b.scale);
    b.maxLife = 0.2;
    b.life = 0.2;
    b.vx = 0;
    b.vy = 0;
    b.grow = 1.6;
    b.sprite.visible = true;
  }

  spawnDust(x: number, y: number, count = 6): void {
    for (let i = 0; i < count; i++) {
      const b = this.takeBurst();
      if (!b) break;
      const mat = b.sprite.material as THREE.SpriteMaterial;
      mat.color.setHex(0xb9a98d);
      mat.opacity = 0.55;
      b.sprite.position.set(x + (this.rng() - 0.5) * 0.8, y + this.rng() * 0.3, 0.2);
      b.scale = 0.5 + this.rng() * 0.5;
      b.sprite.scale.setScalar(b.scale);
      b.maxLife = 0.5 + this.rng() * 0.3;
      b.life = b.maxLife;
      b.vx = (this.rng() - 0.5) * 0.16;
      b.vy = this.rng() * 0.1;
      b.grow = 1.6;
      b.sprite.visible = true;
    }
  }

  update(dt: number): void {
    for (const b of this.bursts) {
      if (b.life <= 0) continue;
      b.life -= dt;
      if (b.life <= 0) {
        b.sprite.visible = false;
        continue;
      }
      const t = clamp(b.life / b.maxLife, 0, 1);
      b.sprite.position.x += b.vx;
      b.sprite.position.y += b.vy;
      b.sprite.scale.setScalar(b.scale * (1 + (1 - t) * b.grow));
      (b.sprite.material as THREE.SpriteMaterial).opacity = t * 0.6;
    }
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      if (r.life <= 0) {
        r.mesh.visible = false;
        continue;
      }
      const t = clamp(r.life / r.maxLife, 0, 1);
      r.mesh.scale.multiplyScalar(1 + r.grow * dt);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = t * 0.42;
    }
  }

  dispose(): void {
    for (const b of this.bursts) this.scene.remove(b.sprite);
    for (const r of this.rings) this.scene.remove(r.mesh);
    this.bursts.length = 0;
    this.rings.length = 0;
    this.sparkTex.dispose();
    this.ringGeo.dispose();
  }
}
