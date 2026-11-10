import { describe, expect, test } from "bun:test";
import type { AssistantMessage, AssistantMessageEvent, ToolResultMessage, UserMessage } from "@oh-my-pi/pi-ai";
import {
	composeInstructions,
	historyBlocks,
	INLINE_TEXT_BUDGET,
	inlineResult,
	inputSegments,
	messageKey,
	packPrompts,
	StreamWriter,
	usageFrom,
} from "../../src/convert.ts";

const user = (text: string, timestamp = 1): UserMessage => ({ role: "user", content: text, timestamp });
const result = (text: string, extra: Partial<ToolResultMessage> = {}): ToolResultMessage => ({
	role: "toolResult",
	toolCallId: "call-1",
	toolName: "read",
	content: [{ type: "text", text }],
	isError: false,
	timestamp: 3,
	...extra,
});

describe("packPrompts", () => {
	test("keeps a large delivery whole across parts that each fit the per-message budget", () => {
		const big = Array.from({ length: 12_000 }, (_, i) => `line ${i} ${"x".repeat(40)}`).join("\n");
		const parts = packPrompts(["[OMP user message]\n", big, "tail\n"], 180_000);
		expect(parts.length).toBeGreaterThan(1);
		const texts = parts.map(p => p.map(b => (b.type === "text" ? b.text : "")).join(""));
		for (const text of texts) expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(180_000);
		const body = texts.map(t => t.replace(/^\[OMP delivery part \d+\/\d+[^\n]*\]\n/, "")).join("");
		expect(body).toBe(`[OMP user message]\n${big}tail\n`);
		expect(texts[0]).toStartWith("[OMP delivery part 1/");
		expect(texts.at(-1)).toStartWith(`[OMP delivery part ${parts.length}/${parts.length}]`);
	});

	test("host text never opens a prompt, so user slash text stays data", () => {
		const [part] = packPrompts(inputSegments([user("/compact now please")]));
		expect(part[0]).toEqual({ type: "text", text: expect.stringMatching(/^\[OMP user message\]\n~~~\n\/compact now please\n~~~\n$/) });
	});

	test("images keep their position between text blocks", () => {
		const image = { type: "image" as const, data: "AAAA", mimeType: "image/png" };
		const [part] = packPrompts(["before\n", image, "after\n"]);
		expect(part.map(b => b.type)).toEqual(["text", "image", "text"]);
	});
});

describe("messageKey", () => {
	test("ignores rewritten content but tracks identity, tool ids, and rewinds", () => {
		const a: AssistantMessage = {
			role: "assistant",
			content: [{ type: "text", text: "hi" }, { type: "toolCall", id: "t1", name: "read", arguments: {} }],
			api: "antigravity-acp",
			provider: "antigravity-acp",
			model: "m",
			usage: usageFrom(undefined),
			stopReason: "toolUse",
			timestamp: 5,
		};
		const rewritten = { ...a, content: [{ type: "text" as const, text: "edited" }, a.content[1]] };
		expect(messageKey(rewritten)).toBe(messageKey(a));
		expect(messageKey({ ...a, timestamp: 6 })).not.toBe(messageKey(a));
		expect(messageKey(a)).toContain("t1");
	});
});

describe("inlineResult", () => {
	test("inlines results within the observed MCP budget and defers larger ones", () => {
		expect(inlineResult(result("ok"))?.content).toEqual([{ type: "text", text: "ok" }]);
		expect(inlineResult(result("x".repeat(INLINE_TEXT_BUDGET + 1)))).toBeUndefined();
		expect(inlineResult(result("bad", { isError: true }))?.isError).toBe(true);
	});
});

describe("usageFrom", () => {
	test("aggregate agent usage never reads as context occupancy", () => {
		const usage = usageFrom({ inputTokens: 50_000, cachedReadTokens: 40_000, outputTokens: 300, thoughtTokens: 200 });
		expect(usage.input + usage.cacheRead + usage.cacheWrite).toBe(0);
		expect(usage.contextTokens).toBeUndefined();
		const orchestration = (usage.orchestration?.input ?? 0) + (usage.orchestration?.cacheRead ?? 0);
		expect(usage.totalTokens - orchestration).toBe(usage.output);
		expect(usage.reasoningTokens).toBe(200);
	});
});

describe("history rendering", () => {
	test("fences outgrow tildes inside replayed content", () => {
		const text = historyBlocks([user("~~~~ not a fence end ~~~~")]).filter(s => typeof s === "string").join("");
		expect(text).toContain("~~~~~\n~~~~ not a fence end ~~~~\n~~~~~");
		expect(text).toStartWith("[OMP history");
	});

	test("instructions keep the host prompt and add the transport notes", () => {
		const text = composeInstructions(["OMP base", "Project rules"], "tool-free");
		expect(text).toStartWith("OMP base\n\nProject rules\n\n# omp-antigravity transport notes");
		expect(text).toContain("No tools are available");
	});
});

describe("StreamWriter", () => {
	test("emits canonical events for text, a tool call, and the toolUse boundary", () => {
		const events: AssistantMessageEvent[] = [];
		const stream = { push: (e: AssistantMessageEvent) => events.push(e) } as unknown as ConstructorParameters<typeof StreamWriter>[0];
		const model = { id: "gemini-4-carbon", api: "antigravity-acp", provider: "antigravity-acp" } as unknown as ConstructorParameters<typeof StreamWriter>[1];
		const writer = new StreamWriter(stream, model);
		writer.thinking("plan");
		writer.text("Reading");
		writer.toolCall({ id: "agy_1", name: "read", arguments: { path: "a" } });
		writer.finish("toolUse");
		writer.text("ignored after end");
		expect(events.map(e => e.type)).toEqual([
			"start",
			"thinking_start",
			"thinking_delta",
			"thinking_end",
			"text_start",
			"text_delta",
			"text_end",
			"toolcall_start",
			"toolcall_delta",
			"toolcall_end",
			"done",
		]);
		const done = events.at(-1) as Extract<AssistantMessageEvent, { type: "done" }>;
		expect(done.reason).toBe("toolUse");
		expect(done.message.content.map(b => b.type)).toEqual(["thinking", "text", "toolCall"]);
	});
});
