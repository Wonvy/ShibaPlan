(() => {
  const root = (window.__SHIBA_COLLECTORS__ = window.__SHIBA_COLLECTORS__ || {});

  function parseFlexibleNumber(raw) {
    if (raw === null || raw === undefined) return null;
    const text = String(raw).trim();
    if (!text) return null;

    const cnHelper = root.xiaohongshu?.parseCnCount;
    if (typeof cnHelper === "function") {
      const exactCn = cnHelper(text);
      if (exactCn !== null) return exactCn;
    }

    const numMatch = /(-?\d[\d,]*(?:\.\d+)?)\s*(亿|万|千|[wWkK])?/.exec(text);
    if (!numMatch) return null;
    const base = Number(numMatch[1].replace(/,/g, ""));
    if (!Number.isFinite(base)) return null;

    const unit = numMatch[2] ? numMatch[2].toLowerCase() : "";
    let multiplier = 1;
    if (unit === "亿") multiplier = 100000000;
    else if (unit === "万" || unit === "w") multiplier = 10000;
    else if (unit === "千" || unit === "k") multiplier = 1000;

    return multiplier === 1 ? base : Math.round(base * multiplier);
  }

  function escapeCssIdent(str) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(str);
    }
    return String(str).replace(/([^\w-])/g, "\\$1");
  }

  function buildUniqueSelector(el) {
    if (!el || el.nodeType !== 1) return "";
    if (el.id && !/^\d/.test(el.id)) {
      const byId = `#${escapeCssIdent(el.id)}`;
      try {
        if (document.querySelectorAll(byId).length === 1) return byId;
      } catch {}
    }

    const parts = [];
    let cur = el;
    let depth = 0;
    while (cur && cur.nodeType === 1 && cur !== document.body && cur !== document.documentElement && depth < 6) {
      let seg = cur.tagName.toLowerCase();
      if (cur.id && !/^\d/.test(cur.id)) {
        seg = `#${escapeCssIdent(cur.id)}`;
        parts.unshift(seg);
        break;
      }

      const stableClasses = Array.from(cur.classList || [])
        .filter((c) => c && c.length <= 32 && !/[0-9]{4,}|hover|active|focus/.test(c))
        .slice(0, 2);
      if (stableClasses.length > 0) {
        seg += "." + stableClasses.map(escapeCssIdent).join(".");
      }

      const parent = cur.parentElement;
      if (parent) {
        const sameTagSiblings = Array.from(parent.children).filter(
          (child) => child.tagName === cur.tagName
        );
        if (sameTagSiblings.length > 1) {
          const idx = sameTagSiblings.indexOf(cur) + 1;
          seg += `:nth-of-type(${idx})`;
        }
      }

      parts.unshift(seg);
      const candidate = parts.join(" > ");
      try {
        if (document.querySelectorAll(candidate).length === 1) {
          return candidate;
        }
      } catch {}

      cur = parent;
      depth++;
    }

    return parts.join(" > ");
  }

  function applyRegex(text, regexStr) {
    const raw = String(text ?? "").trim();
    if (!regexStr || !String(regexStr).trim()) return raw;
    try {
      const re = new RegExp(String(regexStr).trim());
      const m = re.exec(raw);
      if (!m) return raw;
      return (m[1] ?? m[0] ?? raw).trim();
    } catch {
      return raw;
    }
  }

  function extract(task) {
    const cfg = task?.selectorConfig || {};
    const selector = String(cfg.selector || "").trim();
    if (!selector) {
      return { ok: false, needsLogin: false, reason: "未配置 CSS 选择器" };
    }

    let targetEl = null;
    try {
      targetEl = document.querySelector(selector);
    } catch (err) {
      return { ok: false, needsLogin: false, reason: `CSS 选择器语法无效: ${err?.message || selector}` };
    }

    if (!targetEl) {
      return { ok: false, needsLogin: false, reason: `页面未找到匹配元素 (${selector})` };
    }

    const rawText = (targetEl.innerText || targetEl.textContent || "").trim();
    const captured = applyRegex(rawText, cfg.regex);
    if (!captured) {
      return { ok: false, needsLogin: false, reason: "匹配到的元素文本为空" };
    }

    const parseNumber = Boolean(cfg.parseNumber);
    const numericValue = parseNumber ? parseFlexibleNumber(captured) : null;
    const displayValue = numericValue !== null ? numericValue : captured;

    const extraItems = [];
    if (Array.isArray(cfg.extraFields)) {
      for (const field of cfg.extraFields) {
        if (!field?.label || !field?.selector) continue;
        try {
          const extraEl = document.querySelector(field.selector);
          const extraText = (extraEl?.innerText || extraEl?.textContent || "").trim();
          if (extraText) {
            extraItems.push({ label: String(field.label), value: extraText });
          }
        } catch {}
      }
    }

    return {
      ok: true,
      data: {
        value: displayValue,
        numericValue,
        rawValue: captured,
        label: task?.cardTitle || task?.name || "网页监控",
        unit: String(cfg.unit || ""),
        sourceType: "元素监控",
        extraItems,
        pageUrl: window.location.href,
        pageTitle: document.title || "",
      },
    };
  }

  root.selector = {
    id: "selector",
    name: "通用网页元素监控",
    parseFlexibleNumber,
    buildUniqueSelector,
    extract,
  };
})();
