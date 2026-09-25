/**
 * Faces the serverless Chromium draws with, since its Linux has none of the
 * system fonts the document stacks name. `scripts/fetch-fonts.ts` downloads
 * them into `fonts/` at build time; `launchBrowser` installs them.
 */
const GOOGLE_FONTS =
  "https://raw.githubusercontent.com/google/fonts/23e54b51ddffbc7713c583748e3bd86f62b1fa4a/ofl";
// Tag v2.051.
const NOTO_EMOJI =
  "https://raw.githubusercontent.com/googlefonts/noto-emoji/8998f5dd683424a73e2314a8c1f1e359c19e8742/fonts";

export const RENDER_FONTS = [
  {
    file: "Inter.ttf",
    url: `${GOOGLE_FONTS}/inter/Inter%5Bopsz,wght%5D.ttf`,
    sha256: "29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031",
  },
  {
    file: "Inter-Italic.ttf",
    url: `${GOOGLE_FONTS}/inter/Inter-Italic%5Bopsz,wght%5D.ttf`,
    sha256: "acd98e64795781b2058f07b18475e0ecee2a0fe2b42a49e2f9e37d0d6bf66ce6",
  },
  {
    file: "NotoSansJP.ttf",
    url: `${GOOGLE_FONTS}/notosansjp/NotoSansJP%5Bwght%5D.ttf`,
    sha256: "c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f",
  },
  {
    file: "NotoSerifJP.ttf",
    url: `${GOOGLE_FONTS}/notoserifjp/NotoSerifJP%5Bwght%5D.ttf`,
    sha256: "2fd527ba12b6a44ec30d796d633360da0aeba6c5d4af1304ce12bb4dc15a7dfc",
  },
  {
    file: "NotoColorEmoji.ttf",
    url: `${NOTO_EMOJI}/NotoColorEmoji.ttf`,
    sha256: "72a635cb3d2f3524c51620cdde406b217204e8a6a06c6a096ff8ed4b5fd6e27b",
  },
] as const;
