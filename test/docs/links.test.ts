// Purpose: Keep the documentation navigable as written and free of workstation identifiers.
// Responsibilities: Every relative link and image path in the Markdown documentation resolves to a file
//   or directory, every heading fragment resolves to a heading or explicit HTML id in its target, every
//   link into this repository on github.com, from the documentation or the public site, names a path
//   that exists on `main` and a fragment that resolves there, and no published page names a real home
//   directory or a process id.
// Scope: Static checks of the Markdown pages, site/index.html, and site/llms.txt against the working
//   tree; no network.
// Usage: bun run test:docs
// Ported from alphastorm/omp-oracle scripts/docs-links.test.mjs; keep in step.
import { expect, test } from "bun:test";
import { existsSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { MARKDOWN, read, REPOSITORY, ROOT, SITE_TEXT } from "./repo.ts";

// The repository's own pages on github.com: the README view, or a path on `main`.
const REPOSITORY_URL = new RegExp(`^${REPOSITORY}(?:/(blob|tree)/main/([^?#]+?))?/?(?:[?#]|$)`);

const kind = (path: string) => (existsSync(path) ? (statSync(path).isDirectory() ? "directory" : "file") : undefined);

/** Lines outside fenced code blocks, numbered from 1. */
function proseLines(markdown: string): { number: number; text: string }[] {
	const lines: { number: number; text: string }[] = [];
	let fence: string | undefined;
	for (const [index, text] of markdown.split(/\r?\n/).entries()) {
		const [, marker, rest = ""] = text.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/) ?? [];
		if (fence) {
			if (marker && marker[0] === fence[0] && marker.length >= fence.length && rest.trim() === "") fence = undefined;
			continue;
		}
		if (marker && !(marker[0] === "`" && rest.includes("`"))) {
			fence = marker;
			continue;
		}
		lines.push({ number: index + 1, text });
	}
	return lines;
}

/** The anchor GitHub derives from a heading (github-slugger: drop punctuation, keep `_` and `-`). */
function slug(heading: string): string {
	return heading
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/<[^>]+>/g, "")
		.toLowerCase()
		.replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
		.replace(/ /g, "-");
}

function anchorsOf(markdown: string): Set<string> {
	const anchors = new Set<string>();
	const seen = new Map<string, number>();
	for (const { text } of proseLines(markdown)) {
		const heading = text.match(/^\s{0,3}#{1,6}\s+(.+?)(?:\s+#+)?\s*$/)?.[1];
		if (heading) {
			const base = slug(heading);
			const count = seen.get(base) ?? 0;
			anchors.add(count === 0 ? base : `${base}-${count}`);
			seen.set(base, count + 1);
		}
		for (const [, id] of text.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) anchors.add(id);
	}
	return anchors;
}

function linksOf(markdown: string): { line: number; target: string }[] {
	const links: { line: number; target: string }[] = [];
	for (const { number, text } of proseLines(markdown)) {
		// A code span is literal text, never a link.
		const line = text.replace(/`[^`]*`/g, span => " ".repeat(span.length));
		const definition = line.match(/^\s{0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/)?.[1];
		if (definition) {
			links.push({ line: number, target: definition });
			continue;
		}
		for (const [, target] of line.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g)) links.push({ line: number, target });
		for (const [, target] of line.matchAll(/\b(?:href|src)="([^"]+)"/g)) links.push({ line: number, target });
		for (const [, candidates] of line.matchAll(/\bsrcset="([^"]+)"/g)) {
			for (const candidate of candidates.split(",")) links.push({ line: number, target: candidate.trim().split(/\s+/)[0] });
		}
	}
	return links;
}

const anchorCache = new Map<string, Set<string>>();

/** Why `fragment` does not resolve in `targetPath`, or undefined when it does (or cannot be checked). */
function fragmentProblem(targetPath: string, fragment: string | undefined): string | undefined {
	if (fragment === undefined || !targetPath.endsWith(".md") || kind(targetPath) !== "file") return undefined;
	if (fragment === "") return "empty fragment";
	let anchors = anchorCache.get(targetPath);
	if (!anchors) anchorCache.set(targetPath, (anchors = anchorsOf(read(relative(ROOT, targetPath)))));
	return anchors.has(decodeURIComponent(fragment)) ? undefined : `no heading or id #${fragment}`;
}

/** Why a link into this repository on github.com does not resolve, or undefined when it does. */
function repositoryUrlProblem(url: string): string | undefined {
	const match = url.match(REPOSITORY_URL);
	if (!match) return undefined;
	const [, view, path] = match;
	const fragment = url.includes("#") ? url.slice(url.indexOf("#") + 1) : undefined;
	if (!view) {
		if (fragment === undefined || fragment === "readme") return undefined;
		return fragmentProblem(join(ROOT, "README.md"), fragment);
	}
	const target = join(ROOT, decodeURIComponent(path));
	const expected = view === "tree" ? "directory" : "file";
	if (kind(target) !== expected) return `no ${expected} ${path} on main`;
	return fragmentProblem(target, fragment);
}

test("every relative link and heading fragment in the documentation resolves", () => {
	const broken: string[] = [];
	for (const file of MARKDOWN) {
		const source = join(ROOT, file);
		for (const { line, target } of linksOf(read(file))) {
			if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) continue;
			const hash = target.indexOf("#");
			const path = decodeURIComponent((hash >= 0 ? target.slice(0, hash) : target).replace(/\?.*$/, ""));
			const fragment = hash >= 0 ? target.slice(hash + 1) : undefined;
			const resolved = path === "" ? source : resolve(dirname(source), path);
			const inside = !relative(ROOT, resolved).split(sep).join("/").startsWith("../");
			const problem = !inside || !kind(resolved) ? "no such file in the repository" : fragmentProblem(resolved, fragment);
			if (problem) broken.push(`${file}:${line} → ${target} (${problem})`);
		}
	}
	expect(broken).toEqual([]);
});

test("every link into this repository on github.com resolves on main", () => {
	const broken: string[] = [];
	const repositoryUrls = new RegExp(`${REPOSITORY}[^\\s"'<>)\`]*`, "g");
	for (const file of [...MARKDOWN, ...SITE_TEXT]) {
		for (const [index, text] of read(file).split(/\r?\n/).entries()) {
			for (const [url] of text.matchAll(repositoryUrls)) {
				const problem = repositoryUrlProblem(url);
				if (problem) broken.push(`${file}:${index + 1} → ${url} (${problem})`);
			}
		}
	}
	expect(broken).toEqual([]);
});

// Home directories other than the `you` placeholder, and process ids with their numbers: evidence
// travels as commits, versions, and run ids instead.
const WORKSTATION_IDENTIFIER = /(?:\/Users\/|\/home\/|C:\\Users\\)(?!you\b|<you>)[A-Za-z0-9_-]+|\b(?:PID|pid)s?\s+\*{0,2}\d+/g;

test("the documentation names no home directory or process id", () => {
	const found: string[] = [];
	for (const file of [...MARKDOWN, ...SITE_TEXT]) {
		for (const [index, text] of read(file).split(/\r?\n/).entries()) {
			for (const [match] of text.matchAll(WORKSTATION_IDENTIFIER)) found.push(`${file}:${index + 1} → ${match}`);
		}
	}
	expect(found).toEqual([]);
});
