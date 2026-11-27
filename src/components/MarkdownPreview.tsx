import React, { useState } from "react";
import { Check, Copy } from "lucide-react";
import { openExternalUrl } from "../lib/updater";

interface MarkdownPreviewProps {
  content: string;
  onToggleCheckbox?: (lineIndex: number) => void;
  onNotify?: (msg: string) => void;
  className?: string;
}

type TableAlign = "left" | "center" | "right" | undefined;

function isSafeLinkUrl(url: string): boolean {
  const trimmed = url.trim().toLowerCase();
  return (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("mailto:")
  );
}

function isSafeImageUrl(url: string): boolean {
  const trimmed = url.trim().toLowerCase();
  return (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("data:image/") ||
    trimmed.startsWith("/")
  );
}

const INLINE_TOKEN_RE =
  /(`[^`\n]+`|!\[[^\]]*\]\([^)\n]+\)|\[[^\]]+\]\([^)\n]+\)|\*\*\*[^*\n]+\*\*\*|\*\*[^*\n]+\*\*|~~[^~\n]+~~|\*[^*\n]+\*|https?:\/\/[^\s<>()]+)/g;

function renderInline(
  text: string,
  keyPrefix: string
): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let matchIndex = 0;

  INLINE_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_TOKEN_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
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
      const imgMatch = /^!\[([^\]]*)\]\(([^)\n]+)\)$/.exec(token);
      if (imgMatch && isSafeImageUrl(imgMatch[2])) {
        nodes.push(
          <img
            key={key}
            src={imgMatch[2].trim()}
            alt={imgMatch[1]}
            className="my-2 max-w-full rounded-md border border-border/60"
            loading="lazy"
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
            {renderInline(linkMatch[1], `${key}-lbl`)}
          </a>
        );
      } else {
        nodes.push(token);
      }
    } else if (token.startsWith("***") && token.endsWith("***")) {
      nodes.push(
        <strong key={key} className="font-semibold italic text-foreground">
          {token.slice(3, -3)}
        </strong>
      );
    } else if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(
        <strong key={key} className="font-semibold text-foreground">
          {renderInline(token.slice(2, -2), `${key}-b`)}
        </strong>
      );
    } else if (token.startsWith("~~") && token.endsWith("~~")) {
      nodes.push(
        <del key={key} className="text-muted-foreground line-through">
          {renderInline(token.slice(2, -2), `${key}-s`)}
        </del>
      );
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(
        <em key={key} className="italic">
          {renderInline(token.slice(1, -1), `${key}-i`)}
        </em>
      );
    } else if (
      (token.startsWith("http://") || token.startsWith("https://")) &&
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
          className="text-primary underline-offset-2 hover:underline break-all"
        >
          {token}
        </a>
      );
    } else {
      nodes.push(token);
    }

    lastIndex = INLINE_TOKEN_RE.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
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

const CodeBlock: React.FC<{
  lang: string;
  code: string;
  onNotify?: (msg: string) => void;
}> = ({ lang, code, onNotify }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    onNotify?.("已复制代码块");
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="my-2.5 overflow-hidden rounded-md border border-border bg-surface/65">
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
      <pre className="overflow-x-auto p-3 font-mono text-[12.5px] leading-relaxed text-foreground">
        <code>{code}</code>
      </pre>
    </div>
  );
};

function isBlockStart(lines: string[], idx: number): boolean {
  const line = lines[idx];
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (/^```/.test(trimmed)) return true;
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

export const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({
  content,
  onToggleCheckbox,
  onNotify,
  className = "",
}) => {
  if (!content.trim()) {
    return (
      <div
        className={`flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground ${className}`}
      >
        暂无正文内容，可在「编辑」或「分栏」中输入 Markdown
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
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing fence
      blocks.push(
        <CodeBlock
          key={`code-${startIdx}`}
          lang={lang}
          code={codeLines.join("\n")}
          onNotify={onNotify}
        />
      );
      continue;
    }

    // 3. Heading
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const key = `h-${i}`;
      const body = renderInline(text, key);
      if (level === 1) {
        blocks.push(
          <h1
            key={key}
            className="mt-4 mb-2 text-lg font-semibold tracking-[-0.015em] text-foreground first:mt-0"
          >
            {body}
          </h1>
        );
      } else if (level === 2) {
        blocks.push(
          <h2
            key={key}
            className="mt-4 mb-2 border-b border-border/50 pb-1 text-[15px] font-semibold tracking-[-0.01em] text-foreground first:mt-0"
          >
            {body}
          </h2>
        );
      } else if (level === 3) {
        blocks.push(
          <h3
            key={key}
            className="mt-3 mb-1.5 text-[14px] font-semibold text-foreground first:mt-0"
          >
            {body}
          </h3>
        );
      } else {
        blocks.push(
          <h4
            key={key}
            className="mt-2.5 mb-1 text-[13px] font-semibold text-foreground/90 first:mt-0"
          >
            {body}
          </h4>
        );
      }
      i++;
      continue;
    }

    // 4. Horizontal rule
    if (/^(\*{3,}|-{3,}|_{3,})\s*$/.test(trimmed)) {
      blocks.push(<hr key={`hr-${i}`} className="my-3 border-border/70" />);
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
        const rows: string[][] = [];
        while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
          rows.push(splitTableRow(lines[i]));
          i++;
        }
        blocks.push(
          <div
            key={`tbl-${startIdx}`}
            className="my-2.5 overflow-x-auto rounded-md border border-border"
          >
            <table className="w-full border-collapse text-left text-[12.5px]">
              <thead className="bg-surface/70">
                <tr className="border-b border-border">
                  {headers.map((h, colIdx) => (
                    <th
                      key={colIdx}
                      style={{ textAlign: aligns[colIdx] }}
                      className="px-3 py-1.5 font-semibold text-foreground"
                    >
                      {renderInline(h, `th-${startIdx}-${colIdx}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.map((row, rowIdx) => (
                  <tr key={rowIdx} className="hover:bg-surface/35">
                    {headers.map((_, colIdx) => (
                      <td
                        key={colIdx}
                        style={{ textAlign: aligns[colIdx] }}
                        className="px-3 py-1.5 text-foreground/90"
                      >
                        {renderInline(
                          row[colIdx] ?? "",
                          `td-${startIdx}-${rowIdx}-${colIdx}`
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        continue;
      }
    }

    // 6. Blockquote
    if (/^>\s?/.test(line)) {
      const startIdx = i;
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote
          key={`bq-${startIdx}`}
          className="my-2 border-l-2 border-primary/50 bg-surface/50 py-1.5 pl-3 pr-2 text-[13px] leading-relaxed text-muted-foreground"
        >
          {quoteLines.map((ql, qIdx) => (
            <React.Fragment key={qIdx}>
              {qIdx > 0 && <br />}
              {renderInline(ql, `bq-${startIdx}-${qIdx}`)}
            </React.Fragment>
          ))}
        </blockquote>
      );
      continue;
    }

    // 7. Lists (task / unordered / ordered)
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const startIdx = i;
      const listItems: {
        lineIndex: number;
        indent: number;
        kind: "task" | "ul" | "ol";
        checked?: boolean;
        marker?: string;
        text: string;
      }[] = [];

      while (i < lines.length) {
        const cur = lines[i];
        const taskMatch = /^(\s*)[-*+]\s+\[([ xX])\]\s*(.*)$/.exec(cur);
        if (taskMatch) {
          listItems.push({
            lineIndex: i,
            indent: Math.floor(taskMatch[1].length / 2),
            kind: "task",
            checked: taskMatch[2].toLowerCase() === "x",
            text: taskMatch[3],
          });
          i++;
          continue;
        }
        const ulMatch = /^(\s*)[-*+]\s+(.*)$/.exec(cur);
        if (ulMatch) {
          listItems.push({
            lineIndex: i,
            indent: Math.floor(ulMatch[1].length / 2),
            kind: "ul",
            text: ulMatch[2],
          });
          i++;
          continue;
        }
        const olMatch = /^(\s*)(\d+\.)\s+(.*)$/.exec(cur);
        if (olMatch) {
          listItems.push({
            lineIndex: i,
            indent: Math.floor(olMatch[1].length / 2),
            kind: "ol",
            marker: olMatch[2],
            text: olMatch[3],
          });
          i++;
          continue;
        }
        break;
      }

      blocks.push(
        <div key={`list-${startIdx}`} className="my-2 space-y-1">
          {listItems.map((item) => {
            const padLeft = Math.min(item.indent, 4) * 16;
            if (item.kind === "task") {
              return (
                <div
                  key={item.lineIndex}
                  style={{ paddingLeft: padLeft }}
                  className="flex items-start gap-2 text-[13.5px] leading-relaxed"
                >
                  <button
                    type="button"
                    onClick={() => onToggleCheckbox?.(item.lineIndex)}
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
                  <span
                    className={
                      item.checked
                        ? "text-muted-foreground line-through"
                        : "text-foreground"
                    }
                  >
                    {item.text
                      ? renderInline(item.text, `li-${item.lineIndex}`)
                      : "\u00A0"}
                  </span>
                </div>
              );
            }

            if (item.kind === "ol") {
              return (
                <div
                  key={item.lineIndex}
                  style={{ paddingLeft: padLeft }}
                  className="flex items-start gap-2 text-[13.5px] leading-relaxed text-foreground"
                >
                  <span className="min-w-[1.25rem] shrink-0 font-mono text-xs text-muted-foreground leading-relaxed">
                    {item.marker}
                  </span>
                  <span className="min-w-0 flex-1">
                    {renderInline(item.text, `li-${item.lineIndex}`)}
                  </span>
                </div>
              );
            }

            return (
              <div
                key={item.lineIndex}
                style={{ paddingLeft: padLeft }}
                className="flex items-start gap-2 text-[13.5px] leading-relaxed text-foreground"
              >
                <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/70" />
                <span className="min-w-0 flex-1">
                  {renderInline(item.text, `li-${item.lineIndex}`)}
                </span>
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
    blocks.push(
      <p
        key={`p-${startIdx}`}
        className="my-2 text-[13.5px] leading-relaxed text-foreground/95 first:mt-0"
      >
        {paraLines.map((pl, pIdx) => (
          <React.Fragment key={pIdx}>
            {pIdx > 0 && <br />}
            {renderInline(pl, `p-${startIdx}-${pIdx}`)}
          </React.Fragment>
        ))}
      </p>
    );
  }

  return <div className={`select-text ${className}`}>{blocks}</div>;
};
