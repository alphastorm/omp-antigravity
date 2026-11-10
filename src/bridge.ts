// Loopback MCP server exposing the current request's OMP tools to Antigravity.
//
// The bridge never executes anything. A `tools/call` is parked: its HTTP response stays open until
// the session settles it with the result OMP produced (or an error), exactly once.
import { createHash, timingSafeEqual } from "node:crypto";
import type { McpServer } from "@agentclientprotocol/sdk";
import type { Tool } from "@oh-my-pi/pi-ai";
import { toolWireSchema } from "@oh-my-pi/pi-ai";
import { Server, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { AdapterError, CLIENT_NAME, CLIENT_VERSION } from "./acp.ts";

/** MCP server name; Antigravity exposes its tools to the model as `mcp_omp_<tool>`. */
export const BRIDGE_SERVER = "omp";
export const BRIDGE_PREFIX = `mcp_${BRIDGE_SERVER}_`;

// Gemini function names allow [A-Za-z0-9_.-] up to 64 characters, including agy's prefix.
const MAX_NAME = 64 - BRIDGE_PREFIX.length;

export interface BridgeTool {
	name: string;
	mcpName: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

export interface ParkedCall {
	readonly id: string;
	readonly name: string;
	readonly arguments: Record<string, unknown>;
	readonly arrivedAt: number;
	readonly settled: boolean;
	/** Resolves the parked MCP request; later calls are ignored. */
	settle(result: CallToolResult): void;
}

function mcpNameFor(name: string): string {
	if (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name) && name.length <= MAX_NAME) return name;
	const hash = createHash("sha256").update(name).digest("hex").slice(0, 8);
	return `${name.replace(/[^A-Za-z0-9_.-]/g, "_").replace(/^[^A-Za-z_]/, "_").slice(0, MAX_NAME - 9)}_${hash}`;
}

/** Projects OMP tools to MCP declarations; an unbridgeable tool fails the request by name. */
export function projectTools(tools: readonly Tool[]): BridgeTool[] {
	const seen = new Map<string, string>();
	return tools.map(tool => {
		if (tool.native) throw new AdapterError("tool_projection", `OMP tool "${tool.name}" is provider-native and cannot be bridged to Antigravity`);
		let inputSchema: Record<string, unknown>;
		try {
			inputSchema = structuredClone(toolWireSchema(tool));
		} catch (error) {
			throw new AdapterError("tool_projection", `OMP tool "${tool.name}" has no JSON schema the bridge can declare: ${String(error)}`);
		}
		if (inputSchema.type !== "object") {
			throw new AdapterError("tool_projection", `OMP tool "${tool.name}" parameters must be a JSON object schema for MCP`);
		}
		const mcpName = mcpNameFor(tool.name);
		const clash = seen.get(mcpName);
		if (clash) throw new AdapterError("tool_projection", `OMP tools "${clash}" and "${tool.name}" map to the same MCP name "${mcpName}"`);
		seen.set(mcpName, tool.name);
		return { name: tool.name, mcpName, description: tool.description, inputSchema };
	});
}

export class ToolBridge {
	readonly #token = crypto.getRandomValues(new Uint8Array(32)).toHex();
	readonly #onCall: (call: ParkedCall) => void;
	readonly #open = new Set<ParkedCall>();
	#tools: BridgeTool[] = [];
	#byMcpName = new Map<string, BridgeTool>();
	#server: ReturnType<typeof Bun.serve> | undefined;

	constructor(onCall: (call: ParkedCall) => void) {
		this.#onCall = onCall;
	}

	get tools(): readonly BridgeTool[] {
		return this.#tools;
	}

	setTools(tools: BridgeTool[]): void {
		this.#tools = tools;
		this.#byMcpName = new Map(tools.map(t => [t.mcpName, t]));
	}

	/** Model-visible tool name → OMP tool name, for calls Antigravity reports through ACP. */
	ompName(modelName: string): string | undefined {
		return modelName.startsWith(BRIDGE_PREFIX) ? this.#byMcpName.get(modelName.slice(BRIDGE_PREFIX.length))?.name : undefined;
	}

	start(): McpServer {
		const tokenBytes = new TextEncoder().encode(`Bearer ${this.#token}`);
		this.#server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			idleTimeout: 0, // parked calls hold their response open
			maxRequestBodySize: 16 * 1024 * 1024,
			fetch: async request => {
				const auth = new TextEncoder().encode(request.headers.get("authorization") ?? "");
				if (auth.length !== tokenBytes.length || !timingSafeEqual(auth, tokenBytes)) return new Response("unauthorized", { status: 401 });
				if (new URL(request.url).pathname !== "/mcp") return new Response("not found", { status: 404 });
				const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
				await this.#mcpServer().connect(transport);
				return transport.handleRequest(request);
			},
		});
		return {
			type: "http",
			name: BRIDGE_SERVER,
			url: `http://127.0.0.1:${this.#server.port}/mcp`,
			headers: [{ name: "Authorization", value: `Bearer ${this.#token}` }],
		};
	}

	/** Settles every still-open call with `text` as an error result and stops the server. */
	close(text = "The OMP session ended before this tool call completed."): void {
		for (const call of [...this.#open]) call.settle({ content: [{ type: "text", text }], isError: true });
		this.#server?.stop(true);
		this.#server = undefined;
	}

	#mcpServer(): Server {
		// Low-level server: OMP, not the MCP SDK, validates arguments against the real tool schema.
		const server = new Server({ name: CLIENT_NAME, version: CLIENT_VERSION }, { capabilities: { tools: {} } });
		server.setRequestHandler("tools/list", async () => ({
			tools: this.#tools.map(t => ({
				name: t.mcpName,
				description: t.description,
				inputSchema: t.inputSchema as { type: "object" },
				_meta: { "antigravity/alwaysLoad": true },
			})),
		}));
		server.setRequestHandler("tools/call", async (request, ctx) => {
			const tool = this.#byMcpName.get(request.params.name);
			if (!tool) {
				return { content: [{ type: "text", text: `Unknown OMP tool "${request.params.name}".` }], isError: true };
			}
			const args = request.params.arguments;
			if (args !== undefined && (args === null || typeof args !== "object" || Array.isArray(args))) {
				return { content: [{ type: "text", text: `Arguments for "${tool.name}" must be a JSON object.` }], isError: true };
			}
			const { promise, resolve } = Promise.withResolvers<CallToolResult>();
			let settled = false;
			const call: ParkedCall = {
				id: `agy_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`,
				name: tool.name,
				arguments: (args ?? {}) as Record<string, unknown>,
				arrivedAt: Date.now(),
				get settled() {
					return settled;
				},
				settle: result => {
					if (settled) return;
					settled = true;
					this.#open.delete(call);
					resolve(result);
				},
			};
			this.#open.add(call);
			ctx.mcpReq.signal.addEventListener(
				"abort",
				() => call.settle({ content: [{ type: "text", text: "Cancelled by Antigravity." }], isError: true }),
				{ once: true },
			);
			this.#onCall(call);
			return promise;
		});
		return server;
	}
}
