// @ts-nocheck
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { renderReviewableSource, slugify } from "./review-page";
import { createReviewServer, listenOnRandomPort, reviewUrl } from "./review-server";
import type { ReviewServer } from "./review-server";
import { buildReviewSummary } from "./review-submissions";

const execFileAsync = promisify(execFile);
const REVIEW_ROOT = ".pi/html-reviews";
type ReviewRuntime = {
	server?: ReviewServer;
	port?: number;
	sourcePath?: string;
	reviewDir?: string;
};

type ReviewLaunchResult = {
	url: string;
	reviewDir: string;
	sourcePath: string;
};

async function openBrowser(url: string) {
	const commands = process.platform === "darwin" ? [["open", [url]]] : [["xdg-open", [url]]];
	for (const [command, args] of commands) {
		try {
			await execFileAsync(command, args);
			return;
		} catch {}
	}
}

export default function (pi: ExtensionAPI) {
	const runtime: ReviewRuntime = {};

	async function closeServer() {
		if (!runtime.server) return;
		const server = runtime.server;
		runtime.server = undefined;
		runtime.port = undefined;
		runtime.sourcePath = undefined;
		runtime.reviewDir = undefined;
		await new Promise<void>((resolve, reject) => {
			server.close((error) => {
				if (error) reject(error);
				else resolve();
			});
		});
	}

	function forwardSubmissionToPi(payload: any, savedPaths: { jsonPath: string; markdownPath: string }) {
		try {
			pi.sendUserMessage(buildReviewSummary(payload, savedPaths.jsonPath, savedPaths.markdownPath), { deliverAs: "followUp" });
		} catch {}
	}

	function announceReview(result: ReviewLaunchResult, ctx: any, verb: "opened" | "updated") {
		const message = `Document review ${verb}: ${result.url}`;
		ctx.ui.setStatus("html-review", message);
		ctx.ui.setWidget("html-review", undefined);
		ctx.ui.notify(message, "info");
	}

	async function launchReview(sourcePathInput: string, ctx: any): Promise<ReviewLaunchResult> {
		const sourcePath = path.resolve(ctx.cwd, sourcePathInput);
		const sourceContent = await fs.readFile(sourcePath, "utf8");
		const sourceHtml = renderReviewableSource(sourceContent, sourcePath);
		const slug = slugify(path.basename(sourcePath, path.extname(sourcePath)));
		const reviewDir = path.join(ctx.cwd, REVIEW_ROOT, slug);
		const submissionsDir = path.join(reviewDir, "submissions");
		await fs.mkdir(submissionsDir, { recursive: true });

		let openedNewServer = false;
		let clientCount = 0;
		if (runtime.server && runtime.port) {
			runtime.server.updateReviewHtml({
				sourceHtml,
				sourcePath,
				reviewDir,
				submissionsDir,
				source: "launchReview",
			});
			clientCount = runtime.server.getReviewState().clientCount;
			Object.assign(runtime, { sourcePath, reviewDir });
		} else {
			const server = createReviewServer({
				ctx,
				sourceHtml,
				sourcePath,
				reviewDir,
				submissionsDir,
				onSubmitted: forwardSubmissionToPi,
			});
			const port = await listenOnRandomPort(server);
			Object.assign(runtime, { server, port, sourcePath, reviewDir });
			openedNewServer = true;
		}

		const url = reviewUrl(runtime.port!);
		if (ctx.mode !== "rpc" && (openedNewServer || clientCount === 0)) {
			await openBrowser(url);
		}
		return { url, reviewDir, sourcePath };
	}

	const openReviewCommand = async (args: string, ctx: any) => {
		let fileArg = args.trim();
		if (!fileArg && ctx.hasUI) {
			fileArg = (await ctx.ui.input("HTML or Markdown file to review", "path/to/document.md"))?.trim() ?? "";
		}
		if (!fileArg) {
			ctx.ui.notify("Usage: /annotate-html <path-to-html-or-markdown>", "error");
			return;
		}

		try {
			const hadServer = !!runtime.server;
			const result = await launchReview(fileArg, ctx);
			announceReview(result, ctx, hadServer ? "updated" : "opened");
		} catch (error: any) {
			ctx.ui.notify(`Failed to open document review: ${error?.message ?? error}`, "error");
		}
	};

	pi.registerCommand("annotate-html", {
		description: "Open reviewable HTML or Markdown in pi-human-inquire with questions, comments, and submission",
		handler: openReviewCommand,
	});

	pi.registerCommand("annotate-markdown", {
		description: "Open reviewable Markdown in pi-human-inquire with questions, comments, and submission",
		handler: openReviewCommand,
	});

	pi.registerCommand("annotate-plan-html", {
		description: "Alias for /annotate-html",
		handler: openReviewCommand,
	});

	pi.registerCommand("annotate-html-stop", {
		description: "Stop the active document review server",
		handler: async (_args, ctx) => {
			if (!runtime.server) {
				ctx.ui.notify("No active document review server", "info");
				return;
			}
			await closeServer();
			ctx.ui.setStatus("html-review", undefined);
			ctx.ui.setWidget("html-review", undefined);
			ctx.ui.notify("Stopped document review server", "info");
		},
	});

	pi.registerTool({
		name: "open_html_review",
		label: "Open Document Review",
		description: "Open reviewable HTML or Markdown in pi-human-inquire with inline questions and feedback support",
		promptSnippet: "Open reviewable HTML or Markdown for in-page questions, threaded discussion, and feedback.",
		promptGuidelines: ["Use open_html_review when the user wants to open reviewable HTML or Markdown for in-page questions, threaded discussion, comments, and feedback submission."],
		parameters: Type.Object({
			path: Type.String({ description: "Path to the HTML or Markdown file to open in pi-human-inquire" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const hadServer = !!runtime.server;
			const result = await launchReview(params.path, ctx);
			announceReview(result, ctx, hadServer ? "updated" : "opened");
			return {
				content: [{ type: "text", text: `${hadServer ? "Updated" : "Opened"} document review for ${result.sourcePath}. Review URL: ${result.url}` }],
				details: result,
			};
		},
	});

	pi.on("session_shutdown", async () => {
		await closeServer();
	});
}
