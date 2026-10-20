import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { Look } from "../../../shared/rosters";
import { ACT, CELEBRATION, type PlayerView } from "../../../shared/state";
import {
  applyKit,
  makeKitMaterial,
  makeStrandMaterial,
  setKitLayout,
  skinFamily,
  type KitSetup,
  type KitUniforms,
  type ModelMeta,
  type SkinAssets,
  type SkinFamily,
} from "./kitMaterial";

const BONE_NAMES = [
  "hips",
  "spine",
  "spine2",
  "chest",
  "neck",
  "head",
  "shoulderL",
  "upperarmL",
  "forearmL",
  "handL",
  "shoulderR",
  "upperarmR",
  "forearmR",
  "handR",
  "thighL",
  "shinL",
  "footL",
  "thighR",
  "shinR",
  "footR",
] as const;
type BoneName = (typeof BONE_NAMES)[number];
const BI = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i])) as Record<BoneName, number>;
const NB = BONE_NAMES.length;
const EYES = ["brown", "brownlight", "blue", "green", "grey"] as const;
type EyeColor = (typeof EYES)[number];
const EYE_CODE: Record<string, EyeColor> = { br: "brown", lb: "brownlight", bl: "blue", gr: "green", gy: "grey" };
const FACE_KEYS = ["nw", "nn", "nl", "ns", "nh", "jw", "jn", "cp", "cr", "fl", "fr", "lf", "lt", "mw", "cb", "ch", "es", "eb", "bh", "fh", "eo", "nk"];
const OPPOSITE: Record<string, string> = { nw: "nn", nn: "nw", nl: "ns", ns: "nl", jw: "jn", jn: "jw", cp: "cr", cr: "cp", fl: "fr", fr: "fl", lf: "lt", lt: "lf", es: "eb", eb: "es" };
const AFRICAN = [0, 0, 0.16, 0.48, 0.78, 0.95];

interface StrandTex {
  tex: THREE.Texture;
  lum: number;
}

export interface AvatarTemplate {
  scene: THREE.Object3D;
  restW: THREE.Quaternion[];
  restWInv: THREE.Quaternion[];
  hingeL: THREE.Vector3;
  hingeR: THREE.Vector3;
  meta: ModelMeta;
  assets: SkinAssets;
  hair: Record<string, StrandTex>;
  brows: StrandTex[];
  lashMat: THREE.Material;
  eyeMats: Record<EyeColor, THREE.Material>;
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function averageLum(tex: THREE.Texture): number {
  const img = tex.image as CanvasImageSource & { width: number; height: number };
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) return 0.2;
  g.drawImage(img, 0, 0, 64, 64);
  const d = g.getImageData(0, 0, 64, 64).data;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    sum += 0.2126 * srgbToLinear(d[i] / 255) + 0.7152 * srgbToLinear(d[i + 1] / 255) + 0.0722 * srgbToLinear(d[i + 2] / 255);
    n += 1;
  }
  return n ? sum / n : 0.2;
}

export async function loadAvatarTemplate(base: string): Promise<AvatarTemplate> {
  const loader = new THREE.TextureLoader();
  const tex = async (file: string, srgb = true): Promise<THREE.Texture> => {
    const t = await loader.loadAsync(`${base}/tex/${file}`);
    t.flipY = false;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    return t;
  };
  const [gltf, meta] = await Promise.all([
    new GLTFLoader().loadAsync(`${base}/player.glb`),
    fetch(`${base}/player.json`).then((r) => r.json() as Promise<ModelMeta>),
  ]);
  const families: SkinFamily[] = ["light", "dark", "asian"];
  const skinTex = await Promise.all(families.map((f) => tex(`skin_${f}.jpg`)));
  const hairNames = Object.keys(meta.hairTex);
  const hairTex = await Promise.all(hairNames.map((h) => tex(meta.hairTex[h])));
  const browTex = await Promise.all(["brow_a.png", "brow_b.png"].map((f) => tex(f)));
  const lashTex = await tex("lashes.png");
  const eyeTex = await Promise.all(EYES.map((e) => tex(`eye_${e}.png`)));
  const boot = await tex("boot.jpg");
  const lin = (v: number[]) => new THREE.Color(srgbToLinear(v[0]), srgbToLinear(v[1]), srgbToLinear(v[2]));
  const assets: SkinAssets = {
    skin: { light: skinTex[0], dark: skinTex[1], asian: skinTex[2] },
    skinAvg: { light: lin(meta.skinAvg.light), dark: lin(meta.skinAvg.dark), asian: lin(meta.skinAvg.asian) },
    boot,
  };
  setKitLayout(meta);
  const hair: Record<string, StrandTex> = {};
  hairNames.forEach((h, i) => (hair[h] = { tex: hairTex[i], lum: averageLum(hairTex[i]) }));
  const brows = browTex.map((t) => ({ tex: t, lum: averageLum(t) }));
  const lashMat = makeStrandMaterial(lashTex, averageLum(lashTex), "#120c0a", { rough: 0.7 });
  const eyeMats = {} as Record<EyeColor, THREE.Material>;
  EYES.forEach((e, i) => (eyeMats[e] = new THREE.MeshPhysicalMaterial({ map: eyeTex[i], roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.03, alphaTest: 0.5 })));

  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const restW: THREE.Quaternion[] = [];
  const restWInv: THREE.Quaternion[] = [];
  const pos: Record<string, THREE.Vector3> = {};
  for (const name of BONE_NAMES) {
    const bone = scene.getObjectByName(name);
    if (!bone) throw new Error(`Brak kości ${name}`);
    const q = new THREE.Quaternion();
    bone.getWorldQuaternion(q);
    restW.push(q);
    restWInv.push(q.clone().invert());
    pos[name] = bone.getWorldPosition(new THREE.Vector3());
  }
  const fwd = new THREE.Vector3(0, 0, 1);
  const hinge = (a: string, b: string) => pos[b].clone().sub(pos[a]).normalize().cross(fwd).normalize();
  return { scene, restW, restWInv, hingeL: hinge("forearmL", "handL"), hingeR: hinge("forearmR", "handR"), meta, assets, hair, brows, lashMat, eyeMats };
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface FaceSpec {
  weights: Record<string, number>;
  eyes: EyeColor;
  brow: number;
}

/** Turns a roster look into morph weights; unspecified features get a small per-player variation. */
function faceSpec(look: Look): FaceSpec {
  const rnd = mulberry(look.seed ?? Math.floor(look.height * 1000 + look.skin * 7919));
  const w: Record<string, number> = { afr: AFRICAN[Math.max(0, Math.min(5, look.skin))] };
  for (const k of FACE_KEYS) {
    if (rnd() < 0.45 && !(OPPOSITE[k] && w[OPPOSITE[k]])) w[k] = rnd() * 0.3;
  }
  w.mus = 0.25 + rnd() * 0.25;
  let eyes: EyeColor = "brown";
  const light = look.skin <= 1 && look.hairColor !== "#141010";
  const r = rnd();
  if (light) eyes = r < 0.35 ? "blue" : r < 0.5 ? "grey" : r < 0.62 ? "green" : r < 0.8 ? "brownlight" : "brown";
  else if (r < 0.2) eyes = "brownlight";
  let brow = look.beard === 2 || rnd() < 0.2 ? 1 : 0;
  for (const tok of (look.face ?? "").split(",")) {
    const t = tok.trim();
    if (!t) continue;
    if (t === "B") brow = 1;
    else if (t[0] === "E") eyes = EYE_CODE[t.slice(1)] ?? eyes;
    else {
      const m = /^([a-z]+)(\d+)$/.exec(t);
      if (!m) continue;
      w[m[1]] = Number(m[2]) / 10;
      if (OPPOSITE[m[1]]) delete w[OPPOSITE[m[1]]];
    }
  }
  return { weights: w, eyes, brow };
}

interface MorphMesh {
  mesh: THREE.Mesh;
  base: THREE.BufferGeometry;
  names: string[];
}

function attrArray(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): Float32Array {
  if ((a as THREE.BufferAttribute).isBufferAttribute && a.array instanceof Float32Array && a.itemSize === 3) return a.array;
  const out = new Float32Array(a.count * 3);
  for (let i = 0; i < a.count; i += 1) {
    out[i * 3] = a.getX(i);
    out[i * 3 + 1] = a.getY(i);
    out[i * 3 + 2] = a.getZ(i);
  }
  return out;
}

const E = new THREE.Euler();
const Q1 = new THREE.Quaternion();
const Q2 = new THREE.Quaternion();

class Pose {
  q: THREE.Quaternion[] = Array.from({ length: NB }, () => new THREE.Quaternion());
  y = 0;
  pitch = 0;
  roll = 0;
  yaw = 0;
  fwd = 0;
  side = 0;
  reset(): void {
    for (const q of this.q) q.identity();
    this.y = this.pitch = this.roll = this.yaw = this.fwd = this.side = 0;
  }
  blendTo(o: Pose, t: number): void {
    for (let i = 0; i < NB; i += 1) this.q[i].slerp(o.q[i], t);
    this.y += (o.y - this.y) * t;
    this.pitch += (o.pitch - this.pitch) * t;
    this.roll += (o.roll - this.roll) * t;
    this.yaw += (o.yaw - this.yaw) * t;
    this.fwd += (o.fwd - this.fwd) * t;
    this.side += (o.side - this.side) * t;
  }
  copy(o: Pose): void {
    for (let i = 0; i < NB; i += 1) this.q[i].copy(o.q[i]);
    this.y = o.y;
    this.pitch = o.pitch;
    this.roll = o.roll;
    this.yaw = o.yaw;
    this.fwd = o.fwd;
    this.side = o.side;
  }
}

function smooth01(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function bump(x: number, c: number, w: number): number {
  let d = x - c;
  d -= Math.round(d);
  return Math.exp(-(d * d) / (w * w));
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Writes bone rotations in character space: X = left, Y = up, Z = forward. */
class Rig {
  constructor(
    private p: Pose,
    private tpl: AvatarTemplate,
  ) {}
  set(b: BoneName, x: number, y: number, z: number): void {
    this.p.q[BI[b]].setFromEuler(E.set(x, y, z, "XYZ"));
  }
  pre(b: BoneName, x: number, y: number, z: number): void {
    Q1.setFromEuler(E.set(x, y, z, "XYZ"));
    this.p.q[BI[b]].premultiply(Q1);
  }
  /** side: 1 = left, -1 = right. swing > 0 moves the foot forward. */
  leg(side: 1 | -1, swing: number, knee: number, foot: number, abduct = 0, twist = 0): void {
    const s = side === 1 ? "L" : "R";
    this.set(`thigh${s}` as BoneName, -swing, side * twist, side * abduct);
    this.set(`shin${s}` as BoneName, Math.max(0, knee), 0, 0);
    this.set(`foot${s}` as BoneName, foot, 0, 0);
  }
  /** lower > 0 brings the arm from the A-pose toward the body; swing > 0 moves the hand forward. */
  arm(side: 1 | -1, swing: number, lower: number, elbow: number, twist = 0): void {
    const s = side === 1 ? "L" : "R";
    this.set(`upperarm${s}` as BoneName, -swing, side * twist, -side * lower);
    this.p.q[BI[`forearm${s}` as BoneName]].setFromAxisAngle(side === 1 ? this.tpl.hingeL : this.tpl.hingeR, Math.max(0, elbow));
  }
  torso(lean: number, twist: number, bend: number): void {
    this.set("spine", lean * 0.36, twist * 0.3, bend * 0.36);
    this.set("spine2", lean * 0.3, twist * 0.3, bend * 0.3);
    this.set("chest", lean * 0.34, twist * 0.4, bend * 0.34);
  }
  head(pitch: number, yaw: number): void {
    this.set("neck", pitch * 0.4, yaw * 0.4, 0);
    this.set("head", pitch * 0.6, yaw * 0.6, 0);
  }
}

export interface AvatarContext {
  ball: [number, number, number];
  owner: boolean;
  charge: number;
  celebrate: boolean;
  isRef: boolean;
}

export class Avatar {
  readonly root = new THREE.Group();
  readonly tilt = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly kit: KitUniforms;
  private readonly bones: THREE.Bone[] = [];
  private readonly restL: THREE.Quaternion[] = [];
  private readonly tpl: AvatarTemplate;
  private readonly hair = new Map<string, THREE.Mesh>();
  private readonly brows: THREE.Mesh[] = [];
  private readonly morphs: MorphMesh[] = [];
  private readonly hairMat: THREE.MeshStandardMaterial;
  private readonly browMat: THREE.MeshStandardMaterial;
  private eyes: THREE.Mesh | null = null;
  private readonly pose = new Pose();
  private readonly target = new Pose();
  private readonly rig: Rig;
  private readonly hipH: number;
  private readonly sole: number;
  private readonly modelH: number;
  private prop: THREE.Mesh | null = null;
  private propKind = 0;
  private scale = 1;
  private phase = 0;
  private speedS = 0;
  private fwdS = 0;
  private sideS = 0;
  private accS = 0;
  private turnS = 0;
  private lastYaw = 0;
  private lastSpeed = 0;
  private act = -1;
  private actT = 0;
  private foot: 1 | -1 = -1;
  private idleT = Math.random() * 10;
  private headYaw = 0;
  private headPitch = 0;
  private first = true;
  private faceKey = "";
  private stillT = 0;
  private kneel = 0;
  private flipDone = false;
  private spinDone = false;
  private isGk = false;
  private readonly variant = Math.random();

  constructor(tpl: AvatarTemplate) {
    this.tpl = tpl;
    this.hipH = tpl.meta.hip;
    this.sole = tpl.meta.sole ?? 0;
    this.modelH = tpl.meta.height;
    this.model = cloneSkinned(tpl.scene);
    this.model.rotation.y = Math.PI / 2;
    this.model.position.y = -this.hipH;
    const { material, uniforms } = makeKitMaterial(tpl.assets);
    this.kit = uniforms;
    const firstHair = Object.values(tpl.hair)[0];
    this.hairMat = makeStrandMaterial(firstHair.tex, firstHair.lum, "#2b1d14", { rough: 0.78 });
    this.browMat = makeStrandMaterial(tpl.brows[0].tex, tpl.brows[0].lum, "#2b1d14", { rough: 0.7 });
    const meshes: THREE.Mesh[] = [];
    this.model.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) meshes.push(obj as THREE.Mesh);
    });
    for (const mesh of meshes) {
      mesh.frustumCulled = false;
      const name = mesh.name;
      const strand = name.startsWith("hair_") || name.startsWith("brow_") || name === "lashes";
      mesh.castShadow = !strand && name !== "eyes";
      mesh.receiveShadow = true;
      if (name === "body" || name === "shoes") mesh.material = material;
      else if (name.startsWith("hair_")) {
        mesh.material = this.hairMat;
        this.hair.set(name.slice(5), mesh);
      } else if (name.startsWith("brow_")) {
        mesh.material = this.browMat;
        this.brows.push(mesh);
      } else if (name === "lashes") mesh.material = tpl.lashMat;
      else if (name === "eyes") {
        mesh.material = tpl.eyeMats.brown;
        this.eyes = mesh;
      }
      const g = mesh.geometry;
      if (g.morphAttributes.position && g.morphAttributes.position.length) {
        const own = new THREE.BufferGeometry();
        for (const [k, a] of Object.entries(g.attributes)) {
          own.setAttribute(k, k === "position" || k === "normal" ? new THREE.BufferAttribute(attrArray(a).slice(), 3) : a);
        }
        own.setIndex(g.index);
        for (const gr of g.groups) own.addGroup(gr.start, gr.count, gr.materialIndex);
        const dict = (mesh as THREE.Mesh).morphTargetDictionary ?? {};
        const names: string[] = [];
        for (const [n, i] of Object.entries(dict)) names[i] = n;
        mesh.geometry = own;
        mesh.morphTargetInfluences = undefined;
        mesh.morphTargetDictionary = undefined;
        this.morphs.push({ mesh, base: g, names });
      }
    }
    this.brows.sort((a, b) => a.name.localeCompare(b.name));
    for (const name of BONE_NAMES) {
      const bone = this.model.getObjectByName(name) as THREE.Bone;
      this.bones.push(bone);
      this.restL.push(bone.quaternion.clone());
    }
    this.tilt.position.y = this.hipH + this.sole;
    this.tilt.add(this.model);
    this.root.add(this.tilt);
    this.rig = new Rig(this.target, tpl);
  }

  private bakeFace(w: Record<string, number>): void {
    for (const m of this.morphs) {
      const base = m.base;
      const P = attrArray(base.attributes.position);
      const N = attrArray(base.attributes.normal);
      const pa = m.mesh.geometry.attributes.position as THREE.BufferAttribute;
      const na = m.mesh.geometry.attributes.normal as THREE.BufferAttribute;
      const out = pa.array as Float32Array;
      const on = na.array as Float32Array;
      out.set(P);
      on.set(N);
      const mp = base.morphAttributes.position ?? [];
      const mn = base.morphAttributes.normal;
      for (let k = 0; k < m.names.length; k += 1) {
        const wk = w[m.names[k]] ?? 0;
        if (Math.abs(wk) < 1e-3) continue;
        const d = attrArray(mp[k]);
        for (let i = 0; i < out.length; i += 1) out[i] += wk * d[i];
        if (mn && mn[k]) {
          const dn = attrArray(mn[k]);
          for (let i = 0; i < on.length; i += 1) on[i] += wk * dn[i];
        }
      }
      for (let i = 0; i < on.length; i += 3) {
        const l = Math.hypot(on[i], on[i + 1], on[i + 2]) || 1;
        on[i] /= l;
        on[i + 1] /= l;
        on[i + 2] /= l;
      }
      pa.needsUpdate = true;
      na.needsUpdate = true;
    }
  }

  dress(setup: KitSetup, height: number): void {
    const look = setup.look;
    this.isGk = setup.gk;
    const face = faceSpec(look);
    const family = skinFamily(look, face.weights.asi ?? 0);
    applyKit(this.kit, setup, this.tpl.assets, family);
    const key = JSON.stringify(face.weights);
    if (key !== this.faceKey) {
      this.faceKey = key;
      this.bakeFace(face.weights);
    }
    const style = look.hair === "long" ? "longcurly" : look.hair;
    for (const [name, mesh] of this.hair) mesh.visible = name === style;
    const strand = this.tpl.hair[style];
    if (strand) {
      this.hairMat.map = strand.tex;
      this.setLum(this.hairMat, strand.lum);
    }
    this.hairMat.color.set(look.hairColor);
    const brow = this.tpl.brows[face.brow] ?? this.tpl.brows[0];
    this.browMat.map = brow.tex;
    this.setLum(this.browMat, brow.lum);
    this.browMat.color.set(look.hairColor).multiplyScalar(0.8);
    this.brows.forEach((b, i) => (b.visible = i === face.brow));
    if (this.eyes) this.eyes.material = this.tpl.eyeMats[face.eyes];
    this.scale = height / this.modelH;
    const w = Math.sqrt(this.scale);
    this.model.scale.set(w, this.scale, w);
    this.model.position.y = -this.hipH * this.scale;
  }

  private setLum(m: THREE.MeshStandardMaterial, lum: number): void {
    (m.userData.avgLum as { value: number }).value = Math.max(0.02, lum);
  }

  setProp(kind: 0 | 1 | 2): void {
    if (kind === this.propKind) return;
    this.propKind = kind;
    if (!this.prop) {
      this.prop = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.11, 0.08), new THREE.MeshStandardMaterial({ color: 0xf5e11b, roughness: 0.5 }));
      this.prop.position.set(0, 0.1, 0.02);
      this.bones[BI.handR].add(this.prop);
    }
    const mat = this.prop.material as THREE.MeshStandardMaterial;
    if (kind === 2) {
      this.prop.geometry.dispose();
      const flag = new THREE.BoxGeometry(0.02, 0.36, 0.3);
      flag.translate(0, 0.2, 0.16);
      this.prop.geometry = flag;
      mat.color.set(0xff3b1f);
    }
    this.prop.visible = kind !== 0;
  }

  showCard(red: boolean, on: boolean): void {
    if (!this.prop || this.propKind === 2) {
      if (!on) return;
      this.setProp(1);
    }
    if (!this.prop) return;
    (this.prop.material as THREE.MeshStandardMaterial).color.set(red ? 0xe3242b : 0xf5e11b);
    this.prop.visible = on;
  }

  update(v: PlayerView, dt: number, ctx: AvatarContext): void {
    const yaw = v.yaw;
    this.root.position.set(v.x, 0, v.z);
    this.root.rotation.y = -yaw;
    this.root.visible = v.on;
    if (!v.on) return;
    const speed = Math.hypot(v.vx, v.vz);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const fwd = v.vx * cy + v.vz * sy;
    const side = -v.vx * sy + v.vz * cy;
    const k = 1 - Math.exp(-dt * 10);
    if (this.first) {
      this.speedS = speed;
      this.lastYaw = yaw;
      this.lastSpeed = speed;
    }
    this.speedS += (speed - this.speedS) * k;
    this.fwdS += (fwd - this.fwdS) * k;
    this.sideS += (side - this.sideS) * k;
    const acc = dt > 0 ? (speed - this.lastSpeed) / dt : 0;
    this.accS += (THREE.MathUtils.clamp(acc, -12, 12) - this.accS) * (1 - Math.exp(-dt * 5));
    let dyaw = yaw - this.lastYaw;
    dyaw -= Math.round(dyaw / (Math.PI * 2)) * Math.PI * 2;
    const turn = dt > 0 ? dyaw / dt : 0;
    this.turnS += (THREE.MathUtils.clamp(turn, -8, 8) - this.turnS) * (1 - Math.exp(-dt * 6));
    this.lastYaw = yaw;
    this.lastSpeed = speed;
    if (v.act !== this.act) {
      this.act = v.act;
      this.actT = 0;
      if (v.act === ACT.kick || v.act === ACT.volley) {
        const bx = ctx.ball[0] - v.x;
        const bz = ctx.ball[2] - v.z;
        const right = -bx * sy + bz * cy;
        this.foot = right < -0.12 ? 1 : -1;
      }
      if (v.act === ACT.celebrate) {
        this.stillT = 0;
        this.kneel = 0;
        this.flipDone = false;
        this.spinDone = false;
      }
    } else this.actT += dt;
    this.idleT += dt;

    const T = this.target;
    T.reset();
    this.locomotion(v, dt, ctx);
    let rate = 14;
    switch (v.act) {
      case ACT.kick:
        if (v.aa < 0) this.gkThrow(v.at);
        else this.kick(v.at, v.aa > 2 ? Math.min(1, v.aa - 2) : v.aa, v.aa > 2);
        rate = 34;
        break;
      case ACT.volley:
        this.volley(v.at, v.aa);
        rate = 30;
        break;
      case ACT.header:
        this.header(v.at, ctx.ball[1]);
        rate = 26;
        break;
      case ACT.slide:
        this.slide(v.at);
        rate = 18;
        break;
      case ACT.tackle:
        this.tackle(v.at);
        rate = 24;
        break;
      case ACT.fallen:
        this.fallen(v.at, v.aa);
        rate = 12;
        break;
      case ACT.stumble:
        this.stumble(v.at);
        rate = 18;
        break;
      case ACT.dive:
        this.dive(v.at, v.aa);
        rate = 22;
        break;
      case ACT.throwin:
        this.throwIn(v.aa > 0.5 ? v.at : -1);
        rate = 22;
        break;
      case ACT.hold:
        this.hold();
        break;
      case ACT.gkset:
        this.gkSet();
        break;
      case ACT.jockey:
        this.jockey();
        break;
      case ACT.celebrate:
        this.celebrate(v.at, v.aa, dt);
        rate = 12;
        break;
      case ACT.wait:
        this.waitPose(this.actT);
        break;
      case ACT.off:
        this.rig.head(0.45, 0);
        break;
      case ACT.card:
        this.rig.arm(-1, 2.95, 0.35, 0.05);
        rate = 16;
        break;
      case ACT.flag:
        this.rig.arm(-1, 2.9, 0.3, 0.1);
        rate = 16;
        break;
      case ACT.point:
        this.rig.arm(-1, 1.5, -0.2, 0.05);
        rate = 16;
        break;
      default:
        break;
    }
    if (ctx.celebrate && !ctx.isRef && v.act === ACT.run) this.dejected();
    if (ctx.owner && ctx.charge > 0 && v.act === ACT.run) this.windup(ctx.charge);
    this.look(v, ctx, dt);
    if (this.first) {
      this.pose.copy(T);
      this.first = false;
    } else this.pose.blendTo(T, 1 - Math.exp(-dt * rate));
    this.apply();
  }

  private look(v: PlayerView, ctx: AvatarContext, dt: number): void {
    const busy = ctx.celebrate || v.act === ACT.fallen || v.act === ACT.dive || v.act === ACT.slide || v.act === ACT.celebrate || v.act === ACT.off || v.act === ACT.throwin;
    const bx = ctx.ball[0] - v.x;
    const bz = ctx.ball[2] - v.z;
    const cy = Math.cos(v.yaw);
    const sy = Math.sin(v.yaw);
    const f = bx * cy + bz * sy;
    const r = -bx * sy + bz * cy;
    const d = Math.hypot(bx, bz);
    let yaw = Math.atan2(-r, f);
    let pitch = Math.atan2(1.68 * this.scale - ctx.ball[1], Math.max(0.4, d)) * 0.8;
    yaw = THREE.MathUtils.clamp(yaw, -1.2, 1.2);
    pitch = THREE.MathUtils.clamp(pitch, -0.5, 0.75);
    if (busy) {
      yaw = 0;
      pitch = 0;
    }
    const k = 1 - Math.exp(-dt * 6);
    this.headYaw += (yaw - this.headYaw) * k;
    this.headPitch += (pitch - this.headPitch) * k;
    this.rig.pre("neck", this.headPitch * 0.35, this.headYaw * 0.35, 0);
    this.rig.pre("head", this.headPitch * 0.55, this.headYaw * 0.5, 0);
    this.rig.pre("chest", 0, this.headYaw * 0.15, 0);
  }

  private apply(): void {
    const P = this.pose;
    const tpl = this.tpl;
    for (let i = 0; i < NB; i += 1) {
      Q2.copy(tpl.restWInv[i]).multiply(P.q[i]).multiply(tpl.restW[i]);
      this.bones[i].quaternion.copy(this.restL[i]).multiply(Q2);
    }
    const s = this.scale;
    this.tilt.position.set(P.fwd, (this.hipH + this.sole) * s + P.y * s, P.side);
    this.tilt.rotation.set(P.roll, P.yaw, -P.pitch, "YXZ");
  }

  // ------------------------------------------------------------------ poses

  private locomotion(v: PlayerView, dt: number, ctx: AvatarContext): void {
    const R = this.rig;
    const T = this.target;
    const s = this.speedS;
    const back = this.fwdS < -0.6 && Math.abs(this.fwdS) > Math.abs(this.sideS) * 0.8;
    const lateral = Math.abs(this.sideS) > Math.abs(this.fwdS) * 1.2 && s > 0.5;
    const stride = s < 2 ? 1.2 + s * 0.2 : Math.min(3.9, 1.55 + s * 0.25);
    this.phase += ((back ? -1 : 1) * (s * dt)) / stride;
    this.phase -= Math.floor(this.phase);
    const run = smooth01(0.3, 3.2, s);
    const sprint = smooth01(5.5, 8.8, s);
    const breathe = Math.sin(this.idleT * 2.1) * 0.02;
    if (s < 0.3) {
      const sway = Math.sin(this.idleT * 0.9) * 0.03;
      R.leg(1, 0.03, 0.08, 0.02, 0.05 + sway * 0.3, 0.12);
      R.leg(-1, -0.02, 0.06, 0.0, 0.05 - sway * 0.3, 0.12);
      R.arm(1, 0.05, 0.55, 0.22 + breathe, 0.2);
      R.arm(-1, 0.05, 0.55, 0.22 + breathe, 0.2);
      R.torso(0.03 + breathe, sway * 0.5, sway);
      T.roll = sway * 0.3;
      return;
    }
    const pL = this.phase;
    const pR = this.phase + 0.5;
    const ampF = mix(0.32, 0.62, run) + sprint * 0.3;
    const ampB = mix(0.25, 0.4, run) + sprint * 0.16;
    const kneeSwing = mix(0.8, 1.55, run) + sprint * 0.5;
    const kneeStance = mix(0.08, 0.28, run);
    const toe = mix(0.2, 0.45, run);
    const legAt = (ph: number) => {
      const c = Math.cos(ph * Math.PI * 2);
      const swing = c > 0 ? c * ampF : c * ampB;
      const knee = kneeStance * bump(ph, 0.1, 0.12) + kneeSwing * bump(ph, 0.72, 0.2) + 0.06;
      const foot = -0.18 * bump(ph, 0.02, 0.08) + toe * bump(ph, 0.5, 0.1) + 0.25 * bump(ph, 0.72, 0.15);
      return [swing, knee, foot];
    };
    const [sL, kL, fL] = legAt(pL);
    const [sR, kR, fR] = legAt(pR);
    if (lateral) {
      const dir = Math.sign(this.sideS);
      const a = Math.sin(pL * Math.PI * 2) * 0.22;
      R.leg(1, 0.1, 0.35 + Math.max(0, a) * 1.2, 0.1, 0.08 + a * dir * -1, 0.1);
      R.leg(-1, 0.1, 0.35 + Math.max(0, -a) * 1.2, 0.1, 0.08 + a * dir, 0.1);
      T.y = -0.06 - Math.abs(a) * 0.06;
      R.arm(1, 0.2, 0.3, 0.7);
      R.arm(-1, 0.2, 0.3, 0.7);
      R.torso(0.18, 0, 0);
      return;
    }
    R.leg(1, sL, kL, fL, 0.03, 0.06);
    R.leg(-1, sR, kR, fR, 0.03, 0.06);
    const armAmp = mix(0.32, 0.6, run) + sprint * 0.32;
    const elbow = mix(0.35, 1.35, run) + sprint * 0.2;
    const cL = Math.cos(pL * Math.PI * 2);
    R.arm(1, -cL * armAmp, mix(0.52, 0.45, run), elbow + cL * 0.15 * run, 0.15);
    R.arm(-1, cL * armAmp, mix(0.52, 0.45, run), elbow - cL * 0.15 * run, 0.15);
    const lean = (back ? -0.08 : 0.03 + s * 0.022) + THREE.MathUtils.clamp(this.accS, -6, 6) * 0.022;
    R.set("hips", 0, -cL * 0.09 * run, 0);
    R.torso(lean * 0.6, cL * 0.18 * run, 0);
    T.pitch = lean * 0.5;
    T.roll = THREE.MathUtils.clamp(this.turnS * s * 0.035, -0.32, 0.32);
    const bobAmp = mix(0.015, 0.045, run);
    T.y = -bobAmp * (0.5 + 0.5 * Math.cos((pL - 0.12) * Math.PI * 4)) - run * 0.03;
  }

  private windup(c: number): void {
    const R = this.rig;
    const f = this.foot === 1 ? 1 : -1;
    R.leg(f as 1 | -1, -0.35 * c, 0.9 * c + 0.2, 0.3 * c);
    R.arm((-f) as 1 | -1, 0.5 * c, 0.1, 0.6);
    this.target.pitch -= 0.06 * c;
  }

  private kick(t: number, power: number, punt: boolean): void {
    const R = this.rig;
    const T = this.target;
    const f = this.foot;
    const o = (-f) as 1 | -1;
    const p = THREE.MathUtils.clamp(power, 0, 1);
    const inside = p < 0.45 && !punt;
    let swing: number;
    let knee: number;
    if (t < 0.05) {
      const k = t / 0.05;
      swing = mix(-0.55, 0.45, k);
      knee = mix(1.5, 0.25, k);
    } else if (t < 0.24) {
      const k = (t - 0.05) / 0.19;
      swing = mix(0.45, 0.6 + p * 0.7 + (punt ? 0.6 : 0), smooth01(0, 1, k));
      knee = mix(0.25, 0.3, k);
    } else {
      const k = smooth01(0.24, 0.42, t);
      swing = mix(0.6 + p * 0.7 + (punt ? 0.6 : 0), 0.15, k);
      knee = mix(0.3, 0.45, k);
    }
    R.leg(f, swing, knee, inside ? 0.0 : 0.45, inside ? 0.18 : 0.04, inside ? 0.7 : 0.05);
    R.leg(o, 0.12, 0.38, 0.05, 0.08, 0.1);
    R.arm(o, 0.45, -0.25, 0.6, 0.2);
    R.arm(f, -0.35, -0.1, 0.4, 0.2);
    R.set("hips", 0, f * 0.25 * p, 0);
    R.torso(-0.06 - p * 0.12, -f * 0.15, -f * 0.05);
    T.pitch = -0.04 - p * 0.08;
    T.y = -0.05;
    T.roll = -f * 0.05;
  }

  private gkThrow(t: number): void {
    const R = this.rig;
    const k = smooth01(0, 0.3, t);
    R.arm(-1, mix(-0.8, 1.2, k), 0.4, 0.2);
    R.arm(1, 0.6, 0.1, 0.8);
    R.leg(1, 0.45, 0.6, 0.05);
    R.leg(-1, -0.3, 0.5, 0.2);
    R.torso(0.35, 0.2, 0);
    this.target.y = -0.18;
    this.target.pitch = 0.18;
  }

  private volley(t: number, power: number): void {
    const R = this.rig;
    const T = this.target;
    const f = this.foot;
    const o = (-f) as 1 | -1;
    const k = smooth01(0, 0.2, t) * (1 - smooth01(0.28, 0.42, t));
    R.leg(f, 0.4 + k * (0.6 + power * 0.3), 0.3, 0.45, 0.5 * k + 0.1, 0.1);
    R.leg(o, 0.1, 0.4, 0.05, 0.1);
    R.arm(o, 0.3, -0.5, 0.5);
    R.arm(f, -0.2, -0.3, 0.4);
    R.torso(-0.1, -f * 0.2, -f * 0.2 * k);
    T.roll = -f * 0.45 * k;
    T.y = -0.06;
  }

  private header(t: number, ballY: number): void {
    const R = this.rig;
    const T = this.target;
    const jumpH = ballY > 1.9 ? Math.min(0.55, (ballY - 1.7) * 0.7) : 0;
    const air = Math.sin(Math.PI * THREE.MathUtils.clamp(t / 0.55, 0, 1));
    T.y = jumpH * air - 0.04;
    const nod = Math.exp(-((t - 0.04) * (t - 0.04)) / 0.006);
    R.torso(-0.12 + nod * 0.45, 0, 0);
    R.head(0.1 + nod * 0.35, 0);
    R.arm(1, 0.7, -0.15, 1.2);
    R.arm(-1, 0.7, -0.15, 1.2);
    R.leg(1, -0.05 + air * 0.2, 0.3 + air * 0.7, 0.4);
    R.leg(-1, -0.15, 0.3 + air * 0.9, 0.4);
    T.pitch = nod * 0.2;
  }

  private slide(t: number): void {
    const R = this.rig;
    const T = this.target;
    const down = smooth01(0, 0.16, t) * (1 - smooth01(0.82, 1.12, t));
    R.leg(1, mix(0.2, 0.8, down), mix(0.3, 0.05, down), 0.3, 0.05);
    R.leg(-1, mix(0.0, 0.3, down), mix(0.4, 1.8, down), 0.2, mix(0.05, 0.12, down), 1.35 * down);
    R.arm(1, mix(0, -0.7, down), mix(0.4, -0.35, down), 0.3);
    R.arm(-1, mix(0, -0.4, down), mix(0.4, -0.6, down), 0.5);
    R.torso(mix(0.1, 0.35, down), 0, 0);
    R.head(0.35 * down, 0);
    T.pitch = -0.95 * down;
    T.y = -0.7 * down;
    T.roll = 0.18 * down;
  }

  private tackle(t: number): void {
    const R = this.rig;
    const T = this.target;
    const k = smooth01(0, 0.12, t) * (1 - smooth01(0.32, 0.5, t));
    R.leg(-1, 0.85 * k + 0.1, 0.2 + (1 - k) * 0.3, 0.3, 0.3 * k, 0.4 * k);
    R.leg(1, -0.1, 0.4 + k * 0.4, 0.05, 0.05);
    R.arm(1, 0.3, -0.3 * k + 0.3, 0.6);
    R.arm(-1, -0.3, -0.2 * k + 0.3, 0.6);
    R.torso(0.3 * k + 0.1, 0.2 * k, 0);
    T.y = -0.14 * k;
    T.pitch = 0.1 * k;
  }

  private fallen(t: number, aa: number): void {
    const R = this.rig;
    const T = this.target;
    const dir = aa >= 0 ? 1 : -1;
    const dur = Math.max(0.9, Math.abs(aa));
    const fall = smooth01(0, 0.38, t);
    const up = smooth01(dur - 0.55, dur - 0.05, t);
    const lie = fall * (1 - up);
    if (dir > 0) {
      R.arm(1, mix(0.2, 2.3, lie), mix(0.4, 0.1, lie), 0.5);
      R.arm(-1, mix(0.2, 2.1, lie), mix(0.4, 0.2, lie), 0.6);
      R.leg(1, -0.1 * lie, 0.3 + 0.4 * lie, 0.4 * lie);
      R.leg(-1, 0.05, 0.2 + 0.7 * lie + up * 0.8, 0.3 * lie);
      R.head(-0.5 * lie, 0.3 * lie);
      T.pitch = 1.42 * lie;
    } else {
      R.arm(1, mix(0.1, -0.3, lie), mix(0.4, -0.5, lie), 0.4);
      R.arm(-1, mix(0.1, 0.8, lie), mix(0.4, -0.3, lie), 1.4 * lie);
      R.leg(1, 0.3 * lie, 0.4 + 0.5 * lie + up * 0.8, 0.2);
      R.leg(-1, 0.15 * lie, 0.2 + 0.2 * lie, 0.3);
      R.head(0.4 * lie, -0.3 * lie);
      T.pitch = -1.4 * lie;
    }
    const writhe = lie > 0.9 ? Math.sin(t * 7) * 0.05 : 0;
    T.roll = writhe;
    T.y = -0.76 * lie - up * (1 - up) * 0.9;
  }

  private stumble(t: number): void {
    const R = this.rig;
    const T = this.target;
    const k = Math.sin(Math.PI * THREE.MathUtils.clamp(t / 0.5, 0, 1));
    R.arm(1, 0.6 * k, -0.4 * k + 0.3, 0.6);
    R.arm(-1, -0.2 * k, -0.6 * k + 0.3, 0.5);
    R.leg(1, 0.4 * k, 0.5, 0.2);
    R.leg(-1, -0.3 * k, 0.6 * k, 0.3);
    R.torso(0.3 * k, 0.1, 0);
    T.pitch = 0.3 * k;
    T.y = -0.08 * k;
  }

  private dive(t: number, aa: number): void {
    const R = this.rig;
    const T = this.target;
    const side = aa >= 0 ? 1 : -1;
    const h = THREE.MathUtils.clamp(Math.abs(aa) - 1, 0, 1);
    const load = smooth01(-0.05, 0.1, t);
    const fly = smooth01(0.06, 0.32, t);
    const land = smooth01(0.55, 0.8, t);
    const up = smooth01(0.95, 1.32, t);
    const out = fly * (1 - up);
    const reach = out * (1 - land * 0.4);
    R.arm(1, mix(0.3, 2.95, reach), mix(0.2, 0.25, reach), mix(0.5, 0.05, reach));
    R.arm(-1, mix(0.3, 2.95, reach), mix(0.2, 0.25, reach), mix(0.5, 0.05, reach));
    R.leg(1, mix(0.2, 0.15, out), mix(0.6 * load, 0.35, out), 0.3, side > 0 ? 0.25 * out : 0.05);
    R.leg(-1, mix(0.2, -0.05, out), mix(0.6 * load, 0.5, out), 0.3, side < 0 ? 0.25 * out : 0.05);
    R.torso(mix(0.25 * load, 0.05, out), 0, side * -0.15 * out);
    R.head(0, 0);
    const lift = Math.sin(Math.PI * THREE.MathUtils.clamp((t - 0.08) / 0.6, 0, 1)) * (0.15 + h * 0.85);
    T.roll = side * mix(0.12 * load, 1.4, out);
    T.y = mix(-0.2 * load * (1 - fly), -0.62 + lift, out);
    T.side = side * 0.25 * out;
    T.pitch = 0.1 * load * (1 - out);
  }

  private throwIn(t: number): void {
    const R = this.rig;
    const T = this.target;
    if (t < 0) {
      R.arm(1, 2.85, 0.25, 1.75);
      R.arm(-1, 2.85, 0.25, 1.75);
      R.torso(-0.18, 0, 0);
      R.leg(1, 0.25, 0.15, 0.05);
      R.leg(-1, -0.2, 0.25, 0.25);
      T.pitch = -0.08;
      return;
    }
    const k = smooth01(0, 0.3, t);
    R.arm(1, mix(2.85, 1.2, k), 0.25, mix(1.75, 0.2, k));
    R.arm(-1, mix(2.85, 1.2, k), 0.25, mix(1.75, 0.2, k));
    R.torso(mix(-0.25, 0.35, k), 0, 0);
    R.leg(1, 0.25, 0.2, 0.05);
    R.leg(-1, -0.25, 0.3, 0.35);
    T.pitch = mix(-0.1, 0.15, k);
  }

  private hold(): void {
    const R = this.rig;
    R.arm(1, 0.95, 0.7, 1.45, -0.3);
    R.arm(-1, 0.95, 0.7, 1.45, -0.3);
    R.torso(0.08, 0, 0);
  }

  private gkSet(): void {
    const R = this.rig;
    const T = this.target;
    const bounce = Math.sin(this.idleT * 7) * 0.012;
    R.leg(1, 0.35, 0.75, -0.15, 0.18, 0.2);
    R.leg(-1, 0.35, 0.75, -0.15, 0.18, 0.2);
    R.arm(1, 0.45, 0.05, 0.75, 0.3);
    R.arm(-1, 0.45, 0.05, 0.75, 0.3);
    R.torso(0.32, 0, 0);
    R.head(-0.25, 0);
    T.y = -0.14 + bounce;
    T.pitch = 0.1;
  }

  private jockey(): void {
    const R = this.rig;
    const T = this.target;
    const s = this.speedS;
    const a = Math.sin(this.phase * Math.PI * 2) * Math.min(1, s / 2) * 0.25;
    R.leg(1, 0.2 + a, 0.6 + Math.max(0, a) * 0.8, -0.05, 0.14, 0.15);
    R.leg(-1, 0.2 - a, 0.6 + Math.max(0, -a) * 0.8, -0.05, 0.14, 0.15);
    R.arm(1, 0.25, 0.2, 0.7);
    R.arm(-1, 0.25, 0.2, 0.7);
    R.torso(0.28, 0, 0);
    T.y = -0.1;
    T.pitch = 0.08;
  }

  private waitPose(t: number): void {
    if (t < 1.4) return;
    const R = this.rig;
    R.arm(1, -0.55, -0.05, 1.5, -0.45);
    R.arm(-1, -0.55, -0.05, 1.5, -0.45);
  }

  // ------------------------------------------------------------ celebrations

  private both(fn: (side: 1 | -1) => void): void {
    fn(1);
    fn(-1);
  }

  private stand(abduct = 0.12, knee = 0.08): void {
    this.both((s) => this.rig.leg(s, 0.02, knee, 0, abduct, 0.18));
  }

  /** `t` is time since the goal; poses after the run-in are timed from when the player comes to a stop. */
  private celebrate(t: number, style: number, dt: number): void {
    const R = this.rig;
    const T = this.target;
    const s = this.speedS;
    if (s < 0.9) this.stillT += dt;
    else if (s > 2.2) this.stillT = 0;
    const st = this.stillT;
    const moving = s > 1.6;
    const pump = Math.sin(t * 7.5);
    switch (style) {
      case CELEBRATION.teammate:
        this.joinIn(t, st, moving);
        return;
      case CELEBRATION.kneeSlide: {
        if (!this.kneel && t > 0.5 && ((this.accS < -2.2 && s > 1.2) || st > 0.25)) this.kneel = 1e-4;
        if (this.kneel <= 0) {
          if (moving) this.both((sd) => R.arm(sd, 0.15, -0.55, 0.5));
          return;
        }
        this.kneel = Math.min(1, this.kneel + dt * 4.5);
        const k = smooth01(0, 1, this.kneel);
        const open = s > 0.6 ? 1 : 0.75 + 0.25 * Math.sin(st * 3.2);
        this.both((sd) => R.leg(sd, mix(0.2, 0, k), mix(0.4, 1.55, k), mix(0.1, 1.05, k), 0.1, 0.12));
        this.both((sd) => R.arm(sd, 0.3, mix(0.3, -1.85 * open, k), mix(0.4, 0.3, k)));
        R.torso(mix(0.05, -0.5, k), 0, 0);
        R.head(-0.5 * k, 0);
        T.y = -0.48 * k;
        return;
      }
      case CELEBRATION.airplane:
        this.both((sd) => R.arm(sd, 0, -0.95, 0.08));
        if (moving) {
          T.roll = THREE.MathUtils.clamp(this.turnS * 0.35, -0.55, 0.55) + Math.sin(t * 2.3) * 0.22;
          return;
        }
        this.stand(0.16);
        T.roll = Math.sin(st * 1.7) * 0.28;
        T.yaw = Math.sin(st * 0.9) * 0.5;
        R.head(-0.15, 0);
        return;
      case CELEBRATION.jumpSpin:
        this.siuu(t, st, moving);
        return;
      case CELEBRATION.badgeKiss: {
        if (moving) {
          R.arm(-1, 1.05, 0.95, 2.1, -0.6);
          R.arm(1, 2.6 + pump * 0.2, 0.45, 0.5);
          return;
        }
        const kiss = 1 - smooth01(1.7, 2.1, st);
        R.arm(-1, mix(2.75, 1.25, kiss), mix(0.5, 0.95, kiss), mix(0.12, 2.3, kiss), -0.7 * kiss);
        R.arm(1, mix(0.25, 1.0, kiss), mix(0.5, 0.9, kiss), mix(0.3, 2.2, kiss), -0.7 * kiss);
        R.torso(mix(-0.15, 0.25, kiss), 0, 0);
        R.head(mix(-0.35, 0.5, kiss), 0);
        this.stand();
        return;
      }
      case CELEBRATION.crossedArms:
        R.arm(1, 0.5, 0.78, 1.8, -1.25);
        R.arm(-1, 0.32, 0.78, 1.8, -1.25);
        if (moving) return;
        R.torso(-0.12, 0, 0);
        R.head(-0.22, 0);
        this.stand(0.12, 0.05);
        T.yaw = Math.sin(st * 0.5) * 0.15;
        return;
      case CELEBRATION.roar: {
        if (moving) {
          this.both((sd) => R.arm(sd, 1.0, -0.2, 2.0, -0.2));
          return;
        }
        const p = 0.5 + 0.5 * Math.sin(st * 4.5);
        this.both((sd) => R.leg(sd, 0.05, 0.55, -0.1, 0.3, 0.3));
        this.both((sd) => R.arm(sd, mix(0.7, 1.1, p), mix(-0.1, -0.55, p), 2.1, -0.2));
        R.torso(mix(0.35, 0.05, p), 0, 0);
        R.head(mix(-0.1, -0.55, p), 0);
        T.y = -0.14;
        T.roll = Math.sin(st * 22) * 0.03 * p;
        return;
      }
      case CELEBRATION.backflip:
        this.backflip(t, st, moving);
        return;
      case CELEBRATION.pointSky: {
        const alt = Math.sin(t * 3) * 0.12;
        R.arm(1, 2.75 + alt, 0.55, 0.12);
        R.arm(-1, 2.75 - alt, 0.55, 0.12);
        R.head(-0.55, 0);
        R.torso(-0.15, 0, 0);
        if (moving) return;
        this.stand();
        T.yaw = Math.sin(st * 0.6) * 0.3;
        return;
      }
      case CELEBRATION.cupEar: {
        const sd = this.variant < 0.5 ? 1 : -1;
        R.arm(sd, 1.2, -0.75, 2.45);
        if (moving) return;
        R.arm((-sd) as 1 | -1, 0.15, 0.45, 0.35);
        R.head(-0.05, 0);
        R.pre("head", 0, 0, sd * 0.3);
        R.torso(-0.08, 0, sd * 0.12);
        this.stand();
        T.yaw = Math.sin(st * 0.8) * 0.45;
        return;
      }
      case CELEBRATION.dance:
        if (moving) {
          this.both((sd) => R.arm(sd, 2.6 + sd * pump * 0.2, 0.45, 0.4));
          return;
        }
        this.samba(st);
        return;
      case CELEBRATION.zen: {
        if (moving) return;
        const k = smooth01(0, 0.9, st);
        this.both((sd) => R.leg(sd, mix(0, 1.35, k), mix(0.1, 2.35, k), mix(0, -0.3, k), mix(0, 0.7, k), mix(0, 0.9, k)));
        this.both((sd) => R.arm(sd, mix(0, 0.75, k), mix(0.5, 0.25, k), mix(0.2, 0.55, k)));
        R.torso(mix(0, -0.05, k), 0, 0);
        R.head(0.25 * k, 0);
        T.y = -0.86 * k;
        return;
      }
      case CELEBRATION.armsWide:
        this.both((sd) => R.arm(sd, 0.3, -1.3, 0.12));
        R.torso(-0.22, 0, 0);
        R.head(-0.25, 0);
        if (moving) return;
        this.stand(0.16);
        T.yaw = Math.sin(st * 0.7) * 0.35;
        return;
      default:
        this.both((sd) => R.arm(sd, 2.6 + sd * pump * 0.2, 0.45, 0.4));
    }
  }

  /** Teammates run in with arms up, then jump, hug, applaud or point at the scorer. */
  private joinIn(t: number, st: number, moving: boolean): void {
    const R = this.rig;
    const T = this.target;
    const v = this.variant;
    const wave = Math.sin(t * 8);
    if (this.isGk) {
      const k = 0.5 + 0.5 * Math.sin(t * 5);
      R.arm(-1, mix(2.2, 2.9, k), 0.45, mix(1.4, 0.2, k));
      R.arm(1, 0.6, 0.3, 1.6, -0.4);
      if (!moving) {
        this.stand(0.14);
        T.y = Math.max(0, Math.sin(t * 5)) * 0.12;
      }
      return;
    }
    if (moving) {
      if (v < 0.5) this.both((sd) => R.arm(sd, 2.7 + sd * wave * 0.2, 0.5, 0.3));
      else R.arm(v < 0.75 ? 1 : -1, 2.8, 0.45, 0.2);
      return;
    }
    if (v < 0.3) {
      const j = Math.max(0, Math.sin(st * 6.5));
      T.y = j * 0.2 - 0.02;
      this.both((sd) => R.arm(sd, 2.75, 0.45, 0.35));
      this.both((sd) => R.leg(sd, 0.1, 0.25 + j * 0.6, 0.35 * j));
    } else if (v < 0.65) {
      const k = smooth01(0, 0.5, st);
      this.both((sd) => R.arm(sd, mix(0.3, 1.35, k), mix(0.5, -0.15, k), mix(0.3, 1.1, k), -0.55 * k));
      R.torso(0.22 * k, 0, 0);
      R.head(0.1, 0);
      R.leg(1, 0.15, 0.25, 0.05, 0.08);
      R.leg(-1, -0.15, 0.3, 0.1, 0.08);
      T.pitch = 0.08 * k;
    } else if (v < 0.85) {
      const c = Math.abs(Math.sin(st * 9));
      this.both((sd) => R.arm(sd, 1.15, 0.7 + c * 0.12, 1.55, -0.85));
      this.stand();
    } else {
      R.arm(-1, 1.5, 0.55, 0.05);
      R.arm(1, 2.4 + Math.sin(st * 6) * 0.25, 0.45, 1.6);
      this.stand();
    }
  }

  /** Jump with a full turn in the air, then the wide-legged landing with arms flung down. */
  private siuu(t: number, st: number, moving: boolean): void {
    const R = this.rig;
    const T = this.target;
    if (moving || st < 0.08) {
      R.arm(-1, 2.6 + Math.sin(t * 7) * 0.25, 0.45, 0.6);
      return;
    }
    const load = smooth01(0.08, 0.3, st) * (1 - smooth01(0.3, 0.38, st));
    const k = THREE.MathUtils.clamp((st - 0.34) / 0.62, 0, 1);
    const air = st > 0.34 && st < 0.96 ? Math.sin(Math.PI * k) : 0;
    if (!this.spinDone) {
      T.yaw = Math.PI * 2 * smooth01(0, 1, k);
      if (st > 1.05) {
        this.spinDone = true;
        this.pose.yaw -= Math.PI * 2;
        T.yaw = 0;
      }
    }
    if (st < 0.96) {
      T.y = -0.18 * load + air * 0.55;
      R.leg(1, 0.15 + air * 0.25, 0.5 * load + air * 0.9, 0.35 * air, 0.05);
      R.leg(-1, 0.15 + air * 0.2, 0.5 * load + air * 1.0, 0.35 * air, 0.05);
      this.both((sd) => R.arm(sd, mix(-0.6 * load, 2.2, air), 0.3, 0.6));
      R.torso(0.25 * load - 0.1 * air, 0, 0);
      return;
    }
    const land = smooth01(0.92, 1.1, st);
    this.both((sd) => R.leg(sd, 0, mix(0.7, 0.18, land), 0, 0.32, 0.25));
    this.both((sd) => R.arm(sd, -0.35, -0.45, 0.1, 0.4));
    R.torso(-0.3, 0, 0);
    R.head(-0.4, 0);
    T.y = -0.1 - (1 - land) * 0.15;
  }

  private backflip(t: number, st: number, moving: boolean): void {
    const R = this.rig;
    const T = this.target;
    if (moving) {
      this.both((sd) => R.arm(sd, 2.6 + sd * Math.sin(t * 8) * 0.2, 0.45, 0.4));
      return;
    }
    const k = THREE.MathUtils.clamp((st - 0.3) / 0.75, 0, 1);
    if (!this.flipDone) {
      T.pitch = -Math.PI * 2 * smooth01(0.05, 0.95, k);
      if (st > 1.12) {
        this.flipDone = true;
        this.pose.pitch += Math.PI * 2;
        T.pitch = 0;
      }
    }
    if (st < 0.3) {
      const load = smooth01(0.05, 0.3, st);
      this.both((sd) => R.leg(sd, 0.35 * load, 1.1 * load, -0.2 * load));
      this.both((sd) => R.arm(sd, -0.9 * load, 0.4, 0.3));
      R.torso(0.35 * load, 0, 0);
      T.y = -0.25 * load;
      return;
    }
    if (st < 1.05) {
      const tuck = Math.sin(Math.PI * k);
      T.y = tuck * 0.95 - 0.05;
      this.both((sd) => R.leg(sd, 1.3 * tuck, 2.0 * tuck + 0.2, 0.3));
      this.both((sd) => R.arm(sd, mix(2.6, 1.2, tuck), 0.3, 0.6 * tuck));
      R.torso(0.3 * tuck, 0, 0);
      return;
    }
    const land = smooth01(1.05, 1.3, st);
    this.both((sd) => R.leg(sd, 0.1, mix(0.9, 0.2, land), 0, 0.15));
    this.both((sd) => R.arm(sd, 2.7, 0.5, 0.3));
    T.y = -0.25 * (1 - land);
  }

  /** Side-to-side samba steps with swinging arms and hips. */
  private samba(st: number): void {
    const R = this.rig;
    const T = this.target;
    const sw = Math.sin(st * Math.PI * 2 * 2.1);
    const hop = Math.abs(sw);
    R.leg(1, 0.1 + sw * 0.25, 0.3 + Math.max(0, sw) * 0.6, 0.2, 0.12 + sw * 0.1, 0.2);
    R.leg(-1, 0.1 - sw * 0.25, 0.3 + Math.max(0, -sw) * 0.6, 0.2, 0.12 - sw * 0.1, 0.2);
    R.arm(1, sw * 0.7, 0.35, 1.5);
    R.arm(-1, -sw * 0.7, 0.35, 1.5);
    R.set("hips", 0, sw * 0.25, 0);
    R.torso(0.12, -sw * 0.35, sw * 0.12);
    R.head(0, sw * 0.2);
    T.side = sw * 0.08;
    T.roll = sw * 0.08;
    T.y = -0.08 + hop * 0.05;
  }

  /** The conceding side: hands on head or hips, head down, the keeper sinks to the turf. */
  private dejected(): void {
    const R = this.rig;
    const T = this.target;
    const still = this.speedS < 0.4;
    const v = this.variant;
    R.head(0.45, 0);
    if (this.isGk && still) {
      if (v < 0.5) {
        this.both((sd) => R.leg(sd, 0.45, 0.85, -0.2, 0.12));
        this.both((sd) => R.arm(sd, 0.75, 0.35, 0.25));
        R.torso(0.55, 0, 0);
        T.y = -0.16;
        T.pitch = 0.2;
      } else {
        this.both((sd) => R.leg(sd, 1.45, 0.4, 0.1, 0.1));
        this.both((sd) => R.arm(sd, -0.7, 0.2, 0.1));
        R.torso(-0.2, 0, 0);
        T.y = -0.82;
        T.pitch = -0.25;
      }
      return;
    }
    if (v < 0.35) this.both((sd) => R.arm(sd, 2.05, 0.3, 2.25, -0.2));
    else if (v < 0.75 || !still) this.both((sd) => R.arm(sd, -0.55, -0.05, 1.5, -0.45));
    else {
      this.both((sd) => R.leg(sd, 0.45, 0.85, -0.2, 0.12));
      this.both((sd) => R.arm(sd, 0.75, 0.35, 0.25));
      R.torso(0.55, 0, 0);
      T.y = -0.16;
      T.pitch = 0.2;
    }
  }
}