import {
  Fredoka,
  Inter,
  Ubuntu_Mono,
  M_PLUS_Rounded_1c,
  Noto_Sans_JP,
  Noto_Sans_SC,
  Noto_Sans_TC,
  Noto_Sans_KR,
  Noto_Serif_JP,
  Noto_Serif_SC,
  Noto_Serif_TC,
  Noto_Serif_KR,
  Source_Serif_4,
  Yusei_Magic,
  Kosugi_Maru,
  Sawarabi_Mincho,
} from "next/font/google";

export const fredoka = Fredoka({
  subsets: ["latin"],
  variable: "--font-fredoka",
  display: "block",
});
export const mono = Ubuntu_Mono({
  weight: ["400", "700"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-ubuntu-mono",
  preload: false,
  display: "block",
});
const inter = Inter({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-inter",
  preload: false,
  display: "block",
});
const mplus = M_PLUS_Rounded_1c({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-mplus",
  preload: false,
  display: "block",
});
const noto = Noto_Sans_JP({
  weight: ["400", "600", "700"],
  subsets: ["latin"],
  variable: "--font-noto",
  preload: false,
  display: "block",
});
const sc = Noto_Sans_SC({
  weight: ["400", "600", "700"],
  subsets: ["latin"],
  variable: "--font-noto-sc",
  preload: false,
  display: "block",
});
const tc = Noto_Sans_TC({
  weight: ["400", "600", "700"],
  subsets: ["latin"],
  variable: "--font-noto-tc",
  preload: false,
  display: "block",
});
const kr = Noto_Sans_KR({
  weight: ["400", "600", "700"],
  subsets: ["latin"],
  variable: "--font-noto-kr",
  preload: false,
  display: "block",
});
const serif = Source_Serif_4({
  subsets: ["latin"],
  style: ["normal", "italic"],
  variable: "--font-source-serif",
  preload: false,
  display: "block",
});
const serifJp = Noto_Serif_JP({
  weight: ["400", "600", "700"],
  subsets: ["latin"],
  variable: "--font-serif-jp",
  preload: false,
  display: "block",
});
const serifSc = Noto_Serif_SC({
  weight: ["400", "600", "700"],
  subsets: ["latin"],
  variable: "--font-serif-sc",
  preload: false,
  display: "block",
});
const serifTc = Noto_Serif_TC({
  weight: ["400", "600", "700"],
  subsets: ["latin"],
  variable: "--font-serif-tc",
  preload: false,
  display: "block",
});
const serifKr = Noto_Serif_KR({
  weight: ["400", "600", "700"],
  subsets: ["latin"],
  variable: "--font-serif-kr",
  preload: false,
  display: "block",
});
const yusei = Yusei_Magic({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-yusei",
  preload: false,
  display: "block",
});
const kosugi = Kosugi_Maru({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-kosugi",
  preload: false,
  display: "block",
});
const sawarabi = Sawarabi_Mincho({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-sawarabi",
  preload: false,
  display: "block",
});

export const fontVariables = [
  fredoka,
  mono,
  inter,
  mplus,
  noto,
  sc,
  tc,
  kr,
  serif,
  serifJp,
  serifSc,
  serifTc,
  serifKr,
  yusei,
  kosugi,
  sawarabi,
]
  .map((font) => font.variable)
  .join(" ");
