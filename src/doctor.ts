// No-generation status report: executable, version, sign-in, capabilities, models, profile.
// CLI: `bun src/doctor.ts` (exit 1 when the runtime is not usable).
import { AdapterError, AgentProcess, type CatalogEntry, childEnv, ensureProfile, resolveAgy } from "./acp.ts";

export interface DoctorReport {
	ok: boolean;
	agy?: { path: string; version: string };
	agent?: string;
	capabilities?: AgentProcess["capabilities"];
	signedIn?: boolean;
	models?: CatalogEntry[];
	profile?: { home: string; geminiDir: string; workspace: string };
	problems: string[];
}

export async function doctor(): Promise<DoctorReport> {
	const report: DoctorReport = { ok: false, problems: [] };
	let agent: AgentProcess | undefined;
	try {
		const path = resolveAgy();
		const profile = ensureProfile();
		report.profile = profile;
		// Same isolation as a session, and bounded: this call blocks the host's event loop while it runs.
		const version = Bun.spawnSync([path, "--version"], { cwd: profile.workspace, env: childEnv(), timeout: 5000, stdout: "pipe", stderr: "pipe" })
			.stdout.toString()
			.trim();
		report.agy = { path, version };
		agent = await AgentProcess.start({
			profile,
			timeoutMs: 15_000,
			hooks: { onUpdate() {}, onPermission: () => ({ outcome: { outcome: "cancelled" } }), onExit() {} },
		});
		report.agent = agent.agentLabel;
		report.capabilities = agent.capabilities;
		if (!agent.capabilities.appendInstructions) report.problems.push("runtime does not advertise _meta.antigravity.systemPrompt.append");
		if (!agent.capabilities.httpMcp) report.problems.push("runtime does not advertise HTTP MCP (OMP tools cannot be bridged)");
		if (!agent.capabilities.image) report.problems.push("runtime does not advertise image prompts");
		try {
			report.models = await agent.catalog(profile.workspace);
			report.signedIn = true;
			if (report.models.length === 0) report.problems.push("no models are available to this account");
		} catch (error) {
			if (error instanceof AdapterError && error.code === "auth") {
				report.signedIn = false;
				report.problems.push(error.message);
			} else throw error;
		}
	} catch (error) {
		report.problems.push(error instanceof Error ? error.message : String(error));
	} finally {
		await agent?.close();
	}
	report.ok = report.problems.length === 0;
	return report;
}

export function formatReport(report: DoctorReport): string {
	const lines = [`omp-antigravity doctor: ${report.ok ? "ok" : "problems found"}`];
	if (report.agy) lines.push(`agy: ${report.agy.path} (${report.agy.version || "version unknown"})`);
	if (report.agent) lines.push(`ACP agent: ${report.agent}`);
	if (report.capabilities) lines.push(`capabilities: ${JSON.stringify(report.capabilities)}`);
	if (report.signedIn !== undefined) lines.push(`signed in: ${report.signedIn ? "yes" : "no"}`);
	for (const model of report.models ?? []) {
		lines.push(`model antigravity-acp/${model.id} — ${model.name}; efforts: ${model.efforts.join(", ") || "none"} (default ${model.defaultEffort ?? "n/a"})`);
	}
	if (report.profile) lines.push(`profile: ${report.profile.home}`);
	for (const problem of report.problems) lines.push(`problem: ${problem}`);
	return lines.join("\n");
}

if (import.meta.main) {
	const report = await doctor();
	console.log(process.argv.includes("--json") ? JSON.stringify(report, null, 2) : formatReport(report));
	process.exit(report.ok ? 0 : 1);
}
