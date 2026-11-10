// Minimal PNG encoder for live image fixtures: vertical bands of solid RGB colours.
import { deflateSync } from "node:zlib";

function chunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	out.set(new TextEncoder().encode(type), 4);
	out.set(data, 8);
	view.setUint32(8 + data.length, Bun.hash.crc32(out.subarray(4, 8 + data.length)));
	return out;
}

/** Encodes a `width`×`height` PNG split into equal vertical bands, one per colour (left to right). */
export function bandsPng(width: number, height: number, colors: [number, number, number][]): Uint8Array {
	const header = new Uint8Array(13);
	const view = new DataView(header.buffer);
	view.setUint32(0, width);
	view.setUint32(4, height);
	header.set([8, 2, 0, 0, 0], 8); // 8-bit, truecolour, deflate, no filter, no interlace
	const raw = new Uint8Array(height * (1 + width * 3));
	for (let y = 0; y < height; y++) {
		const row = y * (1 + width * 3);
		for (let x = 0; x < width; x++) {
			const [r, g, b] = colors[Math.min(colors.length - 1, Math.floor((x * colors.length) / width))];
			raw.set([r, g, b], row + 1 + x * 3);
		}
	}
	const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
	const parts = [signature, chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())];
	const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let offset = 0;
	for (const part of parts) {
		png.set(part, offset);
		offset += part.length;
	}
	return png;
}
