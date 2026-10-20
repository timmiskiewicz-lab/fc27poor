import * as THREE from "three";
import type { Club } from "../../../shared/clubs";
import { GOAL_DEPTH, GOAL_H, GOAL_HALF_W, HALF_L, HALF_W } from "../game/math";
import { adTexture, FIELD_X, FIELD_Z, grassDetail, netTexture, pitchTexture, screenCanvas, seatTexture, shade } from "./textures";

export interface StadiumOptions {
  home: Club;
  away: Club;
  quality: number;
  night: boolean;
}

const PATH_A = HALF_L + 8.5;
const PATH_B = HALF_W + 7.5;
const CORNER_R = 14;

/** Rounded-rectangle path around the pitch: returns point and outward normal for parameter u in [0,1). */
function pathAt(u: number, out: { x: number; z: number; nx: number; nz: number }): void {
  const sa = 2 * (PATH_A - CORNER_R);
  const sb = 2 * (PATH_B - CORNER_R);
  const arc = (Math.PI / 2) * CORNER_R;
  const total = 2 * sa + 2 * sb + 4 * arc;
  let s = (((u % 1) + 1) % 1) * total;
  const segs: Array<[number, (t: number) => void]> = [
    [sa, (t) => set(-PATH_A + CORNER_R + t * sa, PATH_B, 0, 1)],
    [arc, (t) => corner(PATH_A - CORNER_R, PATH_B - CORNER_R, Math.PI / 2 - (t * Math.PI) / 2)],
    [sb, (t) => set(PATH_A, PATH_B - CORNER_R - t * sb, 1, 0)],
    [arc, (t) => corner(PATH_A - CORNER_R, -PATH_B + CORNER_R, -(t * Math.PI) / 2)],
    [sa, (t) => set(PATH_A - CORNER_R - t * sa, -PATH_B, 0, -1)],
    [arc, (t) => corner(-PATH_A + CORNER_R, -PATH_B + CORNER_R, -Math.PI / 2 - (t * Math.PI) / 2)],
    [sb, (t) => set(-PATH_A, -PATH_B + CORNER_R + t * sb, -1, 0)],
    [arc, (t) => corner(-PATH_A + CORNER_R, PATH_B - CORNER_R, Math.PI - (t * Math.PI) / 2)],
  ];
  function set(x: number, z: number, nx: number, nz: number) {
    out.x = x;
    out.z = z;
    out.nx = nx;
    out.nz = nz;
  }
  function corner(cx: number, cz: number, a: number) {
    set(cx + Math.cos(a) * CORNER_R, cz + Math.sin(a) * CORNER_R, Math.cos(a), Math.sin(a));
  }
  for (const [len, fn] of segs) {
    if (s <= len) {
      fn(s / len);
      return;
    }
    s -= len;
  }
  segs[0][1](0);
}

function pathLength(r: number): number {
  return 4 * (PATH_A - CORNER_R) + 4 * (PATH_B - CORNER_R) + 2 * Math.PI * (CORNER_R + r);
}

/** Bowl profile in (outward offset, height) pairs; tread rows are flagged for crowd placement. */
interface Profile {
  pts: Array<[number, number]>;
  rows: Array<{ r: number; y: number; depth: number }>;
}

function bowlProfile(): Profile {
  const pts: Array<[number, number]> = [[-0.2, 0], [0, 0], [0, 1.25]];
  const rows: Profile["rows"] = [];
  let r = 0.4;
  let y = 1.25;
  pts.push([r, y]);
  for (let i = 0; i < 18; i += 1) {
    y += 0.42;
    pts.push([r, y]);
    rows.push({ r: r + 0.42, y, depth: 0.85 });
    r += 0.85;
    pts.push([r, y]);
  }
  pts.push([r, 12.2]);
  pts.push([r + 1.2, 12.2]);
  r += 1.2;
  y = 12.2;
  for (let i = 0; i < 22; i += 1) {
    y += 0.52;
    pts.push([r, y]);
    rows.push({ r: r + 0.4, y, depth: 0.8 });
    r += 0.8;
    pts.push([r, y]);
  }
  pts.push([r, y + 4.5]);
  pts.push([r + 1.5, y + 4.5]);
  pts.push([r + 1.5, 0]);
  return { pts, rows };
}

function sweep(profile: Array<[number, number]>, segments: number, vScale = 1): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const P = { x: 0, z: 0, nx: 0, nz: 0 };
  const n = profile.length;
  let vAcc = 0;
  const vs: number[] = [0];
  for (let j = 1; j < n; j += 1) {
    vAcc += Math.hypot(profile[j][0] - profile[j - 1][0], profile[j][1] - profile[j - 1][1]);
    vs.push(vAcc * vScale);
  }
  for (let i = 0; i <= segments; i += 1) {
    pathAt(i / segments, P);
    for (let j = 0; j < n; j += 1) {
      const [r, y] = profile[j];
      pos.push(P.x + P.nx * r, y, P.z + P.nz * r);
      uv.push((i / segments) * pathLength(10) * 0.25, vs[j]);
    }
  }
  for (let i = 0; i < segments; i += 1) {
    for (let j = 0; j < n - 1; j += 1) {
      const a = i * n + j;
      const b = (i + 1) * n + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function fanGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const tag = (g: THREE.BufferGeometry, part: number) => {
    const n = g.getAttribute("position").count;
    g.setAttribute("aPart", new THREE.Float32BufferAttribute(new Array(n).fill(part), 1));
    const ng = g.index ? g.toNonIndexed() : g;
    return ng;
  };
  const torso = new THREE.BoxGeometry(0.42, 0.62, 0.26);
  torso.translate(0, 0.82, 0);
  parts.push(tag(torso, 0));
  const head = new THREE.IcosahedronGeometry(0.12, 0);
  head.translate(0, 1.27, 0);
  parts.push(tag(head, 1));
  for (const s of [-1, 1]) {
    const arm = new THREE.BoxGeometry(0.1, 0.5, 0.12);
    arm.translate(s * 0.27, 0.86, 0);
    parts.push(tag(arm, 2));
  }
  const legs = new THREE.BoxGeometry(0.36, 0.5, 0.24);
  legs.translate(0, 0.25, 0);
  parts.push(tag(legs, 3));
  const merged = new THREE.BufferGeometry();
  const attrs = ["position", "normal", "aPart"];
  for (const name of attrs) {
    const arrays = parts.map((p) => p.getAttribute(name).array as Float32Array);
    const size = parts[0].getAttribute(name).itemSize;
    const total = arrays.reduce((a, b) => a + b.length, 0);
    const out = new Float32Array(total);
    let o = 0;
    for (const arr of arrays) {
      out.set(arr, o);
      o += arr.length;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(out, size));
  }
  return merged;
}

interface NetPanel {
  mesh: THREE.Mesh;
  base: Float32Array;
  normal: THREE.Vector3;
}

interface Goal {
  side: number;
  panels: NetPanel[];
  hit: THREE.Vector3;
  dir: THREE.Vector3;
  amp: number;
  t: number;
}

export class Stadium {
  readonly group = new THREE.Group();
  private readonly crowdUniforms = { uTime: { value: 0 }, uCheer: { value: 0.2 }, uGoalH: { value: 0 }, uGoalA: { value: 0 } };
  private readonly goals: Goal[] = [];
  private readonly adTex: THREE.Texture;
  private readonly flags: THREE.Mesh[] = [];
  private readonly screen: [HTMLCanvasElement, CanvasRenderingContext2D, THREE.CanvasTexture];
  private readonly disposables: Array<{ dispose(): void }> = [];
  private screenSig = "";
  private time = 0;

  constructor(private readonly opts: StadiumOptions) {
    this.buildGround();
    this.buildGoals();
    this.buildBoards();
    this.adTex = this.boardTex;
    this.buildBowl();
    this.buildCrowd();
    this.buildRoof();
    this.buildFlags();
    this.screen = screenCanvas();
    this.buildScreens();
  }

  private boardTex!: THREE.Texture;

  private track<T extends { dispose(): void }>(o: T): T {
    this.disposables.push(o);
    return o;
  }

  private buildGround(): void {
    const tex = this.track(pitchTexture(this.opts.home.id.length % 3, this.opts.quality >= 2 ? 8192 : 4096));
    const detail = this.track(grassDetail());
    const mat = this.track(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.93, metalness: 0 }));
    const uDetail = { value: detail };
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uDetail = uDetail;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vWxz;")
        .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvWxz = (modelMatrix * vec4(transformed, 1.0)).xz;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vWxz;\nuniform sampler2D uDetail;")
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>
          float dA = texture2D(uDetail, vWxz * 0.55).r;
          float dB = texture2D(uDetail, vWxz * 0.043 + 0.3).r;
          float dC = texture2D(uDetail, vWxz * 2.3).r;
          diffuseColor.rgb *= (0.78 + dA * 0.42) * (0.9 + dB * 0.2) * (0.92 + dC * 0.16);`,
        )
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = 0.86 + (texture2D(uDetail, vWxz * 0.9).r - 0.5) * 0.2;");
    };
    mat.customProgramCacheKey = () => "grass-v2";
    const ground = new THREE.Mesh(this.track(new THREE.PlaneGeometry(FIELD_X * 2, FIELD_Z * 2)), mat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);
    const apron = new THREE.Mesh(
      this.track(new THREE.PlaneGeometry(300, 300)),
      this.track(new THREE.MeshStandardMaterial({ color: 0x2c4a22, roughness: 1 })),
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -0.02;
    apron.receiveShadow = true;
    this.group.add(apron);
  }

  private buildGoals(): void {
    const white = this.track(new THREE.MeshStandardMaterial({ color: 0xf7f7f2, roughness: 0.35, metalness: 0.1 }));
    const r = 0.06;
    const netMap = this.track(netTexture());
    const netMat = this.track(
      new THREE.MeshStandardMaterial({ color: 0xffffff, alphaMap: netMap, alphaTest: 0.35, transparent: false, side: THREE.DoubleSide, roughness: 0.8 }),
    );
    for (const side of [-1, 1]) {
      const g = new THREE.Group();
      const gx = side * HALF_L;
      const post = this.track(new THREE.CylinderGeometry(r, r, GOAL_H + r, 20));
      for (const z of [-GOAL_HALF_W, GOAL_HALF_W]) {
        const m = new THREE.Mesh(post, white);
        m.position.set(gx, (GOAL_H + r) / 2, z);
        m.castShadow = true;
        g.add(m);
      }
      const bar = new THREE.Mesh(this.track(new THREE.CylinderGeometry(r, r, GOAL_HALF_W * 2 + r * 2, 20)), white);
      bar.rotation.x = Math.PI / 2;
      bar.position.set(gx, GOAL_H, 0);
      bar.castShadow = true;
      g.add(bar);
      const thin = this.track(new THREE.CylinderGeometry(0.025, 0.025, 1, 8));
      const backX = gx + side * GOAL_DEPTH;
      const frame = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
        const m = new THREE.Mesh(thin, white);
        const a = new THREE.Vector3(x0, y0, z0);
        const b = new THREE.Vector3(x1, y1, z1);
        m.position.copy(a).add(b).multiplyScalar(0.5);
        m.scale.y = a.distanceTo(b);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
        g.add(m);
      };
      for (const z of [-GOAL_HALF_W, GOAL_HALF_W]) {
        frame(backX, 0, z, backX, GOAL_H, z);
        frame(gx, GOAL_H, z, backX, GOAL_H, z);
        frame(gx, 0.02, z, backX, 0.02, z);
      }
      frame(backX, GOAL_H, -GOAL_HALF_W, backX, GOAL_H, GOAL_HALF_W);
      frame(backX, 0.02, -GOAL_HALF_W, backX, 0.02, GOAL_HALF_W);
      const goal: Goal = { side, panels: [], hit: new THREE.Vector3(), dir: new THREE.Vector3(), amp: 0, t: 9 };
      const panel = (w: number, h: number, sw: number, sh: number, place: (m: THREE.Mesh) => void, normal: THREE.Vector3) => {
        const geo = new THREE.PlaneGeometry(w, h, sw, sh);
        const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * (w / 0.16), uv.getY(i) * (h / 0.16));
        const m = new THREE.Mesh(geo, netMat);
        place(m);
        m.updateMatrixWorld(true);
        geo.applyMatrix4(m.matrixWorld);
        m.position.set(0, 0, 0);
        m.rotation.set(0, 0, 0);
        m.scale.set(1, 1, 1);
        m.castShadow = true;
        this.track(geo);
        g.add(m);
        const base = Float32Array.from(geo.getAttribute("position").array as Float32Array);
        goal.panels.push({ mesh: m, base, normal });
      };
      panel(GOAL_HALF_W * 2, GOAL_H, 30, 12, (m) => {
        m.position.set(backX, GOAL_H / 2, 0);
        m.rotation.y = Math.PI / 2;
      }, new THREE.Vector3(side, 0, 0));
      panel(GOAL_HALF_W * 2, GOAL_DEPTH, 30, 10, (m) => {
        m.position.set(gx + (side * GOAL_DEPTH) / 2, GOAL_H, 0);
        m.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
      }, new THREE.Vector3(0, 1, 0));
      for (const z of [-GOAL_HALF_W, GOAL_HALF_W]) {
        panel(GOAL_DEPTH, GOAL_H, 10, 12, (m) => {
          m.position.set(gx + (side * GOAL_DEPTH) / 2, GOAL_H / 2, z);
        }, new THREE.Vector3(0, 0, Math.sign(z)));
      }
      this.goals.push(goal);
      this.group.add(g);
    }
  }

  netHit(x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
    const goal = this.goals.find((g) => Math.sign(x) === g.side);
    if (!goal) return;
    const sp = Math.hypot(vx, vy, vz);
    goal.hit.set(x, y, z);
    goal.dir.set(vx, vy * 0.4, vz).normalize();
    if (goal.dir.lengthSq() < 0.5) goal.dir.set(goal.side, 0, 0);
    goal.amp = Math.min(0.55, 0.12 + sp * 0.022);
    goal.t = 0;
  }

  private updateNets(dt: number, ball: [number, number, number] | null): void {
    for (const goal of this.goals) {
      goal.t += dt;
      const inside = ball && Math.abs(ball[0]) > HALF_L && Math.sign(ball[0]) === goal.side && Math.abs(ball[2]) < GOAL_HALF_W + 0.2 && ball[1] < GOAL_H + 0.2;
      const wave = goal.amp * Math.exp(-goal.t * 3.2) * Math.cos(goal.t * 13);
      if (Math.abs(wave) < 0.002 && !inside && goal.t > 3) continue;
      for (const panel of goal.panels) {
        const attr = panel.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
        const arr = attr.array as Float32Array;
        for (let i = 0; i < arr.length; i += 3) {
          const bx = panel.base[i];
          const by = panel.base[i + 1];
          const bz = panel.base[i + 2];
          const d2 = (bx - goal.hit.x) ** 2 + (by - goal.hit.y) ** 2 + (bz - goal.hit.z) ** 2;
          const edge = Math.min(1, by / 0.4, (GOAL_H - by + 0.001) / 0.3 + (panel.normal.y > 0.5 ? 1 : 0), (GOAL_HALF_W - Math.abs(bz) + 0.001) / 0.3 + (panel.normal.z !== 0 ? 1 : 0));
          let k = wave * Math.exp(-d2 / 0.9) * Math.max(0, edge);
          let ox = goal.dir.x * k;
          let oy = goal.dir.y * k;
          let oz = goal.dir.z * k;
          if (inside && ball) {
            const e2 = (bx - ball[0]) ** 2 + (by - ball[1]) ** 2 + (bz - ball[2]) ** 2;
            k = Math.exp(-e2 / 0.12) * 0.12 * Math.max(0, edge);
            ox += panel.normal.x * k;
            oy += panel.normal.y * k;
            oz += panel.normal.z * k;
          }
          arr[i] = bx + ox;
          arr[i + 1] = by + oy;
          arr[i + 2] = bz + oz;
        }
        attr.needsUpdate = true;
      }
    }
  }

  private buildBoards(): void {
    const tex = this.track(adTexture([this.opts.home, this.opts.away], this.opts.home.stadium));
    this.boardTex = tex;
    const front = this.track(new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: this.opts.night ? 1.2 : 0.6, roughness: 0.4 }));
    const backMat = this.track(new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: 0.8 }));
    const board = (len: number, x: number, z: number, rotY: number) => {
      const geo = new THREE.BoxGeometry(len, 0.9, 0.16);
      const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i += 1) uv.setX(i, uv.getX(i) * (len / 40));
      this.track(geo);
      const m = new THREE.Mesh(geo, [backMat, backMat, backMat, backMat, front, backMat]);
      m.position.set(x, 0.45, z);
      m.rotation.y = rotY;
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    };
    board(108, 0, -(HALF_W + 4.3), 0);
    board(108, 0, HALF_W + 4.3, Math.PI);
    board(60, HALF_L + 4.6, 0, -Math.PI / 2);
    board(60, -(HALF_L + 4.6), 0, Math.PI / 2);
  }

  private buildBowl(): void {
    const prof = bowlProfile();
    const geo = this.track(sweep(prof.pts, 360, 0.18));
    const seats = this.track(seatTexture(this.opts.home));
    seats.repeat.set(1, 1);
    const mat = this.track(new THREE.MeshStandardMaterial({ map: seats, roughness: 0.85, side: THREE.DoubleSide }));
    const bowl = new THREE.Mesh(geo, mat);
    bowl.receiveShadow = true;
    this.group.add(bowl);
    const fascia: Array<[number, number]> = [
      [16.05, 9.6],
      [16.05, 11.4],
    ];
    const ribbon = this.track(sweep(fascia, 360, 1));
    const rib = new THREE.Mesh(ribbon, this.track(new THREE.MeshStandardMaterial({ map: this.boardTex, emissiveMap: this.boardTex, emissive: 0xffffff, emissiveIntensity: this.opts.night ? 1.5 : 0.8, side: THREE.DoubleSide })));
    const ruv = ribbon.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < ruv.count; i += 1) ruv.setXY(i, ruv.getX(i) * 0.06, ruv.getY(i) / 1.8);
    this.group.add(rib);
  }

  private buildCrowd(): void {
    const prof = bowlProfile();
    const fill = [0.28, 0.62, 0.9][Math.max(0, Math.min(2, this.opts.quality))];
    const geo = this.track(fanGeometry());
    const home = this.opts.home;
    const away = this.opts.away;
    const homeCols = [home.home.shirt, home.home.alt, home.home.shirt, home.home.trim, "#f2f2f2", "#1b1b1b"];
    const awayCols = [away.home.shirt, away.home.alt, away.home.shirt, away.home.trim];
    const neutral = ["#1c1c1f", "#2d3240", "#5b5f68", "#f0f0f0", "#3b2a22", "#20304d", "#7a1d22"];
    const skins = ["#f2d6c2", "#e3b796", "#c99470", "#a8724d", "#7c4f33"];
    const items: Array<{ x: number; y: number; z: number; yaw: number; team: number }> = [];
    const P = { x: 0, z: 0, nx: 0, nz: 0 };
    let seed = 1;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (const row of prof.rows) {
      const L = pathLength(row.r);
      const count = Math.floor(L / 0.56);
      for (let i = 0; i < count; i += 1) {
        if (rnd() > fill) continue;
        const u = (i + rnd() * 0.3) / count;
        pathAt(u, P);
        const x = P.x + P.nx * (row.r + (rnd() - 0.5) * 0.1);
        const z = P.z + P.nz * (row.r + (rnd() - 0.5) * 0.1);
        const awayEnd = x < -PATH_A + 4 && z < 0;
        items.push({ x, y: row.y, z, yaw: Math.atan2(-P.nx, -P.nz), team: awayEnd ? 1 : rnd() < 0.82 ? 0 : 2 });
      }
    }
    const mesh = new THREE.InstancedMesh(geo, this.crowdMaterial(), items.length);
    const phase = new Float32Array(items.length);
    const team = new Float32Array(items.length);
    const skin = new Float32Array(items.length * 3);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const c = new THREE.Color();
    items.forEach((it, i) => {
      const h = 0.92 + rnd() * 0.16;
      s.set(h, h, h);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.yaw + (rnd() - 0.5) * 0.4);
      m4.compose(new THREE.Vector3(it.x, it.y, it.z), q, s);
      mesh.setMatrixAt(i, m4);
      const pal = it.team === 0 ? (rnd() < 0.75 ? homeCols : neutral) : it.team === 1 ? (rnd() < 0.85 ? awayCols : neutral) : neutral;
      c.set(pal[Math.floor(rnd() * pal.length)]);
      c.multiplyScalar(0.75 + rnd() * 0.3);
      mesh.setColorAt(i, c);
      phase[i] = rnd();
      team[i] = it.team;
      c.set(skins[Math.floor(rnd() * skins.length)]);
      skin[i * 3] = c.r;
      skin[i * 3 + 1] = c.g;
      skin[i * 3 + 2] = c.b;
    });
    geo.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phase, 1));
    geo.setAttribute("aTeam", new THREE.InstancedBufferAttribute(team, 1));
    geo.setAttribute("aSkin", new THREE.InstancedBufferAttribute(skin, 3));
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }

  private crowdMaterial(): THREE.Material {
    const mat = this.track(new THREE.MeshLambertMaterial({ color: 0xffffff }));
    const u = this.crowdUniforms;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
          attribute float aPart; attribute float aPhase; attribute float aTeam; attribute vec3 aSkin;
          uniform float uTime, uCheer, uGoalH, uGoalA;
          varying vec3 vSkin; varying float vPart;`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          vSkin = aSkin; vPart = aPart;
          float ph = aPhase * 6.2831 + uTime * (2.4 + aPhase * 1.8);
          float exc = uCheer * (0.35 + aPhase * 0.4) + (aTeam < 0.5 ? uGoalH : (aTeam < 1.5 ? uGoalA : uGoalH * 0.3));
          float jump = max(0.0, sin(ph * 1.7)) * 0.32 * clamp(exc, 0.0, 1.2);
          transformed.y += sin(ph * 0.4) * 0.015 + jump * step(aPart, 2.5);
          if (aPart > 2.5) transformed.y += jump * 0.4;
          if (aPart > 1.5 && aPart < 2.5) {
            float raise = clamp(exc * 1.6 - 0.3 + sin(ph * 0.31) * 0.3, 0.0, 1.0);
            float wave = sin(ph * 2.3) * 0.08 * raise;
            transformed.y = mix(transformed.y, 2.24 - transformed.y + jump, raise);
            transformed.x += wave * sign(transformed.x);
          }`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vSkin; varying float vPart;")
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          if (vPart > 0.5 && vPart < 1.5) diffuseColor.rgb = vSkin;
          if (vPart > 2.5) diffuseColor.rgb = vec3(0.07, 0.08, 0.1);`,
        );
    };
    mat.customProgramCacheKey = () => "crowd-v2";
    return mat;
  }

  private buildRoof(): void {
    const top = this.track(sweep([[44, 31], [3.5, 33.2], [3.5, 32.4], [44, 30.2]], 240));
    const roof = new THREE.Mesh(top, this.track(new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.75, metalness: 0.4, side: THREE.DoubleSide })));
    this.group.add(roof);
    const strip = this.track(sweep([[4.2, 32.2], [7.5, 32.0]], 240));
    const light = new THREE.Mesh(
      strip,
      this.track(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e0, emissiveIntensity: this.opts.night ? 3.2 : 0.6, side: THREE.DoubleSide })),
    );
    this.group.add(light);
    const P = { x: 0, z: 0, nx: 0, nz: 0 };
    const truss = this.track(new THREE.BoxGeometry(0.35, 0.35, 40));
    const trussMat = this.track(new THREE.MeshStandardMaterial({ color: 0x3a3f48, roughness: 0.6, metalness: 0.5 }));
    for (let i = 0; i < 48; i += 1) {
      pathAt(i / 48, P);
      const m = new THREE.Mesh(truss, trussMat);
      m.position.set(P.x + P.nx * 24, 31.2, P.z + P.nz * 24);
      m.rotation.y = Math.atan2(P.nx, P.nz);
      m.rotation.x = 0.055;
      this.group.add(m);
    }
  }

  private buildFlags(): void {
    const pole = this.track(new THREE.CylinderGeometry(0.02, 0.02, 1.6, 8));
    const poleMat = this.track(new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 }));
    const flagGeo = this.track(new THREE.PlaneGeometry(0.45, 0.32, 6, 1));
    flagGeo.translate(0.225, 0, 0);
    const flagMat = this.track(new THREE.MeshStandardMaterial({ color: new THREE.Color(this.opts.home.home.shirt), side: THREE.DoubleSide, roughness: 0.7 }));
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const p = new THREE.Mesh(pole, poleMat);
        p.position.set(sx * HALF_L, 0.8, sz * HALF_W);
        p.castShadow = true;
        this.group.add(p);
        const f = new THREE.Mesh(flagGeo, flagMat);
        f.position.set(sx * HALF_L, 1.42, sz * HALF_W);
        f.castShadow = true;
        this.flags.push(f);
        this.group.add(f);
      }
    }
  }

  private buildScreens(): void {
    const [, , tex] = this.screen;
    const mat = this.track(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    const frameMat = this.track(new THREE.MeshStandardMaterial({ color: 0x111317, roughness: 0.6 }));
    for (const sx of [-1, 1]) {
      const g = new THREE.Group();
      const scr = new THREE.Mesh(this.track(new THREE.PlaneGeometry(14, 7)), mat);
      const back = new THREE.Mesh(this.track(new THREE.BoxGeometry(14.6, 7.6, 0.6)), frameMat);
      back.position.z = -0.32;
      g.add(scr, back);
      const x = sx * (PATH_A + 8);
      const z = -(PATH_B + 8);
      g.position.set(x, 27.5, z);
      g.lookAt(0, 12, 0);
      this.group.add(g);
    }
  }

  setScreen(text: { home: string; away: string; score: string; clock: string; flash: string }): void {
    const sig = JSON.stringify(text);
    if (sig === this.screenSig) return;
    this.screenSig = sig;
    const [, g, tex] = this.screen;
    const W = 512;
    const H = 256;
    g.fillStyle = "#04070d";
    g.fillRect(0, 0, W, H);
    g.textAlign = "center";
    g.textBaseline = "middle";
    if (text.flash) {
      g.fillStyle = "#ffd34d";
      g.font = '900 120px "Arial Black", Arial';
      g.fillText(text.flash, W / 2, H / 2);
    } else {
      g.fillStyle = shade(this.opts.home.home.shirt, 0.1);
      g.fillRect(24, 40, 150, 80);
      g.fillStyle = shade(this.opts.away.home.shirt, 0.1);
      g.fillRect(W - 174, 40, 150, 80);
      g.fillStyle = "#ffffff";
      g.font = '900 52px "Arial Black", Arial';
      g.fillText(text.home, 99, 82);
      g.fillText(text.away, W - 99, 82);
      g.font = '900 86px "Arial Black", Arial';
      g.fillText(text.score, W / 2, 84);
      g.font = "700 56px Arial";
      g.fillStyle = "#b8c7e0";
      g.fillText(text.clock, W / 2, 190);
    }
    tex.needsUpdate = true;
  }

  update(dt: number, cheer: number, goalHome: number, goalAway: number, ball: [number, number, number] | null): void {
    this.time += dt;
    const u = this.crowdUniforms;
    u.uTime.value = this.time;
    u.uCheer.value += (cheer - u.uCheer.value) * (1 - Math.exp(-dt * 2));
    u.uGoalH.value = goalHome;
    u.uGoalA.value = goalAway;
    this.adTex.offset.x = (this.time * 0.02) % 1;
    for (let i = 0; i < this.flags.length; i += 1) {
      this.flags[i].rotation.y = Math.sin(this.time * 2.2 + i) * 0.35 + 0.4;
    }
    this.updateNets(dt, ball);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}
