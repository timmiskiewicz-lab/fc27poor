import * as THREE from "three";
import type { Kit } from "../../../shared/clubs";
import type { Look } from "../../../shared/rosters";

export const SKIN_TONES = ["#f0d3bf", "#ddb293", "#c18c69", "#9d6948", "#744a31", "#4d2f1e"];

const PATTERN: Record<Kit["pattern"], number> = { solid: 0, stripes: 1, band: 2, hoops: 3 };

export type SkinFamily = "light" | "dark" | "asian";

export interface ModelMeta {
  height: number;
  hip: number;
  sole?: number;
  mouth: number[];
  nipple: number[];
  shirtTop: number;
  shirtBottom: number;
  collarBack: number;
  collarFront: number;
  chestFrontZ: number;
  backZ: number;
  shoulderX: number;
  shortsTop: number;
  morphs: string[];
  hairs: string[];
  skinAvg: Record<SkinFamily, number[]>;
  hairTex: Record<string, string>;
}

export interface SkinAssets {
  skin: Record<SkinFamily, THREE.Texture>;
  skinAvg: Record<SkinFamily, THREE.Color>;
  boot: THREE.Texture;
}

/** Layout of prints on the kit, in character space (metres). Shared by every kit material. */
const LAYOUT = {
  uBackRect: { value: new THREE.Vector4(0.17, 1.52, 0.34, 0.42) },
  uSponsorRect: { value: new THREE.Vector4(-0.155, 1.355, 0.31, 0.13) },
  uCrestRect: { value: new THREE.Vector4(0.062, 1.445, 0.062, 0.062) },
  uShortsRect: { value: new THREE.Vector4(0.05, 0.9, 0.085, 0.085) },
  uMidZ: { value: 0.03 },
  uCollarY: { value: 1.5 },
};

export function setKitLayout(m: ModelMeta): void {
  const nip = m.nipple;
  const top = m.collarBack - 0.03;
  LAYOUT.uBackRect.value.set(0.17, top, 0.34, 0.42);
  LAYOUT.uSponsorRect.value.set(-0.155, nip[1] + 0.035, 0.31, 0.13);
  LAYOUT.uCrestRect.value.set(0.058, nip[1] + 0.125, 0.062, 0.062);
  LAYOUT.uShortsRect.value.set(0.045, m.shortsTop - 0.11, 0.085, 0.085);
  LAYOUT.uMidZ.value = (m.chestFrontZ + m.backZ) / 2;
  LAYOUT.uCollarY.value = m.collarFront;
}

export interface KitUniforms {
  uShirt: { value: THREE.Color };
  uAlt: { value: THREE.Color };
  uEdge: { value: THREE.Color };
  uSleeves: { value: THREE.Color };
  uShorts: { value: THREE.Color };
  uSocks: { value: THREE.Color };
  uTrim: { value: THREE.Color };
  uSkin: { value: THREE.Color };
  uSkinAvg: { value: THREE.Color };
  uHair: { value: THREE.Color };
  uBoots: { value: THREE.Color };
  uGloves: { value: THREE.Color };
  uPattern: { value: number };
  uStripes: { value: number };
  uScalp: { value: number };
  uStubble: { value: number };
  uGk: { value: number };
  uDirt: { value: number };
  uSeed: { value: number };
  uPrint: { value: THREE.Texture | null };
  uCrest: { value: THREE.Texture | null };
  uSkinTex: { value: THREE.Texture | null };
  uBootTex: { value: THREE.Texture | null };
  uHasPrint: { value: number };
}

const VERT_PRE = /* glsl */ `
#ifndef USE_UV1
attribute vec2 uv1;
#endif
#if !defined( USE_COLOR ) && !defined( USE_COLOR_ALPHA )
attribute vec4 color;
#endif
varying vec3 vRest;
varying vec3 vRestN;
varying vec2 vUv0;
varying vec2 vReg;
varying vec4 vMask;
`;

const VERT_MAIN = /* glsl */ `
#include <begin_vertex>
vRest = position;
vRestN = normal;
vUv0 = uv;
vReg = uv1;
vMask = vec4(color);
`;

const FRAG_PRE = /* glsl */ `
varying vec3 vRest;
varying vec3 vRestN;
varying vec2 vUv0;
varying vec2 vReg;
varying vec4 vMask;
uniform vec3 uShirt, uAlt, uEdge, uSleeves, uShorts, uSocks, uTrim, uSkin, uSkinAvg, uHair, uBoots, uGloves;
uniform float uPattern, uStripes, uScalp, uStubble, uGk, uDirt, uSeed, uHasPrint, uMidZ, uCollarY;
uniform vec4 uBackRect, uSponsorRect, uCrestRect, uShortsRect;
uniform sampler2D uPrint, uCrest, uSkinTex, uBootTex;
float kRough;
float kSheen;

float h31(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float region() { return floor(vReg.x); }
bool isReg(float r) { return abs(region() - r) < 0.5; }

vec3 dirtify(vec3 c, float amount) {
  float n = vnoise(vRest * 9.0 + uSeed) * 0.6 + vnoise(vRest * 23.0 + uSeed * 2.0) * 0.4;
  float d = smoothstep(0.55, 0.85, n) * amount;
  vec3 grass = vec3(0.16, 0.22, 0.08);
  vec3 mud = vec3(0.23, 0.18, 0.12);
  return mix(c, mix(grass, mud, step(0.7, n)), d * 0.65);
}

vec4 rectSample(sampler2D tex, vec4 r, vec2 p, bool mirror, float v0, float vh) {
  vec2 uv = vec2(mirror ? (r.x - p.x) / r.z : (p.x - r.x) / r.z, (r.y - p.y) / r.w);
  if (uv.x <= 0.0 || uv.x >= 1.0 || uv.y <= 0.0 || uv.y >= 1.0) return vec4(0.0);
  return texture2D(tex, vec2(uv.x, 1.0 - (v0 + uv.y * vh)));
}

vec3 shirtColor(bool sleeve) {
  vec3 p = vRest;
  float ax = abs(p.x);
  float hem = vReg.y;
  kRough = 0.66;
  kSheen = 1.0;
  if (sleeve) {
    if (hem < 0.022) return uTrim;
    return uSleeves;
  }
  if (hem < 0.018 && p.y > uCollarY - 0.05) return uTrim;
  vec3 c = uShirt;
  if (uPattern > 0.5 && uPattern < 1.5) {
    float w = 0.42 / max(uStripes, 1.0);
    float idx = floor(p.x / w + 0.5);
    c = mod(idx, 2.0) < 0.5 ? uShirt : uAlt;
  } else if (uPattern > 1.5 && uPattern < 2.5) {
    if (ax < 0.07) c = uAlt;
    else if (ax < 0.082) c = uEdge;
  } else if (uPattern > 2.5) {
    float idx = floor(p.y / 0.085);
    c = mod(idx, 2.0) < 0.5 ? uShirt : uAlt;
  }
  if (hem < 0.008) c *= 0.82;
  bool front = vRestN.z > 0.2 && p.z > uMidZ;
  bool back = vRestN.z < -0.2 && p.z < uMidZ;
  if (uHasPrint > 0.5 && back) {
    vec4 t = rectSample(uPrint, uBackRect, p.xy, true, 0.0, 0.5);
    c = mix(c, t.rgb, t.a);
  }
  if (front) {
    vec4 t = rectSample(uCrest, uCrestRect, p.xy, false, 0.0, 1.0);
    c = mix(c, t.rgb, t.a);
    vec2 m = vec2(-p.x - uCrestRect.x - uCrestRect.z * 0.5, p.y - uCrestRect.y + uCrestRect.w * 0.5);
    float chev = abs(m.y - abs(m.x) * 0.55 + 0.004);
    if (abs(m.x) < 0.022 && chev < 0.0045) c = mix(c, uTrim, 0.9);
    if (uHasPrint > 0.5) {
      vec4 s = rectSample(uPrint, uSponsorRect, p.xy, false, 0.5, 0.25);
      c = mix(c, s.rgb, s.a);
    }
  }
  float weave = sin(p.x * 900.0) * sin(p.y * 900.0);
  c *= 0.97 + 0.03 * weave;
  return c;
}

vec3 skinColor() {
  vec3 t = texture2D(uSkinTex, vUv0).rgb;
  vec3 ratio = clamp(t / max(uSkinAvg, vec3(0.002)), vec3(0.3), vec3(1.9));
  vec3 c = uSkin * ratio;
  kRough = 0.52;
  float beard = vMask.r;
  float scalp = vMask.g;
  float lips = vMask.b;
  if (beard > 0.001) {
    float g1 = vnoise(vRest * 900.0 + uSeed);
    float g2 = vnoise(vRest * 260.0 + uSeed * 0.3);
    float dens = uStubble < 0.3 ? 0.28 : (uStubble < 0.9 ? 0.62 : 0.92);
    float edge = smoothstep(0.0, 0.55, beard + (g2 - 0.5) * 0.35);
    float amt = edge * dens * (0.55 + 0.45 * g1) * uStubble;
    c = mix(c, uHair * 0.55, clamp(amt, 0.0, 0.95));
    kRough = mix(kRough, 0.8, amt);
  }
  if (scalp > 0.001 && uScalp > 0.5) {
    float g = vnoise(vRest * 700.0 + uSeed) * 0.5 + vnoise(vRest * 2100.0) * 0.5;
    float line = smoothstep(0.15, 0.7, scalp + (vnoise(vRest * 160.0 + uSeed) - 0.5) * 0.4);
    if (uScalp < 1.5) {
      c = mix(c, uHair * (0.62 + g * 0.45), line * 0.88);
      kRough = mix(kRough, 0.85, line);
    } else if (uScalp < 2.5) {
      kRough = mix(kRough, 0.36, line);
      c *= 1.0 + line * 0.04;
    } else {
      c = mix(c, uHair * (0.7 + g * 0.3), line * 0.92);
      kRough = mix(kRough, 0.8, line);
    }
  }
  kRough = mix(kRough, 0.38, lips);
  return c;
}

vec3 kitColor() {
  kRough = 0.6;
  kSheen = 0.0;
  if (isReg(1.0)) return dirtify(shirtColor(false), uDirt * 0.5);
  if (isReg(13.0)) return dirtify(shirtColor(true), uDirt * 0.5);
  if (isReg(2.0)) {
    kRough = 0.6;
    kSheen = 1.0;
    vec3 c = uShorts;
    if (vRestN.x * sign(vRest.x) > 0.5 && abs(vRest.x) > 0.11 && abs(vRestN.z) < 0.17 && abs(vRestN.y) < 0.5) c = uTrim;
    if (vReg.y < 0.012) c = mix(c, uTrim, 0.5);
    if (uHasPrint > 0.5 && vRestN.z > 0.3) {
      vec4 t = rectSample(uPrint, uShortsRect, vRest.xy, false, 0.14, 0.36);
      c = mix(c, t.rgb, t.a);
    }
    return dirtify(c, uDirt);
  }
  if (isReg(3.0)) {
    kRough = 0.78;
    vec3 c = uSocks;
    if (vReg.y > 0.014 && vReg.y < 0.032) c = uTrim;
    c *= 0.95 + 0.05 * sin(vRest.y * 700.0);
    return dirtify(c, uDirt);
  }
  if (isReg(4.0)) {
    vec3 t = texture2D(uBootTex, vUv0).rgb;
    float l = dot(t, vec3(0.2126, 0.7152, 0.0722));
    kRough = 0.34;
    vec3 c = uBoots * clamp(0.45 + l * 2.4, 0.4, 1.5);
    if (vRest.y < 0.022) {
      c = mix(vec3(0.04), uBoots * 0.6, 0.35);
      kRough = 0.6;
    }
    float swoosh = abs(vRest.y - 0.05 - vRest.z * 0.1);
    if (swoosh < 0.006 && abs(vRestN.x) > 0.55 && vRest.y > 0.025) c = mix(c, vec3(1.0) - uBoots * 0.85, 0.85);
    return dirtify(c, uDirt * 0.7);
  }
  if (isReg(6.0) && uGk > 0.5) {
    kRough = 0.55;
    return uGloves * (0.92 + 0.08 * vnoise(vRest * 300.0));
  }
  return skinColor();
}
`;

export function makeKitMaterial(assets: SkinAssets): { material: THREE.MeshStandardMaterial; uniforms: KitUniforms } {
  const uniforms: KitUniforms = {
    uShirt: { value: new THREE.Color() },
    uAlt: { value: new THREE.Color() },
    uEdge: { value: new THREE.Color() },
    uSleeves: { value: new THREE.Color() },
    uShorts: { value: new THREE.Color() },
    uSocks: { value: new THREE.Color() },
    uTrim: { value: new THREE.Color() },
    uSkin: { value: new THREE.Color() },
    uSkinAvg: { value: new THREE.Color(0.5, 0.35, 0.3) },
    uHair: { value: new THREE.Color() },
    uBoots: { value: new THREE.Color() },
    uGloves: { value: new THREE.Color("#e8e8e8") },
    uPattern: { value: 0 },
    uStripes: { value: 5 },
    uScalp: { value: 0 },
    uStubble: { value: 0 },
    uGk: { value: 0 },
    uDirt: { value: 0 },
    uSeed: { value: Math.random() * 50 },
    uPrint: { value: null },
    uCrest: { value: null },
    uSkinTex: { value: assets.skin.light },
    uBootTex: { value: assets.boot },
    uHasPrint: { value: 0 },
  };
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, LAYOUT);
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>\n${VERT_PRE}`).replace("#include <begin_vertex>", VERT_MAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAG_PRE}`)
      .replace("vec4 diffuseColor = vec4( diffuse, opacity );", "vec4 diffuseColor = vec4( kitColor(), opacity );")
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = kRough;")
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\nfloat fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);\ntotalEmissiveRadiance += diffuseColor.rgb * fres * kSheen * 0.12;",
      );
  };
  material.customProgramCacheKey = () => "kit-mh-v1";
  return { material, uniforms };
}

export interface KitSetup {
  kit: Kit;
  look: Look;
  gk: boolean;
  print: THREE.Texture | null;
  crest: THREE.Texture | null;
  gloves?: string;
}

export function skinFamily(look: Look, asian: number): SkinFamily {
  if (asian > 0.5) return "asian";
  return look.skin >= 3 ? "dark" : "light";
}

export function applyKit(u: KitUniforms, s: KitSetup, assets: SkinAssets, family: SkinFamily): void {
  const k = s.kit;
  u.uShirt.value.set(k.shirt);
  u.uAlt.value.set(k.alt);
  u.uEdge.value.set(k.edge);
  u.uSleeves.value.set(k.sleeves);
  u.uShorts.value.set(k.shorts);
  u.uSocks.value.set(k.socks);
  u.uTrim.value.set(k.trim);
  u.uSkin.value.set(SKIN_TONES[Math.max(0, Math.min(5, s.look.skin))]);
  u.uSkinTex.value = assets.skin[family];
  u.uSkinAvg.value.copy(assets.skinAvg[family]);
  u.uHair.value.set(s.look.hairColor);
  u.uBoots.value.set(s.look.boots);
  u.uGloves.value.set(s.gloves ?? (s.gk ? "#f4f4f0" : "#ffffff"));
  u.uPattern.value = PATTERN[k.pattern];
  u.uStripes.value = k.stripes;
  const h = s.look.hair;
  u.uScalp.value = h === "buzz" ? 1 : h === "bald" ? 2 : 3;
  u.uStubble.value = s.look.beard === 1 ? 0.75 : s.look.beard === 2 ? 1 : 0.2;
  u.uGk.value = s.gk ? 1 : 0;
  u.uPrint.value = s.print;
  u.uCrest.value = s.crest;
  u.uHasPrint.value = s.print ? 1 : 0;
}

/** Alpha-tested strand cards (hair, brows, lashes) tinted by a single colour. */
export function makeStrandMaterial(map: THREE.Texture, avgLum: number, color: string, opts: { rough?: number; shadow?: boolean } = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color,
    map,
    roughness: opts.rough ?? 0.55,
    metalness: 0,
    side: THREE.DoubleSide,
    alphaTest: 0.4,
    alphaToCoverage: true,
  });
  const avg = { value: Math.max(0.02, avgLum) };
  m.userData.avgLum = avg;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uAvgLum = avg;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uAvgLum;")
      .replace(
        "#include <map_fragment>",
        `#ifdef USE_MAP
  vec4 texel = texture2D( map, vMapUv );
  float lum = dot( texel.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  diffuseColor.rgb *= clamp( lum / uAvgLum, 0.2, 2.2 );
  diffuseColor.a *= texel.a;
#endif`,
      );
  };
  m.customProgramCacheKey = () => "strand-v1";
  return m;
}
