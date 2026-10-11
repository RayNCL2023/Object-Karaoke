// Duet Anything - 12 hand-drawn placeholder characters (original vector art, no network) so the
// idle gallery and the karaoke crowd are never empty. Art is SVG inner markup in a 200x200 box;
// face + bbox are fractions 0-1 of that box, same shape as a real character from /api/characters.
const dk = "#1a1a1f";
export const PLACEHOLDERS = [
  {
    id: "ph_mug", name: "Brewster the Mug", object: "brew mug", colour: "#d9573b", personality: "never says no to a brew", catchphrase: "Kettle's on, our kid",
    bbox: { x: 0.22, y: 0.24, w: 0.7, h: 0.62 },
    face: { leftEye: { x: 0.38, y: 0.5 }, rightEye: { x: 0.58, y: 0.5 }, eyeSize: 0.14, mouth: { x: 0.48, y: 0.7, width: 0.2 } },
    art: `<path d="M140 78 q42 0 42 36 t-42 36" fill="none" stroke="#b8442c" stroke-width="16" stroke-linecap="round"/>
      <rect x="48" y="52" width="94" height="118" rx="16" fill="#d9573b"/>
      <ellipse cx="95" cy="55" rx="47" ry="10" fill="#6b3418"/><ellipse cx="95" cy="55" rx="40" ry="6" fill="#a8652e"/>
      <rect x="58" y="68" width="10" height="80" rx="5" fill="#fff" opacity=".25"/>`,
  },
  {
    id: "ph_cone", name: "Connie the Cone", object: "traffic cone", colour: "#ff7a1a", personality: "been on every roadworks in Ancoats", catchphrase: "Mind out, I'm working",
    bbox: { x: 0.16, y: 0.08, w: 0.68, h: 0.84 },
    face: { leftEye: { x: 0.43, y: 0.52 }, rightEye: { x: 0.57, y: 0.52 }, eyeSize: 0.11, mouth: { x: 0.5, y: 0.68, width: 0.14 } },
    art: `<path d="M100 18 L152 162 H48 Z" fill="#ff7a1a" stroke="#ff7a1a" stroke-width="8" stroke-linejoin="round"/>
      <path d="M84 62 H116 L124 86 H76 Z" fill="#fff"/><path d="M68 112 H132 L140 134 H60 Z" fill="#fff"/>
      <rect x="32" y="158" width="136" height="24" rx="6" fill="#e2620c"/>`,
  },
  {
    id: "ph_pint", name: "Pint Gallaghop", object: "pint glass", colour: "#e0a12b", personality: "full of himself, half full of ale", catchphrase: "Get it down yer",
    bbox: { x: 0.25, y: 0.09, w: 0.5, h: 0.8 },
    face: { leftEye: { x: 0.42, y: 0.47 }, rightEye: { x: 0.58, y: 0.47 }, eyeSize: 0.11, mouth: { x: 0.5, y: 0.66, width: 0.16 } },
    art: `<path d="M56 30 H144 L134 176 H66 Z" fill="#e0a12b" stroke="#c8861a" stroke-width="5" stroke-linejoin="round"/>
      <path d="M52 20 Q60 10 72 18 Q84 6 100 16 Q116 6 128 18 Q140 10 148 20 V46 H52 Z" fill="#fff8e6"/>
      <circle cx="80" cy="120" r="4" fill="#fff" opacity=".6"/><circle cx="118" cy="140" r="3" fill="#fff" opacity=".6"/><circle cx="104" cy="96" r="3" fill="#fff" opacity=".5"/>
      <rect x="68" y="56" width="8" height="100" rx="4" fill="#fff" opacity=".25"/>`,
  },
  {
    id: "ph_bee", name: "Bez the Bee", object: "worker bee", colour: "#ffcc1a", personality: "busiest bee in the Northern Quarter", catchphrase: "Buzzin', proper buzzin'",
    bbox: { x: 0.18, y: 0.14, w: 0.74, h: 0.68 },
    face: { leftEye: { x: 0.3, y: 0.5 }, rightEye: { x: 0.44, y: 0.5 }, eyeSize: 0.11, mouth: { x: 0.37, y: 0.66, width: 0.13 } },
    art: `<ellipse cx="78" cy="58" rx="22" ry="32" fill="#e6f6ff" stroke="#9cc9e6" stroke-width="4" transform="rotate(-20 78 58)"/>
      <ellipse cx="122" cy="58" rx="22" ry="32" fill="#e6f6ff" stroke="#9cc9e6" stroke-width="4" transform="rotate(20 122 58)"/>
      <path d="M160 108 L184 112 L160 118 Z" fill="${dk}"/>
      <ellipse cx="100" cy="112" rx="64" ry="48" fill="#ffcc1a"/>
      <path d="M96 66 Q104 112 96 158 L114 156 Q122 112 114 68 Z" fill="${dk}"/><path d="M130 74 Q138 112 130 150 L144 142 Q150 112 144 82 Z" fill="${dk}"/>`,
  },
  {
    id: "ph_cloud", name: "Drizzle Dave", object: "rain cloud", colour: "#8fa3c4", personality: "never leaves Manchester, never will", catchphrase: "Bit of rain never hurt",
    bbox: { x: 0.15, y: 0.2, w: 0.7, h: 0.66 },
    face: { leftEye: { x: 0.42, y: 0.5 }, rightEye: { x: 0.6, y: 0.5 }, eyeSize: 0.12, mouth: { x: 0.51, y: 0.64, width: 0.16 } },
    art: `<path d="M70 150 l-6 16 M100 152 l-6 18 M130 150 l-6 16" stroke="#4da3ff" stroke-width="8" stroke-linecap="round"/>
      <g fill="#c3cede"><circle cx="68" cy="102" r="36"/><circle cx="106" cy="84" r="46"/><circle cx="144" cy="106" r="32"/><rect x="40" y="100" width="128" height="40" rx="20"/></g>`,
  },
  {
    id: "ph_brolly", name: "Ella Brolly", object: "umbrella", colour: "#3b6fe0", personality: "inside out by Piccadilly every time", catchphrase: "I'm covering for you",
    bbox: { x: 0.13, y: 0.12, w: 0.74, h: 0.8 },
    face: { leftEye: { x: 0.42, y: 0.36 }, rightEye: { x: 0.58, y: 0.36 }, eyeSize: 0.1, mouth: { x: 0.5, y: 0.45, width: 0.13 } },
    art: `<path d="M100 98 V164 q0 18 -16 18 q-12 0 -12 -12" fill="none" stroke="#333" stroke-width="9" stroke-linecap="round"/>
      <path d="M28 100 Q100 0 172 100 Q154 88 136 100 Q118 88 100 100 Q82 88 64 100 Q46 88 28 100 Z" fill="#3b6fe0"/>
      <path d="M100 26 Q80 60 64 100 M100 26 Q120 60 136 100" stroke="#2a54b8" stroke-width="4" fill="none"/>
      <rect x="96" y="14" width="8" height="16" rx="4" fill="#333"/>`,
  },
  {
    id: "ph_pie", name: "Percy Pie", object: "meat pie", colour: "#c98a3e", personality: "Wigan-born, gravy-filled", catchphrase: "Crust me, our kid",
    bbox: { x: 0.17, y: 0.28, w: 0.66, h: 0.56 },
    face: { leftEye: { x: 0.42, y: 0.6 }, rightEye: { x: 0.58, y: 0.6 }, eyeSize: 0.1, mouth: { x: 0.5, y: 0.74, width: 0.15 } },
    art: `<path d="M78 70 q-8 -10 0 -18 M100 66 q-8 -10 0 -18 M122 70 q-8 -10 0 -18" stroke="#ddd" stroke-width="5" fill="none" stroke-linecap="round" opacity=".8"/>
      <path d="M38 108 H162 L148 164 H52 Z" fill="#b5762f"/>
      <ellipse cx="100" cy="106" rx="64" ry="28" fill="#e3a857"/>
      <g fill="#c98a3e"><circle cx="44" cy="104" r="7"/><circle cx="62" cy="88" r="7"/><circle cx="86" cy="80" r="7"/><circle cx="114" cy="80" r="7"/><circle cx="138" cy="88" r="7"/><circle cx="156" cy="104" r="7"/></g>`,
  },
  {
    id: "ph_tram", name: "Tilly the Tram", object: "tram", colour: "#f2c31b", personality: "always five minutes late, always smiling", catchphrase: "Mind the doors, love",
    bbox: { x: 0.11, y: 0.14, w: 0.78, h: 0.74 },
    face: { leftEye: { x: 0.4, y: 0.44 }, rightEye: { x: 0.6, y: 0.44 }, eyeSize: 0.12, mouth: { x: 0.5, y: 0.68, width: 0.18 } },
    art: `<path d="M82 56 L100 30 L118 56" fill="none" stroke="#333" stroke-width="5"/><rect x="70" y="28" width="60" height="5" rx="2" fill="#333"/>
      <rect x="24" y="54" width="152" height="100" rx="20" fill="#f2c31b"/>
      <rect x="36" y="68" width="128" height="40" rx="10" fill="#bfe6ff"/>
      <rect x="24" y="126" width="152" height="10" fill="#d9a90c"/>
      <circle cx="58" cy="160" r="13" fill="#333"/><circle cx="142" cy="160" r="13" fill="#333"/>`,
  },
  {
    id: "ph_vinyl", name: "Vinny Vinyl", object: "vinyl record", colour: "#e23b4e", personality: "only likes the B-sides", catchphrase: "Spin us round again",
    bbox: { x: 0.12, y: 0.12, w: 0.76, h: 0.76 },
    face: { leftEye: { x: 0.38, y: 0.36 }, rightEye: { x: 0.62, y: 0.36 }, eyeSize: 0.13, mouth: { x: 0.5, y: 0.7, width: 0.2 } },
    art: `<circle cx="100" cy="100" r="76" fill="#151515"/>
      <g fill="none" stroke="#333" stroke-width="2"><circle cx="100" cy="100" r="64"/><circle cx="100" cy="100" r="54"/><circle cx="100" cy="100" r="44"/><circle cx="100" cy="100" r="34"/></g>
      <path d="M52 60 A60 60 0 0 1 90 42" stroke="#555" stroke-width="5" fill="none" stroke-linecap="round"/>
      <circle cx="100" cy="100" r="22" fill="#e23b4e"/><circle cx="100" cy="100" r="4" fill="#151515"/>`,
  },
  {
    id: "ph_hat", name: "Bucket Barry", object: "bucket hat", colour: "#2f8f6a", personality: "madchester raver who never went home", catchphrase: "Have it, our kid",
    bbox: { x: 0.12, y: 0.16, w: 0.76, h: 0.6 },
    face: { leftEye: { x: 0.42, y: 0.43 }, rightEye: { x: 0.58, y: 0.43 }, eyeSize: 0.1, mouth: { x: 0.5, y: 0.54, width: 0.14 } },
    art: `<ellipse cx="100" cy="128" rx="76" ry="22" fill="#257556"/>
      <path d="M58 124 L64 54 Q100 28 136 54 L142 124 Z" fill="#2f8f6a"/>
      <path d="M60 106 H140 L141 120 H59 Z" fill="#1f5f46"/>
      <path d="M72 70 q28 -10 56 0" stroke="#3fae83" stroke-width="4" fill="none" stroke-dasharray="6 5"/>`,
  },
  {
    id: "ph_kebab", name: "Kev the Kebab", object: "kebab", colour: "#e9a640", personality: "only comes out after midnight", catchphrase: "Chilli sauce? Go on then",
    bbox: { x: 0.24, y: 0.16, w: 0.52, h: 0.76 },
    face: { leftEye: { x: 0.43, y: 0.56 }, rightEye: { x: 0.57, y: 0.56 }, eyeSize: 0.1, mouth: { x: 0.5, y: 0.71, width: 0.13 } },
    art: `<path d="M54 66 Q78 34 92 58 Q104 30 118 56 Q134 34 148 66 Z" fill="#4caf50"/>
      <g fill="#8a4b2a"><circle cx="76" cy="66" r="10"/><circle cx="100" cy="60" r="11"/><circle cx="124" cy="66" r="10"/></g>
      <circle cx="88" cy="58" r="6" fill="#e53935"/><circle cx="114" cy="56" r="6" fill="#e53935"/>
      <path d="M50 68 Q100 82 150 68 L122 172 Q100 186 78 172 Z" fill="#e9c27c" stroke="#d1a35a" stroke-width="4" stroke-linejoin="round"/>`,
  },
  {
    id: "ph_ball", name: "Footy Fran", object: "football", colour: "#5ad16b", personality: "plays five-a-side every Tuesday", catchphrase: "Back of the net!",
    bbox: { x: 0.14, y: 0.14, w: 0.72, h: 0.72 },
    face: { leftEye: { x: 0.38, y: 0.38 }, rightEye: { x: 0.62, y: 0.38 }, eyeSize: 0.13, mouth: { x: 0.5, y: 0.7, width: 0.2 } },
    art: `<circle cx="100" cy="100" r="70" fill="#fff" stroke="${dk}" stroke-width="5"/>
      <path d="M100 86 L114 96 L109 113 H91 L86 96 Z" fill="${dk}"/>
      <path d="M100 30 L100 50 M38 78 L56 84 M162 78 L144 84 M60 152 L72 138 M140 152 L128 138" stroke="${dk}" stroke-width="5" stroke-linecap="round"/>`,
  },
].map((c) => ({ ...c, placeholder: true }));
