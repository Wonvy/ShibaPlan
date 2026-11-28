(() => {
  const JS_KEYWORDS = new Set([
    "async", "await", "break", "case", "catch", "class", "const", "continue",
    "debugger", "default", "delete", "do", "else", "export", "extends", "false",
    "finally", "for", "function", "if", "import", "in", "instanceof", "let",
    "new", "null", "of", "return", "static", "super", "switch", "this", "throw",
    "true", "try", "typeof", "undefined", "var", "void", "while", "with", "yield",
    "document", "window", "fetch", "JSON", "Math", "Number", "String", "Array",
    "Object", "Promise", "Date", "RegExp", "URL", "console", "helpers", "task",
  ]);

  const JSON_KEYWORDS = new Set(["true", "false", "null"]);

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function tokenizeLine(line, lang, state) {
    const tokens = [];
    const keywords = lang === "json" ? JSON_KEYWORDS : JS_KEYWORDS;
    let i = 0;

    const push = (kind, text) => {
      if (!text) return;
      const prev = tokens[tokens.length - 1];
      if (prev && prev.kind === kind) {
        prev.text += text;
      } else {
        tokens.push({ kind, text });
      }
    };

    while (i < line.length) {
      if (state.inBlockComment) {
        const endIdx = line.indexOf("*/", i);
        if (endIdx === -1) {
          push("comment", line.slice(i));
          break;
        }
        push("comment", line.slice(i, endIdx + 2));
        i = endIdx + 2;
        state.inBlockComment = false;
        continue;
      }

      const ch = line[i];

      if (lang !== "json" && ch === "/" && line[i + 1] === "/") {
        push("comment", line.slice(i));
        break;
      }

      if (lang !== "json" && ch === "/" && line[i + 1] === "*") {
        const endIdx = line.indexOf("*/", i + 2);
        if (endIdx === -1) {
          push("comment", line.slice(i));
          state.inBlockComment = true;
          break;
        }
        push("comment", line.slice(i, endIdx + 2));
        i = endIdx + 2;
        continue;
      }

      if (ch === '"' || ch === "'" || (lang !== "json" && ch === "`")) {
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

      if (/[0-9]/.test(ch) && (i === 0 || !/[A-Za-z0-9_$]/.test(line[i - 1]))) {
        let j = i;
        while (j < line.length && /[0-9._xXa-fA-Fn]/.test(line[j])) j++;
        push("number", line.slice(i, j));
        i = j;
        continue;
      }

      if (/[A-Za-z_$]/.test(ch)) {
        let j = i;
        while (j < line.length && /[A-Za-z0-9_$]/.test(line[j])) j++;
        const word = line.slice(i, j);
        if (keywords.has(word)) {
          push("keyword", word);
        } else if (lang !== "json" && /^\s*:/.test(line.slice(j))) {
          push("key", word);
        } else {
          push("plain", word);
        }
        i = j;
        continue;
      }

      if (/[{}()[\].,:;+-/*=<>!&|?~%^]/.test(ch)) {
        push("operator", ch);
        i++;
        continue;
      }

      push("plain", ch);
      i++;
    }

    return tokens;
  }

  function highlightCode(code, lang = "javascript") {
    const lines = String(code ?? "").split(/\r?\n/);
    const state = { inBlockComment: false };
    const htmlLines = lines.map((line) => {
      const tokens = tokenizeLine(line, lang, state);
      if (tokens.length === 0) return "";
      return tokens
        .map((t) => {
          const escaped = escapeHtml(t.text);
          return t.kind === "plain" ? escaped : `<span class="tok-${t.kind}">${escaped}</span>`;
        })
        .join("");
    });
    return htmlLines.join("\n") + (String(code ?? "").endsWith("\n") ? " " : "");
  }

  function mount(container, opts = {}) {
    let language = opts.language || "javascript";
    const onChange = typeof opts.onChange === "function" ? opts.onChange : null;
    const onSave = typeof opts.onSave === "function" ? opts.onSave : null;

    container.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "shiba-editor-wrap";

    const gutter = document.createElement("div");
    gutter.className = "shiba-editor-gutter";

    const stage = document.createElement("div");
    stage.className = "shiba-editor-stage";

    const pre = document.createElement("pre");
    pre.className = "shiba-editor-pre";
    pre.setAttribute("aria-hidden", "true");

    const codeEl = document.createElement("code");
    pre.appendChild(codeEl);

    const textarea = document.createElement("textarea");
    textarea.className = "shiba-editor-textarea";
    textarea.spellcheck = false;
    textarea.autocomplete = "off";
    textarea.setAttribute("autocorrect", "off");
    textarea.setAttribute("autocapitalize", "off");
    if (opts.placeholder) textarea.placeholder = opts.placeholder;

    stage.appendChild(pre);
    stage.appendChild(textarea);
    wrap.appendChild(gutter);
    wrap.appendChild(stage);
    container.appendChild(wrap);

    const render = () => {
      const val = textarea.value;
      const lineCount = Math.max(1, val.split(/\r?\n/).length);
      const nums = [];
      for (let i = 1; i <= lineCount; i++) nums.push(String(i));
      gutter.textContent = nums.join("\n");
      codeEl.innerHTML = highlightCode(val, language);
    };

    const syncScroll = () => {
      pre.scrollTop = textarea.scrollTop;
      pre.scrollLeft = textarea.scrollLeft;
      gutter.scrollTop = textarea.scrollTop;
    };

    textarea.addEventListener("input", () => {
      render();
      if (onChange) onChange(textarea.value);
    });

    textarea.addEventListener("scroll", syncScroll);

    textarea.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (onSave) onSave(textarea.value);
        return;
      }

      if (e.key === "Tab") {
        e.preventDefault();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const val = textarea.value;

        if (e.shiftKey) {
          const lineStart = val.lastIndexOf("\n", start - 1) + 1;
          if (val.slice(lineStart, lineStart + 2) === "  ") {
            textarea.value = val.slice(0, lineStart) + val.slice(lineStart + 2);
            textarea.selectionStart = Math.max(lineStart, start - 2);
            textarea.selectionEnd = Math.max(lineStart, end - 2);
          }
        } else {
          textarea.value = val.slice(0, start) + "  " + val.slice(end);
          textarea.selectionStart = textarea.selectionEnd = start + 2;
        }
        render();
        syncScroll();
        if (onChange) onChange(textarea.value);
      }
    });

    textarea.value = opts.value || "";
    render();

    return {
      getValue: () => textarea.value,
      setValue: (next) => {
        textarea.value = String(next ?? "");
        render();
        syncScroll();
      },
      setLanguage: (nextLang) => {
        language = nextLang || "javascript";
        render();
      },
      focus: () => textarea.focus(),
    };
  }

  const api = { mount, tokenizeLine, highlightCode, escapeHtml };
  if (typeof window !== "undefined") {
    window.ShibaCodeEditor = api;
  }
  if (typeof globalThis !== "undefined") {
    globalThis.ShibaCodeEditor = api;
  }
})();
