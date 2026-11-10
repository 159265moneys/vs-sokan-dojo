const levelSkins = { normal: "classic", strong: "luxury", max: "inferno" };

// A played game keeps its own skin, including when inspected from the records.
// Standalone lessons use the conventional black/white teaching board.
export function boardSkin({ mode, level, gameLevel, started, reviewLevel }) {
  if (mode === "review") return levelSkins[reviewLevel] || "classic";
  if (mode === "play")
    return levelSkins[started ? gameLevel : level] || "classic";
  return "classic";
}

export function stoneSprite(skin, side) {
  if (skin === "luxury")
    return `assets/themes/stone-luxury-${side === 1 ? "black" : "white"}.png`;
  if (skin === "inferno")
    return `assets/themes/stone-inferno-${side === 1 ? "red" : "blue"}.png`;
  return `assets/stone-${side === 1 ? "black" : "white"}.svg`;
}

export function stoneName(skin, side) {
  return skin === "inferno"
    ? side === 1
      ? "赤"
      : "青"
    : side === 1
      ? "黒"
      : "白";
}

// Only presentation changes; the game and its saved records still use sides 1/2.
export function skinText(text, skin) {
  return skin === "inferno"
    ? text.replaceAll("黒", "赤").replaceAll("白", "青")
    : text;
}
