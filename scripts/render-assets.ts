#!/usr/bin/env bun
// Purpose: Render the editable HTML brand sources in assets/ into the committed PNGs.
// Responsibilities: Locate Chrome, screenshot each source headlessly at its logical size and device
//   scale, verify the PNG dimensions, then replace the committed PNG, or with --check compare against
//   it without writing.
// Scope: Artwork maintenance only; neither the extension nor CI runs this. It needs Chrome and no
//   network: assets/fonts.css loads the first-party font subsets in site/fonts.
// Usage: bun run render:assets [-- [og|how-it-works ...] [--check] [--chrome <path>]]
// Invariants/Assumptions: A committed PNG is replaced only by a complete render at the expected
//   dimensions. Byte-identical output is expected only from the Chrome build that produced the
//   committed PNG, so --check is a same-machine staleness check, not a cross-platform one.
// Ported from alphastorm/omp-oracle scripts/render-assets.mjs; keep in step.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const ASSETS = fileURLToPath(new URL("../assets/", import.meta.url));
// Logical CSS size and device scale of each assets/<name>.html; the PNG is (width × scale) × (height × scale).
const TARGETS: Record<string, { width: number; height: number; scale: number }> = {
	og: { width: 1280, height: 640, scale: 1 },
	"how-it-works": { width: 1240, height: 580, scale: 2 },
};
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function findChrome(explicit: string | undefined): string {
	if (explicit) {
		if (!existsSync(explicit)) throw new Error(`--chrome ${explicit} does not exist`);
		return explicit;
	}
	const pathDirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
	const found = [
		process.env.CHROME,
		...["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].flatMap(name => pathDirs.map(dir => join(dir, name))),
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
	].find(candidate => candidate && existsSync(candidate));
	if (!found) throw new Error("Chrome or Chromium not found; pass --chrome <path> or set CHROME");
	return found;
}

function pngSize(bytes: Buffer, label: string): [number, number] {
	if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.toString("latin1", 12, 16) !== "IHDR") {
		throw new Error(`${label} is not a PNG`);
	}
	return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

function render(chrome: string, name: string, check: boolean): void {
	const { width, height, scale } = TARGETS[name];
	const destination = join(ASSETS, `${name}.png`);
	const dir = mkdtempSync(join(tmpdir(), `omp-antigravity-${name}-`));
	try {
		const output = join(dir, `${name}.png`);
		const result = spawnSync(
			chrome,
			[
				"--headless=new",
				"--hide-scrollbars",
				"--disable-gpu",
				"--force-color-profile=srgb",
				`--force-device-scale-factor=${scale}`,
				`--window-size=${width},${height}`,
				"--virtual-time-budget=5000",
				`--screenshot=${output}`,
				pathToFileURL(join(ASSETS, `${name}.html`)).href,
			],
			{ encoding: "utf8", timeout: 60_000 },
		);
		if (result.status !== 0 || !existsSync(output)) {
			throw new Error(`${name}: Chrome exited with ${result.error?.message ?? result.status ?? result.signal}: ${result.stderr?.trim() ?? ""}`);
		}
		const rendered = readFileSync(output);
		const [renderedWidth, renderedHeight] = pngSize(rendered, `${name} render`);
		if (renderedWidth !== width * scale || renderedHeight !== height * scale) {
			throw new Error(`${name}: expected ${width * scale}x${height * scale}, rendered ${renderedWidth}x${renderedHeight}`);
		}
		if (check) {
			if (!existsSync(destination) || !readFileSync(destination).equals(rendered)) {
				throw new Error(`${name}: assets/${name}.png does not match assets/${name}.html; run bun run render:assets`);
			}
		} else {
			copyFileSync(output, destination);
		}
		console.log(`${name}: ${renderedWidth}x${renderedHeight}${check ? ", matches the committed PNG" : ""}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: { check: { type: "boolean", default: false }, chrome: { type: "string" } },
});
const unknown = positionals.filter(name => !Object.hasOwn(TARGETS, name));
if (unknown.length > 0) {
	console.error(`Unknown target ${unknown.join(", ")}; expected ${Object.keys(TARGETS).join(" or ")}`);
	process.exit(2);
}
try {
	const chrome = findChrome(values.chrome);
	for (const name of positionals.length > 0 ? positionals : Object.keys(TARGETS)) render(chrome, name, values.check);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
