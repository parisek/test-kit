// Reuse the pure upstream region extraction (R4.4, R11.3).
const DIFF_R = 255;
const DIFF_G = 0;
const DIFF_B = 0;

/**
 * @param {Uint8Array|Buffer} data RGBA pixelmatch output, width * height * 4 bytes.
 * @param {number} width Diff canvas width in screenshot pixels.
 * @param {number} height Diff canvas height in screenshot pixels.
 * @param {{cell?: number, minPixels?: number, maxRegions?: number}} [options]
 *   cell: grid size that decides how far apart two blobs must be to stay
 *   separate; minPixels: drop regions smaller than this (text-engine noise);
 *   maxRegions: cap the returned list.
 * @returns {Array<{x: number, y: number, w: number, h: number, pixels: number}>}
 *   Exact pixel bounding boxes, sorted by differing-pixel count descending.
 */
export function extractRegions(data, width, height, options = {}) {
	const { cell = 16, minPixels = 24, maxRegions = 8 } = options;
	const cols = Math.ceil(width / cell);
	const rows = Math.ceil(height / cell);

	// Pass 1 — mark every grid cell that contains at least one diff pixel.
	const hot = new Uint8Array(cols * rows);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			if (data[i] === DIFF_R && data[i + 1] === DIFF_G && data[i + 2] === DIFF_B) {
				hot[Math.floor(y / cell) * cols + Math.floor(x / cell)] = 1;
			}
		}
	}

	// Pass 2 — flood-fill hot cells into connected components (8-connectivity,
	// so diagonally-touching cells merge too — a stair-stepped re-flowed edge
	// must not fragment into one region per step).
	// Iterative, not recursive: a full-page diff can span tens of thousands of
	// cells and would blow the call stack.
	const label = new Int32Array(cols * rows).fill(-1);
	const stack = [];
	let count = 0;
	for (let seed = 0; seed < hot.length; seed++) {
		if (!hot[seed] || label[seed] !== -1) {
			continue;
		}
		const id = count++;
		label[seed] = id;
		stack.push(seed);
		while (stack.length) {
			const cur = stack.pop();
			const cx = cur % cols;
			const cy = (cur - cx) / cols;
			const neighbours = [];
			const left = cx > 0;
			const right = cx < cols - 1;
			const up = cy > 0;
			const down = cy < rows - 1;
			if (left) neighbours.push(cur - 1);
			if (right) neighbours.push(cur + 1);
			if (up) neighbours.push(cur - cols);
			if (down) neighbours.push(cur + cols);
			if (up && left) neighbours.push(cur - cols - 1);
			if (up && right) neighbours.push(cur - cols + 1);
			if (down && left) neighbours.push(cur + cols - 1);
			if (down && right) neighbours.push(cur + cols + 1);
			for (const n of neighbours) {
				if (hot[n] && label[n] === -1) {
					label[n] = id;
					stack.push(n);
				}
			}
		}
	}

	// Pass 3 — exact bounding box and pixel count per component. The grid
	// decided the grouping; the pixels decide the box, so a region never
	// reports empty cell padding as changed area.
	const acc = Array.from({ length: count }, () => ({
		x0: Infinity, y0: Infinity, x1: -1, y1: -1, pixels: 0,
	}));
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			if (data[i] !== DIFF_R || data[i + 1] !== DIFF_G || data[i + 2] !== DIFF_B) {
				continue;
			}
			const region = acc[label[Math.floor(y / cell) * cols + Math.floor(x / cell)]];
			if (x < region.x0) region.x0 = x;
			if (y < region.y0) region.y0 = y;
			if (x > region.x1) region.x1 = x;
			if (y > region.y1) region.y1 = y;
			region.pixels++;
		}
	}

	return acc
		.filter((r) => r.pixels >= minPixels)
		.map((r) => ({
			x: r.x0,
			y: r.y0,
			w: r.x1 - r.x0 + 1,
			h: r.y1 - r.y0 + 1,
			pixels: r.pixels,
		}))
		.sort((a, b) => b.pixels - a.pixels)
		.slice(0, maxRegions);
}
