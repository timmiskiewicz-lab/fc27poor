import type { ClubId } from "./clubs";

export type HairStyle = "buzz" | "bald" | "short" | "crop" | "slick" | "curly" | "afro" | "bun" | "long" | "longcurly";

export interface Look {
  skin: number;
  hair: HairStyle;
  hairColor: string;
  beard: 0 | 1 | 2;
  height: number;
  boots: string;
  /** Face shape code: comma-separated morph weights like "afr8,nw5", "E" + eye colour (bl, gr, gy, br, lb), "B" for bushy brows. */
  face?: string;
  seed?: number;
}

export interface Stats {
  pac: number;
  sho: number;
  pas: number;
  dri: number;
  def: number;
  phy: number;
  gk: number;
}

export interface PlayerInfo {
  num: number;
  name: string;
  shirtName: string;
  pos: string;
  stats: Stats;
  ovr: number;
  look: Look;
}

export const SLOT_POS = ["BR", "PO", "ŚO", "ŚO", "LO", "ŚP", "ŚPD", "ŚP", "PS", "N", "LS"];

const HAIR: Record<string, string> = {
  k: "#141010",
  d: "#2b1d14",
  b: "#4a3020",
  l: "#7a5634",
  y: "#c9a764",
  p: "#ddd2b8",
  r: "#8a4422",
};

const BOOTS: Record<string, string> = {
  w: "#f2f2f2",
  k: "#161616",
  y: "#d8f03a",
  o: "#ff6a1a",
  p: "#ff4fa3",
  b: "#2f7bff",
  g: "#d4a73a",
  r: "#e3242b",
};

function overall(pos: string, s: Stats): number {
  const w: Record<string, number[]> = {
    BR: [0, 0, 0, 0, 0, 0, 1],
    PO: [0.18, 0.02, 0.16, 0.12, 0.36, 0.16, 0],
    LO: [0.18, 0.02, 0.16, 0.12, 0.36, 0.16, 0],
    ŚO: [0.1, 0, 0.1, 0.06, 0.5, 0.24, 0],
    ŚPD: [0.08, 0.06, 0.28, 0.14, 0.3, 0.14, 0],
    ŚP: [0.1, 0.14, 0.34, 0.26, 0.08, 0.08, 0],
    PS: [0.26, 0.2, 0.2, 0.3, 0.0, 0.04, 0],
    LS: [0.26, 0.2, 0.2, 0.3, 0.0, 0.04, 0],
    N: [0.22, 0.4, 0.1, 0.2, 0.0, 0.08, 0],
  };
  const k = w[pos] ?? w.ŚP;
  const v = [s.pac, s.sho, s.pas, s.dri, s.def, s.phy, s.gk];
  let sum = 0;
  for (let i = 0; i < 7; i += 1) sum += k[i] * v[i];
  return Math.round(Math.min(97, sum + (pos === "BR" ? 0 : 3)));
}

function hashName(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function p(num: number, name: string, shirtName: string, slot: number, stats: number[], look: string): PlayerInfo {
  const [skin, hair, hairColor, beard, height, boots, face] = look.split(":");
  const pos = SLOT_POS[slot];
  const s: Stats =
    stats.length === 1
      ? { pac: 52, sho: 30, pas: 62, dri: 50, def: 30, phy: 70, gk: stats[0] }
      : { pac: stats[0], sho: stats[1], pas: stats[2], dri: stats[3], def: stats[4], phy: stats[5], gk: 20 };
  return {
    num,
    name,
    shirtName,
    pos,
    stats: s,
    ovr: overall(pos, s),
    look: {
      skin: Number(skin),
      hair: hair as HairStyle,
      hairColor: HAIR[hairColor] ?? HAIR.d,
      beard: Number(beard) as 0 | 1 | 2,
      height: Number(height) / 100,
      boots: BOOTS[boots] ?? BOOTS.w,
      face: face ?? "",
      seed: hashName(name),
    },
  };
}

export const ROSTERS: Record<ClubId, PlayerInfo[]> = {
  barca: [
    p(1, "Joan García", "JOAN GARCIA", 0, [86], "1:short:d:1:194:k:fl3,jw3,nl3"),
    p(23, "Jules Koundé", "KOUNDÉ", 1, [80, 50, 72, 77, 84, 76], "4:curly:k:0:180:w:afr7,nw5,lf4,fr2"),
    p(5, "Pau Cubarsí", "CUBARSÍ", 2, [72, 40, 77, 72, 86, 72], "1:short:b:0:184:w:nl2,jn2,lean3"),
    p(24, "Eric García", "ERIC", 3, [64, 45, 76, 72, 81, 72], "1:slick:d:1:182:k:nl4,nh2,jn2"),
    p(3, "Alejandro Balde", "BALDE", 4, [92, 55, 74, 82, 74, 68], "5:buzz:k:0:175:y:afr10,nw6,lf6,fr2"),
    p(8, "Pedri", "PEDRI", 5, [76, 74, 90, 89, 66, 66], "1:crop:d:0:174:w:nl5,nn3,ch3,lean5,eo3"),
    p(16, "Rodri", "RODRI", 6, [62, 78, 88, 82, 87, 84], "1:short:d:1:191:k:fl4,jw3,nl4,bh3"),
    p(21, "Frenkie de Jong", "F. DE JONG", 7, [78, 68, 87, 86, 74, 76], "1:slick:b:1:181:w:fl3,nl3,cp3,es2,Ebl"),
    p(10, "Lamine Yamal", "LAMINE YAMAL", 8, [88, 84, 87, 93, 40, 66], "3:curly:k:0:180:p:afr5,lf4,ns2,fr2"),
    p(9, "Gabriel Jesus", "G. JESUS", 9, [82, 80, 74, 84, 45, 72], "3:buzz:k:1:175:o:afr5,nw4,lf3,fr3"),
    p(11, "Raphinha", "RAPHINHA", 10, [88, 85, 82, 87, 50, 70], "2:short:k:2:176:y:afr2,nl3,jw3,cb3,mus3"),
  ],
  real: [
    p(1, "Thibaut Courtois", "COURTOIS", 0, [89], "0:short:b:1:200:k:fl6,nl4,jn2,es2"),
    p(12, "Trent Alexander-Arnold", "TRENT", 1, [75, 70, 91, 80, 76, 70], "2:crop:k:1:180:w:afr3,lf3,nl2,fl2"),
    p(3, "Éder Militão", "MILITÃO", 2, [82, 52, 70, 68, 85, 84], "3:buzz:k:1:186:k:afr5,jw5,nw3,mus4"),
    p(4, "Dean Huijsen", "HUIJSEN", 3, [72, 50, 80, 76, 83, 78], "1:curly:b:0:197:w:fl4,ns2,es2,Ebl"),
    p(18, "Álvaro Carreras", "CARRERAS", 4, [85, 55, 76, 80, 79, 74], "1:short:d:1:186:k:nl2,cp2"),
    p(8, "Federico Valverde", "VALVERDE", 5, [88, 82, 85, 83, 80, 86], "1:short:d:2:182:w:jw4,cb4,bh3,nl3"),
    p(14, "Aurélien Tchouaméni", "TCHOUAMÉNI", 6, [72, 70, 80, 77, 85, 86], "5:buzz:k:1:188:k:afr9,fl4,lf4,nw4"),
    p(5, "Jude Bellingham", "BELLINGHAM", 7, [80, 84, 85, 88, 78, 84], "3:crop:k:0:186:w:afr5,jw4,cp3,lf3,mus3"),
    p(11, "Rodrygo", "RODRYGO", 8, [88, 82, 80, 87, 35, 64], "3:curly:k:0:174:o:afr5,lf3,ns2,lean3"),
    p(10, "Kylian Mbappé", "MBAPPÉ", 9, [97, 92, 82, 92, 36, 78], "4:buzz:k:0:178:g:afr8,nw5,lf4,fr3,cb4,eo2"),
    p(7, "Vinícius Júnior", "VINI JR.", 10, [95, 85, 81, 91, 30, 68], "4:curly:k:0:176:y:afr8,nw4,lf5,fl3,eb2"),
  ],
  atleti: [
    p(13, "Jan Oblak", "OBLAK", 0, [87], "0:short:b:1:188:k:fl4,jw4,es3,bh2,Ebl"),
    p(14, "Marcos Llorente", "M. LLORENTE", 1, [87, 74, 80, 80, 74, 84], "1:slick:d:1:184:w:jw3,fl3,mus4,nl3"),
    p(21, "Cristian Romero", "C. ROMERO", 2, [74, 55, 72, 70, 86, 85], "2:short:k:2:185:k:jw5,bh4,nl4,cb3,mus3,B"),
    p(17, "Dávid Hancko", "HANCKO", 3, [76, 55, 75, 72, 83, 80], "0:short:l:1:188:w:fl3,nl3,Egy"),
    p(22, "Álex Grimaldo", "GRIMALDO", 4, [82, 76, 85, 84, 72, 64], "1:short:d:1:171:o:fr3,ns2,mw2"),
    p(8, "Pablo Barrios", "BARRIOS", 5, [76, 70, 84, 84, 72, 72], "1:curly:d:0:181:w:nl3,jn2"),
    p(23, "Morten Hjulmand", "HJULMAND", 6, [66, 68, 80, 76, 82, 82], "0:short:b:2:185:k:jw4,fl3,bh3,Ebl"),
    p(10, "Álex Baena", "BAENA", 7, [76, 80, 86, 85, 55, 66], "1:short:d:1:174:w:fr2,nl3"),
    p(20, "Giuliano Simeone", "GIULIANO", 8, [86, 72, 74, 78, 66, 78], "1:short:d:1:179:r:jn3,nl4,lean3"),
    p(19, "Julián Alvarez", "J. ALVAREZ", 9, [84, 86, 80, 86, 50, 74], "1:short:d:0:170:w:fr4,ns3,es2"),
    p(11, "Ademola Lookman", "LOOKMAN", 10, [88, 80, 76, 86, 38, 64], "5:curly:k:0:174:y:afr10,nw5,lf5,fr3"),
  ],
  city: [
    p(1, "Gianluigi Donnarumma", "DONNARUMMA", 0, [89], "1:short:d:2:196:k:fl3,fr3,jw4,hvy3,nl3,B"),
    p(27, "Matheus Nunes", "MATHEUS N.", 1, [82, 66, 80, 82, 75, 78], "3:buzz:k:1:183:w:afr5,fl3,lf3"),
    p(3, "Rúben Dias", "RÚBEN", 2, [64, 40, 72, 66, 89, 86], "1:short:d:2:187:k:jw5,bh5,nl3,fl2,B"),
    p(6, "Marc Guéhi", "GUÉHI", 3, [74, 45, 72, 70, 85, 80], "5:buzz:k:0:182:w:afr10,fr3,nw5,lf4,jw3"),
    p(24, "Joško Gvardiol", "GVARDIOL", 4, [80, 66, 78, 76, 85, 84], "0:short:l:1:185:k:fl3,jw4,nl3,bh2,Egr"),
    p(17, "Enzo Fernández", "ENZO", 5, [72, 78, 87, 84, 76, 78], "1:curly:d:1:178:w:fr2,nl3,cp2"),
    p(5, "Elliot Anderson", "E. ANDERSON", 6, [74, 70, 82, 80, 78, 78], "1:short:b:0:179:k:fr2,ns2"),
    p(47, "Phil Foden", "FODEN", 7, [82, 85, 86, 90, 50, 64], "0:buzz:b:1:171:w:fr3,ns3,jn2,eo3,Ebl"),
    p(42, "Antoine Semenyo", "SEMENYO", 8, [90, 80, 74, 82, 45, 80], "5:short:k:1:185:o:afr10,jw4,nw4,lf4"),
    p(9, "Erling Haaland", "HAALAND", 9, [89, 93, 70, 80, 45, 88], "0:bun:y:0:195:y:fl6,jw5,cp4,nl3,mus3,es2,Ebl"),
    p(11, "Jérémy Doku", "DOKU", 10, [93, 72, 76, 90, 30, 66], "5:curly:k:0:171:w:afr10,fr4,nw5,lf5,ns2"),
  ],
  liverpool: [
    p(1, "Alisson", "ALISSON", 0, [88], "1:short:d:2:193:k:fl4,jw4,nl3,bh3,B"),
    p(30, "Jeremie Frimpong", "FRIMPONG", 1, [94, 70, 76, 84, 72, 66], "4:short:k:0:171:o:afr8,fr3,lf4,ns2,eo2"),
    p(33, "Ronald Araújo", "ARAÚJO", 2, [80, 50, 66, 64, 85, 86], "3:short:k:1:188:k:afr5,jw5,mus4,fl3"),
    p(4, "Virgil van Dijk", "VAN DIJK", 3, [76, 60, 76, 72, 89, 86], "3:crop:k:2:195:w:afr5,jw5,fl4,mus4,cp3"),
    p(6, "Milos Kerkez", "KERKEZ", 4, [86, 60, 76, 78, 77, 74], "1:short:b:0:180:w:fl2,nl3"),
    p(8, "Dominik Szoboszlai", "SZOBOSZLAI", 5, [80, 84, 86, 82, 70, 82], "0:slick:y:1:186:k:fl4,jw4,nl4,cb3,Ebl"),
    p(38, "Ryan Gravenberch", "GRAVENBERCH", 6, [76, 66, 82, 84, 80, 80], "4:short:k:0:190:w:afr8,fl4,lf4,jn2"),
    p(10, "Alexis Mac Allister", "MAC ALLISTER", 7, [70, 80, 87, 84, 78, 74], "1:curly:r:1:176:k:nl3,cp2,fr2,Elb"),
    p(7, "Florian Wirtz", "WIRTZ", 8, [80, 84, 88, 90, 50, 64], "0:crop:b:0:177:w:fr3,ns2,es1,Ebl"),
    p(9, "Alexander Isak", "ISAK", 9, [88, 88, 76, 87, 40, 74], "4:short:k:0:192:k:afr7,fl5,jn3,nl3,lean3"),
    p(29, "Bradley Barcola", "BARCOLA", 10, [91, 78, 76, 85, 35, 64], "4:curly:k:0:182:y:afr8,lf4,fl3,jn2"),
  ],
  bayern: [
    p(1, "Manuel Neuer", "NEUER", 0, [86], "0:short:y:0:193:k:fl3,jw4,cp3,bh3,old6,Ebl"),
    p(27, "Konrad Laimer", "LAIMER", 1, [82, 66, 78, 78, 78, 82], "0:short:b:1:180:w:nl3,jw3,mus3"),
    p(2, "Dayot Upamecano", "UPAMECANO", 2, [80, 50, 70, 68, 85, 86], "5:buzz:k:1:186:k:afr10,fr4,nw5,lf5,jw4,mus3"),
    p(4, "Jonathan Tah", "TAH", 3, [72, 50, 72, 66, 86, 86], "4:buzz:k:1:195:w:afr8,jw5,fl4,mus4,nk4"),
    p(19, "Alphonso Davies", "DAVIES", 4, [94, 62, 76, 82, 75, 74], "5:curly:k:0:183:y:afr10,fr3,lf5,nw5"),
    p(6, "Joshua Kimmich", "KIMMICH", 5, [70, 76, 91, 84, 80, 74], "0:slick:l:0:177:k:fl2,nl3,jn3,es2,lean3,Ebl"),
    p(45, "Aleksandar Pavlović", "PAVLOVIĆ", 6, [68, 70, 84, 80, 80, 78], "0:short:d:0:188:w:fl3,nl3"),
    p(10, "Jamal Musiala", "MUSIALA", 7, [84, 82, 84, 92, 50, 62], "3:curly:k:0:184:w:afr5,fr2,lf3,ns2"),
    p(17, "Michael Olise", "OLISE", 8, [86, 84, 86, 89, 40, 66], "4:curly:k:0:184:o:afr8,fl3,lf4,jn2"),
    p(9, "Harry Kane", "KANE", 9, [70, 93, 86, 82, 48, 82], "0:short:b:1:188:w:fl3,jw4,nl3,es2,eo2,Egy"),
    p(14, "Luis Díaz", "LUIS DÍAZ", 10, [91, 82, 78, 88, 42, 72], "3:curly:k:0:180:y:afr4,fl3,nl4,cb3,lean3"),
  ],
  juve: [
    p(1, "Guglielmo Vicario", "VICARIO", 0, [84], "1:short:d:1:194:k:fl3,nl4"),
    p(15, "Pierre Kalulu", "KALULU", 1, [84, 45, 70, 72, 82, 78], "4:buzz:k:0:182:w:afr8,fl3,lf3"),
    p(4, "Federico Gatti", "GATTI", 2, [66, 50, 64, 62, 82, 86], "1:short:d:2:190:k:jw4,nl3,bh3,mus3,B"),
    p(3, "Bremer", "BREMER", 3, [78, 50, 66, 64, 87, 86], "4:buzz:k:1:188:w:afr7,jw5,mus4,fr3"),
    p(27, "Andrea Cambiaso", "CAMBIASO", 4, [80, 66, 80, 80, 76, 72], "1:short:d:1:183:o:fl3,nl3"),
    p(22, "Weston McKennie", "McKENNIE", 5, [76, 72, 76, 76, 74, 84], "4:short:k:1:183:w:afr7,fr3,lf3,mw3"),
    p(5, "Manuel Locatelli", "LOCATELLI", 6, [62, 72, 84, 78, 80, 78], "1:slick:d:2:185:k:jw3,fl3,nl3,B"),
    p(19, "Khéphren Thuram", "K. THURAM", 7, [80, 70, 78, 84, 70, 84], "4:buzz:k:0:192:w:afr8,fl4,lf4,jw3"),
    p(7, "Francisco Conceição", "CONCEIÇÃO", 8, [88, 74, 76, 87, 35, 58], "1:curly:d:0:170:y:fr2,ns3,lean4"),
    p(9, "Randal Kolo Muani", "KOLO MUANI", 9, [88, 80, 72, 80, 40, 80], "5:short:k:1:187:o:afr10,fl4,nw4,lf4"),
    p(10, "Kenan Yıldız", "YILDIZ", 10, [84, 82, 80, 88, 40, 68], "1:crop:d:0:183:w:fl2,nl3,jn2"),
  ],
  psg: [
    p(30, "Lucas Chevalier", "CHEVALIER", 0, [84], "1:short:d:1:188:k:fl3,nl2"),
    p(2, "Achraf Hakimi", "HAKIMI", 1, [92, 76, 82, 82, 76, 76], "3:curly:k:1:181:w:afr4,fl3,nl3,cb3,lean2"),
    p(5, "Marquinhos", "MARQUINHOS", 2, [72, 55, 76, 72, 86, 78], "2:short:k:2:183:k:afr2,jw3,nl3,fr2,B"),
    p(51, "Willian Pacho", "PACHO", 3, [80, 45, 70, 66, 85, 84], "5:buzz:k:1:187:w:afr10,jw5,mus4,nw4"),
    p(25, "Nuno Mendes", "NUNO MENDES", 4, [92, 66, 80, 84, 80, 78], "4:short:k:0:180:y:afr8,fl3,lf4"),
    p(87, "João Neves", "JOÃO NEVES", 5, [80, 74, 85, 86, 80, 70], "1:longcurly:d:0:174:w:fr2,ns3,es2,lean3"),
    p(17, "Vitinha", "VITINHA", 6, [72, 78, 90, 88, 74, 68], "1:short:d:1:172:k:fr3,ns3,es2"),
    p(8, "Fabián Ruiz", "FABIÁN", 7, [64, 78, 86, 82, 74, 76], "1:bun:d:2:189:w:fl4,nl4,jw3,B"),
    p(14, "Désiré Doué", "DOUÉ", 8, [88, 80, 80, 88, 45, 66], "4:curly:k:0:181:o:afr8,fl3,lf3,jn2"),
    p(10, "Ousmane Dembélé", "DEMBÉLÉ", 9, [91, 88, 84, 90, 38, 68], "5:curly:k:1:178:w:afr10,fr3,nw5,lf5,eo3"),
    p(7, "Khvicha Kvaratskhelia", "KVARATSKHELIA", 10, [86, 82, 82, 90, 40, 72], "0:longcurly:d:1:183:y:fl5,nl5,jn3,lean3,es2"),
  ],
};

export function teamRatings(id: ClubId): { att: number; mid: number; def: number; ovr: number } {
  const list = ROSTERS[id];
  const avg = (slots: number[]) => Math.round(slots.reduce((sum, i) => sum + list[i].ovr, 0) / slots.length);
  const att = avg([8, 9, 10]);
  const mid = avg([5, 6, 7]);
  const def = avg([0, 1, 2, 3, 4]);
  return { att, mid, def, ovr: Math.round((att + mid + def) / 3 + 1) };
}

export function shortName(info: PlayerInfo): string {
  const parts = info.name.split(" ");
  if (parts.length === 1) return info.name;
  if (info.name === "Lamine Yamal" || info.name === "Vinícius Júnior" || info.name === "Gabriel Jesus" || info.name === "Nuno Mendes" || info.name === "João Neves" || info.name === "Luis Díaz" || info.name === "Fabián Ruiz" || info.name === "Matheus Nunes" || info.name === "Joan García" || info.name === "Eric García" || info.name === "Rúben Dias")
    return info.name;
  if (info.name === "Frenkie de Jong") return "De Jong";
  if (info.name === "Virgil van Dijk") return "Van Dijk";
  if (info.name === "Alexis Mac Allister") return "Mac Allister";
  if (info.name === "Kenan Yıldız") return "Yıldız";
  return parts.slice(1).join(" ");
}
