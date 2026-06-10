import { REVIEW_CLIENT_SCRIPT, REVIEW_CLIENT_STYLE } from "./review-client-assets";

export function escapeHtml(value: string): string {
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

function uniqueSlug(value: string, seen: Set<string>): string {
	const base = slugify(value);
	let next = base;
	let counter = 2;
	while (seen.has(next)) {
		next = `${base}-${counter++}`;
	}
	seen.add(next);
	return next;
}

function isMarkdownPath(sourcePath: string): boolean {
	return /\.(md|markdown|mdown|mkd)$/i.test(sourcePath);
}

function isPlainTextPath(sourcePath: string): boolean {
	return /\.(txt|text)$/i.test(sourcePath);
}

type Heading = { level: number; text: string };
type MarkdownSection = { title: string; lines: string[]; sourceLevel: number };

function markdownHeading(line: string): Heading | null {
	const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
	if (!match) return null;
	return { level: match[1].length, text: match[2].trim() };
}

function stripInlineMarkdown(value: string): string {
	return value
		.replaceAll(/`([^`]+)`/g, "$1")
		.replaceAll(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
		.replaceAll(/\[([^\]]+)\]\([^)]+\)/g, "$1")
		.replaceAll(/[*_~]/g, "")
		.trim();
}

function documentTitle(markdown: string, sourcePath: string): { title: string; titleLine: number | null } {
	const lines = markdown.split("\n");
	const firstMeaningful = lines.findIndex((line) => line.trim().length > 0);
	if (firstMeaningful >= 0) {
		const heading = markdownHeading(lines[firstMeaningful]);
		if (heading?.level === 1) return { title: stripInlineMarkdown(heading.text), titleLine: firstMeaningful };
	}
	const filename = sourcePath.split("/").pop()?.replace(/\.[^.]+$/, "") || "Review";
	return { title: filename.replaceAll(/[-_]+/g, " ").replace(/^./, (value) => value.toUpperCase()), titleLine: null };
}

function hasMeaningfulContent(lines: string[]): boolean {
	return lines.some((line) => line.trim().length > 0);
}

function splitMarkdownSections(markdown: string, sourcePath: string): { title: string; sections: MarkdownSection[] } {
	const normalized = markdown.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
	const lines = normalized.split("\n");
	const { title, titleLine } = documentTitle(normalized, sourcePath);
	const contentStart = titleLine === null ? 0 : titleLine + 1;
	const contentHeadings = lines
		.map((line, index) => ({ heading: markdownHeading(line), index }))
		.filter((entry) => entry.index >= contentStart && entry.heading) as Array<{ heading: Heading; index: number }>;
	const sectionLevel = contentHeadings.some((entry) => entry.heading.level === 2)
		? 2
		: contentHeadings.length > 0
			? Math.min(...contentHeadings.map((entry) => entry.heading.level))
			: 2;

	const sections: MarkdownSection[] = [];
	let current: MarkdownSection | null = null;
	let preface: string[] = [];

	function flushPreface() {
		if (!hasMeaningfulContent(preface)) return;
		sections.push({ title: "Overview", lines: preface, sourceLevel: sectionLevel });
		preface = [];
	}

	for (let index = contentStart; index < lines.length; index++) {
		const line = lines[index];
		const heading = markdownHeading(line);
		if (heading && heading.level === sectionLevel) {
			if (current) sections.push(current);
			else flushPreface();
			current = { title: stripInlineMarkdown(heading.text), lines: [], sourceLevel: sectionLevel };
			continue;
		}
		if (current) current.lines.push(line);
		else preface.push(line);
	}
	if (current) sections.push(current);
	else flushPreface();
	if (sections.length === 0) {
		const fallbackLines = titleLine === null ? lines : lines.slice(titleLine + 1);
		sections.push({ title: hasMeaningfulContent(fallbackLines) ? "Overview" : "Document", lines: fallbackLines, sourceLevel: sectionLevel });
	}
	return { title, sections };
}

function safeHref(rawHref: string): string {
	const href = rawHref.trim();
	if (/^(javascript|data|vbscript):/i.test(href)) return "#";
	return href;
}

function renderInlineMarkdown(value: string): string {
	const codeSpans: string[] = [];
	let text = value.replace(/`([^`]+)`/g, (_match, code) => {
		const token = `\u0000CODE${codeSpans.length}\u0000`;
		codeSpans.push(`<code>${escapeHtml(code)}</code>`);
		return token;
	});
	text = escapeHtml(text);
	text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, src) => `<span class="pr-md-image">Image: ${escapeHtml(alt || src)}</span>`);
	text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => `<a href="${escapeHtml(safeHref(href))}" target="_blank" rel="noreferrer">${label}</a>`);
	text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
	text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
	text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");
	text = text.replace(/_([^_]+)_/g, "<em>$1</em>");
	codeSpans.forEach((code, index) => {
		text = text.replaceAll(`\u0000CODE${index}\u0000`, code);
	});
	return text;
}

function isFenceStart(line: string): boolean {
	return /^\s*(```|~~~)/.test(line);
}

function isHr(line: string): boolean {
	return /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line);
}

function listMatch(line: string): { ordered: boolean; text: string } | null {
	const unordered = line.match(/^\s*[-*+]\s+(.*)$/);
	if (unordered) return { ordered: false, text: unordered[1] };
	const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
	if (ordered) return { ordered: true, text: ordered[1] };
	return null;
}

function splitTableRow(line: string): string[] {
	let value = line.trim();
	if (value.startsWith("|")) value = value.slice(1);
	if (value.endsWith("|")) value = value.slice(0, -1);
	return value.split("|").map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
	const cells = splitTableRow(line);
	return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isTableStart(lines: string[], index: number): boolean {
	return lines[index]?.includes("|") && lines[index + 1]?.includes("|") && isTableSeparator(lines[index + 1]);
}

function isSpecialMarkdownLine(lines: string[], index: number): boolean {
	const line = lines[index];
	return !line.trim() || !!markdownHeading(line) || isFenceStart(line) || isHr(line) || !!listMatch(line) || /^\s*>\s?/.test(line) || isTableStart(lines, index);
}

function renderListItem(text: string): string {
	const task = text.match(/^\[([ xX])\]\s+(.*)$/);
	if (!task) return renderInlineMarkdown(text);
	const checked = task[1].toLowerCase() === "x" ? " checked" : "";
	return `<input type="checkbox" disabled${checked} data-no-review /> ${renderInlineMarkdown(task[2])}`;
}

function renderMarkdownBlocks(lines: string[]): string {
	const html: string[] = [];
	let index = 0;
	while (index < lines.length) {
		const line = lines[index];
		if (!line.trim()) {
			index++;
			continue;
		}

		if (isFenceStart(line)) {
			const fence = line.trim().slice(0, 3);
			const language = line.trim().slice(3).trim();
			const code: string[] = [];
			index++;
			while (index < lines.length && !lines[index].trim().startsWith(fence)) {
				code.push(lines[index++]);
			}
			if (index < lines.length) index++;
			const className = language ? ` class="language-${escapeHtml(slugify(language))}"` : "";
			html.push(`<pre><code${className}>${escapeHtml(code.join("\n"))}</code></pre>`);
			continue;
		}

		if (isTableStart(lines, index)) {
			const headers = splitTableRow(lines[index]);
			index += 2;
			const rows: string[][] = [];
			while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
				rows.push(splitTableRow(lines[index++]));
			}
			html.push([
				'<div class="pr-md-table-wrap"><table class="pr-md-table"><thead><tr>',
				headers.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join(""),
				"</tr></thead><tbody>",
				rows.map((row) => `<tr>${headers.map((_header, cellIndex) => `<td>${renderInlineMarkdown(row[cellIndex] || "")}</td>`).join("")}</tr>`).join(""),
				"</tbody></table></div>",
			].join(""));
			continue;
		}

		const heading = markdownHeading(line);
		if (heading) {
			const level = Math.min(6, Math.max(3, heading.level));
			html.push(`<h${level}>${renderInlineMarkdown(heading.text)}</h${level}>`);
			index++;
			continue;
		}

		if (isHr(line)) {
			html.push("<hr />");
			index++;
			continue;
		}

		const quoteMatch = line.match(/^\s*>\s?(.*)$/);
		if (quoteMatch) {
			const quoteLines: string[] = [];
			while (index < lines.length) {
				const match = lines[index].match(/^\s*>\s?(.*)$/);
				if (!match) break;
				quoteLines.push(match[1]);
				index++;
			}
			html.push(`<blockquote>${renderMarkdownBlocks(quoteLines)}</blockquote>`);
			continue;
		}

		const item = listMatch(line);
		if (item) {
			const ordered = item.ordered;
			const tag = ordered ? "ol" : "ul";
			const items: string[] = [];
			while (index < lines.length) {
				const next = listMatch(lines[index]);
				if (!next || next.ordered !== ordered) break;
				items.push(`<li>${renderListItem(next.text)}</li>`);
				index++;
			}
			html.push(`<${tag}>${items.join("")}</${tag}>`);
			continue;
		}

		const paragraph: string[] = [];
		while (index < lines.length && !isSpecialMarkdownLine(lines, index)) {
			paragraph.push(lines[index++].trim());
		}
		html.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
	}
	return html.join("\n");
}

function renderSectionBody(section: MarkdownSection, sectionId: string, seenIds: Set<string>): string {
	const html: string[] = [];
	let buffer: string[] = [];
	let article: { id: string; title: string; lines: string[] } | null = null;

	function flushBuffer() {
		if (!hasMeaningfulContent(buffer)) {
			buffer = [];
			return;
		}
		html.push(renderMarkdownBlocks(buffer));
		buffer = [];
	}

	function flushArticle() {
		if (!article) return;
		const body = renderMarkdownBlocks(article.lines) || "<p><em>No content.</em></p>";
		html.push(`<article class="pr-md-card" data-review-id="${escapeHtml(article.id)}" data-review-title="${escapeHtml(article.title)}"><h3>${renderInlineMarkdown(article.title)}</h3>${body}</article>`);
		article = null;
	}

	for (const line of section.lines) {
		const heading = markdownHeading(line);
		if (heading && heading.level > section.sourceLevel) {
			if (article) flushArticle();
			else flushBuffer();
			const title = stripInlineMarkdown(heading.text);
			article = { id: uniqueSlug(`${sectionId}-${title}`, seenIds), title, lines: [] };
			continue;
		}
		if (article) article.lines.push(line);
		else buffer.push(line);
	}
	flushArticle();
	flushBuffer();
	return html.join("\n") || "<p><em>No content.</em></p>";
}

const MARKDOWN_REVIEW_CSS = `
:root{color-scheme:dark;--bg:#0b1220;--surface:#111a2e;--surface2:#16213a;--border:rgba(148,163,184,.24);--text:#e6edf5;--muted:#b6c2d2;--accent:#67d2e7;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.55}main.plan{max-width:920px;margin:0 auto;padding:24px 20px 88px;display:grid;gap:12px}.pr-md-title{margin:0 0 4px;font-size:1.65rem;letter-spacing:-.02em}section[data-review-id],article[data-review-id]{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:16px 18px}article[data-review-id]{background:var(--surface2);margin-top:10px}h2{margin:0 0 10px;font-size:1.15rem}h3{margin:0 0 8px;font-size:1rem}h4,h5,h6{margin:12px 0 6px}p,li,td,blockquote{color:var(--muted)}p{margin:6px 0}ul,ol{padding-left:22px;margin:8px 0}li+li{margin-top:3px}a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}code{font-family:var(--mono);font-size:.92em;background:rgba(103,210,231,.08);color:var(--text);padding:2px 5px;border-radius:5px}pre{overflow:auto;background:#07101f;border:1px solid var(--border);border-radius:10px;padding:12px}pre code{display:block;background:none;padding:0}blockquote{margin:10px 0;padding:8px 12px;border-left:3px solid var(--accent);background:rgba(103,210,231,.07);border-radius:8px}.pr-md-card{display:block}.pr-md-table-wrap{overflow:auto;margin:10px 0}.pr-md-table{width:100%;border-collapse:collapse;font-size:.92rem}.pr-md-table th,.pr-md-table td{border:1px solid var(--border);padding:7px 9px;text-align:left}.pr-md-table th{color:var(--text);background:rgba(103,210,231,.08)}hr{border:0;border-top:1px solid var(--border);margin:14px 0}.pr-md-image{color:#8ea0b8;font-style:italic}input[type="checkbox"]{vertical-align:middle;margin-right:4px}
`;

export function renderMarkdownReviewPage(markdown: string, sourcePath: string): string {
	const { title, sections } = splitMarkdownSections(markdown, sourcePath);
	const seenIds = new Set<string>(["doc-root"]);
	const body = sections.map((section) => {
		const id = uniqueSlug(section.title, seenIds);
		return `<section id="${escapeHtml(id)}" data-review-id="${escapeHtml(id)}" data-review-title="${escapeHtml(section.title)}"><h2>${renderInlineMarkdown(section.title)}</h2>${renderSectionBody(section, id, seenIds)}</section>`;
	}).join("\n");
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<style>${MARKDOWN_REVIEW_CSS}</style>
</head>
<body>
<main class="plan" data-review-id="doc-root" data-review-title="${escapeHtml(title)}">
<h1 class="pr-md-title">${escapeHtml(title)}</h1>
${body}
</main>
</body>
</html>`;
}

function renderPlainTextReviewPage(text: string, sourcePath: string): string {
	const filename = sourcePath.split("/").pop() || "Document";
	return renderMarkdownReviewPage(`# ${filename}\n\n${text}`, sourcePath);
}

export function renderReviewableSource(source: string, sourcePath: string): string {
	if (isMarkdownPath(sourcePath)) return renderMarkdownReviewPage(source, sourcePath);
	if (isPlainTextPath(sourcePath)) return renderPlainTextReviewPage(source, sourcePath);
	return source;
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
