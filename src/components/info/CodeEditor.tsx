import React, { useMemo, useRef } from "react";
import {
  ExternalLink,
  FolderOpen,
  Save,
  Sparkles,
} from "lucide-react";
import { InfoScriptLang } from "../../types";

interface CodeEditorProps {
  value: string;
  onChange: (next: string) => void;
  language: InfoScriptLang;
  onLanguageChange?: (lang: InfoScriptLang) => void;
  filePath?: string;
  onSaveFile?: () => void;
  onOpenExternal?: () => void;
  onRevealFile?: () => void;
  onInsertTemplate?: () => void;
  savingFile?: boolean;
  dirty?: boolean;
  heightClass?: string;
  placeholder?: string;
}

type TokenKind =
  | "plain"
  | "comment"
  | "string"
  | "keyword"
  | "number"
  | "variable"
  | "key"
  | "operator";

interface Token {
  kind: TokenKind;
  text: string;
}

const KEYWORDS_BY_LANG: Record<InfoScriptLang, Set<string>> = {
  python: new Set([
    "import", "from", "as", "def", "class", "return", "if", "elif", "else",
    "for", "while", "in", "not", "and", "or", "is", "try", "except", "finally",
    "with", "raise", "pass", "break", "continue", "True", "False", "None",
    "lambda", "yield", "async", "await", "print",
  ]),
  powershell: new Set([
    "if", "else", "elseif", "foreach", "for", "while", "switch", "function",
    "param", "return", "try", "catch", "finally", "throw", "in", "true", "false",
    "null", "Get-CimInstance", "Get-Process", "Select-Object", "Sort-Object",
    "Measure-Object", "Where-Object", "ConvertTo-Json", "ConvertFrom-Json",
    "Write-Output", "Write-Host", "Invoke-RestMethod",
  ]),
  node: new Set([
    "const", "let", "var", "function", "return", "if", "else", "for", "while",
    "of", "in", "try", "catch", "finally", "throw", "async", "await", "import",
    "from", "export", "default", "require", "new", "true", "false", "null",
    "undefined", "typeof", "JSON", "console", "process",
  ]),
  batch: new Set([
    "echo", "off", "set", "setlocal", "if", "else", "for", "do", "in", "call",
    "exit", "rem", "goto", "not", "exist", "defined", "chcp",
  ]),
  bash: new Set([
    "if", "then", "else", "elif", "fi", "for", "do", "done", "while", "case",
    "esac", "function", "return", "local", "export", "echo", "exit", "true",
    "false", "jq", "curl", "grep", "awk", "sed",
  ]),
  json: new Set(["true", "false", "null"]),
};

function tokenizeLine(line: string, lang: InfoScriptLang): Token[] {
  const tokens: Token[] = [];
  const keywords = KEYWORDS_BY_LANG[lang] ?? KEYWORDS_BY_LANG.python;
  let i = 0;

  const push = (kind: TokenKind, text: string) => {
    if (!text) return;
    const prev = tokens[tokens.length - 1];
    if (prev && prev.kind === kind) {
      prev.text += text;
    } else {
      tokens.push({ kind, text });
    }
  };

  while (i < line.length) {
    const ch = line[i];

    // Comments
    if (
      (lang === "python" || lang === "powershell" || lang === "bash") &&
      ch === "#"
    ) {
      push("comment", line.slice(i));
      break;
    }
    if (lang === "node" && ch === "/" && line[i + 1] === "/") {
      push("comment", line.slice(i));
      break;
    }
    if (
      lang === "batch" &&
      (line.slice(i, i + 2) === "::" ||
        /^rem(\s|$)/i.test(line.slice(i)))
    ) {
      push("comment", line.slice(i));
      break;
    }

    // Strings
    if (ch === '"' || ch === "'" || (lang === "node" && ch === "`")) {
      const quote = ch;
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === "\\" && j + 1 < line.length) {
          j += 2;
          continue;
        }
        if (line[j] === quote) {
          j++;
          break;
        }
        j++;
      }
      const literal = line.slice(i, j);
      // JSON property key detection: "..." followed by optional spaces and ':'
      if (lang === "json" && quote === '"') {
        const rest = line.slice(j);
        if (/^\s*:/.test(rest)) {
          push("key", literal);
          i = j;
          continue;
        }
      }
      push("string", literal);
      i = j;
      continue;
    }

    // PowerShell / Bash variables ($var) or Batch (%var%)
    if (
      (lang === "powershell" || lang === "bash") &&
      ch === "$" &&
      /[A-Za-z_{]/.test(line[i + 1] ?? "")
    ) {
      let j = i + 1;
      while (j < line.length && /[A-Za-z0-9_:{}.-]/.test(line[j])) j++;
      push("variable", line.slice(i, j));
      i = j;
      continue;
    }
    if (lang === "batch" && ch === "%") {
      const end = line.indexOf("%", i + 1);
      if (end > i + 1) {
        push("variable", line.slice(i, end + 1));
        i = end + 1;
        continue;
      }
    }

    // Numbers
    if (/[0-9]/.test(ch) && (i === 0 || !/[A-Za-z0-9_]/.test(line[i - 1]))) {
      let j = i;
      while (j < line.length && /[0-9._xXa-fA-F]/.test(line[j])) j++;
      push("number", line.slice(i, j));
      i = j;
      continue;
    }

    // Identifiers / Keywords
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < line.length && /[A-Za-z0-9_-]/.test(line[j])) {
        // Only allow '-' inside PowerShell cmdlets (Get-Process)
        if (line[j] === "-" && lang !== "powershell") break;
        j++;
      }
      const word = line.slice(i, j);
      if (keywords.has(word)) {
        push("keyword", word);
      } else {
        push("plain", word);
      }
      i = j;
      continue;
    }

    if (/[{}()[\].,:;+-/*=<>!&|?]/.test(ch)) {
      push("operator", ch);
      i++;
      continue;
    }

    push("plain", ch);
    i++;
  }

  return tokens;
}

const TOKEN_CLASS: Record<TokenKind, string> = {
  plain: "text-foreground",
  comment: "text-muted-foreground/70 italic",
  string: "text-emerald-500 dark:text-emerald-400",
  keyword: "text-violet-600 dark:text-violet-400 font-medium",
  number: "text-amber-600 dark:text-amber-400",
  variable: "text-sky-600 dark:text-sky-400",
  key: "text-sky-600 dark:text-sky-400",
  operator: "text-muted-foreground",
};

const LANG_OPTIONS: { value: InfoScriptLang; label: string }[] = [
  { value: "python", label: "Python" },
  { value: "powershell", label: "PowerShell" },
  { value: "node", label: "Node.js" },
  { value: "batch", label: "Batch (.bat)" },
  { value: "bash", label: "Bash (.sh)" },
  { value: "json", label: "JSON" },
];

export const CodeEditor: React.FC<CodeEditorProps> = ({
  value,
  onChange,
  language,
  onLanguageChange,
  filePath,
  onSaveFile,
  onOpenExternal,
  onRevealFile,
  onInsertTemplate,
  savingFile,
  dirty,
  heightClass = "h-64",
  placeholder,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const lines = useMemo(() => value.split("\n"), [value]);
  const tokenizedLines = useMemo(
    () => lines.map((line) => tokenizeLine(line, language)),
    [lines, language]
  );

  const syncScroll = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (preRef.current) {
      preRef.current.scrollTop = ta.scrollTop;
      preRef.current.scrollLeft = ta.scrollLeft;
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = ta.scrollTop;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      if (onSaveFile) {
        e.preventDefault();
        onSaveFile();
      }
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey) {
        const before = value.slice(0, start);
        const lineStart = before.lastIndexOf("\n") + 1;
        const linePrefix = value.slice(lineStart, start);
        const remove = linePrefix.startsWith("  ")
          ? 2
          : linePrefix.startsWith(" ")
            ? 1
            : 0;
        if (remove > 0) {
          const next = value.slice(0, lineStart) + value.slice(lineStart + remove);
          onChange(next);
          requestAnimationFrame(() => {
            ta.selectionStart = ta.selectionEnd = Math.max(lineStart, start - remove);
          });
        }
      } else {
        const next = value.slice(0, start) + "  " + value.slice(end);
        onChange(next);
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + 2;
        });
      }
      return;
    }

    if (e.key === "Enter") {
      const before = value.slice(0, start);
      const lineStart = before.lastIndexOf("\n") + 1;
      const curLine = before.slice(lineStart);
      const indentMatch = /^(\s*)/.exec(curLine);
      const indent = indentMatch ? indentMatch[1] : "";
      if (indent) {
        e.preventDefault();
        const insert = "\n" + indent;
        const next = value.slice(0, start) + insert + value.slice(end);
        onChange(next);
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + insert.length;
        });
      }
    }
  };

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-background">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface/80 px-2.5 py-1.5 text-[11px]">
        <div className="flex items-center gap-2 min-w-0">
          {onLanguageChange ? (
            <select
              value={language}
              onChange={(e) => onLanguageChange(e.target.value as InfoScriptLang)}
              className="rounded border border-border bg-background px-1.5 py-0.5 text-[11px] font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {LANG_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">
              {language.toUpperCase()}
            </span>
          )}

          {filePath ? (
            <span
              title={filePath}
              className="truncate max-w-[200px] font-mono text-[10.5px] text-muted-foreground"
            >
              {filePath}
            </span>
          ) : (
            <span className="text-[10.5px] text-muted-foreground">
              内联脚本（测试/运行即生效）
            </span>
          )}
          {dirty && (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">
              未保存
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {onInsertTemplate && (
            <button
              type="button"
              onClick={onInsertTemplate}
              title="填充标准协议示例代码"
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Sparkles className="h-3 w-3" />
              <span>协议模板</span>
            </button>
          )}
          {onSaveFile && (
            <button
              type="button"
              disabled={savingFile}
              onClick={onSaveFile}
              title="保存到脚本文件 (Ctrl+S)"
              className="inline-flex items-center gap-1 rounded bg-primary/15 px-2 py-0.5 font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
            >
              <Save className="h-3 w-3" />
              <span>{savingFile ? "保存中" : "保存文件"}</span>
            </button>
          )}
          {filePath && onOpenExternal && (
            <button
              type="button"
              onClick={onOpenExternal}
              title="使用系统默认编辑器打开"
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ExternalLink className="h-3 w-3" />
              <span>系统编辑器</span>
            </button>
          )}
          {filePath && onRevealFile && (
            <button
              type="button"
              onClick={onRevealFile}
              title="在文件夹中定位"
              className="inline-flex items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <FolderOpen className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Editor Area */}
      <div className={`relative flex w-full overflow-hidden ${heightClass}`}>
        {/* Line Numbers */}
        <div
          ref={gutterRef}
          aria-hidden="true"
          className="w-10 shrink-0 overflow-hidden border-r border-border/60 bg-surface/40 py-3 pr-2 text-right font-mono text-[11px] leading-[20px] text-muted-foreground/55 select-none"
        >
          {lines.map((_, idx) => (
            <div key={idx}>{idx + 1}</div>
          ))}
        </div>

        {/* Highlighted Overlay + Transparent Textarea */}
        <div className="relative flex-1 overflow-hidden">
          <pre
            ref={preRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 m-0 overflow-hidden p-3 font-mono text-[12.5px] leading-[20px] whitespace-pre"
          >
            {tokenizedLines.map((lineTokens, lineIdx) => (
              <div key={lineIdx} className="min-h-[20px]">
                {lineTokens.length === 0 ? (
                  "\u200B"
                ) : (
                  lineTokens.map((tk, tkIdx) => (
                    <span key={tkIdx} className={TOKEN_CLASS[tk.kind]}>
                      {tk.text}
                    </span>
                  ))
                )}
              </div>
            ))}
          </pre>

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onScroll={syncScroll}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            placeholder={placeholder}
            className="relative z-10 h-full w-full resize-none overflow-auto bg-transparent p-3 font-mono text-[12.5px] leading-[20px] text-transparent caret-foreground placeholder:text-muted-foreground/45 focus:outline-none whitespace-pre selection:bg-primary/25"
          />
        </div>
      </div>
    </div>
  );
};
