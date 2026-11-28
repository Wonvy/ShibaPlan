import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Copy,
  ImageOff,
  Info,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import {
  getEditableSelectionInMarkdown,
  getVisibleSelectionOffsets,
  INLINE_TOKEN_RE_SOURCE,
  isSafeImageUrl,
  isSafeLinkUrl,
  renderInlineMarkdownToHtml,
  restoreVisibleSelectionOffsets,
  serializeDomToMarkdown,
  toggleInlineWrapOnString,
} from "../lib/markdownEdit";
import {
  getImmediateMemoImageSrc,
  resolveMemoImageSrc,
} from "../lib/storage";
import { openExternalUrl } from "../lib/updater";

export interface LineRange {
  startLine: number;
  endLine: number;
}

export interface MarkdownPreviewHandle {
  applyInlineWrap: (
    prefix: string,
    suffix: string,
    placeholder: string
  ) => boolean;
  insertSmartLink: () => boolean;
  insertInlineSnippet: (snippet: string) => boolean;
  focusLine: (targetLine: number, placeAtStart?: boolean) => void;
}

export interface MarkdownPreviewProps {
  content: string;
  customDataDir?: string;
  baseLineOffset?: number;
  editable?: boolean;
  editorHandleRef?: React.MutableRefObject<MarkdownPreviewHandle | null>;
  highlightRange?: LineRange | null;
  autoScrollHighlight?: boolean;
  onActiveRangeChange?: (range: LineRange) => void;
  onHoverRangeChange?: (range: LineRange | null) => void;
  onReplaceLines?: (
    startLine: number,
    endLine: number,
    nextLinesText: string,
    opts?: {
      coalesce?: boolean;
      nextFocusLine?: number;
      focusAtStart?: boolean;
    }
  ) => void;
  onToggleCheckbox?: (lineIndex: number) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onIndentLines?: (range: LineRange, direction: 1 | -1) => void;
  onNotify?: (msg: string) => void;
  className?: string;
}

interface InlineRenderOptions {
  customDataDir?: string;
  onZoomImage?: (src: string, alt: string) => void;
}

type TableAlign = "left" | "center" | "right" | undefined;

const MarkdownImage: React.FC<{
  rawSrc: string;
  alt: string;
  customDataDir?: string;
  onZoom?: (src: string, alt: string) => void;
}> = ({ rawSrc, alt, customDataDir, onZoom }) => {
  const immediate = getImmediateMemoImageSrc(rawSrc, customDataDir);
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(immediate);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    const syncSrc = getImmediateMemoImageSrc(rawSrc, customDataDir);
    if (syncSrc !== null) {
      setResolvedSrc(syncSrc);
      return;
    }
    setResolvedSrc(null);
    let cancelled = false;
    resolveMemoImageSrc(rawSrc, customDataDir).then((url) => {
      if (!cancelled) {
        if (url) setResolvedSrc(url);
        else setFailed(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [rawSrc, customDataDir]);

  if (failed) {
    return (
      <span className="my-1.5 inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-surface/60 px-2.5 py-1.5 text-xs text-muted-foreground">
        <ImageOff className="h-3.5 w-3.5 shrink-0" />
        <span className="max-w-[280px] truncate">
          {alt ? `${alt} (${rawSrc})` : rawSrc}
        </span>
      </span>
    );
  }

  if (!resolvedSrc) {
    return (
      <span className="my-2 block h-24 w-44 animate-pulse rounded-md border border-border/50 bg-muted/40" />
    );
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      title="点击放大查看图片"
      onClick={() => onZoom?.(resolvedSrc, alt)}
      onError={() => setFailed(true)}
      className="my-2 max-h-[420px] max-w-full cursor-zoom-in rounded-md border border-border/60 object-contain transition-opacity hover:opacity-95"
      loading="lazy"
    />
  );
};

function renderInline(
  text: string,
  keyPrefix: string,
  opts?: InlineRenderOptions,
  depth = 0
): React.ReactNode[] {
  if (depth > 8) return [text];

  const nodes: React.ReactNode[] = [];
  const tokenRe = new RegExp(INLINE_TOKEN_RE_SOURCE, "gi");
  let lastIndex = 0;
  let matchIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(text)) !== null) {
    if (tokenRe.lastIndex === match.index) {
      tokenRe.lastIndex++;
      continue;
    }
    const nextLastIndex = tokenRe.lastIndex;

    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const lowerToken = token.toLowerCase();
    const key = `${keyPrefix}-${matchIndex++}`;

    if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px] text-foreground"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("![")) {
      const imgMatch = /^!\[([^\]]*)\]\(((?:<[^>\n]+>|[^)\n]+))\)$/.exec(token);
      if (imgMatch && isSafeImageUrl(imgMatch[2])) {
        const cleanTarget = imgMatch[2]
          .trim()
          .replace(/^<+|>+$/g, "")
          .trim();
        nodes.push(
          <MarkdownImage
            key={key}
            rawSrc={cleanTarget}
            alt={imgMatch[1]}
            customDataDir={opts?.customDataDir}
            onZoom={opts?.onZoomImage}
          />
        );
      } else {
        nodes.push(token);
      }
    } else if (token.startsWith("[")) {
      const linkMatch = /^\[([^\]]+)\]\(([^)\n]+)\)$/.exec(token);
      if (linkMatch && isSafeLinkUrl(linkMatch[2])) {
        const href = linkMatch[2].trim();
        nodes.push(
          <a
            key={key}
            href={href}
            onClick={(e) => {
              e.preventDefault();
              openExternalUrl(href).catch(() => {});
            }}
            className="text-primary underline-offset-2 hover:underline"
          >
            {renderInline(linkMatch[1], `${key}-lbl`, opts, depth + 1)}
          </a>
        );
      } else {
        nodes.push(token);
      }
    } else if (token.startsWith("***") && token.endsWith("***")) {
      nodes.push(
        <strong key={key} className="font-semibold italic text-foreground">
          {renderInline(token.slice(3, -3), `${key}-bi`, opts, depth + 1)}
        </strong>
      );
    } else if (
      (token.startsWith("**") && token.endsWith("**")) ||
      (token.startsWith("__") && token.endsWith("__"))
    ) {
      nodes.push(
        <strong key={key} className="font-semibold text-foreground">
          {renderInline(token.slice(2, -2), `${key}-b`, opts, depth + 1)}
        </strong>
      );
    } else if (token.startsWith("~~") && token.endsWith("~~")) {
      nodes.push(
        <del key={key} className="text-muted-foreground line-through">
          {renderInline(token.slice(2, -2), `${key}-s`, opts, depth + 1)}
        </del>
      );
    } else if (token.startsWith("==") && token.endsWith("==")) {
      nodes.push(
        <mark
          key={key}
          className="rounded bg-amber-500/25 px-1 py-0.5 text-foreground"
        >
          {renderInline(token.slice(2, -2), `${key}-hl`, opts, depth + 1)}
        </mark>
      );
    } else if (lowerToken.startsWith("<u>") && lowerToken.endsWith("</u>")) {
      nodes.push(
        <u
          key={key}
          className="underline decoration-primary/75 underline-offset-2"
        >
          {renderInline(token.slice(3, -4), `${key}-u`, opts, depth + 1)}
        </u>
      );
    } else if (
      lowerToken.startsWith("<kbd>") &&
      lowerToken.endsWith("</kbd>")
    ) {
      nodes.push(
        <kbd
          key={key}
          className="mx-0.5 inline-flex items-center rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground shadow-sm"
        >
          {token.slice(5, -6)}
        </kbd>
      );
    } else if (
      lowerToken.startsWith("<sup>") &&
      lowerToken.endsWith("</sup>")
    ) {
      nodes.push(
        <sup key={key} className="text-[10.5px]">
          {renderInline(token.slice(5, -6), `${key}-sup`, opts, depth + 1)}
        </sup>
      );
    } else if (
      lowerToken.startsWith("<sub>") &&
      lowerToken.endsWith("</sub>")
    ) {
      nodes.push(
        <sub key={key} className="text-[10.5px]">
          {renderInline(token.slice(5, -6), `${key}-sub`, opts, depth + 1)}
        </sub>
      );
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(
        <em key={key} className="italic">
          {renderInline(token.slice(1, -1), `${key}-i`, opts, depth + 1)}
        </em>
      );
    } else if (
      (lowerToken.startsWith("http://") || lowerToken.startsWith("https://")) &&
      isSafeLinkUrl(token)
    ) {
      nodes.push(
        <a
          key={key}
          href={token}
          onClick={(e) => {
            e.preventDefault();
            openExternalUrl(token).catch(() => {});
          }}
          className="break-all text-primary underline-offset-2 hover:underline"
        >
          {token}
        </a>
      );
    } else {
      nodes.push(token);
    }

    lastIndex = nextLastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

function splitTableRow(line: string): string[] {
  const placeholder = "\u0000PIPE\u0000";
  const escaped = line.replace(/\\\|/g, placeholder);
  const trimmed = escaped.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed
    .split("|")
    .map((cell) => cell.split(placeholder).join("|").trim());
}

function serializeTableRow(cells: string[], colCount: number): string {
  const normalized: string[] = [];
  for (let i = 0; i < colCount; i++) {
    const raw = (cells[i] ?? "").replace(/\r?\n/g, " ").trim();
    const safe = raw.replace(/(?<!\\)\|/g, "\\|");
    normalized.push(safe);
  }
  return `| ${normalized.join(" | ")} |`;
}

function parseTableSeparator(line: string): TableAlign[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  const cells = splitTableRow(trimmed);
  if (cells.length === 0) return null;
  const aligns: TableAlign[] = [];
  for (const cell of cells) {
    if (!/^:?-{3,}:?$/.test(cell)) return null;
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) aligns.push("center");
    else if (right) aligns.push("right");
    else if (left) aligns.push("left");
    else aligns.push(undefined);
  }
  return aligns;
}

/* -------------------------------------------------------------------------- */
/* Editable Rich Inline Surface                                               */
/* -------------------------------------------------------------------------- */

interface RegisteredEditableSurface {
  id: string;
  el: HTMLElement;
  startLine: number;
  endLine: number;
  applyFormattedMarkdown: (nextInlineMd: string) => void;
}

interface EditableInlineProps {
  surfaceId: string;
  tag?: "div" | "span" | "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  markdown: string;
  startLine: number;
  endLine: number;
  customDataDir?: string;
  singleLine?: boolean;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  onCommit: (nextInlineMd: string, coalesce: boolean) => void;
  onEnterSplit?: (beforeMd: string, afterMd: string) => boolean;
  onBackspaceStart?: (currentMd: string) => boolean;
  onTab?: (shiftKey: boolean) => boolean;
  onActivateRange?: (range: LineRange) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onZoomImage?: (src: string, alt: string) => void;
  registerSurface: (
    id: string,
    surface: RegisteredEditableSurface | null
  ) => void;
  markActiveSurface: (surface: RegisteredEditableSurface) => void;
}

const EditableInline: React.FC<EditableInlineProps> = ({
  surfaceId,
  tag = "div",
  markdown,
  startLine,
  endLine,
  customDataDir,
  singleLine = false,
  placeholder,
  className = "",
  style,
  onCommit,
  onEnterSplit,
  onBackspaceStart,
  onTab,
  onActivateRange,
  onUndo,
  onRedo,
  onZoomImage,
  registerSurface,
  markActiveSurface,
}) => {
  const elRef = useRef<HTMLElement | null>(null);
  const lastDomMdRef = useRef<string | null>(null);
  const composingRef = useRef(false);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  const hydrateAsyncImages = useCallback(
    (host: HTMLElement) => {
      const imgs = host.querySelectorAll<HTMLImageElement>("img[data-md-src]");
      imgs.forEach((img) => {
        const currentSrc = img.getAttribute("src") || "";
        const rawTarget = img.getAttribute("data-md-src") || "";
        if (!currentSrc && rawTarget) {
          resolveMemoImageSrc(rawTarget, customDataDir).then((resolved) => {
            if (resolved && img.isConnected) {
              img.src = resolved;
            }
          });
        }
      });
    },
    [customDataDir]
  );

  useLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;
    if (lastDomMdRef.current !== markdown) {
      el.innerHTML = renderInlineMarkdownToHtml(markdown, customDataDir);
      lastDomMdRef.current = markdown;
      hydrateAsyncImages(el);
    }
  }, [markdown, customDataDir, hydrateAsyncImages]);

  const makeSurfaceEntry = useCallback((): RegisteredEditableSurface | null => {
    const el = elRef.current;
    if (!el) return null;
    return {
      id: surfaceId,
      el,
      startLine,
      endLine,
      applyFormattedMarkdown: (nextInlineMd: string) => {
        const cleanNext = singleLine
          ? nextInlineMd.replace(/\r?\n/g, " ")
          : nextInlineMd;
        el.innerHTML = renderInlineMarkdownToHtml(cleanNext, customDataDir);
        lastDomMdRef.current = cleanNext;
        hydrateAsyncImages(el);
        onCommitRef.current(cleanNext, false);
      },
    };
  }, [surfaceId, startLine, endLine, singleLine, customDataDir, hydrateAsyncImages]);

  useEffect(() => {
    const entry = makeSurfaceEntry();
    if (entry) {
      registerSurface(surfaceId, entry);
      if (document.activeElement === entry.el) {
        markActiveSurface(entry);
      }
    }
    return () => {
      registerSurface(surfaceId, null);
    };
  }, [surfaceId, makeSurfaceEntry, registerSurface, markActiveSurface]);

  const flushDomInput = () => {
    const el = elRef.current;
    if (!el || composingRef.current) return;
    let nextMd = serializeDomToMarkdown(el);
    if (singleLine) {
      nextMd = nextMd.replace(/\r?\n/g, " ");
    }
    if (nextMd !== lastDomMdRef.current) {
      lastDomMdRef.current = nextMd;
      onCommit(nextMd, true);
    }
  };

  const applyShortcutWrap = (
    prefix: string,
    suffix: string,
    wrapPlaceholder: string
  ) => {
    const el = elRef.current;
    if (!el) return;
    const selInfo = getEditableSelectionInMarkdown(el);
    const vis = getVisibleSelectionOffsets(el);
    if (!selInfo) return;
    const res = toggleInlineWrapOnString(
      selInfo.markdown,
      selInfo.start,
      selInfo.end,
      prefix,
      suffix,
      wrapPlaceholder
    );
    const cleanNext = singleLine ? res.next.replace(/\r?\n/g, " ") : res.next;
    el.innerHTML = renderInlineMarkdownToHtml(cleanNext, customDataDir);
    lastDomMdRef.current = cleanNext;
    hydrateAsyncImages(el);
    onCommit(cleanNext, false);
    if (vis) {
      const vEnd = res.insertedPlaceholder
        ? vis.start + wrapPlaceholder.length
        : vis.end;
      restoreVisibleSelectionOffsets(el, vis.start, vEnd);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.nativeEvent.isComposing || composingRef.current) return;
    const el = elRef.current;
    if (!el) return;

    const mod = e.ctrlKey || e.metaKey;
    const keyLower = e.key.toLowerCase();

    if (mod && !e.altKey) {
      if (keyLower === "z" && !e.shiftKey && onUndo) {
        e.preventDefault();
        onUndo();
        return;
      }
      if ((keyLower === "y" || (keyLower === "z" && e.shiftKey)) && onRedo) {
        e.preventDefault();
        onRedo();
        return;
      }
      if (!e.shiftKey && keyLower === "b") {
        e.preventDefault();
        applyShortcutWrap("**", "**", "加粗文本");
        return;
      }
      if (!e.shiftKey && keyLower === "i") {
        e.preventDefault();
        applyShortcutWrap("*", "*", "斜体文本");
        return;
      }
      if (!e.shiftKey && keyLower === "u") {
        e.preventDefault();
        applyShortcutWrap("<u>", "</u>", "下划线");
        return;
      }
      if (!e.shiftKey && keyLower === "e") {
        e.preventDefault();
        applyShortcutWrap("`", "`", "code");
        return;
      }
      if (e.shiftKey && keyLower === "x") {
        e.preventDefault();
        applyShortcutWrap("~~", "~~", "删除线");
        return;
      }
      if (e.shiftKey && keyLower === "h") {
        e.preventDefault();
        applyShortcutWrap("==", "==", "高亮内容");
        return;
      }
    }

    if (e.key === "Tab" && onTab) {
      if (onTab(e.shiftKey)) {
        e.preventDefault();
        return;
      }
    }

    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      !mod &&
      !e.altKey &&
      onEnterSplit
    ) {
      const selInfo = getEditableSelectionInMarkdown(el);
      if (selInfo) {
        const before = selInfo.markdown.slice(0, selInfo.start);
        const after = selInfo.markdown.slice(selInfo.end);
        if (onEnterSplit(before, after)) {
          e.preventDefault();
          return;
        }
      }
    }

    if (e.key === "Backspace" && !mod && !e.altKey && onBackspaceStart) {
      const vis = getVisibleSelectionOffsets(el);
      if (vis && vis.start === 0 && vis.end === 0) {
        const curMd = serializeDomToMarkdown(el);
        if (onBackspaceStart(curMd)) {
          e.preventDefault();
          return;
        }
      }
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLElement>) => {
    const dt = e.clipboardData;
    if (!dt) return;
    // Let image pastes bubble up to MemosView's image paste handler
    for (let i = 0; i < (dt.items?.length ?? 0); i++) {
      if (dt.items[i].type.startsWith("image/")) {
        return;
      }
    }
    for (let i = 0; i < (dt.files?.length ?? 0); i++) {
      if (dt.files[i].type.startsWith("image/")) {
        return;
      }
    }
    // Insert clean plain text so external HTML styles never corrupt Markdown
    e.preventDefault();
    const rawText = dt.getData("text/plain");
    if (!rawText) return;
    const cleanText = singleLine
      ? rawText.replace(/\r?\n/g, " ")
      : rawText.replace(/\r\n?/g, "\n");

    const el = elRef.current;
    if (!el) return;
    const selInfo = getEditableSelectionInMarkdown(el);
    const vis = getVisibleSelectionOffsets(el);
    const baseMd = selInfo ? selInfo.markdown : serializeDomToMarkdown(el);
    const s = selInfo ? selInfo.start : baseMd.length;
    const endPos = selInfo ? selInfo.end : s;
    const nextMd = baseMd.slice(0, s) + cleanText + baseMd.slice(endPos);

    el.innerHTML = renderInlineMarkdownToHtml(nextMd, customDataDir);
    lastDomMdRef.current = nextMd;
    hydrateAsyncImages(el);
    onCommit(nextMd, false);

    if (vis) {
      const nextCaret = vis.start + cleanText.length;
      restoreVisibleSelectionOffsets(el, nextCaret, nextCaret);
    }
  };

  const handleClick = (e: React.MouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (target instanceof HTMLImageElement) {
      const src = target.currentSrc || target.src;
      if (src) {
        e.preventDefault();
        e.stopPropagation();
        onZoomImage?.(src, target.alt || "");
        return;
      }
    }
    const anchor = target.closest("a[data-md-href]") as HTMLAnchorElement | null;
    if (anchor) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const href = anchor.getAttribute("data-md-href") || anchor.href;
        if (href) openExternalUrl(href).catch(() => {});
      }
    }
  };

  const handleFocusOrSelect = () => {
    const entry = makeSurfaceEntry();
    if (entry) markActiveSurface(entry);
    onActivateRange?.({ startLine, endLine });
  };

  const Tag = tag as React.ElementType;

  return (
    <Tag
      ref={elRef}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      data-empty={!markdown ? "true" : undefined}
      data-placeholder={placeholder}
      onFocus={handleFocusOrSelect}
      onMouseUp={handleFocusOrSelect}
      onKeyUp={handleFocusOrSelect}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={() => {
        composingRef.current = false;
        flushDomInput();
      }}
      onInput={flushDomInput}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onClick={handleClick}
      style={style}
      className={`outline-none focus:outline-none empty:before:pointer-events-none empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground/45 ${className}`}
    />
  );
};

/* -------------------------------------------------------------------------- */
/* CodeBlock (Read-only or Editable)                                          */
/* -------------------------------------------------------------------------- */

const CodeBlock: React.FC<{
  lang: string;
  code: string;
  editable?: boolean;
  highlighted?: boolean;
  startLine: number;
  endLine: number;
  onActivate?: () => void;
  onHover?: (hovering: boolean) => void;
  onChangeCode?: (nextCode: string) => void;
  onNotify?: (msg: string) => void;
}> = ({
  lang,
  code,
  editable = false,
  highlighted = false,
  onActivate,
  onHover,
  onChangeCode,
  onNotify,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    onNotify?.("已复制代码块");
    window.setTimeout(() => setCopied(false), 1600);
  };

  const lineCount = Math.max(1, code.split("\n").length);

  return (
    <div
      data-hl-active={highlighted ? "true" : undefined}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      className={`my-2.5 overflow-hidden rounded-md border transition-colors ${
        highlighted
          ? "border-border bg-foreground/[0.035]"
          : "border-border bg-surface/65"
      }`}
    >
      <div className="flex items-center justify-between border-b border-border/60 bg-surface px-3 py-1 text-[11px] text-muted-foreground">
        <span className="font-mono">{lang || "code"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-500" />
              <span>已复制</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>复制</span>
            </>
          )}
        </button>
      </div>
      {editable && onChangeCode ? (
        <textarea
          value={code}
          rows={lineCount}
          spellCheck={false}
          onFocus={onActivate}
          onClick={onActivate}
          onChange={(e) => onChangeCode(e.target.value)}
          className="block w-full resize-none overflow-x-auto bg-transparent p-3 font-mono text-[12.5px] leading-relaxed text-foreground focus:outline-none"
        />
      ) : (
        <pre className="overflow-x-auto p-3 font-mono text-[12.5px] leading-relaxed text-foreground">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
};

function isBlockStart(lines: string[], idx: number): boolean {
  const line = lines[idx];
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (/^```/.test(trimmed)) return true;
  if (/^<details(?:\s|>|$)/i.test(trimmed)) return true;
  if (/^#{1,6}\s+/.test(line)) return true;
  if (/^>\s?/.test(line)) return true;
  if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(trimmed)) return true;
  if (/^\s*[-*+]\s+/.test(line)) return true;
  if (/^\s*\d+\.\s+/.test(line)) return true;
  if (
    idx + 1 < lines.length &&
    line.includes("|") &&
    parseTableSeparator(lines[idx + 1]) !== null
  ) {
    return true;
  }
  return false;
}

type CalloutKind = "note" | "tip" | "important" | "warning" | "caution";

const CALLOUT_STYLES: Record<
  CalloutKind,
  {
    label: string;
    boxClass: string;
    titleClass: string;
    Icon: React.ComponentType<{ className?: string }>;
  }
> = {
  note: {
    label: "备注",
    boxClass: "border-sky-500/45 bg-sky-500/8",
    titleClass: "text-sky-500",
    Icon: Info,
  },
  tip: {
    label: "技巧",
    boxClass: "border-emerald-500/45 bg-emerald-500/8",
    titleClass: "text-emerald-500",
    Icon: Sparkles,
  },
  important: {
    label: "重要",
    boxClass: "border-primary/50 bg-primary/8",
    titleClass: "text-primary",
    Icon: ShieldAlert,
  },
  warning: {
    label: "注意",
    boxClass: "border-amber-500/50 bg-amber-500/8",
    titleClass: "text-amber-500",
    Icon: AlertTriangle,
  },
  caution: {
    label: "警告",
    boxClass: "border-rose-500/50 bg-rose-500/8",
    titleClass: "text-rose-500",
    Icon: AlertTriangle,
  },
};

const HL_BLOCK_CLASS =
  "-mx-2 rounded-md bg-foreground/[0.045] px-2 transition-colors";
const IDLE_BLOCK_CLASS = "-mx-2 rounded-md px-2 transition-colors";

export const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({
  content,
  customDataDir,
  baseLineOffset = 0,
  editable = false,
  editorHandleRef,
  highlightRange = null,
  autoScrollHighlight = false,
  onActiveRangeChange,
  onHoverRangeChange,
  onReplaceLines,
  onToggleCheckbox,
  onUndo,
  onRedo,
  onIndentLines,
  onNotify,
  className = "",
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const surfacesRef = useRef<Map<string, RegisteredEditableSurface>>(new Map());
  const activeSurfaceRef = useRef<RegisteredEditableSurface | null>(null);
  const pendingFocusRef = useRef<{
    line: number;
    placeAtStart: boolean;
  } | null>(null);

  const [zoomImage, setZoomImage] = useState<{
    src: string;
    alt: string;
  } | null>(null);

  const registerSurface = useCallback(
    (id: string, surface: RegisteredEditableSurface | null) => {
      if (surface) {
        surfacesRef.current.set(id, surface);
      } else {
        surfacesRef.current.delete(id);
        if (activeSurfaceRef.current?.id === id) {
          activeSurfaceRef.current = null;
        }
      }
    },
    []
  );

  const markActiveSurface = useCallback(
    (surface: RegisteredEditableSurface) => {
      activeSurfaceRef.current = surface;
    },
    []
  );

  const focusLine = useCallback((targetLine: number, placeAtStart = false) => {
    let best: RegisteredEditableSurface | null = null;
    surfacesRef.current.forEach((surf) => {
      if (targetLine >= surf.startLine && targetLine <= surf.endLine) {
        if (!best || surf.endLine - surf.startLine < best.endLine - best.startLine) {
          best = surf;
        }
      }
    });
    const found = best as RegisteredEditableSurface | null;
    if (found && found.el.isConnected) {
      activeSurfaceRef.current = found;
      const textLen = (found.el.textContent || "").length;
      const pos = placeAtStart ? 0 : textLen;
      restoreVisibleSelectionOffsets(found.el, pos, pos);
      onActiveRangeChange?.({
        startLine: found.startLine,
        endLine: found.endLine,
      });
    }
  }, [onActiveRangeChange]);

  useLayoutEffect(() => {
    if (!pendingFocusRef.current) return;
    const req = pendingFocusRef.current;
    pendingFocusRef.current = null;
    focusLine(req.line, req.placeAtStart);
  });

  useEffect(() => {
    if (!editorHandleRef) return;
    editorHandleRef.current = {
      applyInlineWrap: (prefix, suffix, placeholder) => {
        const surf = activeSurfaceRef.current;
        if (!surf || !surf.el.isConnected) return false;
        const selInfo = getEditableSelectionInMarkdown(surf.el);
        const vis = getVisibleSelectionOffsets(surf.el);
        const baseMd = selInfo ? selInfo.markdown : serializeDomToMarkdown(surf.el);
        const s = selInfo ? selInfo.start : baseMd.length;
        const e = selInfo ? selInfo.end : s;
        const res = toggleInlineWrapOnString(
          baseMd,
          s,
          e,
          prefix,
          suffix,
          placeholder
        );
        surf.applyFormattedMarkdown(res.next);
        if (vis) {
          const vEnd = res.insertedPlaceholder
            ? vis.start + placeholder.length
            : vis.end;
          restoreVisibleSelectionOffsets(surf.el, vis.start, vEnd);
        } else {
          const endLen = (surf.el.textContent || "").length;
          restoreVisibleSelectionOffsets(surf.el, endLen, endLen);
        }
        return true;
      },
      insertSmartLink: () => {
        const surf = activeSurfaceRef.current;
        if (!surf || !surf.el.isConnected) return false;
        const selInfo = getEditableSelectionInMarkdown(surf.el);
        const vis = getVisibleSelectionOffsets(surf.el);
        const baseMd = selInfo ? selInfo.markdown : serializeDomToMarkdown(surf.el);
        const s = selInfo ? selInfo.start : baseMd.length;
        const e = selInfo ? selInfo.end : s;
        const selected = baseMd.slice(s, e).trim();

        let nextMd: string;
        const visStart = vis ? vis.start : (surf.el.textContent || "").length;
        let visEnd = visStart;

        if (/^https?:\/\/\S+$/i.test(selected)) {
          const label = "链接文字";
          nextMd = `${baseMd.slice(0, s)}[${label}](${selected})${baseMd.slice(e)}`;
          visEnd = visStart + label.length;
        } else if (selected) {
          nextMd = `${baseMd.slice(0, s)}[${selected}](https://)${baseMd.slice(e)}`;
          visEnd = visStart + selected.length;
        } else {
          const label = "链接文字";
          nextMd = `${baseMd.slice(0, s)}[${label}](https://)${baseMd.slice(e)}`;
          visEnd = visStart + label.length;
        }

        surf.applyFormattedMarkdown(nextMd);
        restoreVisibleSelectionOffsets(surf.el, visStart, visEnd);
        return true;
      },
      insertInlineSnippet: (snippet) => {
        const surf = activeSurfaceRef.current;
        if (!surf || !surf.el.isConnected) return false;
        const selInfo = getEditableSelectionInMarkdown(surf.el);
        const vis = getVisibleSelectionOffsets(surf.el);
        const baseMd = selInfo ? selInfo.markdown : serializeDomToMarkdown(surf.el);
        const s = selInfo ? selInfo.start : baseMd.length;
        const e = selInfo ? selInfo.end : s;
        const nextMd = baseMd.slice(0, s) + snippet + baseMd.slice(e);
        surf.applyFormattedMarkdown(nextMd);
        const nextCaret = (vis ? vis.start : (surf.el.textContent || "").length) + snippet.length;
        restoreVisibleSelectionOffsets(surf.el, nextCaret, nextCaret);
        return true;
      },
      focusLine,
    };
    return () => {
      editorHandleRef.current = null;
    };
  }, [editorHandleRef, focusLine]);

  useEffect(() => {
    if (!zoomImage) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setZoomImage(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [zoomImage]);

  useEffect(() => {
    if (!autoScrollHighlight || !highlightRange || !rootRef.current) return;
    const targetEl = rootRef.current.querySelector<HTMLElement>(
      '[data-hl-active="true"]'
    );
    if (targetEl) {
      targetEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [
    autoScrollHighlight,
    highlightRange?.startLine,
    highlightRange?.endLine,
  ]);

  const inlineOpts: InlineRenderOptions = {
    customDataDir,
    onZoomImage: (src, alt) => setZoomImage({ src, alt }),
  };

  const isRangeHighlighted = (gStart: number, gEnd: number): boolean => {
    if (!highlightRange) return false;
    return (
      gStart <= highlightRange.endLine && gEnd >= highlightRange.startLine
    );
  };

  const replaceAndFocus = (
    gStart: number,
    gEnd: number,
    nextText: string,
    opts?: { coalesce?: boolean; focusLine?: number; focusAtStart?: boolean }
  ) => {
    if (opts?.focusLine !== undefined) {
      pendingFocusRef.current = {
        line: opts.focusLine,
        placeAtStart: opts.focusAtStart ?? true,
      };
    }
    onReplaceLines?.(gStart, gEnd, nextText, {
      coalesce: opts?.coalesce,
      nextFocusLine: opts?.focusLine,
      focusAtStart: opts?.focusAtStart,
    });
  };

  // Empty document state
  if (!content.trim()) {
    if (editable && onReplaceLines) {
      const gLine = baseLineOffset;
      const hl = isRangeHighlighted(gLine, gLine);
      return (
        <div
          ref={rootRef}
          className={`min-h-full select-text ${className}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              focusLine(gLine, true);
            }
          }}
        >
          <div
            data-hl-active={hl ? "true" : undefined}
            className={hl ? HL_BLOCK_CLASS : IDLE_BLOCK_CLASS}
          >
            <EditableInline
              surfaceId={`empty-${gLine}`}
              tag="p"
              markdown={content}
              startLine={gLine}
              endLine={gLine}
              customDataDir={customDataDir}
              placeholder="点击此处直接输入文字，支持上方工具栏排版与 Ctrl+V 粘贴图片..."
              className="my-1 min-h-[1.75rem] text-[13.5px] leading-relaxed text-foreground/95"
              onCommit={(nextMd, coalesce) =>
                replaceAndFocus(gLine, gLine, nextMd, { coalesce })
              }
              onActivateRange={onActiveRangeChange}
              onUndo={onUndo}
              onRedo={onRedo}
              onZoomImage={(src, alt) => setZoomImage({ src, alt })}
              registerSurface={registerSurface}
              markActiveSurface={markActiveSurface}
            />
          </div>
        </div>
      );
    }

    return (
      <div
        ref={rootRef}
        className={`flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground ${className}`}
      >
        暂无正文内容，可在「编辑」或「分栏」中输入 Markdown（支持 Ctrl+V 粘贴图片）
      </div>
    );
  }

  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 1. Blank line
    if (!trimmed) {
      i++;
      continue;
    }

    // 2. Fenced code block
    const fenceMatch = /^```([^\s`]*)\s*$/.exec(trimmed);
    if (fenceMatch) {
      const lang = fenceMatch[1] || "";
      const startIdx = i;
      const openFenceLine = lines[i];
      i++;
      const codeLines: string[] = [];
      let hasClosingFence = false;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) {
        hasClosingFence = true;
        i++;
      }
      const endIdx = i - 1;
      const gStart = baseLineOffset + startIdx;
      const gEnd = baseLineOffset + endIdx;
      const hl = isRangeHighlighted(gStart, gEnd);

      blocks.push(
        <CodeBlock
          key={`code-${startIdx}`}
          lang={lang}
          code={codeLines.join("\n")}
          editable={editable && Boolean(onReplaceLines)}
          highlighted={hl}
          startLine={gStart}
          endLine={gEnd}
          onActivate={() =>
            onActiveRangeChange?.({ startLine: gStart, endLine: gEnd })
          }
          onHover={(hovering) =>
            onHoverRangeChange?.(
              hovering ? { startLine: gStart, endLine: gEnd } : null
            )
          }
          onChangeCode={
            editable && onReplaceLines
              ? (nextCode) => {
                  const rebuilt = hasClosingFence
                    ? `${openFenceLine}\n${nextCode}\n\`\`\``
                    : `${openFenceLine}\n${nextCode}`;
                  replaceAndFocus(gStart, gEnd, rebuilt, { coalesce: true });
                }
              : undefined
          }
          onNotify={onNotify}
        />
      );
      continue;
    }

    // 2.5. Collapsible <details> block
    if (/^<details(?:\s+open)?\s*>/i.test(trimmed)) {
      const startIdx = i;
      const defaultOpen = /^<details\s+open\s*>/i.test(trimmed);
      let summaryText = "展开查看详情";
      let summaryLineIdx: number | null = null;
      const inlineSummary = /<summary>(.*?)<\/summary>/i.exec(line);
      if (inlineSummary) {
        summaryText = inlineSummary[1].trim() || summaryText;
      }
      i++;
      let depthCount = 1;
      let bodyStartIdx = i;
      const bodyLines: string[] = [];

      while (i < lines.length && depthCount > 0) {
        const curTrim = lines[i].trim();
        if (/^<details(?:\s|>|$)/i.test(curTrim)) {
          depthCount++;
          bodyLines.push(lines[i]);
          i++;
          continue;
        }
        if (/^<\/details>/i.test(curTrim)) {
          depthCount--;
          i++;
          if (depthCount === 0) break;
          bodyLines.push(lines[i - 1]);
          continue;
        }
        if (
          depthCount === 1 &&
          bodyLines.length === 0 &&
          /^<summary>(.*?)<\/summary>\s*$/i.test(curTrim)
        ) {
          const m = /^<summary>(.*?)<\/summary>\s*$/i.exec(curTrim);
          if (m && m[1].trim()) summaryText = m[1].trim();
          summaryLineIdx = i;
          i++;
          bodyStartIdx = i;
          continue;
        }
        bodyLines.push(lines[i]);
        i++;
      }

      const endIdx = i - 1;
      const gStart = baseLineOffset + startIdx;
      const gEnd = baseLineOffset + endIdx;
      const hl = isRangeHighlighted(gStart, gEnd);

      blocks.push(
        <details
          key={`det-${startIdx}`}
          open={defaultOpen}
          data-hl-active={hl ? "true" : undefined}
          onMouseEnter={() =>
            onHoverRangeChange?.({ startLine: gStart, endLine: gEnd })
          }
          onMouseLeave={() => onHoverRangeChange?.(null)}
          className={`group/det my-2.5 overflow-hidden rounded-md border transition-colors ${
            hl ? "border-border bg-foreground/[0.04]" : "border-border bg-surface/40"
          }`}
        >
          <summary className="flex cursor-pointer list-none select-none items-center gap-1.5 px-3 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-accent/45 [&::-webkit-details-marker]:hidden">
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open/det:rotate-90" />
            {editable && onReplaceLines && summaryLineIdx !== null ? (
              <span
                onClick={(e) => e.stopPropagation()}
                className="min-w-0 flex-1 cursor-text"
              >
                <EditableInline
                  surfaceId={`det-sum-${baseLineOffset + summaryLineIdx}`}
                  tag="span"
                  singleLine
                  markdown={summaryText}
                  startLine={baseLineOffset + summaryLineIdx}
                  endLine={baseLineOffset + summaryLineIdx}
                  customDataDir={customDataDir}
                  onCommit={(nextMd, coalesce) =>
                    replaceAndFocus(
                      baseLineOffset + summaryLineIdx!,
                      baseLineOffset + summaryLineIdx!,
                      `<summary>${nextMd}</summary>`,
                      { coalesce }
                    )
                  }
                  onActivateRange={onActiveRangeChange}
                  onUndo={onUndo}
                  onRedo={onRedo}
                  onZoomImage={(src, alt) => setZoomImage({ src, alt })}
                  registerSurface={registerSurface}
                  markActiveSurface={markActiveSurface}
                />
              </span>
            ) : (
              <span>
                {renderInline(summaryText, `det-sum-${startIdx}`, inlineOpts)}
              </span>
            )}
          </summary>
          {bodyLines.length > 0 && (
            <div className="border-t border-border/60 bg-background/50 px-3.5 py-2.5">
              <MarkdownPreview
                content={bodyLines.join("\n")}
                customDataDir={customDataDir}
                baseLineOffset={baseLineOffset + bodyStartIdx}
                editable={editable}
                highlightRange={highlightRange}
                onActiveRangeChange={onActiveRangeChange}
                onHoverRangeChange={onHoverRangeChange}
                onReplaceLines={onReplaceLines}
                onToggleCheckbox={onToggleCheckbox}
                onUndo={onUndo}
                onRedo={onRedo}
                onIndentLines={onIndentLines}
                onNotify={onNotify}
              />
            </div>
          )}
        </details>
      );
      continue;
    }

    // 3. Heading
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      const hashes = headingMatch[1];
      const text = headingMatch[2];
      const lineIdx = i;
      const gLine = baseLineOffset + lineIdx;
      const hl = isRangeHighlighted(gLine, gLine);
      const key = `h-${lineIdx}`;

      const headingCls =
        level === 1
          ? "mt-4 mb-2 text-lg font-semibold tracking-[-0.015em] text-foreground first:mt-0"
          : level === 2
          ? "mt-4 mb-2 border-b border-border/50 pb-1 text-[15px] font-semibold tracking-[-0.01em] text-foreground first:mt-0"
          : level === 3
          ? "mt-3 mb-1.5 text-[14px] font-semibold text-foreground first:mt-0"
          : level === 4
          ? "mt-2.5 mb-1 text-[13.5px] font-semibold text-foreground/95 first:mt-0"
          : level === 5
          ? "mt-2 mb-1 text-[12.5px] font-semibold text-foreground/85 first:mt-0"
          : "mt-2 mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground first:mt-0";

      const tagName = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

      if (editable && onReplaceLines) {
        blocks.push(
          <div
            key={key}
            data-hl-active={hl ? "true" : undefined}
            onMouseEnter={() =>
              onHoverRangeChange?.({ startLine: gLine, endLine: gLine })
            }
            onMouseLeave={() => onHoverRangeChange?.(null)}
            className={hl ? HL_BLOCK_CLASS : IDLE_BLOCK_CLASS}
          >
            <EditableInline
              surfaceId={`h-${gLine}`}
              tag={tagName}
              singleLine
              markdown={text}
              startLine={gLine}
              endLine={gLine}
              customDataDir={customDataDir}
              placeholder={`H${level} 标题`}
              className={headingCls}
              onCommit={(nextMd, coalesce) =>
                replaceAndFocus(gLine, gLine, `${hashes} ${nextMd}`, {
                  coalesce,
                })
              }
              onEnterSplit={(before, after) => {
                replaceAndFocus(
                  gLine,
                  gLine,
                  `${hashes} ${before}\n${after}`,
                  { focusLine: gLine + 1, focusAtStart: true }
                );
                return true;
              }}
              onBackspaceStart={(curMd) => {
                replaceAndFocus(gLine, gLine, curMd, {
                  focusLine: gLine,
                  focusAtStart: true,
                });
                return true;
              }}
              onActivateRange={onActiveRangeChange}
              onUndo={onUndo}
              onRedo={onRedo}
              onZoomImage={(src, alt) => setZoomImage({ src, alt })}
              registerSurface={registerSurface}
              markActiveSurface={markActiveSurface}
            />
          </div>
        );
      } else {
        const HeadingTag = tagName;
        blocks.push(
          <div
            key={key}
            data-hl-active={hl ? "true" : undefined}
            className={hl ? HL_BLOCK_CLASS : undefined}
          >
            <HeadingTag className={headingCls}>
              {renderInline(text, key, inlineOpts)}
            </HeadingTag>
          </div>
        );
      }
      i++;
      continue;
    }

    // 4. Horizontal rule
    if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(trimmed)) {
      const gLine = baseLineOffset + i;
      const hl = isRangeHighlighted(gLine, gLine);
      blocks.push(
        <div
          key={`hr-${i}`}
          data-hl-active={hl ? "true" : undefined}
          onClick={() =>
            onActiveRangeChange?.({ startLine: gLine, endLine: gLine })
          }
          onMouseEnter={() =>
            onHoverRangeChange?.({ startLine: gLine, endLine: gLine })
          }
          onMouseLeave={() => onHoverRangeChange?.(null)}
          className={`py-1 ${hl ? HL_BLOCK_CLASS : IDLE_BLOCK_CLASS}`}
        >
          <hr className="my-2 border-border/70" />
        </div>
      );
      i++;
      continue;
    }

    // 5. GFM Table
    if (i + 1 < lines.length && line.includes("|")) {
      const aligns = parseTableSeparator(lines[i + 1]);
      if (aligns) {
        const startIdx = i;
        const headers = splitTableRow(line);
        i += 2;
        const rows: { lineIdx: number; cells: string[] }[] = [];
        while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
          rows.push({ lineIdx: i, cells: splitTableRow(lines[i]) });
          i++;
        }
        const endIdx = i - 1;
        const gStart = baseLineOffset + startIdx;
        const gEnd = baseLineOffset + endIdx;
        const gHeaderLine = baseLineOffset + startIdx;
        const colCount = Math.max(headers.length, aligns.length);
        const tableHl = isRangeHighlighted(gStart, gEnd);

        blocks.push(
          <div
            key={`tbl-${startIdx}`}
            data-hl-active={tableHl ? "true" : undefined}
            onMouseEnter={() =>
              onHoverRangeChange?.({ startLine: gStart, endLine: gEnd })
            }
            onMouseLeave={() => onHoverRangeChange?.(null)}
            className="my-2.5 overflow-x-auto rounded-md border border-border transition-colors"
          >
            <table className="w-full border-collapse text-left text-[12.5px]">
              <thead className="bg-surface/70">
                <tr
                  className={`border-b border-border transition-colors ${
                    isRangeHighlighted(gHeaderLine, gHeaderLine)
                      ? "bg-foreground/[0.045]"
                      : ""
                  }`}
                >
                  {headers.map((h, colIdx) => (
                    <th
                      key={colIdx}
                      style={{ textAlign: aligns[colIdx] }}
                      className="px-3 py-1.5 font-semibold text-foreground"
                    >
                      {editable && onReplaceLines ? (
                        <EditableInline
                          surfaceId={`th-${gHeaderLine}-${colIdx}`}
                          tag="div"
                          singleLine
                          markdown={h}
                          startLine={gHeaderLine}
                          endLine={gHeaderLine}
                          customDataDir={customDataDir}
                          placeholder="列名"
                          onCommit={(nextCell, coalesce) => {
                            const nextHeaders = [...headers];
                            nextHeaders[colIdx] = nextCell;
                            replaceAndFocus(
                              gHeaderLine,
                              gHeaderLine,
                              serializeTableRow(nextHeaders, colCount),
                              { coalesce }
                            );
                          }}
                          onActivateRange={onActiveRangeChange}
                          onUndo={onUndo}
                          onRedo={onRedo}
                          onZoomImage={(src, alt) => setZoomImage({ src, alt })}
                          registerSurface={registerSurface}
                          markActiveSurface={markActiveSurface}
                        />
                      ) : (
                        renderInline(h, `th-${startIdx}-${colIdx}`, inlineOpts)
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.map((rowObj, rowIdx) => {
                  const gRowLine = baseLineOffset + rowObj.lineIdx;
                  const rowHl = isRangeHighlighted(gRowLine, gRowLine);
                  return (
                    <tr
                      key={rowIdx}
                      className={`transition-colors ${
                        rowHl ? "bg-foreground/[0.045]" : "hover:bg-surface/35"
                      }`}
                    >
                      {headers.map((_, colIdx) => (
                        <td
                          key={colIdx}
                          style={{ textAlign: aligns[colIdx] }}
                          className="px-3 py-1.5 text-foreground/90"
                        >
                          {editable && onReplaceLines ? (
                            <EditableInline
                              surfaceId={`td-${gRowLine}-${colIdx}`}
                              tag="div"
                              singleLine
                              markdown={rowObj.cells[colIdx] ?? ""}
                              startLine={gRowLine}
                              endLine={gRowLine}
                              customDataDir={customDataDir}
                              placeholder=" "
                              onCommit={(nextCell, coalesce) => {
                                const nextCells = [...rowObj.cells];
                                while (nextCells.length < colCount) {
                                  nextCells.push("");
                                }
                                nextCells[colIdx] = nextCell;
                                replaceAndFocus(
                                  gRowLine,
                                  gRowLine,
                                  serializeTableRow(nextCells, colCount),
                                  { coalesce }
                                );
                              }}
                              onEnterSplit={() => {
                                if (rowIdx === rows.length - 1) {
                                  const curLineText = lines[rowObj.lineIdx];
                                  const emptyRow = serializeTableRow(
                                    Array(colCount).fill(""),
                                    colCount
                                  );
                                  replaceAndFocus(
                                    gRowLine,
                                    gRowLine,
                                    `${curLineText}\n${emptyRow}`,
                                    {
                                      focusLine: gRowLine + 1,
                                      focusAtStart: true,
                                    }
                                  );
                                } else {
                                  focusLine(gRowLine + 1, true);
                                }
                                return true;
                              }}
                              onActivateRange={onActiveRangeChange}
                              onUndo={onUndo}
                              onRedo={onRedo}
                              onZoomImage={(src, alt) =>
                                setZoomImage({ src, alt })
                              }
                              registerSurface={registerSurface}
                              markActiveSurface={markActiveSurface}
                            />
                          ) : (
                            renderInline(
                              rowObj.cells[colIdx] ?? "",
                              `td-${startIdx}-${rowIdx}-${colIdx}`,
                              inlineOpts
                            )
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
        continue;
      }
    }

    // 6. Blockquote & GFM Alerts / Callouts
    if (/^>\s?/.test(line)) {
      const startIdx = i;
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      const endIdx = i - 1;
      const gStart = baseLineOffset + startIdx;
      const gEnd = baseLineOffset + endIdx;
      const bqHl = isRangeHighlighted(gStart, gEnd);

      const calloutMatch =
        /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s+(.*))?$/i.exec(
          (quoteLines[0] ?? "").trim()
        );
      if (calloutMatch) {
        const rawKind = calloutMatch[1].toUpperCase();
        const kind = rawKind.toLowerCase() as CalloutKind;
        const customTitle = calloutMatch[2]?.trim() ?? "";
        const cfg = CALLOUT_STYLES[kind];
        const CalloutIcon = cfg.Icon;
        const bodyLines = quoteLines.slice(1);
        const bodyMd = bodyLines.join("\n");
        const gBodyStart = gStart + 1;
        const gBodyEnd = Math.max(gBodyStart, gEnd);

        blocks.push(
          <div
            key={`callout-${startIdx}`}
            data-hl-active={bqHl ? "true" : undefined}
            onMouseEnter={() =>
              onHoverRangeChange?.({ startLine: gStart, endLine: gEnd })
            }
            onMouseLeave={() => onHoverRangeChange?.(null)}
            className={`my-2.5 rounded-r-md border-l-[3px] px-3.5 py-2.5 text-[13px] leading-relaxed transition-colors ${
              cfg.boxClass
            }`}
          >
            <div
              className={`flex items-center gap-1.5 text-xs font-semibold ${cfg.titleClass}`}
            >
              <CalloutIcon className="h-3.5 w-3.5 shrink-0" />
              {editable && onReplaceLines ? (
                <EditableInline
                  surfaceId={`co-title-${gStart}`}
                  tag="span"
                  singleLine
                  markdown={customTitle || cfg.label}
                  startLine={gStart}
                  endLine={gStart}
                  customDataDir={customDataDir}
                  onCommit={(nextTitle, coalesce) => {
                    const trimmedTitle = nextTitle.trim();
                    const headerLine =
                      trimmedTitle && trimmedTitle !== cfg.label
                        ? `> [!${rawKind}] ${trimmedTitle}`
                        : `> [!${rawKind}]`;
                    replaceAndFocus(gStart, gStart, headerLine, { coalesce });
                  }}
                  onActivateRange={onActiveRangeChange}
                  onUndo={onUndo}
                  onRedo={onRedo}
                  onZoomImage={(src, alt) => setZoomImage({ src, alt })}
                  registerSurface={registerSurface}
                  markActiveSurface={markActiveSurface}
                />
              ) : (
                <span>{customTitle || cfg.label}</span>
              )}
            </div>
            {editable && onReplaceLines ? (
              <div className="mt-1 text-foreground/90">
                <EditableInline
                  surfaceId={`co-body-${gStart}`}
                  tag="div"
                  markdown={bodyMd}
                  startLine={bodyLines.length > 0 ? gBodyStart : gStart}
                  endLine={gEnd}
                  customDataDir={customDataDir}
                  placeholder="输入提示内容..."
                  onCommit={(nextMd, coalesce) => {
                    const quotedBody = nextMd
                      .split("\n")
                      .map((l) => `> ${l}`)
                      .join("\n");
                    if (bodyLines.length > 0) {
                      replaceAndFocus(gBodyStart, gEnd, quotedBody, {
                        coalesce,
                      });
                    } else {
                      replaceAndFocus(
                        gStart,
                        gStart,
                        `${lines[startIdx]}\n${quotedBody}`,
                        { coalesce }
                      );
                    }
                  }}
                  onActivateRange={onActiveRangeChange}
                  onUndo={onUndo}
                  onRedo={onRedo}
                  onZoomImage={(src, alt) => setZoomImage({ src, alt })}
                  registerSurface={registerSurface}
                  markActiveSurface={markActiveSurface}
                />
              </div>
            ) : (
              bodyLines.length > 0 && (
                <div className="mt-1 text-foreground/90">
                  {bodyLines.map((ql, qIdx) => (
                    <React.Fragment key={qIdx}>
                      {qIdx > 0 && <br />}
                      {renderInline(ql, `co-${startIdx}-${qIdx}`, inlineOpts)}
                    </React.Fragment>
                  ))}
                </div>
              )
            )}
          </div>
        );
        continue;
      }

      blocks.push(
        <blockquote
          key={`bq-${startIdx}`}
          data-hl-active={bqHl ? "true" : undefined}
          onMouseEnter={() =>
            onHoverRangeChange?.({ startLine: gStart, endLine: gEnd })
          }
          onMouseLeave={() => onHoverRangeChange?.(null)}
          className={`my-2 rounded-r-md border-l-2 border-primary/50 py-1.5 pl-3 pr-2 text-[13px] leading-relaxed text-muted-foreground transition-colors ${
            bqHl ? "bg-foreground/[0.05]" : "bg-surface/50"
          }`}
        >
          {editable && onReplaceLines ? (
            <EditableInline
              surfaceId={`bq-${gStart}`}
              tag="div"
              markdown={quoteLines.join("\n")}
              startLine={gStart}
              endLine={gEnd}
              customDataDir={customDataDir}
              placeholder="输入引用文字..."
              onCommit={(nextMd, coalesce) => {
                const quoted = nextMd
                  .split("\n")
                  .map((l) => `> ${l}`)
                  .join("\n");
                replaceAndFocus(gStart, gEnd, quoted, { coalesce });
              }}
              onBackspaceStart={(curMd) => {
                if (gStart === gEnd) {
                  replaceAndFocus(gStart, gEnd, curMd, {
                    focusLine: gStart,
                    focusAtStart: true,
                  });
                  return true;
                }
                return false;
              }}
              onActivateRange={onActiveRangeChange}
              onUndo={onUndo}
              onRedo={onRedo}
              onZoomImage={(src, alt) => setZoomImage({ src, alt })}
              registerSurface={registerSurface}
              markActiveSurface={markActiveSurface}
            />
          ) : (
            quoteLines.map((ql, qIdx) => (
              <React.Fragment key={qIdx}>
                {qIdx > 0 && <br />}
                {renderInline(ql, `bq-${startIdx}-${qIdx}`, inlineOpts)}
              </React.Fragment>
            ))
          )}
        </blockquote>
      );
      continue;
    }

    // 7. Lists (task / unordered / ordered)
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const startIdx = i;
      const listItems: {
        lineIndex: number;
        rawIndent: string;
        indent: number;
        kind: "task" | "ul" | "ol";
        bulletPrefix: string;
        checked?: boolean;
        marker?: string;
        orderNum?: number;
        text: string;
      }[] = [];

      while (i < lines.length) {
        const cur = lines[i];
        const taskMatch = /^(\s*)([-*+]\s+\[([ xX])\]\s*)(.*)$/.exec(cur);
        if (taskMatch) {
          listItems.push({
            lineIndex: i,
            rawIndent: taskMatch[1],
            indent: Math.floor(taskMatch[1].length / 2),
            kind: "task",
            bulletPrefix: `${taskMatch[1]}${taskMatch[2]}`,
            checked: taskMatch[3].toLowerCase() === "x",
            text: taskMatch[4],
          });
          i++;
          continue;
        }
        const ulMatch = /^(\s*)([-*+]\s+)(.*)$/.exec(cur);
        if (ulMatch) {
          listItems.push({
            lineIndex: i,
            rawIndent: ulMatch[1],
            indent: Math.floor(ulMatch[1].length / 2),
            kind: "ul",
            bulletPrefix: `${ulMatch[1]}${ulMatch[2]}`,
            text: ulMatch[3],
          });
          i++;
          continue;
        }
        const olMatch = /^(\s*)((\d+)\.\s+)(.*)$/.exec(cur);
        if (olMatch) {
          listItems.push({
            lineIndex: i,
            rawIndent: olMatch[1],
            indent: Math.floor(olMatch[1].length / 2),
            kind: "ol",
            bulletPrefix: `${olMatch[1]}${olMatch[2]}`,
            marker: `${olMatch[3]}.`,
            orderNum: Number(olMatch[3]),
            text: olMatch[4],
          });
          i++;
          continue;
        }
        break;
      }

      blocks.push(
        <div key={`list-${startIdx}`} className="my-2 space-y-1">
          {listItems.map((item) => {
            const gLine = baseLineOffset + item.lineIndex;
            const itemHl = isRangeHighlighted(gLine, gLine);
            const padLeft = Math.min(item.indent, 4) * 16;
            const rowCls = itemHl ? HL_BLOCK_CLASS : IDLE_BLOCK_CLASS;

            const renderItemBody = (extraCls = "") => {
              if (editable && onReplaceLines) {
                const nextMarkerPrefix =
                  item.kind === "task"
                    ? `${item.rawIndent}- [ ] `
                    : item.kind === "ol"
                    ? `${item.rawIndent}${(item.orderNum ?? 1) + 1}. `
                    : item.bulletPrefix;

                return (
                  <EditableInline
                    surfaceId={`li-${gLine}`}
                    tag="span"
                    singleLine
                    markdown={item.text}
                    startLine={gLine}
                    endLine={gLine}
                    customDataDir={customDataDir}
                    placeholder="输入列表项..."
                    className={`min-w-0 flex-1 ${extraCls}`}
                    onCommit={(nextMd, coalesce) =>
                      replaceAndFocus(
                        gLine,
                        gLine,
                        `${item.bulletPrefix}${nextMd}`,
                        { coalesce }
                      )
                    }
                    onEnterSplit={(before, after) => {
                      if (!before.trim() && !after.trim()) {
                        replaceAndFocus(gLine, gLine, "", {
                          focusLine: gLine,
                          focusAtStart: true,
                        });
                        return true;
                      }
                      replaceAndFocus(
                        gLine,
                        gLine,
                        `${item.bulletPrefix}${before}\n${nextMarkerPrefix}${after}`,
                        { focusLine: gLine + 1, focusAtStart: true }
                      );
                      return true;
                    }}
                    onBackspaceStart={(curMd) => {
                      replaceAndFocus(gLine, gLine, curMd, {
                        focusLine: gLine,
                        focusAtStart: true,
                      });
                      return true;
                    }}
                    onTab={(shift) => {
                      if (onIndentLines) {
                        onIndentLines(
                          { startLine: gLine, endLine: gLine },
                          shift ? -1 : 1
                        );
                        pendingFocusRef.current = {
                          line: gLine,
                          placeAtStart: false,
                        };
                        return true;
                      }
                      return false;
                    }}
                    onActivateRange={onActiveRangeChange}
                    onUndo={onUndo}
                    onRedo={onRedo}
                    onZoomImage={(src, alt) => setZoomImage({ src, alt })}
                    registerSurface={registerSurface}
                    markActiveSurface={markActiveSurface}
                  />
                );
              }

              return (
                <span className={`min-w-0 flex-1 ${extraCls}`}>
                  {item.text
                    ? renderInline(item.text, `li-${item.lineIndex}`, inlineOpts)
                    : "\u00A0"}
                </span>
              );
            };

            if (item.kind === "task") {
              return (
                <div
                  key={item.lineIndex}
                  data-hl-active={itemHl ? "true" : undefined}
                  onMouseEnter={() =>
                    onHoverRangeChange?.({ startLine: gLine, endLine: gLine })
                  }
                  onMouseLeave={() => onHoverRangeChange?.(null)}
                  className={rowCls}
                >
                  <div
                    style={{ paddingLeft: padLeft }}
                    className="flex items-start gap-2 text-[13.5px] leading-relaxed"
                  >
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onToggleCheckbox?.(gLine)}
                      aria-label={item.checked ? "取消勾选" : "完成待办"}
                      className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
                        item.checked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/50 bg-background hover:border-primary"
                      }`}
                    >
                      {item.checked && (
                        <Check className="h-2.5 w-2.5 stroke-[2.75]" />
                      )}
                    </button>
                    {renderItemBody(
                      item.checked
                        ? "text-muted-foreground line-through"
                        : "text-foreground"
                    )}
                  </div>
                </div>
              );
            }

            if (item.kind === "ol") {
              return (
                <div
                  key={item.lineIndex}
                  data-hl-active={itemHl ? "true" : undefined}
                  onMouseEnter={() =>
                    onHoverRangeChange?.({ startLine: gLine, endLine: gLine })
                  }
                  onMouseLeave={() => onHoverRangeChange?.(null)}
                  className={rowCls}
                >
                  <div
                    style={{ paddingLeft: padLeft }}
                    className="flex items-start gap-2 text-[13.5px] leading-relaxed text-foreground"
                  >
                    <span className="min-w-[1.25rem] shrink-0 font-mono text-xs leading-relaxed text-muted-foreground">
                      {item.marker}
                    </span>
                    {renderItemBody()}
                  </div>
                </div>
              );
            }

            return (
              <div
                key={item.lineIndex}
                data-hl-active={itemHl ? "true" : undefined}
                onMouseEnter={() =>
                  onHoverRangeChange?.({ startLine: gLine, endLine: gLine })
                }
                onMouseLeave={() => onHoverRangeChange?.(null)}
                className={rowCls}
              >
                <div
                  style={{ paddingLeft: padLeft }}
                  className="flex items-start gap-2 text-[13.5px] leading-relaxed text-foreground"
                >
                  <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/70" />
                  {renderItemBody()}
                </div>
              </div>
            );
          })}
        </div>
      );
      continue;
    }

    // 8. Paragraph (preserving single line breaks)
    const startIdx = i;
    const paraLines: string[] = [];
    while (i < lines.length && !isBlockStart(lines, i)) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length === 0) {
      paraLines.push(lines[i]);
      i++;
    }
    const endIdx = i - 1;
    const gStart = baseLineOffset + startIdx;
    const gEnd = baseLineOffset + endIdx;
    const paraHl = isRangeHighlighted(gStart, gEnd);

    blocks.push(
      <div
        key={`p-${startIdx}`}
        data-hl-active={paraHl ? "true" : undefined}
        onMouseEnter={() =>
          onHoverRangeChange?.({ startLine: gStart, endLine: gEnd })
        }
        onMouseLeave={() => onHoverRangeChange?.(null)}
        className={paraHl ? HL_BLOCK_CLASS : IDLE_BLOCK_CLASS}
      >
        {editable && onReplaceLines ? (
          <EditableInline
            surfaceId={`p-${gStart}`}
            tag="p"
            markdown={paraLines.join("\n")}
            startLine={gStart}
            endLine={gEnd}
            customDataDir={customDataDir}
            placeholder="输入正文..."
            className="my-2 text-[13.5px] leading-relaxed text-foreground/95 first:mt-0"
            onCommit={(nextMd, coalesce) =>
              replaceAndFocus(gStart, gEnd, nextMd, { coalesce })
            }
            onEnterSplit={(before, after) => {
              const beforeLineCount = before.split("\n").length;
              replaceAndFocus(gStart, gEnd, `${before}\n\n${after}`, {
                focusLine: gStart + beforeLineCount + 1,
                focusAtStart: true,
              });
              return true;
            }}
            onBackspaceStart={(curMd) => {
              if (startIdx > 0 && lines[startIdx - 1].trim() === "") {
                replaceAndFocus(gStart - 1, gEnd, curMd, {
                  focusLine: gStart - 1,
                  focusAtStart: true,
                });
                return true;
              }
              return false;
            }}
            onActivateRange={onActiveRangeChange}
            onUndo={onUndo}
            onRedo={onRedo}
            onZoomImage={(src, alt) => setZoomImage({ src, alt })}
            registerSurface={registerSurface}
            markActiveSurface={markActiveSurface}
          />
        ) : (
          <p className="my-2 text-[13.5px] leading-relaxed text-foreground/95 first:mt-0">
            {paraLines.map((pl, pIdx) => (
              <React.Fragment key={pIdx}>
                {pIdx > 0 && <br />}
                {renderInline(pl, `p-${startIdx}-${pIdx}`, inlineOpts)}
              </React.Fragment>
            ))}
          </p>
        )}
      </div>
    );
  }

  // Trailing click-to-append area when editable
  const lastLineIdx = lines.length - 1;
  const hasTrailingEmptyLine = lines[lastLineIdx]?.trim() === "";

  return (
    <>
      <div ref={rootRef} className={`min-h-full select-text ${className}`}>
        {blocks}
        {editable && onReplaceLines && baseLineOffset === 0 && (
          <div
            title="点击在末尾继续输入"
            onClick={() => {
              const gLast = baseLineOffset + lastLineIdx;
              if (hasTrailingEmptyLine) {
                focusLine(Math.max(0, gLast - 1), false);
              } else {
                const nextLine = gLast + 2;
                replaceAndFocus(gLast, gLast, `${lines[lastLineIdx]}\n\n `, {
                  focusLine: nextLine,
                  focusAtStart: true,
                });
              }
            }}
            className="min-h-[48px] cursor-text"
          />
        )}
      </div>
      {zoomImage &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            onClick={() => setZoomImage(null)}
            className="fixed inset-0 z-[9999] flex cursor-zoom-out items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
          >
            <button
              type="button"
              onClick={() => setZoomImage(null)}
              title="关闭预览 (Esc)"
              className="absolute right-5 top-5 flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25"
            >
              <X className="h-4 w-4" />
            </button>
            <img
              src={zoomImage.src}
              alt={zoomImage.alt}
              onClick={(e) => e.stopPropagation()}
              className="max-h-[90vh] max-w-[92vw] cursor-default rounded-lg object-contain shadow-2xl"
            />
          </div>,
          document.body
        )}
    </>
  );
};
