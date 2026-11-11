// Purpose: Keep the statements and release facts that repeat across surfaces identical.
// Responsibilities: The disclaimer and the quotation from Google's terms appear verbatim wherever a
//   reader can start, and the terms come before the first install command; the install command names
//   one commit everywhere, the one the changelog records for its latest release; every surface names
//   that release; every version a surface states is listed under "Tested versions"; the site's two
//   fit lists are the README's.
// Scope: Static checks of README.md, CHANGELOG.md, NOTICE.md, docs/, site/index.html, and
//   site/llms.txt; no network.
// Usage: bun run test:docs
import { expect, test } from "bun:test";
import { MARKDOWN, plain, read, section, SITE_TEXT } from "./repo.ts";

const DISCLAIMER = "Community project; not affiliated with or endorsed by the Oh My Pi maintainers or Google.";
// Quoted from https://antigravity.google/terms. A quotation is never paraphrased or shortened.
const TERMS =
	"Using third party software, tools, or services to access the Service (e.g. using OpenClaw with Antigravity OAuth) is a breach of this Agreement. Such actions may be grounds for suspension or termination of your Antigravity and/or Gemini CLI accounts.";
const INSTALL_PIN = /github:alphastorm\/omp-antigravity#([0-9a-f]{40})/g;
// Three-part versions only: an IP address and a model id such as gemini-3.8-flash are not versions. A
// version may end a sentence, so a trailing period is allowed unless a digit follows it.
const VERSION = /(?<![\d.])\d+\.\d+\.\d+(?!\.?\d)/g;

const changelog = read("CHANGELOG.md");
const [latestHeading, latestVersion] = changelog.match(/^## (\d+\.\d+\.\d+) — \d{4}-\d{2}-\d{2}$/m) ?? [];

test("the disclaimer and Google's terms appear verbatim wherever a reader can start", () => {
	const surfaces: [string, string[]][] = [
		[DISCLAIMER, ["README.md", "NOTICE.md", "site/index.html", "site/llms.txt"]],
		[TERMS, ["README.md", "docs/SECURITY.md", "site/index.html", "site/llms.txt"]],
	];
	const missing = surfaces.flatMap(([statement, files]) =>
		files.filter(file => !plain(read(file)).includes(statement)).map(file => `${file}: ${statement.slice(0, 40)}…`),
	);
	expect(missing).toEqual([]);
});

test("Google's terms come before the first install command", () => {
	for (const file of ["README.md", "site/index.html"]) {
		const text = plain(read(file));
		expect(text.indexOf(TERMS)).toBeGreaterThanOrEqual(0);
		expect(text.indexOf(TERMS)).toBeLessThan(text.indexOf("omp plugin install"));
	}
});

test("the install command names the commit the changelog records for its latest release", () => {
	expect(latestHeading).toBeDefined();
	const released = [...new Set([...section(changelog, latestHeading!).matchAll(INSTALL_PIN)].map(([, commit]) => commit))];
	expect(released.length).toBe(1);
	// The changelog keeps each release's own command; every other page names only the latest.
	const pinned = [...MARKDOWN.filter(file => file !== "CHANGELOG.md"), ...SITE_TEXT].flatMap(file =>
		[...new Set([...read(file).matchAll(INSTALL_PIN)].map(([, commit]) => commit))].map(commit => `${file}: ${commit}`),
	);
	expect(pinned.filter(entry => !entry.endsWith(released[0]))).toEqual([]);
	// The pages a reader installs from carry the command itself.
	const carriers = pinned.map(entry => entry.split(": ")[0]);
	expect(["README.md", "site/index.html", "site/llms.txt"].filter(file => !carriers.includes(file))).toEqual([]);
});

test("every surface names the changelog's latest release", () => {
	const names = new RegExp(`(?<![\\d.])${latestVersion!.replaceAll(".", "\\.")}(?!\\.?\\d)`);
	const readme = read("README.md");
	const status = readme.split(/\r?\n/).filter(line => line.startsWith(">")).join("\n");
	const ledger = read("site/index.html").match(/<dl class="status-ledger">[\s\S]*?<\/dl>/)?.[0] ?? "";
	expect(status).toMatch(names);
	expect(ledger).toMatch(names);
	expect(read("site/llms.txt")).toMatch(names);
});

test("every version a surface states is listed under Tested versions", () => {
	const tested = new Set(section(read("docs/COMPATIBILITY.md"), "## Tested versions").match(VERSION) ?? []);
	expect(tested.size).toBeGreaterThan(0);
	const readme = read("README.md").split(/\r?\n/);
	const stated: Record<string, string> = {
		"README.md status": readme.filter(line => line.startsWith(">")).join("\n"),
		"README.md badges": readme.filter(line => line.includes("img.shields.io/badge/")).join("\n"),
		// The install command's commit is hex, never a version; URLs carry none.
		"site/index.html": plain(read("site/index.html")),
		"site/llms.txt": read("site/llms.txt"),
	};
	const untested = Object.entries(stated).flatMap(([surface, text]) =>
		[...new Set(text.match(VERSION) ?? [])].filter(version => version !== latestVersion && !tested.has(version)).map(version => `${surface}: ${version}`),
	);
	expect(untested).toEqual([]);
});

test("the site's fit lists are the README's", () => {
	const words = (text: string) => plain(text.replace(/<\/?(?:code|strong|em|a)\b[^>]*>|`/g, "")).trim();
	const fit = read("site/index.html").match(/<section id="fit"[\s\S]*?<\/section>/)?.[0] ?? "";
	for (const heading of ["Use it when", "Use something else when"]) {
		const expected = section(read("README.md"), `## ${heading}`).split(/^- /m).slice(1).map(words);
		const column = fit.split(/<h2\b[^>]*>/).find(part => part.startsWith(`${heading}</h2>`)) ?? "";
		const listed = [...column.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(([, item]) => words(item));
		expect([heading, ...listed]).toEqual([heading, ...expected]);
	}
});
