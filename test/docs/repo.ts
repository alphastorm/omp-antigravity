// Shared by the documentation and site checks: the repository root and the published text files.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const ROOT = join(import.meta.dir, "..", "..");
export const REPOSITORY = "https://github.com/alphastorm/omp-antigravity";
export const SITE_ORIGIN = "https://alphastorm.github.io/omp-antigravity/";

/** Every Markdown page a reader can reach: the root pages and docs/. */
export const MARKDOWN = [
	"README.md",
	"CONTRIBUTING.md",
	"SECURITY.md",
	"CHANGELOG.md",
	"CODE_OF_CONDUCT.md",
	"NOTICE.md",
	...readdirSync(join(ROOT, "docs"))
		.filter(name => name.endsWith(".md"))
		.sort()
		.map(name => `docs/${name}`),
];
export const SITE_TEXT = ["site/index.html", "site/llms.txt"];

export function read(path: string): string {
	return readFileSync(join(ROOT, path), "utf8");
}

/** Text as a reader sees it: tags and Markdown quote markers dropped, entities and typographic quotes folded, whitespace collapsed. */
export function plain(text: string): string {
	return text
		.replace(/<[^>]+>/g, " ")
		.replace(/^\s*>\s?/gm, "")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;|[’‘]/g, "'")
		.replace(/[“”]/g, '"')
		.replace(/\s+/g, " ");
}

/** The body of a `## heading` section, up to the next heading of the same or a higher level. */
export function section(markdown: string, heading: string): string {
	const lines = markdown.split(/\r?\n/);
	const start = lines.findIndex(line => line.trim() === heading);
	if (start < 0) throw new Error(`no heading "${heading}"`);
	const level = heading.match(/^#+/)![0].length;
	const end = lines.findIndex((line, index) => index > start && new RegExp(`^#{1,${level}}\\s`).test(line));
	return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}
