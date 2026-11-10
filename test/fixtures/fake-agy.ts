// Scripted stand-in for `agy acp`: ACP agent side over stdio plus an MCP client for the host bridge.
// Prompt text directives drive it (see SCRIPT below); every request is logged to FAKE_AGY_LOG.
import { appendFileSync } from "node:fs";
import { agent, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import type { ContentBlock, McpServer, SessionConfigOption } from "@agentclientprotocol/sdk";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const log = (entry: Record<string, unknown>) => {
	if (process.env.FAKE_AGY_LOG) appendFileSync(process.env.FAKE_AGY_LOG, `${JSON.stringify({ pid: process.pid, ...entry })}\n`);
};

let model = "gemini-test";
let effort = "medium";
const configOptions = (): SessionConfigOption[] => [
	{
		id: "model",
		name: "Model",
		category: "model",
		type: "select",
		currentValue: model,
		options: [
			{ value: "gemini-test", name: "Gemini Test" },
			{ value: "gemini-other", name: "Gemini Other" },
		],
	},
	{
		id: "thought_level",
		name: "Thinking Level",
		category: "thought_level",
		type: "select",
		currentValue: effort,
		options: ["low", "medium", "high"].map(value => ({ value, name: value })),
	},
];

let bridge: McpServer | undefined;
let cancel: (() => void) | undefined;
const sessionId = `fake-${process.pid}`;

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
	if (!bridge || !("url" in bridge)) return "no bridge";
	const headers = Object.fromEntries(("headers" in bridge ? bridge.headers : []).map(h => [h.name, h.value]));
	const client = new Client({ name: "fake-agy", version: "0" });
	await client.connect(new StreamableHTTPClientTransport(new URL(bridge.url), { requestInit: { headers } }));
	try {
		const result = await client.callTool({ name, arguments: args }, { timeout: 600_000 });
		const content = (result.content ?? []) as { type: string; text?: string }[];
		return `${result.isError ? "ERROR " : ""}${content.map(c => (c.type === "text" ? c.text : `[${c.type}]`)).join("")}`;
	} finally {
		await client.close();
	}
}

const app = agent({ name: "fake-agy" })
	.onRequest("initialize", () => ({
		protocolVersion: PROTOCOL_VERSION,
		agentCapabilities: {
			loadSession: false,
			promptCapabilities: { image: true, audio: false, embeddedContext: true },
			mcpCapabilities: { http: true },
			sessionCapabilities: { close: {} },
			_meta: { antigravity: { systemPrompt: { append: true } } },
		},
		agentInfo: { name: "Fake Antigravity ACP Server", version: "0.0.0" },
		authMethods: [],
	}))
	.onRequest("session/new", ({ params, client }) => {
		bridge = params.mcpServers[0];
		log({ method: "session/new", mcpServers: params.mcpServers.length, append: (params._meta as { antigravity?: { systemPrompt?: { append?: string } } })?.antigravity?.systemPrompt?.append?.length });
		const commands = process.env.FAKE_AGY_DEFAULT_AGENT ? ["goal", "compact", "plan"] : ["plan", "grill-me", "learn"];
		setTimeout(() => {
			void client.notify("session/update", {
				sessionId,
				update: { sessionUpdate: "available_commands_update", availableCommands: commands.map(name => ({ name, description: name })) },
			});
		}, 5);
		return { sessionId, configOptions: configOptions() };
	})
	.onRequest("session/set_config_option", ({ params }) => {
		if (params.configId === "model") model = String(params.value);
		if (params.configId === "thought_level") effort = String(params.value);
		log({ method: "set_config_option", configId: params.configId, value: params.value });
		return { configOptions: configOptions() };
	})
	.onRequest("session/close", () => {
		log({ method: "session/close" });
		return {};
	})
	.onNotification("session/cancel", () => {
		log({ method: "session/cancel" });
		cancel?.();
	})
	.onRequest("session/prompt", async ({ params, client }) => {
		const text = params.prompt.map((b: ContentBlock) => (b.type === "text" ? b.text : `[${b.type}]`)).join("");
		log({ method: "session/prompt", text, blocks: params.prompt.map((b: ContentBlock) => b.type) });
		const { promise: cancelled, resolve } = Promise.withResolvers<"cancelled">();
		cancel = () => resolve("cancelled");
		const say = (t: string) =>
			client.notify("session/update", { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: t } } });
		const race = async <T>(work: Promise<T>) => Promise.race([work, cancelled]);
		const usage = { inputTokens: 100, outputTokens: 7, cachedReadTokens: 50, cachedWriteTokens: 0, thoughtTokens: 2, totalTokens: 157 };
		const done = (stopReason: "end_turn" | "cancelled") => ({ stopReason, usage });

		// Directives in replayed history are data; only the active request (after the replay) counts.
		const active = text.slice(text.lastIndexOf("[end of OMP history]") + 1);
		const at = active.lastIndexOf("#fake:");
		const directive = at >= 0 ? /^#fake:(\w+)(?: (\S+))?(?: (\{[^\n]*?\}))?/.exec(active.slice(at)) : null;
		if (text.includes("[OMP tool results")) {
			await say(`delivered len=${text.length} tail=${text.includes("TAIL-MARKER") ? "yes" : "no"}`);
			return done("end_turn");
		}
		switch (directive?.[1]) {
			case "call": {
				const outcome = await race(callTool(directive[2] ?? "read", JSON.parse(directive[3] ?? "{}")));
				if (outcome === "cancelled") return done("cancelled");
				await say(`result:${outcome.length}:${outcome.slice(0, 80)}`);
				return done("end_turn");
			}
			case "calls2": {
				const [a, b] = (directive[2] ?? "read,grep").split(",");
				const outcome = await race(Promise.all([callTool(a, { n: 1 }), callTool(b, { n: 2 })]));
				if (outcome === "cancelled") return done("cancelled");
				await say(`results:${outcome.map(r => r.slice(0, 40)).join("|")}`);
				return done("end_turn");
			}
			case "native":
				await client.notify("session/update", {
					sessionId,
					update: { sessionUpdate: "tool_call", toolCallId: "native-1", title: "Run run_command", kind: "execute", status: "in_progress", name: "run_command" } as never,
				});
				await cancelled;
				return done("cancelled");
			case "ratelimit":
				await say("\n\n⚠ API error (attempt 1): RESOURCE_EXHAUSTED (code 429): Resource has been exhausted (e.g. check quota).\n\n");
				await cancelled;
				return done("cancelled");
			case "wait":
				await cancelled;
				return done("cancelled");
			case "empty":
				return done("end_turn");
			default:
				await say(`ok model=${model} effort=${effort}`);
				return done("end_turn");
		}
	});

const stdout = new WritableStream<Uint8Array>({
	write(chunk) {
		process.stdout.write(chunk);
	},
});
const connection = app.connect(ndJsonStream(stdout, Bun.stdin.stream()));
await connection.closed;
process.exit(0);
