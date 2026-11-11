// Purpose: Keep the public site deployable as written.
// Responsibilities: Every asset a site page or stylesheet references exists once the Pages workflow has
//   staged the canonical brand assets; an asset change redeploys the site; a staged copy is never
//   committed; the social preview names a real PNG of the size the page declares; the sitemap,
//   robots.txt, and canonical links agree on the site's pages; nothing on the site or in the artwork
//   sources loads from another host.
// Scope: Static checks of site/, assets/, .gitignore, and .github/workflows/pages.yml; no network, no
//   browser.
// Usage: bun run test:docs
// Ported from alphastorm/omp-oracle scripts/site-coherence.test.mjs; keep in step.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { read, ROOT, SITE_ORIGIN } from "./repo.ts";

const SITE = join(ROOT, "site");
const WORKFLOW = read(".github/workflows/pages.yml");
// Site-relative name → canonical source, read from the workflow's `cp <source> site/<name>` lines.
const STAGED = new Map([...WORKFLOW.matchAll(/^\s*cp (\S+) site\/(\S+)$/gm)].map(([, source, name]) => [name, source]));

interface Page {
	file: string;
	dir: string;
	url: string;
}

function sitePages(): Page[] {
	return [...new Bun.Glob("**/index.html").scanSync({ cwd: SITE })]
		.map(file => {
			const dir = posix.dirname(file) === "." ? "" : posix.dirname(file);
			return { file: `site/${file}`, dir, url: dir === "" ? SITE_ORIGIN : `${SITE_ORIGIN}${dir}/` };
		})
		.sort((a, b) => a.url.localeCompare(b.url));
}

/** The file the deployment serves at a site-relative path, or undefined when nothing will. */
function deployedFile(sitePath: string): string | undefined {
	const staged = STAGED.get(sitePath);
	const file =
		staged === undefined ? join(SITE, sitePath === "" || sitePath.endsWith("/") ? `${sitePath}index.html` : sitePath) : join(ROOT, staged);
	return existsSync(file) ? file : undefined;
}

const isRemote = (target: string) => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target);

test("the Pages workflow redeploys when a staged asset's canonical source changes", () => {
	expect(STAGED.size).toBeGreaterThan(0);
	const triggers = WORKFLOW.split(/^\s*paths:\s*$/m)[1]?.split(/^\s*workflow_dispatch:/m)[0] ?? "";
	const watched = new Set([...triggers.matchAll(/^\s*- (\S+)\s*$/gm)].map(([, path]) => path));
	const unwatched = [...STAGED].filter(([, source]) => !watched.has(source)).map(([name, source]) => `site/${name} from ${source}`);
	expect(unwatched).toEqual([]);
});

test("a staged copy is ignored by git, so the site never carries a stale one", () => {
	const ignored = new Set(read(".gitignore").split(/\r?\n/));
	expect([...STAGED.keys()].map(name => `site/${name}`).filter(path => !ignored.has(path))).toEqual([]);
});

test("every asset a site page or stylesheet references exists after staging", () => {
	const missing: string[] = [];
	for (const page of sitePages()) {
		const html = read(page.file);
		for (const [, target] of html.matchAll(/\b(?:src|href)="([^"#?]*)/g)) {
			if (target === "" || isRemote(target)) continue;
			const sitePath = posix.normalize(posix.join(page.dir, target));
			if (sitePath.startsWith("../") || !deployedFile(sitePath)) missing.push(`${page.file} → ${target}`);
		}
		for (const [, url] of html.matchAll(/\bcontent="([^"]*)"/g)) {
			if (url.startsWith(SITE_ORIGIN) && !deployedFile(url.slice(SITE_ORIGIN.length))) missing.push(`${page.file} → ${url}`);
		}
	}
	for (const sheet of new Bun.Glob("**/*.css").scanSync({ cwd: SITE })) {
		for (const [, target] of read(`site/${sheet}`).matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
			if (isRemote(target)) continue;
			if (!deployedFile(posix.normalize(posix.join(posix.dirname(sheet), target)))) missing.push(`site/${sheet} → ${target}`);
		}
	}
	expect(missing).toEqual([]);
});

test("the social preview names a deployed PNG of the size the page declares", () => {
	const html = read("site/index.html");
	const meta = Object.fromEntries([...html.matchAll(/<meta property="(og:image(?::\w+)?)" content="([^"]*)"/g)].map(([, key, value]) => [key, value]));
	const image: string = meta["og:image"] ?? "";
	expect(image.startsWith(SITE_ORIGIN)).toBe(true);
	const file = deployedFile(image.slice(SITE_ORIGIN.length));
	expect(file).toBeDefined();
	const bytes = readFileSync(file!);
	expect(bytes.toString("latin1", 12, 16)).toBe("IHDR");
	expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([Number(meta["og:image:width"]), Number(meta["og:image:height"])]);
});

test("sitemap, robots.txt, and canonical links name exactly the site pages", () => {
	const pages = sitePages();
	const locations = [...read("site/sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, loc]) => loc).sort();
	expect(locations).toEqual(pages.map(page => page.url));
	expect(read("site/robots.txt").split(/\r?\n/)).toContain(`Sitemap: ${SITE_ORIGIN}sitemap.xml`);
	for (const page of pages) {
		const canonical = [...read(page.file).matchAll(/<link rel="canonical" href="([^"]*)"/g)].map(([, href]) => href);
		expect(canonical).toEqual([page.url]);
		expect(read(page.file)).toContain(`<meta property="og:url" content="${page.url}">`);
	}
});

test("nothing on the site or in the artwork sources loads from another host", () => {
	const remote: string[] = [];
	const sources = [
		...[...new Bun.Glob("**/*.{html,css}").scanSync({ cwd: SITE })].map(file => `site/${file}`),
		...[...new Bun.Glob("*.{html,css,svg}").scanSync({ cwd: join(ROOT, "assets") })].map(file => `assets/${file}`),
	];
	// Resources a browser fetches while rendering: scripts, images, media, embedded frames, stylesheets,
	// preloads, icons, CSS url() and @import. A plain <a href> is navigation, not a load.
	const loads = [
		/<(?:script|img|source|iframe|video|audio|embed)\b[^>]*?\bsrc(?:set)?="([^"]+)"/g,
		/<link\b(?=[^>]*\brel="(?:stylesheet|preload|icon|modulepreload|manifest)")[^>]*?\bhref="([^"]+)"/g,
		/url\(\s*["']?([^"')]+)["']?\s*\)/g,
		/@import\s+["']([^"']+)["']/g,
	];
	for (const file of sources) {
		const text = read(file);
		for (const pattern of loads) {
			for (const [, target] of text.matchAll(pattern)) {
				if (isRemote(target) && !target.startsWith("data:")) remote.push(`${file} → ${target}`);
			}
		}
		// A file that references another by relative path must find it, so a render never falls back.
		if (file.startsWith("assets/")) {
			for (const [, target] of text.matchAll(/(?:url\(\s*["']?|\b(?:src|href)=")([^"')#?]+)/g)) {
				if (!isRemote(target) && !existsSync(join(ROOT, dirname(file), target))) remote.push(`${file} → ${target} (missing)`);
			}
		}
	}
	expect(remote).toEqual([]);
});
