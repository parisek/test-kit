import { assertImageBounds } from './helpers.js';

// Rectangles use document coordinates in CSS pixels. Geometry stays pure (R4.4).
export function scopeGeometry(rectangles, viewport, { box = 'border' } = {}) {
  if (!['border', 'content'].includes(box)) throw new Error('Scope box must be border or content.');
  if (!Array.isArray(rectangles) || !rectangles.length || rectangles.length > 50) throw new Error('Scope needs 1..50 rectangles.');
  if (!viewport || !['width', 'height'].every(key => Number.isFinite(viewport[key]) && viewport[key] > 0)
    || !['scrollX', 'scrollY'].every(key => Number.isFinite(viewport[key] ?? 0) && (viewport[key] ?? 0) >= 0)) throw new Error('Invalid scope viewport.');
  for (const rect of rectangles) if (!rect || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key])) || rect.width <= 0 || rect.height <= 0) throw new Error('Scope rectangle has no finite visible area.');
  const left = Math.min(...rectangles.map(rect => rect.x));
  const top = Math.min(...rectangles.map(rect => rect.y));
  const right = Math.max(...rectangles.map(rect => rect.x + rect.width));
  const bottom = Math.max(...rectangles.map(rect => rect.y + rect.height));
  const originX = box === 'content' ? Math.floor(left) : left;
  const originY = box === 'content' ? Math.floor(top) : top;
  const extentX = box === 'content' ? Math.ceil(right) - originX : Math.round(right - left);
  const extentY = box === 'content' ? Math.ceil(bottom) - originY : Math.round(bottom - top);
  const scrollX = viewport.scrollX ?? 0, scrollY = viewport.scrollY ?? 0;
  const localX = originX - scrollX, localY = originY - scrollY;
  const fullPage = box === 'content' || localX < 0 || localY < 0 || localX + extentX > viewport.width || localY + extentY > viewport.height;
  // Intersect with the document origin. A negative origin must not shift the far edge.
  const x = fullPage ? Math.max(0, originX) : localX;
  const y = fullPage ? Math.max(0, originY) : localY;
  const width = fullPage ? originX + extentX - x : extentX;
  const height = fullPage ? originY + extentY - y : extentY;
  assertImageBounds(width, height);
  return { clip: { x, y, width, height }, fullPage, coordinateSpace: fullPage ? 'document' : 'viewport', unit: 'css-px', box };
}

