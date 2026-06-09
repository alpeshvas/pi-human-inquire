import { REVIEW_CLIENT_SCRIPT, REVIEW_CLIENT_STYLE } from "./review-client-assets";

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

export function slugify(value: string): string {
	return value
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/g, "-")
		.replaceAll(/^-+|-+$/g, "")
		.slice(0, 80) || "review";
}

function buildSidebarMarkup(sourcePath: string): string {
	const filename = sourcePath.split("/").pop() || sourcePath;
	return [
		'<aside id="pi-plan-review-panel">',
		'  <div id="pi-plan-review-header">',
		'    <button id="pi-review-toggle" class="pi-review-ghost pi-review-toggle" type="button" aria-expanded="true" title="Toggle review panel">Hide</button>',
		`    <div class="pi-review-filename" title="${escapeHtml(sourcePath)}">${escapeHtml(filename)}</div>`,
		'    <button id="pi-submit-compact" class="pi-review-compact-submit" data-kind="primary" type="button" hidden>Submit</button>',
		'    <button id="pi-add-general" class="pi-review-ghost" title="Add a general comment">+ Note</button>',
		'  </div>',
		'  <div id="pi-plan-review-comments">',
		'    <div id="pi-review-annotations" class="pi-review-annotations"></div>',
		'  </div>',
		'  <div id="pi-plan-review-footer">',
		'    <div id="pi-plan-review-status" role="status" aria-live="polite"></div>',
		'    <label class="pi-review-label" for="pi-review-summary">Overall</label>',
		'    <textarea id="pi-review-summary" class="pi-review-textarea pi-review-summary" placeholder="Overall feedback (optional)"></textarea>',
		'    <div class="pi-review-footer-actions">',
		'      <button id="pi-discard-all" class="pi-review-ghost" hidden>Discard all</button>',
		'      <button id="pi-submit" data-kind="primary">Submit</button>',
		'    </div>',
		'  </div>',
		'</aside>',
	].join("");
}

export type ReviewPageConfig = {
	sourcePath: string;
	version?: number;
	reviewId?: string;
	eventsPath?: string;
};

function buildReviewSurface(config: ReviewPageConfig): string {
	return `<script>window.__PI_HTML_REVIEW__=${JSON.stringify(config)};</script>
<style>
${REVIEW_CLIENT_STYLE}
</style>
<div id="pi-plan-review-root">${buildSidebarMarkup(config.sourcePath)}</div>
<script>${REVIEW_CLIENT_SCRIPT}</script>`;
}

export function renderHtmlWithReviewSurface(html: string, config: ReviewPageConfig): string {
	const reviewSurface = buildReviewSurface(config);
	return html.includes("</body>")
		? html.replace("</body>", `${reviewSurface}</body>`)
		: `${html}${reviewSurface}`;
}
