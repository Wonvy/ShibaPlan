import { getImmediateMemoImageSrc } from "./storage";

export function isSafeLinkUrl(url: string): boolean {
  const trimmed = url.trim().toLowerCase();
  return (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("mailto:")
  );
}

export function isSafeImageUrl(url: string): boolean {
  const trimmed = url
    .trim()
    .replace(/^<+|>+$/g, "")
    .trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("vbscript:")) {
    return false;
  }
  if (lower.startsWith("data:")) {
    return lower.startsWith("data:image/");
  }
  return true;
}

export const INLINE_TOKEN_RE_SOURCE =
  "(`[^`\\n]+`|!\\[[^\\]]*\\]\\((?:<[^>\\n]+>|[^)\\n]+)\\)|\\[[^\\]]+\\]\\([^)\\n]+\\)|\\*\\*\\*[^*\\n]+\\*\\*\\*|\\*\\*[^*\\n]+\\*\\*|__[^_\\n]+__|~~[^~\\n]+~~|==[^=\\n]+==|<u>[^<\\n]+<\\/u>|<kbd>[^<\\n]+<\\/kbd>|<sup>[^<\\n]+<\\/sup>|<sub>[^<\\n]+<\\/sub>|\\*[^*\\n]+\\*|https?:\\/\\/[^\\s<>()]+)";

export function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInlineLineToHtml(
  text: string,
  customDataDir?: string,
  depth = 0
): string {
  if (depth > 8) return escapeHtml(text);

  let out = "";
  const tokenRe = new RegExp(INLINE_TOKEN_RE_SOURCE, "gi");
  let lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(text)) !== null) {
    if (tokenRe.lastIndex === match.index) {
      tokenRe.lastIndex++;
      continue;
    }
    const nextLastIndex = tokenRe.lastIndex;
    if (match.index > lastIndex) {
      out += escapeHtml(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const lowerToken = token.toLowerCase();

    if (token.startsWith("`") && token.endsWith("`")) {
      out += `<code class="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] text-foreground">${escapeHtml(
        token.slice(1, -1)
      )}</code>`;
    } else if (token.startsWith("![")) {
      const imgMatch = /^!\[([^\]]*)\]\(((?:<[^>\n]+>|[^)\n]+))\)$/.exec(token);
      if (imgMatch && isSafeImageUrl(imgMatch[2])) {
        const alt = imgMatch[1];
        const cleanTarget = imgMatch[2]
          .trim()
          .replace(/^<+|>+$/g, "")
          .trim();
        const syncSrc =
          getImmediateMemoImageSrc(cleanTarget, customDataDir) ?? "";
        out += `<img contenteditable="false" data-md-src="${escapeHtml(
          cleanTarget
        )}" data-md-alt="${escapeHtml(alt)}" src="${escapeHtml(
          syncSrc
        )}" alt="${escapeHtml(
          alt
        )}" title="点击放大查看图片" class="my-2 max-h-[420px] max-w-full cursor-zoom-in rounded-md border border-border/60 object-contain transition-opacity hover:opacity-95" loading="lazy" />`;
      } else {
        out += escapeHtml(token);
      }
    } else if (token.startsWith("[")) {
      const linkMatch = /^\[([^\]]+)\]\(([^)\n]+)\)$/.exec(token);
      if (linkMatch && isSafeLinkUrl(linkMatch[2])) {
        const href = linkMatch[2].trim();
        out += `<a href="${escapeHtml(href)}" data-md-href="${escapeHtml(
          href
        )}" title="按住 Ctrl 点击打开链接，直接点击可编辑文字" class="text-primary underline-offset-2 hover:underline">${renderInlineLineToHtml(
          linkMatch[1],
          customDataDir,
          depth + 1
        )}</a>`;
      } else {
        out += escapeHtml(token);
      }
    } else if (token.startsWith("***") && token.endsWith("***")) {
      out += `<strong data-md-bi="1" class="font-semibold italic text-foreground">${renderInlineLineToHtml(
        token.slice(3, -3),
        customDataDir,
        depth + 1
      )}</strong>`;
    } else if (
      (token.startsWith("**") && token.endsWith("**")) ||
      (token.startsWith("__") && token.endsWith("__"))
    ) {
      const delim = token.startsWith("__") ? "__" : "**";
      out += `<strong data-md-delim="${delim}" class="font-semibold text-foreground">${renderInlineLineToHtml(
        token.slice(2, -2),
        customDataDir,
        depth + 1
      )}</strong>`;
    } else if (token.startsWith("~~") && token.endsWith("~~")) {
      out += `<del class="text-muted-foreground line-through">${renderInlineLineToHtml(
        token.slice(2, -2),
        customDataDir,
        depth + 1
      )}</del>`;
    } else if (token.startsWith("==") && token.endsWith("==")) {
      out += `<mark class="rounded bg-amber-500/25 px-1 py-0.5 text-foreground">${renderInlineLineToHtml(
        token.slice(2, -2),
        customDataDir,
        depth + 1
      )}</mark>`;
    } else if (lowerToken.startsWith("<u>") && lowerToken.endsWith("</u>")) {
      out += `<u class="underline decoration-primary/75 underline-offset-2">${renderInlineLineToHtml(
        token.slice(3, -4),
        customDataDir,
        depth + 1
      )}</u>`;
    } else if (
      lowerToken.startsWith("<kbd>") &&
      lowerToken.endsWith("</kbd>")
    ) {
      out += `<kbd class="mx-0.5 inline-flex items-center rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground shadow-sm">${escapeHtml(
        token.slice(5, -6)
      )}</kbd>`;
    } else if (
      lowerToken.startsWith("<sup>") &&
      lowerToken.endsWith("</sup>")
    ) {
      out += `<sup class="text-[10.5px]">${renderInlineLineToHtml(
        token.slice(5, -6),
        customDataDir,
        depth + 1
      )}</sup>`;
    } else if (
      lowerToken.startsWith("<sub>") &&
      lowerToken.endsWith("</sub>")
    ) {
      out += `<sub class="text-[10.5px]">${renderInlineLineToHtml(
        token.slice(5, -6),
        customDataDir,
        depth + 1
      )}</sub>`;
    } else if (token.startsWith("*") && token.endsWith("*")) {
      out += `<em class="italic">${renderInlineLineToHtml(
        token.slice(1, -1),
        customDataDir,
        depth + 1
      )}</em>`;
    } else if (
      (lowerToken.startsWith("http://") || lowerToken.startsWith("https://")) &&
      isSafeLinkUrl(token)
    ) {
      out += `<a href="${escapeHtml(token)}" data-md-href="${escapeHtml(
        token
      )}" data-md-autolink="1" title="按住 Ctrl 点击打开链接" class="text-primary underline-offset-2 hover:underline break-all">${escapeHtml(
        token
      )}</a>`;
    } else {
      out += escapeHtml(token);
    }

    lastIndex = nextLastIndex;
  }

  if (lastIndex < text.length) {
    out += escapeHtml(text.slice(lastIndex));
  }
  return out;
}

export function renderInlineMarkdownToHtml(
  markdown: string,
  customDataDir?: string
): string {
  if (!markdown) return "";
  return markdown
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => renderInlineLineToHtml(line, customDataDir))
    .join("<br />");
}

interface SerializeState {
  out: string;
  selStart: number | null;
  selEnd: number | null;
}

function serializeNode(
  node: Node,
  root: HTMLElement,
  state: SerializeState
): void {
  if (node.nodeType === Node.TEXT_NODE) {
    state.out += (node.textContent || "").replace(/\u00A0/g, " ");
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const el = node as HTMLElement;
  const selKind = el.getAttribute("data-md-sel");
  if (selKind === "start") {
    state.selStart = state.out.length;
    return;
  }
  if (selKind === "end") {
    state.selEnd = state.out.length;
    return;
  }

  const tag = el.tagName.toLowerCase();

  if (tag === "br") {
    // Ignore browser-inserted trailing phantom <br> in an otherwise empty or block-ending host
    const isPhantomOnly =
      node.parentNode === root &&
      node === root.lastChild &&
      (root.childNodes.length === 1 ||
        (node.previousSibling?.nodeType === Node.ELEMENT_NODE &&
          (node.previousSibling as HTMLElement).getAttribute("data-md-sel") !==
            null &&
          root.textContent === ""));
    if (!isPhantomOnly) {
      state.out += "\n";
    }
    return;
  }

  if (tag === "img") {
    const rawSrc =
      el.getAttribute("data-md-src") || el.getAttribute("src") || "";
    const alt = el.getAttribute("data-md-alt") ?? el.getAttribute("alt") ?? "";
    if (rawSrc) {
      state.out += `![${alt}](${rawSrc})`;
    }
    return;
  }

  const wrapInline = (prefix: string, suffix: string) => {
    const sub: SerializeState = { out: "", selStart: null, selEnd: null };
    el.childNodes.forEach((child) => serializeNode(child, root, sub));
    if (!sub.out && sub.selStart === null && sub.selEnd === null) {
      return;
    }
    if (!sub.out) {
      if (sub.selStart !== null) state.selStart = state.out.length;
      if (sub.selEnd !== null) state.selEnd = state.out.length;
      return;
    }
    const base = state.out.length + prefix.length;
    state.out += prefix + sub.out + suffix;
    if (sub.selStart !== null) state.selStart = base + sub.selStart;
    if (sub.selEnd !== null) state.selEnd = base + sub.selEnd;
  };

  if (tag === "code") {
    wrapInline("`", "`");
    return;
  }
  if (tag === "kbd") {
    wrapInline("<kbd>", "</kbd>");
    return;
  }
  if (tag === "strong" || tag === "b") {
    if (el.getAttribute("data-md-bi") === "1") {
      wrapInline("***", "***");
    } else {
      const delim = el.getAttribute("data-md-delim") === "__" ? "__" : "**";
      wrapInline(delim, delim);
    }
    return;
  }
  if (tag === "em" || tag === "i") {
    wrapInline("*", "*");
    return;
  }
  if (tag === "del" || tag === "s" || tag === "strike") {
    wrapInline("~~", "~~");
    return;
  }
  if (tag === "mark") {
    wrapInline("==", "==");
    return;
  }
  if (tag === "u") {
    wrapInline("<u>", "</u>");
    return;
  }
  if (tag === "sup") {
    wrapInline("<sup>", "</sup>");
    return;
  }
  if (tag === "sub") {
    wrapInline("<sub>", "</sub>");
    return;
  }
  if (tag === "a") {
    const href =
      el.getAttribute("data-md-href") || el.getAttribute("href") || "";
    const isAuto = el.getAttribute("data-md-autolink") === "1";
    const sub: SerializeState = { out: "", selStart: null, selEnd: null };
    el.childNodes.forEach((child) => serializeNode(child, root, sub));
    if (isAuto && sub.out === href) {
      const base = state.out.length;
      state.out += sub.out;
      if (sub.selStart !== null) state.selStart = base + sub.selStart;
      if (sub.selEnd !== null) state.selEnd = base + sub.selEnd;
    } else {
      const prefix = "[";
      const suffix = `](${href})`;
      const label = sub.out || href;
      const base = state.out.length + prefix.length;
      state.out += prefix + label + suffix;
      if (sub.selStart !== null) state.selStart = base + sub.selStart;
      if (sub.selEnd !== null) state.selEnd = base + sub.selEnd;
    }
    return;
  }
  if (tag === "div" || tag === "p") {
    if (state.out.length > 0 && !state.out.endsWith("\n")) {
      state.out += "\n";
    }
    el.childNodes.forEach((child) => serializeNode(child, root, state));
    return;
  }

  el.childNodes.forEach((child) => serializeNode(child, root, state));
}

export function serializeDomToMarkdown(root: HTMLElement): string {
  const st: SerializeState = { out: "", selStart: null, selEnd: null };
  root.childNodes.forEach((child) => serializeNode(child, root, st));
  // Strip single trailing newline produced when browser appends a trailing <br> after text
  if (
    st.out.endsWith("\n") &&
    root.lastChild?.nodeName === "BR" &&
    root.childNodes.length > 1 &&
    root.lastChild.previousSibling?.nodeName !== "BR"
  ) {
    return st.out.slice(0, -1);
  }
  return st.out;
}

export function getEditableSelectionInMarkdown(root: HTMLElement): {
  markdown: string;
  start: number;
  end: number;
} | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const origRange = sel.getRangeAt(0);
  if (
    !root.contains(origRange.startContainer) ||
    !root.contains(origRange.endContainer)
  ) {
    return null;
  }

  const startMarker = document.createElement("span");
  startMarker.setAttribute("data-md-sel", "start");
  const endMarker = document.createElement("span");
  endMarker.setAttribute("data-md-sel", "end");

  const endRange = origRange.cloneRange();
  endRange.collapse(false);
  endRange.insertNode(endMarker);

  const startRange = origRange.cloneRange();
  startRange.collapse(true);
  startRange.insertNode(startMarker);

  const st: SerializeState = { out: "", selStart: null, selEnd: null };
  root.childNodes.forEach((child) => serializeNode(child, root, st));

  startMarker.remove();
  endMarker.remove();
  root.normalize();

  let markdown = st.out;
  if (
    markdown.endsWith("\n") &&
    root.lastChild?.nodeName === "BR" &&
    root.childNodes.length > 1 &&
    root.lastChild.previousSibling?.nodeName !== "BR"
  ) {
    markdown = markdown.slice(0, -1);
  }

  const s = Math.min(st.selStart ?? markdown.length, markdown.length);
  const e = Math.min(st.selEnd ?? s, markdown.length);
  return {
    markdown,
    start: Math.min(s, e),
    end: Math.max(s, e),
  };
}

export function getVisibleSelectionOffsets(
  root: HTMLElement
): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
    return null;
  }

  const preStart = document.createRange();
  preStart.selectNodeContents(root);
  preStart.setEnd(range.startContainer, range.startOffset);
  const start = preStart.toString().length;
  const selectedLen = range.toString().length;
  return { start, end: start + selectedLen };
}

export function restoreVisibleSelectionOffsets(
  root: HTMLElement,
  targetStart: number,
  targetEnd: number
): void {
  root.focus();
  const sel = window.getSelection();
  if (!sel) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let curOffset = 0;
  let startNode: Node | null = null;
  let startNodeOffset = 0;
  let endNode: Node | null = null;
  let endNodeOffset = 0;
  let lastTextNode: Text | null = null;

  let cur = walker.nextNode() as Text | null;
  while (cur) {
    lastTextNode = cur;
    const len = cur.data.length;
    if (!startNode && targetStart <= curOffset + len) {
      startNode = cur;
      startNodeOffset = Math.max(0, targetStart - curOffset);
    }
    if (!endNode && targetEnd <= curOffset + len) {
      endNode = cur;
      endNodeOffset = Math.max(0, targetEnd - curOffset);
      break;
    }
    curOffset += len;
    cur = walker.nextNode() as Text | null;
  }

  const range = document.createRange();
  if (startNode && endNode) {
    range.setStart(startNode, startNodeOffset);
    range.setEnd(endNode, endNodeOffset);
  } else if (lastTextNode) {
    const endLen = lastTextNode.data.length;
    if (startNode) {
      range.setStart(startNode, startNodeOffset);
      range.setEnd(lastTextNode, endLen);
    } else {
      range.setStart(lastTextNode, endLen);
      range.setEnd(lastTextNode, endLen);
    }
  } else {
    range.selectNodeContents(root);
    range.collapse(false);
  }

  sel.removeAllRanges();
  sel.addRange(range);
}

export function toggleInlineWrapOnString(
  value: string,
  start: number,
  end: number,
  prefix: string,
  suffix: string,
  placeholder: string
): {
  next: string;
  selStart: number;
  selEnd: number;
  insertedPlaceholder: boolean;
} {
  const selected = value.slice(start, end);

  if (
    suffix &&
    start >= prefix.length &&
    value.slice(start - prefix.length, start) === prefix &&
    value.slice(end, end + suffix.length) === suffix
  ) {
    const next =
      value.slice(0, start - prefix.length) +
      selected +
      value.slice(end + suffix.length);
    const nextStart = start - prefix.length;
    return {
      next,
      selStart: nextStart,
      selEnd: nextStart + selected.length,
      insertedPlaceholder: false,
    };
  }

  if (
    suffix &&
    selected.length >= prefix.length + suffix.length &&
    selected.startsWith(prefix) &&
    selected.endsWith(suffix)
  ) {
    const unwrapped = selected.slice(
      prefix.length,
      selected.length - suffix.length
    );
    const next = value.slice(0, start) + unwrapped + value.slice(end);
    return {
      next,
      selStart: start,
      selEnd: start + unwrapped.length,
      insertedPlaceholder: false,
    };
  }

  const inner = selected || placeholder;
  const next =
    value.slice(0, start) + prefix + inner + suffix + value.slice(end);
  const selStart = start + prefix.length;
  return {
    next,
    selStart,
    selEnd: selStart + inner.length,
    insertedPlaceholder: !selected && Boolean(placeholder),
  };
}

export function computeLineRangeFromOffsets(
  content: string,
  selStart: number,
  selEnd: number
): { startLine: number; endLine: number } {
  const norm = content.replace(/\r\n?/g, "\n");
  const clampedStart = Math.max(0, Math.min(selStart, norm.length));
  const clampedEnd = Math.max(clampedStart, Math.min(selEnd, norm.length));
  const effectiveEnd =
    clampedEnd > clampedStart && norm[clampedEnd - 1] === "\n"
      ? clampedEnd - 1
      : clampedEnd;

  let startLine = 0;
  for (let i = 0; i < clampedStart; i++) {
    if (norm[i] === "\n") startLine++;
  }
  let endLine = startLine;
  for (let i = clampedStart; i < effectiveEnd; i++) {
    if (norm[i] === "\n") endLine++;
  }
  return { startLine, endLine };
}

export function lineRangeToCharOffsets(
  content: string,
  startLine: number,
  endLine: number
): { blockStart: number; blockEnd: number } {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const safeStart = Math.max(0, Math.min(startLine, lines.length - 1));
  const safeEnd = Math.max(safeStart, Math.min(endLine, lines.length - 1));

  let blockStart = 0;
  for (let i = 0; i < safeStart; i++) {
    blockStart += lines[i].length + 1;
  }
  let blockEnd = blockStart;
  for (let i = safeStart; i <= safeEnd; i++) {
    blockEnd += lines[i].length + (i < safeEnd ? 1 : 0);
  }
  return { blockStart, blockEnd };
}
