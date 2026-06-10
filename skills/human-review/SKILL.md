---
name: human-review
description: Open structured Markdown or HTML content as a review-ready pi-human-inquire document with stable review blocks for in-page questions and feedback. Use whenever the user wants to take a written artifact — plan, notes, spec, design doc, RFC, refactor proposal, roadmap, recap, research notes, diff summary, post-mortem, checklist, or any other structured content — and make it reviewable in the browser. Prefer the fast Markdown path when possible. Invoke via /skill:human-review. Also use proactively when the user mentions "review this in the browser", "open this for review", "make this reviewable", "convert this to review HTML", or shares structured content and follows up about reviewing it.
---

# human-review

This skill opens **review-ready documents** for pi-human-inquire with in-page questions and human review. It is content-agnostic: the input can be a plan, notes, spec, RFC, design doc, recap, research note, diff summary, post-mortem, checklist, or any other structured content.

Prefer the **fast Markdown path** whenever possible:

- if the user provides a `.md`, `.markdown`, `.mdown`, `.mkd`, or `.txt` path, pass that path directly to `open_html_review`; do not generate HTML first
- if the user provides inline structured content or asks to review the previous plan, write it as a Markdown artifact and pass that `.md` file to `open_html_review`
- only generate standalone HTML when the user explicitly asks for HTML output or needs a custom designed review page

The extension's Markdown renderer derives stable review blocks from headings, so model-generated HTML is not required for normal plan/spec review.

## Default action on invocation

**When this skill is invoked, immediately execute the full flow. Do not just describe the skill or ask what to do.**

When invoked, your only task is to create or identify the reviewable document and open it. Stop after reporting the saved path and reopen command. Do not perform source edits, critique the source in chat, or continue implementation work.

Steps to run by default:

1. Identify the source content, in this priority order:
   1. If the user provided a path or inline content in the same message, use it.
   2. Otherwise, look back in the current conversation for the most recent substantive structured content from the assistant or user (an outline, design, spec, recap, analysis, proposal, list of items, etc.).
   3. If multiple candidates exist, pick the **most recent**.
   4. If absolutely no suitable content is found in the current conversation, ask the user to paste it or give a path. Do not invent content.

2. If the source is already a Markdown/text/HTML file path, use that exact path. If the source is inline conversation content, save it as Markdown using the rules in the "File output" section.

3. Only generate standalone HTML if the user explicitly requested HTML output or custom visual formatting.

4. **Immediately open it for review** by calling the `open_html_review` tool with the saved path. The tool accepts Markdown, text, and HTML paths. Do this every time, unless the user explicitly said "do not open" or "just generate".

5. Then tell the user:
   - the exact saved path
   - that the review surface is now open in the browser
   - they can also reopen later with: `/annotate-html <path>` or `/annotate-markdown <path>`

Do not output generated HTML inline in the chat. Always write/open a file.

## Important: invocation intent

If this skill is invoked or its content is shown with a target artifact path/content, treat that as a request to open a reviewable browser surface for the artifact.

Do not interpret the invocation as a request to critique, summarize, or edit the artifact in chat.

Do not modify the source artifact unless the user explicitly asks for edits after submitting review feedback.

Examples:

- User: `/skill:human-review README.md`
  - Correct: pass `README.md` directly to `open_html_review` so the extension renders Markdown quickly.
  - Incorrect: generate HTML from `README.md` in the model, review it in chat, or edit `README.md`.

- User provides this skill context followed by `README.md`
  - Correct: treat `README.md` as the source content/path and open it with the fast Markdown review flow.
  - Incorrect: analyze README against the skill instructions and change files.

## When to use

Use this skill when the user asks to:

- "review this in the browser"
- "open this for review"
- "turn this into review HTML"
- "make this reviewable"
- "regenerate the review HTML"
- prepare any structured document for pi-human-inquire

Also run automatically when invoked via `/skill:human-review`, even with no extra prompt.

## Inputs

Accept any of:

- a path to a text/Markdown/structured file
- raw content passed in the user message
- the last substantive structured message in the current conversation

The input can be any kind of document: plan, spec, RFC, design doc, refactor proposal, roadmap, recap, research note, diff summary, post-mortem, checklist, comparison, decision log, etc.

## HTML fallback output shell

Only use this section when standalone HTML generation is explicitly requested. The HTML must be standalone and self-contained.

```
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{{document title}}</title>
  <style>
    /* inline minimal styles, see below */
  </style>
</head>
<body>
  <main class="plan" data-review-id="doc-root" data-review-title="{{document title}}">
    <!-- review blocks here -->
  </main>
</body>
</html>
```

Note: the root element keeps `class="plan"` and `data-review-id="doc-root"` for compatibility with the current pi-human-inquire review block contract. Do not rename these.

## Deriving block structure

Unlike a templated approach, this skill **derives top-level blocks from the input's actual structure**. There is no fixed list of required sections.

Rules:

1. **Read the input and identify its top-level sections.** These usually correspond to:
   - Markdown `##` / `#` headings
   - Numbered or named sections ("1. Background", "Goals:", "Risks", etc.)
   - Natural conceptual groupings, even if not explicitly headed (e.g. a recap that has "what shipped" and "what's next" without headings)

2. **Each top-level section becomes one `<section data-review-id="...">` block.**

3. **Derive `data-review-id` from the section title** as a slug:
   - lowercase, hyphenated, semantic
   - examples: `overview`, `goals`, `non-goals`, `architecture`, `risks`, `sequencing`, `open-questions`, `what-shipped`, `whats-next`, `findings`, `recommendation`, `timeline`, `decision`, `alternatives-considered`, `metrics`
   - avoid auto-numbered ids that shift when content is added (no `section-1`, prefer the semantic name)

4. **Sub-blocks (individual items inside a section)** use `<article data-review-id="...">` with parent-prefixed ids:
   - `risks-cache-invalidation`
   - `sequencing-phase-1`
   - `findings-latency-regression`
   - `alternatives-considered-server-side-rendering`

5. **Stable ids matter.** Ids should be stable across revisions so review feedback maps back correctly. Prefer semantic slugs derived from titles rather than positions.

6. **Do not invent sections that aren't in the input.** If the input has no "risks" content, do not emit a risks block. (Exception: see `--with-stubs` below.)

7. **Do not omit sections that are in the input.** Every meaningful top-level idea in the input should map to a top-level block in the output.

### Optional: revision-stable stubs

For long-lived documents that go through many review→revise cycles (most commonly plans and specs), the user may want **stub sections** preserved across revisions so block ids stay stable even when a section temporarily has no content.

Trigger stub mode when:

- the user passes `with-stubs`, `--with-stubs`, `stubs=true`, or similar
- the user says things like "keep stable ids", "preserve sections for revisions", "this is a plan I'll iterate on"
- the input is clearly a plan or spec that will be revised (use judgment)

In stub mode, if a recognized canonical section is missing from the input, still emit it with `<p>None.</p>` or similar. Canonical sections for plan-like documents include: `overview`, `goals`, `non-goals`, `architecture`, `flow`, `interfaces`, `risks`, `sequencing`, `open-questions`. These are suggestions, not requirements — only include the ones that make sense for the document type.

Outside stub mode, omit sections the input doesn't address.

## Modes

Two modes are supported:

- **full** (default) — uses full inline CSS, the visual primitive library, sticky TOC if 4+ sections, and inline interactivity. Best when the document benefits from scannability and visual structure.
- **lite** — minimal inline styling, no TOC, no primitive library, no interactivity script. Fastest to generate. Best for short documents or quick one-off reviews.

### How to pick the mode

Pick **lite** if any of these are true:

- the user passes `lite`, `--lite`, `mode=lite`, or similar as an argument
- the user uses words like "quick", "fast", "lite", "light", "minimal", or "don't worry about formatting" in the same or immediately prior message
- the input is very short (under ~30 lines of meaningful content) and the user did not explicitly ask for full

Otherwise pick **full**.

When unsure, prefer **full** for the first generation, and **lite** for re-runs in the same conversation.

### Lite mode rules

- Only emit blocks that have real content from the input. No stubs.
- Sub-block ids still follow the parent-prefixed slug rule.
- Use the smaller base stylesheet (see "Style (lite)" below).
- Keep markup tight: no decorative wrappers, no unused classes, no TOC, no interactivity script.
- Skip any commentary or explanation HTML — just blocks.

Lite mode trades visual polish for speed. That's the intentional tradeoff.

## Inner block rules

- Wrap each top-level block in `<section data-review-id="..." data-review-title="...">`
- Use a single `<h2>` as the section heading
- For sub-blocks (e.g., individual phases, components, risks, findings, items), use `<article data-review-id="..." data-review-title="...">` inside the section
- Sub-block ids must be **prefixed by the parent** and slug-style: lowercase, hyphenated, semantic, stable
- Never auto-number ids in a way that shifts when content is added

## Visual primitives (full mode)

Do **not** default to long paragraphs. Choose the right primitive for the content type. The goal is high information density and scannability, not a Markdown-in-browser feel.

Every primitive uses pre-defined classes so the inline CSS stays small.

### Primitive selection rules

| Content shape | Use primitive |
|---|---|
| 3+ similar items (risks, components, modules, options, findings) | **Card grid** (`.pr-grid`) |
| Ordered phases, rollout steps, request flow, timelines | **Step flow** (`.pr-steps`) |
| Short tags (goals, non-goals, scope flags, keywords) | **Pill list** (`.pr-pills`) |
| Interfaces, APIs, types, env vars, fields, glossary | **Definition table** (`.pr-deftable`) |
| Decisions, key insights, warnings, recommendations | **Callout** (`.pr-callout`) |
| Two competing approaches, before/after, today/proposed | **Side-by-side** (`.pr-split`) |
| Long secondary detail under a top-level point | **Collapsible** (`<details class="pr-collapse">`) |
| Status of items (planned/done/blocked/open) | **Status chip** (`.pr-chip`) |
| More than ~4 top-level sections | **Sticky TOC** in a side rail (`.pr-toc`) |

When in doubt: prefer **card grid + callouts + pills** over paragraphs.

### Primitive markup

Use exactly these shapes. They are namespaced with `pr-` so they don't collide with the review viewer.

**Card grid**

```html
<div class="pr-grid">
  <article data-review-id="risks-cache-invalidation" data-review-title="Cache invalidation" class="pr-card">
    <h3>Cache invalidation</h3>
    <p>Short description.</p>
    <span class="pr-chip pr-chip-warn">Risk</span>
  </article>
</div>
```

**Step flow**

```html
<ol class="pr-steps">
  <li data-review-id="sequencing-phase-1" data-review-title="Phase 1">
    <strong>Phase 1</strong>
    <span>One-line outcome.</span>
  </li>
</ol>
```

**Pill list**

```html
<ul class="pr-pills">
  <li>Stable URL contract</li>
  <li>No viewport logic in v0</li>
</ul>
```

**Definition table**

```html
<dl class="pr-deftable">
  <dt><code>ResourceRequest</code></dt>
  <dd>Input contract for image fetches.</dd>
  <dt><code>ResourceDescriptor</code></dt>
  <dd>Resolved canonical asset reference.</dd>
</dl>
```

**Callout**

```html
<aside class="pr-callout pr-callout-info">
  <strong>Decision:</strong> Clients depend only on <code>ResourceRequest</code>.
</aside>
```

Callout variants: `pr-callout-info`, `pr-callout-warn`, `pr-callout-success`.

**Side-by-side**

```html
<div class="pr-split">
  <article class="pr-card">
    <h3>Today</h3>
    <p>One image serves all viewports.</p>
  </article>
  <article class="pr-card">
    <h3>Proposed</h3>
    <p>Resource layer abstracts variants.</p>
  </article>
</div>
```

**Collapsible secondary detail**

```html
<details class="pr-collapse">
  <summary>Implementation notes</summary>
  <p>Longer detail goes here.</p>
</details>
```

**Status chips**

```html
<span class="pr-chip pr-chip-ok">Planned</span>
<span class="pr-chip pr-chip-warn">Open question</span>
<span class="pr-chip pr-chip-info">Future</span>
<span class="pr-chip pr-chip-muted">Not in v0</span>
```

**Sticky TOC**

If there are 4+ top-level sections, emit a TOC at the start of `<main class="plan">`:

```html
<nav class="pr-toc" aria-label="Document sections">
  <a href="#overview">Overview</a>
  <a href="#findings">Findings</a>
  <a href="#recommendation">Recommendation</a>
  <a href="#next-steps">Next steps</a>
</nav>
```

Each corresponding `<section>` must have `id="..."` matching its `data-review-id` so anchors work.

### Composition rules

- Each top-level section should usually contain **at least one primitive other than a paragraph**.
- Avoid stacking 3+ paragraphs in a row. Convert them to a card grid, pills, or definition table.
- Push secondary detail into collapsibles, not paragraphs.
- Keep prose **short and declarative**. Density beats verbosity.
- Status of any item should be a chip, not a sentence.

## Style (full)

Inline minimal CSS, dark-friendly, no external assets. Keep it readable but plain — the review viewer is the primary surface.

Suggested base CSS (includes primitives):

```css
:root {
  --bg: #0b1220;
  --surface: #111a2e;
  --surface-2: #16213a;
  --border: rgba(148,163,184,.24);
  --text: #e6edf5;
  --muted: #8ea0b8;
  --accent: #67d2e7;
  --warn: #f5b56a;
  --ok: #6fe3a7;
  --info: #8ab6f6;
  --font: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--font); line-height: 1.55; }
main.plan { max-width: 980px; margin: 0 auto; padding: 24px 20px 80px; display: grid; gap: 16px; }
section[data-review-id] { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 18px 20px; }
section[data-review-id] > h2 { margin: 0 0 12px; font-size: 1.15rem; color: var(--text); letter-spacing:.01em; }
article[data-review-id] { background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; }
article[data-review-id] > h3 { margin: 0 0 6px; font-size: .98rem; }
p, li, dd { color: var(--muted); }
p { margin: 6px 0; }
code { background: rgba(103,210,231,.08); color: var(--text); padding: 2px 6px; border-radius: 6px; font-family: var(--mono); font-size: .92em; }
ul { padding-left: 18px; margin: 6px 0 0; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

/* TOC */
.pr-toc { position: sticky; top: 12px; display: flex; flex-wrap: wrap; gap: 6px 12px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px; background: rgba(17,26,46,.9); backdrop-filter: blur(6px); font-size: .85rem; z-index: 5; }
.pr-toc a { color: var(--muted); }
.pr-toc a:hover { color: var(--text); }
.pr-toc a[data-active="true"] { color: var(--text); font-weight: 600; }

/* Card grid */
.pr-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin-top: 8px; }
.pr-card { background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; display: grid; gap: 6px; }
.pr-card h3 { margin: 0; font-size: .98rem; }
.pr-card p { margin: 0; font-size: .9rem; }

/* Step flow */
.pr-steps { list-style: none; counter-reset: pr-step; padding: 0; margin: 8px 0 0; display: grid; gap: 8px; }
.pr-steps > li { counter-increment: pr-step; background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px 10px 40px; position: relative; display: grid; gap: 2px; }
.pr-steps > li::before { content: counter(pr-step); position: absolute; left: 10px; top: 10px; width: 22px; height: 22px; border-radius: 999px; background: var(--accent); color: #0b1220; font-weight: 700; font-size: .75rem; display: flex; align-items: center; justify-content: center; }
.pr-steps > li strong { font-size: .95rem; }
.pr-steps > li span { color: var(--muted); font-size: .9rem; }

/* Pill list */
.pr-pills { display: flex; flex-wrap: wrap; gap: 6px; list-style: none; padding: 0; margin: 8px 0 0; }
.pr-pills > li { background: rgba(103,210,231,.08); color: var(--text); border: 1px solid var(--border); border-radius: 999px; padding: 4px 10px; font-size: .82rem; }

/* Definition table */
.pr-deftable { display: grid; grid-template-columns: minmax(120px, max-content) 1fr; gap: 8px 14px; margin: 8px 0 0; }
.pr-deftable dt { color: var(--text); font-family: var(--mono); font-size: .85rem; }
.pr-deftable dd { margin: 0; color: var(--muted); font-size: .9rem; }

/* Callout */
.pr-callout { margin: 10px 0 0; padding: 10px 12px; border-left: 3px solid var(--info); background: rgba(138,182,246,.08); border-radius: 8px; font-size: .92rem; color: var(--text); }
.pr-callout-warn { border-left-color: var(--warn); background: rgba(245,181,106,.08); }
.pr-callout-success { border-left-color: var(--ok); background: rgba(111,227,167,.08); }

/* Split */
.pr-split { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 8px; }
@media (max-width: 720px) { .pr-split { grid-template-columns: 1fr; } }

/* Collapsible */
.pr-collapse { background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 0; margin-top: 8px; overflow: hidden; }
.pr-collapse > summary { list-style: none; cursor: pointer; padding: 10px 12px; font-weight: 600; color: var(--text); display: flex; align-items: center; gap: 8px; }
.pr-collapse > summary::before { content: "▸"; color: var(--muted); transition: transform .15s ease; }
.pr-collapse[open] > summary::before { transform: rotate(90deg); }
.pr-collapse > *:not(summary) { padding: 0 12px 12px; }

/* Chips */
.pr-chip { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: .72rem; font-weight: 600; letter-spacing: .02em; }
.pr-chip-ok { background: rgba(111,227,167,.15); color: var(--ok); }
.pr-chip-warn { background: rgba(245,181,106,.15); color: var(--warn); }
.pr-chip-info { background: rgba(138,182,246,.15); color: var(--info); }
.pr-chip-muted { background: rgba(148,163,184,.15); color: var(--muted); }
```

## Style (lite)

Lite mode should use a tiny base stylesheet so the model has less to emit:

```css
:root { color-scheme: dark; }
body { margin: 0; background: #0b1220; color: #e6edf5; font-family: ui-sans-serif, system-ui, sans-serif; line-height: 1.5; }
main.plan { max-width: 900px; margin: 0 auto; padding: 24px; display: grid; gap: 12px; }
section[data-review-id], article[data-review-id] { background: #111a2e; border: 1px solid rgba(148,163,184,.24); border-radius: 12px; padding: 14px 16px; }
h2 { margin: 0 0 8px; font-size: 1.15rem; }
h3 { margin: 0 0 6px; font-size: 1rem; }
p, li { color: #b6c2d2; margin: 4px 0; }
ul { padding-left: 18px; margin: 6px 0 0; }
```

Do not add anything else in lite mode.

## Inline interactivity

Add this tiny inline script just before `</body>` in **full** mode so the page feels interactive (no frameworks, no network):

```html
<script>
(()=>{
  const toc = document.querySelector('.pr-toc');
  if (toc) {
    toc.querySelectorAll('a[href^="#"]').forEach((a)=>{
      a.addEventListener('click',(e)=>{
        const id = a.getAttribute('href').slice(1);
        const target = document.getElementById(id);
        if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      });
    });
  }
  // mark current section as user scrolls, for TOC highlight
  const sections = [...document.querySelectorAll('main.plan > section[id]')];
  if (sections.length && toc) {
    const links = new Map([...toc.querySelectorAll('a[href^="#"]')].map((a)=>[a.getAttribute('href').slice(1), a]));
    const io = new IntersectionObserver((entries)=>{
      entries.forEach((entry)=>{
        const link = links.get(entry.target.id);
        if (!link) return;
        if (entry.isIntersecting) {
          links.forEach((l)=>l.removeAttribute('data-active'));
          link.setAttribute('data-active','true');
        }
      });
    }, { rootMargin: '-30% 0px -60% 0px', threshold: 0 });
    sections.forEach((section)=>io.observe(section));
  }
})();
</script>
```

Lite mode does **not** include this script or TOC.

## File output

- If the user provides a file path, use it directly; do not copy or convert it unless explicitly requested.
- For inline content, default save location: `~/.agent/diagrams/<slug>.md`.
- Use `.html` only when standalone HTML generation is explicitly requested.
- `<slug>` is derived from the document title (lowercase, hyphenated).
- If a generated file already exists at that location, **overwrite it** (this enables review→revise loops).

## After generation

Always finish by:

1. Calling the `open_html_review` tool with the saved path so the browser review surface opens automatically. The path may be Markdown, text, or HTML.
2. Telling the user:
   - the exact file path opened or written
   - that the review is now open in the browser
   - the reopen command for later use:

     ```
     /annotate-html <path>
     # or
     /annotate-markdown <path>
     ```

Only skip the auto-open step if the user explicitly says they do not want it opened.

After opening the review surface, stop. Wait for submitted review feedback or an explicit follow-up instruction before making any edits.

## Quality checks

Before returning, verify:

For the fast Markdown path, verify:

- the saved/opened path is the original Markdown/text file or a generated `.md` artifact
- headings are meaningful enough for stable review blocks
- no model-generated HTML conversion was done unless explicitly requested

For the HTML fallback path, verify:

- every top-level idea in the input maps to a top-level `<section>` block
- each top-level `<section>` has both `id="<review-id>"` and `data-review-id="<review-id>"`
- ids are slug-style, semantic, and stable (not position-based)
- sub-block ids are prefixed by their parent block id
- the file is valid standalone HTML
- the file contains no external network assets
- each top-level section uses **at least one visual primitive** when it has more than a single line of content (full mode)
- if there are 4+ top-level sections, a sticky `<nav class="pr-toc">` is present at the top (full mode)
- the inline interactivity script is present (full mode)
- stub sections only appear when stub mode was explicitly triggered
