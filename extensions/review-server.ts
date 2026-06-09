import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { readJsonBody, sendJson } from "./http-utils";
import { answerReviewQuestion } from "./review-question-answering";
import { renderHtmlWithReviewSurface } from "./review-page";
import { annotationCount, saveSubmission } from "./review-submissions";

const REVIEW_HOST = "127.0.0.1";
const EVENTS_PATH = "/api/events";
const SSE_HEARTBEAT_MS = 25000;

type SavedSubmissionPaths = { jsonPath: string; markdownPath: string };

export type ReviewServerOptions = {
	ctx: any;
	sourceHtml: string;
	sourcePath: string;
	reviewDir: string;
	submissionsDir: string;
	version?: number;
	reviewId?: string;
	onSubmitted?: (payload: any, savedPaths: SavedSubmissionPaths) => void;
	onShouldClose?: () => void;
};

export type ReviewUpdatedEvent = {
	type: "review_updated";
	reviewId: string;
	version: number;
	sourcePath: string;
	source?: string;
};

export type ReviewServerState = {
	reviewId: string;
	version: number;
	sourcePath: string;
	reviewDir: string;
	submissionsDir: string;
	clientCount: number;
};

export type ReviewHtmlUpdate = {
	sourceHtml: string;
	sourcePath?: string;
	reviewDir?: string;
	submissionsDir?: string;
	version?: number;
	source?: string;
};

export type ReviewServer = Server & {
	broadcastReviewUpdated: (payload?: { version?: number; sourcePath?: string; source?: string }) => ReviewUpdatedEvent;
	updateReviewHtml: (payload: ReviewHtmlUpdate) => ReviewUpdatedEvent;
	getReviewState: () => ReviewServerState;
};

function htmlResponse(res: ServerResponse, html: string) {
	res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
	res.end(html);
}

function requestPath(req: IncomingMessage): string {
	return (req.url ?? "").split("?")[0] || "/";
}

function isDocumentRequest(req: IncomingMessage): boolean {
	return req.method === "GET" && requestPath(req) === "/";
}

function writeSse(res: ServerResponse, event: string, data: any, id?: string | number) {
	if (id !== undefined) res.write(`id: ${id}\n`);
	res.write(`event: ${event}\n`);
	res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function makeReviewId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createReviewServer(options: ReviewServerOptions): ReviewServer {
	let sourceHtml = options.sourceHtml;
	let sourcePath = options.sourcePath;
	let reviewDir = options.reviewDir;
	let submissionsDir = options.submissionsDir;
	let version = options.version ?? 1;
	const reviewId = options.reviewId ?? makeReviewId();
	const clients = new Set<ServerResponse>();
	let heartbeat: ReturnType<typeof setInterval> | undefined;

	function stopHeartbeatIfIdle() {
		if (clients.size > 0 || !heartbeat) return;
		clearInterval(heartbeat);
		heartbeat = undefined;
	}

	function removeClient(res: ServerResponse) {
		clients.delete(res);
		stopHeartbeatIfIdle();
	}

	function ensureHeartbeat() {
		if (heartbeat) return;
		heartbeat = setInterval(() => {
			for (const client of clients) {
				try {
					client.write(`: heartbeat ${Date.now()}\n\n`);
				} catch {
					removeClient(client);
				}
			}
			stopHeartbeatIfIdle();
		}, SSE_HEARTBEAT_MS);
	}

	function handleEvents(req: IncomingMessage, res: ServerResponse) {
		res.writeHead(200, {
			"content-type": "text/event-stream; charset=utf-8",
			"cache-control": "no-cache, no-transform",
			connection: "keep-alive",
			"x-accel-buffering": "no",
		});
		res.write(`retry: 2000\n\n`);
		writeSse(res, "connected", { reviewId, version, sourcePath });
		clients.add(res);
		ensureHeartbeat();
		req.on("close", () => removeClient(res));
		res.on("error", () => removeClient(res));
	}

	function broadcastReviewUpdated(payload: { version?: number; sourcePath?: string; source?: string } = {}): ReviewUpdatedEvent {
		if (payload.sourcePath !== undefined) sourcePath = payload.sourcePath;
		version = payload.version ?? version + 1;
		const event: ReviewUpdatedEvent = { type: "review_updated", reviewId, version, sourcePath, source: payload.source };
		for (const client of clients) {
			try {
				writeSse(client, event.type, event, event.version);
			} catch {
				removeClient(client);
			}
		}
		return event;
	}

	const server = createServer(async (req, res) => {
		const path = requestPath(req);
		try {
			if (isDocumentRequest(req)) {
				htmlResponse(res, renderHtmlWithReviewSurface(sourceHtml, { sourcePath, version, reviewId, eventsPath: EVENTS_PATH }));
				return;
			}

			if (req.method === "GET" && path === EVENTS_PATH) {
				handleEvents(req, res);
				return;
			}

			if (req.method === "POST" && path === "/api/ask") {
				const payload = await readJsonBody(req);
				const answer = await answerReviewQuestion(options.ctx, sourceHtml, payload);
				sendJson(res, 200, { ok: true, answer });
				return;
			}

			if (req.method === "POST" && path === "/api/submit") {
				const payload = await readJsonBody(req);
				const savedPaths = await saveSubmission(payload, reviewDir, submissionsDir);
				options.onSubmitted?.(payload, savedPaths);

				sendJson(res, 200, { ok: true, annotationCount: annotationCount(payload), ...savedPaths });
				options.onShouldClose?.();
				return;
			}

			sendJson(res, 404, { error: "Not found" });
		} catch (error: any) {
			if (!res.headersSent) {
				sendJson(res, 500, { error: error?.message ?? "Unknown error" });
			}
		}
	}) as ReviewServer;

	server.broadcastReviewUpdated = broadcastReviewUpdated;
	server.updateReviewHtml = (payload) => {
		sourceHtml = payload.sourceHtml;
		if (payload.sourcePath !== undefined) sourcePath = payload.sourcePath;
		if (payload.reviewDir !== undefined) reviewDir = payload.reviewDir;
		if (payload.submissionsDir !== undefined) submissionsDir = payload.submissionsDir;
		return broadcastReviewUpdated({ version: payload.version, sourcePath, source: payload.source });
	};
	server.getReviewState = () => ({ reviewId, version, sourcePath, reviewDir, submissionsDir, clientCount: clients.size });
	server.on("close", () => {
		if (heartbeat) clearInterval(heartbeat);
		heartbeat = undefined;
		for (const client of clients) {
			try { client.end(); } catch {}
		}
		clients.clear();
	});

	return server;
}

export async function listenOnRandomPort(server: import("node:http").Server): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, REVIEW_HOST, () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				reject(new Error("Could not determine review server port"));
				return;
			}
			resolve(address.port);
		});
	});
}

export function reviewUrl(port: number): string {
	return `http://${REVIEW_HOST}:${port}`;
}
