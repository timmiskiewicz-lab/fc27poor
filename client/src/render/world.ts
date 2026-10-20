import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { clubById, keeperKit, pickKits, refereeKit, type Club, type ClubId, type Kit } from "../../../shared/clubs";
import { ROSTERS, type Look } from "../../../shared/rosters";
import { ACT, type MatchEvent, type MatchView, type PlayerView } from "../../../shared/state";
import type { GroundBasis } from "../game/input";
import { BALL_R, clamp, HALF_L, HALF_W, smooth } from "../game/math";
import { lerpView } from "../game/viewLerp";
import { Avatar, loadAvatarTemplate, type AvatarTemplate } from "./avatar";
import { Stadium } from "./stadium";
import { ballTexture, crestTexture, printTexture } from "./textures";

export type Screen = "menu" | "clubs" | "match";
export type CamMode = "tv" | "wide" | "pro";
export type Quality = "low" | "high" | "ultra";

export interface WorldSettings {
  quality: Quality;
  night: boolean;
  camera: CamMode;
}

const QUALITY_LEVEL: Record<Quality, number> = { low: 0, high: 1, ultra: 2 };

const REF_LOOK: Look = { skin: 1, hair: "short", hairColor: "#2b1d14", beard: 0, height: 1.8, boots: "#161616" };
const LINE_LOOKS: Look[] = [
  { skin: 2, hair: "buzz", hairColor: "#141010", beard: 1, height: 1.78, boots: "#161616" },
  { skin: 0, hair: "crop", hairColor: "#4a3020", beard: 0, height: 1.83, boots: "#161616" },
];

const VignetteShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 0.28 }, uSat: { value: 1.08 } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uAmount; uniform float uSat; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); float l = dot(c.rgb, vec3(0.299,0.587,0.114));
    c.rgb = mix(vec3(l), c.rgb, uSat); vec2 d = vUv - 0.5; float v = 1.0 - dot(d,d) * uAmount * 1.6;
    gl_FragColor = vec4(c.rgb * v, c.a); }`,
};

interface Recorded {
  t: number;
  v: MatchView;
}

export class World {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.3, 1500);
  readonly ready: Promise<void>;
  private tpl: AvatarTemplate | null = null;
  private stadium: Stadium | null = null;
  private stadiumKey = "";
  private readonly avatars: Avatar[] = [];
  private readonly refs: Avatar[] = [];
  private readonly ball: THREE.Mesh;
  private readonly ballSpin = new THREE.Quaternion();
  private readonly markers: THREE.Group[] = [];
  private readonly sun: THREE.DirectionalLight;
  private readonly fill: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly sky: THREE.Mesh;
  private readonly skyU = { uTop: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() }, uStars: { value: 1 } };
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private settings: WorldSettings = { quality: "high", night: true, camera: "tv" };
  private q = 1;
  private clubs: [Club, Club] = [clubById("barca"), clubById("real")];
  private dressedKey = "";
  private time = 0;
  private screen: Screen = "menu";
  private readonly camPos = new THREE.Vector3(0, 30, 80);
  private readonly camLook = new THREE.Vector3();
  private fov = 34;
  private focus = new THREE.Vector2();
  private rec: Recorded[] = [];
  private recT = 0;
  private goalT = -1;
  private goalGroup = 0;
  private lastMode = "";
  private replay: { t: number; cut: number } | null = null;
  private modeT = 0;
  private goalFlash = [0, 0];
  private size = new THREE.Vector2(1, 1);
  private readonly raycaster = new THREE.Raycaster();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.32;
    pmrem.dispose();

    this.hemi = new THREE.HemisphereLight(0x9fb4d6, 0x2b3a22, 0.6);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
    this.sun.position.set(25, 90, 35);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -64;
    sc.right = 64;
    sc.top = 44;
    sc.bottom = -44;
    sc.near = 20;
    sc.far = 200;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    this.fill = new THREE.DirectionalLight(0xdde6ff, 0.7);
    this.fill.position.set(-40, 60, -50);
    this.scene.add(this.fill);

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: this.skyU,
        vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
        fragmentShader: `uniform vec3 uTop; uniform vec3 uBottom; uniform float uStars; varying vec3 vP;
          float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
          void main(){ float t = clamp(vP.y * 1.6 + 0.1, 0.0, 1.0); vec3 c = mix(uBottom, uTop, t);
          vec3 q = floor(vP * 420.0); float s = step(0.9975, h(q)) * uStars * smoothstep(0.1, 0.5, vP.y);
          gl_FragColor = vec4(c + s * 0.8, 1.0); }`,
      }),
    );
    this.scene.add(this.sky);

    const bt = ballTexture();
    bt.anisotropy = 8;
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 40, 28), new THREE.MeshStandardMaterial({ map: bt, roughness: 0.38, metalness: 0 }));
    this.ball.castShadow = true;
    this.scene.add(this.ball);

    for (const color of [0x3aa0ff, 0xff4a4a]) {
      const g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false });
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.32, 3), mat);
      cone.rotation.x = Math.PI;
      cone.position.y = 2.45;
      cone.renderOrder = 10;
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.68, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.02;
      g.add(cone, ring);
      g.visible = false;
      this.markers.push(g);
      this.scene.add(g);
    }

    this.applySettings(this.settings);
    this.buildStadium();
    this.ready = this.load();
  }

  private async load(): Promise<void> {
    this.tpl = await loadAvatarTemplate("models");
    for (let i = 0; i < 22; i += 1) {
      const a = new Avatar(this.tpl);
      this.avatars.push(a);
      this.scene.add(a.root);
    }
    for (let i = 0; i < 3; i += 1) {
      const a = new Avatar(this.tpl);
      a.setProp(i === 0 ? 0 : 2);
      this.refs.push(a);
      this.scene.add(a.root);
    }
    this.dressedKey = "";
    this.dress();
  }

  applySettings(s: WorldSettings): void {
    const rebuild = s.quality !== this.settings.quality || s.night !== this.settings.night;
    this.settings = { ...s };
    const q = QUALITY_LEVEL[s.quality];
    this.q = q;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q >= 2 ? 2 : q === 1 ? 1.5 : 1));
    const map = q >= 2 ? 4096 : q === 1 ? 4096 : 2048;
    if (this.sun.shadow.mapSize.x !== map) {
      this.sun.shadow.mapSize.set(map, map);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    if (s.night) {
      this.skyU.uTop.value.set("#02050d");
      this.skyU.uBottom.value.set("#16233b");
      this.skyU.uStars.value = 1;
      this.hemi.color.set(0x9fb4d6);
      this.hemi.intensity = 0.55;
      this.sun.color.set(0xfffaf0);
      this.sun.intensity = 2.5;
      this.sun.position.set(18, 95, 30);
      this.fill.intensity = 0.75;
      this.renderer.toneMappingExposure = 1.05;
    } else {
      this.skyU.uTop.value.set("#3f78c4");
      this.skyU.uBottom.value.set("#cfe1f2");
      this.skyU.uStars.value = 0;
      this.hemi.color.set(0xcfe4ff);
      this.hemi.intensity = 0.8;
      this.sun.color.set(0xfff1d8);
      this.sun.intensity = 3.0;
      this.sun.position.set(55, 80, -25);
      this.fill.intensity = 0.45;
      this.renderer.toneMappingExposure = 1.0;
    }
    this.setupComposer();
    if (rebuild && this.stadium) {
      this.stadiumKey = "";
      this.buildStadium();
    }
  }

  private setupComposer(): void {
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
    if (this.q === 0) return;
    const w = Math.max(1, this.size.x);
    const h = Math.max(1, this.size.y);
    const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), this.settings.night ? 0.42 : 0.22, 0.5, 1.5);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    composer.addPass(new ShaderPass(VignetteShader));
    composer.setPixelRatio(this.renderer.getPixelRatio());
    composer.setSize(w, h);
    this.composer = composer;
  }

  resize(w: number, h: number): void {
    this.size.set(w, h);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.composer?.setSize(w, h);
  }

  /** Dresses the squads; the stadium (crowd colours, boards) is rebuilt only when `stadium` is set because it is slow. */
  setClubs(left: ClubId, right: ClubId, stadium: boolean): void {
    this.clubs = [clubById(left), clubById(right)];
    if (stadium) this.buildStadium();
    this.dress();
  }

  private buildStadium(): void {
    const key = `${this.clubs[0].id}:${this.clubs[1].id}:${this.q}:${this.settings.night}`;
    if (key === this.stadiumKey) return;
    this.stadiumKey = key;
    this.stadium?.dispose();
    this.stadium = new Stadium({ home: this.clubs[0], away: this.clubs[1], quality: this.q, night: this.settings.night });
    this.scene.add(this.stadium.group);
  }

  private dress(): void {
    if (!this.tpl) return;
    const key = `${this.clubs[0].id}:${this.clubs[1].id}`;
    if (key === this.dressedKey) return;
    this.dressedKey = key;
    const [kitL, kitR] = pickKits(this.clubs[0], this.clubs[1]);
    const kits: [Kit, Kit] = [kitL, kitR];
    const gk0 = keeperKit(kits, []);
    const gk1 = keeperKit(kits, [gk0.shirt]);
    const gks = [gk0, gk1];
    for (let team = 0; team < 2; team += 1) {
      const club = this.clubs[team];
      const roster = ROSTERS[club.id];
      const crest = crestTexture(club.crest);
      for (let slot = 0; slot < 11; slot += 1) {
        const info = roster[slot];
        const kit = slot === 0 ? gks[team] : kits[team];
        const a = this.avatars[team * 11 + slot];
        a.kit.uPrint.value?.dispose();
        a.dress({ kit, look: info.look, gk: slot === 0, print: printTexture(kit, info.shirtName, info.num), crest, gloves: slot === 0 ? (team === 0 ? "#f4f4f0" : "#1d1d1d") : undefined }, info.look.height);
        a.kit.uDirt.value = 0;
      }
    }
    const ref = refereeKit(kits);
    this.refs.forEach((a, i) => a.dress({ kit: ref, look: i === 0 ? REF_LOOK : LINE_LOOKS[i - 1], gk: false, print: null, crest: null }, i === 0 ? 1.8 : 1.78));
  }

  // ------------------------------------------------------------------ replay buffer

  record(v: MatchView, dt: number): void {
    if (v.mode === "replay" || v.mode === "paused") return;
    this.recT += dt;
    this.rec.push({ t: this.recT, v });
    while (this.rec.length > 2 && this.rec[0].t < this.recT - 14) this.rec.shift();
  }

  private sampleRec(t: number): MatchView | null {
    const r = this.rec;
    if (r.length === 0) return null;
    if (t <= r[0].t) return r[0].v;
    if (t >= r[r.length - 1].t) return r[r.length - 1].v;
    let lo = 0;
    let hi = r.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (r[mid].t <= t) lo = mid;
      else hi = mid;
    }
    const a = r[lo];
    const b = r[hi];
    return lerpView(a.v, b.v, (t - a.t) / Math.max(1e-6, b.t - a.t));
  }

  replaying(): boolean {
    return this.replay !== null;
  }

  setMarkerColors(left: string, right: string): void {
    [left, right].forEach((c, i) => {
      for (const child of this.markers[i].children) ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(c);
    });
  }

  // ------------------------------------------------------------------ events

  onEvents(events: MatchEvent[], view: MatchView | null): void {
    for (const e of events) {
      if (e.k === "net" && view) this.stadium?.netHit(view.ball[0], view.ball[1], view.ball[2], view.ballV[0], view.ballV[1], view.ballV[2]);
      if (e.k === "goal") {
        this.goalFlash[e.team] = 1;
        if (view) this.stadium?.netHit(view.ball[0], view.ball[1], view.ball[2], view.ballV[0] || Math.sign(view.ball[0]) * 10, view.ballV[1], view.ballV[2]);
      }
    }
  }

  // ------------------------------------------------------------------ frame

  update(dt: number, screen: Screen, live: MatchView | null, humans: [boolean, boolean]): MatchView | null {
    this.time += dt;
    if (screen !== this.screen) {
      this.screen = screen;
      this.rec = [];
      this.replay = null;
      this.goalT = -1;
    }
    let view = live;
    let animDt = dt;
    if (live) {
      if (live.mode !== this.lastMode) {
        if (live.mode === "goal") {
          this.goalT = this.recT;
          this.goalGroup = 0;
        }
        if (live.mode === "replay") this.replay = { t: Math.max(this.rec[0]?.t ?? 0, this.goalT - 4.8), cut: 0 };
        if (this.lastMode === "replay") this.replay = null;
        this.lastMode = live.mode;
        this.modeT = 0;
      } else this.modeT += dt;
      if (this.replay && live.mode === "replay") {
        const slow = this.replay.t > this.goalT - 1.3;
        const rate = slow ? 0.42 : 1;
        this.replay.t = Math.min(this.goalT + 1.2, this.replay.t + dt * rate);
        this.replay.cut = slow ? 1 : 0;
        animDt = dt * rate;
        view = this.sampleRec(this.replay.t) ?? live;
      } else this.replay = null;
    }
    for (let i = 0; i < 2; i += 1) this.goalFlash[i] = Math.max(0, this.goalFlash[i] - dt * 0.12);
    if (screen === "match" && view) this.syncMatch(view, animDt, humans);
    else this.syncIdle(dt, screen);
    this.direct(dt, screen, view, humans);
    let cheer = 0.2;
    if (view && screen === "match") {
      const dangerL = clamp((Math.abs(view.ball[0]) - 25) / 25, 0, 1);
      cheer = 0.15 + dangerL * 0.55 + (view.mode === "goal" ? 0.6 : 0);
    }
    this.stadium?.update(dt, cheer, this.goalFlash[0], this.goalFlash[1], view?.ball ?? null);
    if (view && screen === "match") {
      const m = Math.floor((view.clock / view.halfLen) * 45 + (view.half === 2 ? 45 : 0));
      const flash = view.mode === "goal" && Math.floor(this.time * 2) % 2 === 0 ? "GOL!" : "";
      this.stadium?.setScreen({ home: this.clubs[0].short, away: this.clubs[1].short, score: `${view.score[0]} - ${view.score[1]}`, clock: `${m}'`, flash });
    } else this.stadium?.setScreen({ home: this.clubs[0].short, away: this.clubs[1].short, score: "VS", clock: "FC 27", flash: "" });
    return view;
  }

  private syncMatch(view: MatchView, dt: number, humans: [boolean, boolean]): void {
    const owner = view.owner;
    for (let i = 0; i < this.avatars.length; i += 1) {
      const a = this.avatars[i];
      const p = view.players[i];
      if (!p) continue;
      const team = i < 11 ? 0 : 1;
      const controlled = humans[team] && view.control[team] === i;
      a.update(p, dt, { ball: view.ball, owner: owner === i && controlled, charge: controlled ? Math.max(0, view.charge[team]) : 0, celebrate: view.mode === "goal", isRef: false });
      if (p.act === ACT.slide || p.act === ACT.fallen || p.act === ACT.dive) a.kit.uDirt.value = Math.min(1, a.kit.uDirt.value + dt * 0.3);
    }
    this.refs.forEach((a, i) => {
      const r = view.refs[i];
      if (!r) return;
      a.update(r, dt, { ball: view.ball, owner: false, charge: 0, celebrate: false, isRef: true });
      if (i === 0) a.showCard(r.aa >= 2, r.act === ACT.card);
    });
    this.ball.position.set(view.ball[0], view.ball[1], view.ball[2]);
    this.spinBall(view, dt);
    for (let t = 0; t < 2; t += 1) {
      const m = this.markers[t];
      const id = view.control[t];
      const show = humans[t] && !this.replay && view.mode !== "goal" && view.mode !== "halftime" && view.mode !== "fulltime" && id >= 0 && view.players[id]?.on;
      m.visible = Boolean(show);
      if (show) {
        const p = view.players[id];
        m.position.set(p.x, Math.sin(this.time * 5) * 0.05, p.z);
        m.children[0].rotation.y = this.time * 2;
      }
    }
  }

  private spinBall(view: MatchView, dt: number): void {
    const vx = view.ballV[0];
    const vz = view.ballV[2];
    const sp = Math.hypot(vx, vz);
    if (sp > 0.05) {
      const ax = new THREE.Vector3(vz, 0, -vx).normalize();
      const onGround = view.ball[1] < BALL_R + 0.05;
      const w = ((sp / BALL_R) * (onGround ? 1 : 0.35)) * dt;
      this.ballSpin.setFromAxisAngle(ax, w);
      this.ball.quaternion.premultiply(this.ballSpin);
    }
  }

  private photoPlayers(): number[] {
    return [9, 10, 20, 19];
  }

  private syncIdle(dt: number, screen: Screen): void {
    for (const m of this.markers) m.visible = false;
    const show = screen === "clubs" ? this.photoPlayers() : [];
    for (let i = 0; i < this.avatars.length; i += 1) {
      const a = this.avatars[i];
      const k = show.indexOf(i);
      if (k < 0) {
        a.root.visible = false;
        continue;
      }
      const x = [-2.1, -0.75, 0.75, 2.1][k];
      const view: PlayerView = { x, z: Math.abs(x) > 1 ? -0.5 : 0, yaw: Math.PI / 2 + (x < 0 ? -0.18 : 0.18), vx: 0, vz: 0, act: ACT.wait, at: 0.5, aa: 0, on: true };
      a.update(view, dt, { ball: [0, 1.6, 8], owner: false, charge: 0, celebrate: false, isRef: false });
    }
    for (const r of this.refs) r.root.visible = false;
    this.ball.position.set(0, BALL_R, screen === "clubs" ? 0.9 : 0);
  }

  // ------------------------------------------------------------------ camera

  private direct(dt: number, screen: Screen, view: MatchView | null, humans: [boolean, boolean]): void {
    const pos = new THREE.Vector3();
    const look = new THREE.Vector3();
    let fov = 34;
    let k = 3.2;
    if (screen === "menu" || !view) {
      const a = this.time * 0.05;
      pos.set(Math.cos(a) * 66, 17 + Math.sin(this.time * 0.11) * 4, Math.sin(a) * 50);
      look.set(0, 2, 0);
      fov = 42;
      k = 50;
    } else if (screen === "clubs") {
      pos.set(0, 1.5, 7.6);
      look.set(0, 1.12, 0);
      fov = 36;
      k = 50;
    } else if (this.replay) {
      const b = view.ball;
      if (this.replay.cut === 0) {
        pos.set(b[0] - Math.sign(b[0] || 1) * 7, 2.2, b[2] + 9);
        look.set(b[0], 0.9, b[2]);
        fov = 40;
        k = 6;
      } else {
        const gs = Math.sign(b[0] || 1);
        pos.set(gs * (HALF_L + 13), 5.5, b[2] * 0.4 + 5);
        look.set(b[0] - gs * 4, 1, b[2]);
        fov = 38;
        k = 40;
      }
    } else if (view.mode === "goal" && view.goals.length) {
      const g = view.goals[view.goals.length - 1];
      const p = view.players[g.id] ?? view.players[0];
      const sp = Math.hypot(p.vx, p.vz);
      if (sp > 2.5) {
        const ux = p.vx / sp;
        const uz = p.vz / sp;
        pos.set(p.x + ux * 8 - uz * 3, 2.1, p.z + uz * 8 + ux * 3);
        fov = 40;
        k = 3;
      } else {
        let crowd = 0;
        for (let i = g.team * 11; i < g.team * 11 + 11; i += 1) {
          const q = view.players[i];
          if (q && q !== p && q.on && Math.hypot(q.x - p.x, q.z - p.z) < 2.6) crowd += 1;
        }
        const group = smooth(1, 3, crowd);
        this.goalGroup += (group - this.goalGroup) * (1 - Math.exp(-dt * 1.5));
        const gg = this.goalGroup;
        const orbit = Math.sin(this.modeT * 0.35) * 0.45;
        const fx = Math.cos(p.yaw + orbit);
        const fz = Math.sin(p.yaw + orbit);
        const dist = 5.2 + gg * 4;
        pos.set(p.x + fx * dist, 1.75 + gg * 2.4, p.z + fz * dist);
        fov = 36 + gg * 4;
        k = 2.2;
      }
      pos.x = clamp(pos.x, -HALF_L - 4, HALF_L + 4);
      pos.z = clamp(pos.z, -HALF_W - 4, HALF_W + 4);
      look.set(p.x, 1.1, p.z);
    } else if (view.mode === "halftime" || view.mode === "fulltime") {
      const a = this.time * 0.06;
      pos.set(Math.cos(a) * 60, 32, Math.sin(a) * 46);
      look.set(0, 0, 0);
      fov = 44;
      k = 1.5;
    } else {
      const b = view.ball;
      let fx = b[0] + view.ballV[0] * 0.35;
      let fz = b[2] + view.ballV[2] * 0.2;
      let spread = 0;
      const both = humans[0] && humans[1];
      if (both) {
        const p0 = view.players[view.control[0]];
        const p1 = view.players[view.control[1]];
        if (p0 && p1) {
          const xs = [b[0], p0.x, p1.x];
          const zs = [b[2], p0.z, p1.z];
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const minZ = Math.min(...zs);
          const maxZ = Math.max(...zs);
          fx = (minX + maxX) / 2 * 0.6 + fx * 0.4;
          fz = (minZ + maxZ) / 2 * 0.6 + fz * 0.4;
          spread = Math.max(maxX - minX, (maxZ - minZ) * 1.6);
        }
      }
      if (view.restart === "penalty" && view.mode === "setpiece") {
        fx = b[0] + Math.sign(b[0]) * 4;
        fz = 0;
      }
      const sk = 1 - Math.exp(-dt * 2.6);
      this.focus.x += (fx - this.focus.x) * sk;
      this.focus.y += (fz - this.focus.y) * sk;
      const cfg = this.settings.camera === "wide" ? { d: 40, h: 34, f: 38 } : this.settings.camera === "pro" ? { d: 20, h: 12.5, f: 36 } : { d: 29, h: 21, f: 33 };
      const camX = clamp(this.focus.x * 0.9, -HALF_L + 4, HALF_L - 4);
      pos.set(camX, cfg.h, HALF_W + cfg.d + this.focus.y * 0.22);
      look.set(this.focus.x, 0, this.focus.y * 0.85 - 1.5);
      const far = clamp(-this.focus.y / HALF_W, -1, 1);
      fov = cfg.f - far * 3.5 + clamp((spread - 26) * 0.42, 0, 20);
      if (view.restart === "penalty" && view.mode === "setpiece") fov = cfg.f - 8;
      k = 50;
    }
    const kk = 1 - Math.exp(-dt * k);
    this.camPos.lerp(pos, kk);
    this.camLook.lerp(look, kk);
    this.fov += (fov - this.fov) * (1 - Math.exp(-dt * Math.min(k, 4)));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  render(): void {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  // ------------------------------------------------------------------ helpers for input / HUD

  groundBasis(): GroundBasis {
    return { rx: 1, rz: 0, ux: 0, uz: -1 };
  }

  pickGround(clientX: number, clientY: number, rect: DOMRect): [number, number] | null {
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.plane, hit)) return null;
    return [hit.x, hit.z];
  }

  project(x: number, y: number, z: number): { x: number; y: number; ok: boolean } {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.size.x, y: (-v.y * 0.5 + 0.5) * this.size.y, ok: v.z < 1 };
  }
}
