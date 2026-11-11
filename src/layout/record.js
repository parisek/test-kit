// Pure normalisation of the layout record (R6.14). The browser reads raw computed values
// (`extract.js`). This file turns them into one record per element. It has no DOM and no file system (R4.4).

export const LAYOUT_VERSION = '1.0.0';

// The computed style properties that the extractor reads for each element.
export const RECORD_PROPERTIES = Object.freeze([
  'display', 'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'rowGap', 'columnGap',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
  'color', 'backgroundColor', 'borderTopWidth', 'borderTopColor', 'borderTopLeftRadius',
]);

// The record properties that hold a token, and the name families that a token for each must fit.
// A value alone is ambiguous: 40px is a font size and a spacing step. So a token counts only when
// its name fits the family of the property.
export const TOKEN_FAMILIES = Object.freeze({
  'layout.gap': /spacing|space|gap/,
  'type.size': /text|font-size/,
  'paint.radius': /radius|rounded/,
  'paint.color': /colou?r|primary|secondary|accent|brand|neutral|gr[ae]y|black|white|ink|text|foreground|fg/,
  'paint.background': /colou?r|primary|secondary|accent|brand|neutral|gr[ae]y|black|white|surface|background|bg|tint/,
});
const TOKEN_KIND = Object.freeze({ 'layout.gap': 'length', 'type.size': 'length', 'paint.radius': 'length', 'paint.color': 'colour', 'paint.background': 'colour' });

const round = (value, digits = 3) => {
  const factor = 10 ** digits;
  const result = Math.round(value * factor) / factor;
  return Object.is(result, -0) ? 0 : result;
};

// A CSS length in px, or null. `normal` reads as 0 for gap and letter spacing (CSS defines it so).
export function length(value, { normal = null } = {}) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (text === 'normal') return normal;
  const match = /^(-?\d*\.?\d+(?:e[-+]?\d+)?)px$/i.exec(text);
  if (!match) return text === '0' ? 0 : null;
  const number = Number(match[1]);
  return Number.isFinite(number) ? round(number) : null;
}

// The largest magnitude of a stored number (#384). The reader (`snapshot.js`) refuses a number above it, and the
// writer applies it to a radius. Writer and reader read this one constant.
export const MAX_NUMBER = 1_000_000;

// A corner radius in px, or null. A radius above MAX_NUMBER is stored as MAX_NUMBER (owner direction, 2026-11-11, #384).
// It covers the engine limit of `calc(infinity * 1px)` (Tailwind CSS 4 `rounded-full`): 33554400px in Chromium.
// The normal form is exact when the other corners of the box are below the bound. CSS scales all radii of a box by
// one factor, and the record reads only the top-left corner, so two boxes whose adjacent corners are also at or above
// the bound may store the same radius and render differently. That is a known gap (owner decision, 2026-11-11, #384).
// CSS has no negative radius, so only the upper bound applies.
// Every other number above the bound stays as it is, so the reader refuses the file.
const boundRadius = number => number === null ? null : Math.min(MAX_NUMBER, number);
export function radius(value) {
  return boundRadius(length(value));
}

const byte = value => Math.round(Math.min(1, Math.max(0, value)) * 255);
const hex = value => value.toString(16).padStart(2, '0');
// The alpha byte of a colour. An opaque colour has no alpha byte, so `#ff0000ff` and `rgb(255 0 0 / 0.999)`
// both give `#ff0000`. The test runs on the rounded byte, so each input path gives one form.
const alphaSuffix = alphaByte => alphaByte === null || alphaByte === 255 ? '' : hex(alphaByte);
// The longest unparsed colour text that a record keeps (R6.14).
export const MAX_COLOUR_TEXT = 200;

// One numeric component of a colour function. `percent` is the value of 100%.
function component(text, percent = 1) {
  if (text === 'none') return 0;
  const match = /^(-?\d*\.?\d+(?:e[-+]?\d+)?)(%|deg)?$/i.exec(text);
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return null;
  return match[2] === '%' ? number / 100 * percent : number;
}

// The parts of `name(x y z / a)` or `name(x, y, z, a)`. Null for any other shape.
function parts(text) {
  const match = /^([a-z]+)\((.*)\)$/.exec(text);
  if (!match) return null;
  const body = match[2].trim();
  let values, alpha = null;
  if (body.includes(',')) {
    values = body.split(',').map(item => item.trim());
    if (values.length === 4) alpha = values.pop();
  } else {
    const [main, rest, ...extra] = body.split('/');
    if (extra.length) return null;
    values = main.trim().split(/\s+/);
    if (rest !== undefined) alpha = rest.trim();
  }
  if (values.length !== 3 || values.some(value => !value)) return null;
  return { name: match[1], values, alpha };
}

// OKLab to sRGB (Björn Ottosson, "A perceptual color space for image processing", 2020).
export function oklabToSrgb(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
  return linear.map(value => value <= 0.0031308 ? 12.92 * value : 1.055 * Math.max(0, value) ** (1 / 2.4) - 0.055);
}

// A computed colour as lowercase `#rrggbb`, or `#rrggbbaa` when it is not opaque.
// It reads `#hex`, `rgb()` and `rgba()` in comma and space syntax, `oklab()` and `oklch()`.
// Chromium serialises Tailwind 4 colours as `oklab()` or `oklch()`.
// Any other colour text (for example `color(display-p3 1 0 0)`) stays as its trimmed lowercase text,
// cut to MAX_COLOUR_TEXT characters, so an exact compare still sees a change between two such colours.
// Null means that no colour text exists: not a string, an empty string, or a control character.
export function colour(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  if (!text || /[\x00-\x1f\x7f]/.test(text)) return null;
  return converted(text) ?? text.slice(0, MAX_COLOUR_TEXT);
}

function converted(text) {
  if (text === 'transparent') return '#00000000';
  const short = /^#([0-9a-f]{3,4})$/.exec(text);
  const long = short ? null : /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(text);
  if (short || long) {
    const full = short ? [...short[1]].map(digit => digit + digit).join('') : long[1] + (long[2] ?? '');
    return '#' + full.slice(0, 6) + alphaSuffix(full.length === 8 ? parseInt(full.slice(6), 16) : null);
  }
  const parsed = parts(text);
  if (!parsed) return null;
  const alpha = parsed.alpha === null ? null : component(parsed.alpha);
  if (parsed.alpha !== null && (alpha === null || alpha < 0)) return null;
  let rgb;
  if (parsed.name === 'rgb' || parsed.name === 'rgba') {
    const values = parsed.values.map(item => component(item, 255));
    if (values.some(item => item === null)) return null;
    rgb = values.map(item => Math.round(Math.min(255, Math.max(0, item))));
  } else if (parsed.name === 'oklab' || parsed.name === 'oklch') {
    const L = component(parsed.values[0]);
    const first = component(parsed.values[1], 0.4);
    const second = parsed.name === 'oklab' ? component(parsed.values[2], 0.4) : component(parsed.values[2]);
    if ([L, first, second].some(item => item === null)) return null;
    const [a, b] = parsed.name === 'oklab' ? [first, second] : [first * Math.cos(second * Math.PI / 180), first * Math.sin(second * Math.PI / 180)];
    rgb = oklabToSrgb(L, a, b).map(byte);
  } else return null;
  return '#' + rgb.map(hex).join('') + alphaSuffix(alpha === null ? null : byte(alpha));
}

// The first family of a `font-family` list, without quotes.
export function firstFamily(value) {
  if (typeof value !== 'string') return null;
  const first = value.split(',')[0].trim().replace(/^(['"])(.*)\1$/, '$2').trim();
  return first ? first.slice(0, 200) : null;
}

const keyword = value => typeof value === 'string' && value.trim() ? value.trim().slice(0, 100) : null;

// The resolved token table: each custom property on `:root` with the length and the colour it computes to.
// `raw` is a list of { name, length, colour } with the browser values. The result holds normalised values.
export function tokenTable(raw) {
  const table = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!item || typeof item.name !== 'string' || !/^--[A-Za-z0-9_-]{1,126}$/.test(item.name)) continue;
    table.push({ name: item.name, length: length(item.length), colour: colour(item.colour) });
  }
  return table.sort((x, y) => x.name < y.name ? -1 : x.name > y.name ? 1 : 0);
}

// The name of the token for one record property: the first name in sorted order whose value equals
// the record value and whose name fits the family of the property. Null when none fits.
export function tokenFor(property, value, table) {
  if (value === null || value === undefined || !Object.hasOwn(TOKEN_FAMILIES, property)) return null;
  const kind = TOKEN_KIND[property];
  const family = TOKEN_FAMILIES[property];
  for (const token of table) {
    if (!family.test(token.name.toLowerCase())) continue;
    // Only the radius takes the bound, so `--radius-full: calc(infinity * 1px)` still names a fully rounded corner.
    // A token used for any other property keeps its own length, also when its name fits the radius family too.
    const tokenLength = property === 'paint.radius' ? boundRadius(token.length) : token.length;
    if (kind === 'length' ? tokenLength !== null && Math.abs(tokenLength - value) < 0.001 : token.colour === value) return token.name;
  }
  return null;
}

// One record from the raw values of one element. `raw` holds the RECORD_PROPERTIES and `rect`.
export function normaliseRecord(raw, table = []) {
  const display = keyword(raw?.display);
  const flex = /flex/.test(display ?? '');
  const grid = /grid/.test(display ?? '');
  const direction = flex ? keyword(raw.flexDirection) : null;
  // The gap on the main axis: `row-gap` for a column flex box, `column-gap` for a row flex box and a grid.
  const gap = flex || grid ? length(direction?.startsWith('column') ? raw.rowGap : raw.columnGap, { normal: 0 }) : null;
  const size = length(raw?.fontSize);
  const lineHeight = length(raw?.lineHeight);
  const weight = Number(raw?.fontWeight);
  const borderWidth = length(raw?.borderTopWidth);
  const width = Number(raw?.rect?.width), height = Number(raw?.rect?.height);
  const record = {
    box: { width: Number.isFinite(width) ? round(width) : null, height: Number.isFinite(height) ? round(height) : null },
    layout: {
      display,
      direction,
      wrap: flex ? keyword(raw.flexWrap) : null,
      justify: flex || grid ? keyword(raw.justifyContent) : null,
      align: flex || grid ? keyword(raw.alignItems) : null,
      gap,
      padding: [raw?.paddingTop, raw?.paddingRight, raw?.paddingBottom, raw?.paddingLeft].map(value => length(value)),
    },
    type: {
      family: firstFamily(raw?.fontFamily),
      size,
      weight: Number.isFinite(weight) ? weight : null,
      lineHeight: size && lineHeight !== null ? round(lineHeight / size) : null,
      letterSpacing: length(raw?.letterSpacing, { normal: 0 }),
    },
    paint: {
      color: colour(raw?.color),
      background: colour(raw?.backgroundColor),
      borderWidth,
      borderColor: borderWidth ? colour(raw?.borderTopColor) : null,
      radius: radius(raw?.borderTopLeftRadius),
    },
    tokens: {},
  };
  const values = { 'layout.gap': record.layout.gap, 'type.size': record.type.size, 'paint.radius': record.paint.radius,
    'paint.color': record.paint.color, 'paint.background': record.paint.background };
  for (const [property, value] of Object.entries(values)) {
    const name = tokenFor(property, value, table);
    if (name) record.tokens[property] = name;
  }
  return record;
}
