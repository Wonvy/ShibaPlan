(() => {
  const root = (window.__SHIBA_COLLECTORS__ = window.__SHIBA_COLLECTORS__ || {});

  function parseCnCount(raw) {
    if (raw === null || raw === undefined) return null;
    const cleaned = String(raw).replace(/[\s,+]/g, "").trim();
    if (!cleaned) return null;

    const match = /^(-?\d+(?:\.\d+)?)(亿|万|千|[wWkK])?$/.exec(cleaned);
    if (!match) return null;

    const num = Number(match[1]);
    if (!Number.isFinite(num) || num < 0) return null;

    const unit = match[2] ? match[2].toLowerCase() : "";
    let multiplier = 1;
    if (unit === "亿") multiplier = 100000000;
    else if (unit === "万" || unit === "w") multiplier = 10000;
    else if (unit === "千" || unit === "k") multiplier = 1000;

    return Math.round(num * multiplier);
  }

  function extractProfileId(url) {
    if (!url) return "";
    const match = /\/user\/profile\/([a-zA-Z0-9]+)/.exec(String(url));
    return match ? match[1] : "";
  }

  function isCreatorHost(hostname) {
    return hostname === "creator.xiaohongshu.com";
  }

  function detectLoginOrCaptcha() {
    const href = window.location.href;
    if (/\/login\b|\/signin\b/i.test(href)) {
      return { needsLogin: true, reason: "当前停留在登录页，请先登录小红书账号" };
    }

    const bodyText = (document.body?.innerText || "").slice(0, 3000);
    if (
      document.querySelector(".login-container, .qrcode-img, [class*='login-modal']") &&
      /扫码登录|验证码登录|登录后查看|立即登录/.test(bodyText)
    ) {
      return { needsLogin: true, reason: "检测到登录弹窗，请先在页面中完成登录" };
    }

    if (/安全验证|拖动滑块|滑动验证|请完成验证/.test(bodyText)) {
      return { needsLogin: true, reason: "触发安全验证，请在浏览器中手动完成验证后重试" };
    }

    return { needsLogin: false, reason: "" };
  }

  function extractFromInteractions() {
    const boxes = Array.from(
      document.querySelectorAll(
        ".user-interactions > div, .user-interactions span, [class*='interaction'] > div"
      )
    );
    const map = {};
    for (const box of boxes) {
      const countEl = box.querySelector(".count, [class*='count']");
      const labelEl = box.querySelector(".shows, .label, [class*='label'], [class*='text']");
      const rawCount = countEl?.textContent?.trim();
      const rawLabel = labelEl?.textContent?.trim();
      if (rawCount && rawLabel) {
        map[rawLabel] = rawCount;
      }
    }

    const followersRaw = map["粉丝"] ?? map["粉丝数"] ?? null;
    if (!followersRaw) return null;
    const followers = parseCnCount(followersRaw);
    if (followers === null) return null;

    return {
      followers,
      followersRaw,
      following: parseCnCount(map["关注"]) ?? null,
      likes: parseCnCount(map["获赞与收藏"] ?? map["获赞"]) ?? null,
      likesRaw: map["获赞与收藏"] ?? map["获赞"] ?? null,
    };
  }

  function extractByTextPairs() {
    const labelTargets = ["总粉丝数", "粉丝数", "粉丝", "获赞与收藏", "关注"];
    const found = {};

    const candidates = Array.from(
      document.querySelectorAll("div, span, p, li, section, a")
    );

    for (const el of candidates) {
      if (el.children.length > 0) continue;
      const label = (el.textContent || "").trim();
      if (!labelTargets.includes(label)) continue;

      const parent = el.parentElement;
      if (!parent) continue;

      const siblings = Array.from(parent.children).filter((c) => c !== el);
      for (const sib of siblings) {
        const valText = (sib.textContent || "").trim();
        const parsed = parseCnCount(valText);
        if (parsed !== null && !found[label]) {
          found[label] = { value: parsed, raw: valText };
          break;
        }
      }

      if (!found[label] && parent.parentElement) {
        const lines = (parent.innerText || "")
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (lines.length === 2) {
          const other = lines[0] === label ? lines[1] : lines[1] === label ? lines[0] : "";
          const parsed = parseCnCount(other);
          if (parsed !== null) {
            found[label] = { value: parsed, raw: other };
          }
        }
      }
    }

    const fanEntry = found["总粉丝数"] || found["粉丝数"] || found["粉丝"];
    if (!fanEntry) return null;

    return {
      followers: fanEntry.value,
      followersRaw: fanEntry.raw,
      following: found["关注"]?.value ?? null,
      likes: found["获赞与收藏"]?.value ?? null,
      likesRaw: found["获赞与收藏"]?.raw ?? null,
    };
  }

  function extractNickname() {
    const selectors = [
      ".user-name",
      "[class*='user-name']",
      "[class*='nickname']",
      ".creator-name",
      "[class*='account-name']",
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const txt = el?.textContent?.trim();
      if (txt && txt.length <= 40) return txt;
    }
    return "";
  }

  function matchesUrl(url, task) {
    try {
      const u = new URL(url);
      if (isCreatorHost(u.hostname)) return true;
      if (u.hostname === "www.xiaohongshu.com" && u.pathname.startsWith("/user/profile/")) {
        const targetId = extractProfileId(task?.targetUrl || task?.urlPattern || "");
        if (!targetId) return false;
        return extractProfileId(url) === targetId;
      }
      return false;
    } catch {
      return false;
    }
  }

  function extract() {
    const authCheck = detectLoginOrCaptcha();
    if (authCheck.needsLogin) {
      return { ok: false, needsLogin: true, reason: authCheck.reason };
    }

    const stats = extractFromInteractions() || extractByTextPairs();
    if (!stats) {
      return {
        ok: false,
        needsLogin: false,
        reason: "未在当前页面识别到小红书粉丝数据（请确认已打开个人主页或创作者中心首页）",
      };
    }

    const nickname = extractNickname();
    const sourceType = isCreatorHost(window.location.hostname) ? "创作者中心" : "个人主页";
    const extraItems = [];
    if (nickname) extraItems.push({ label: "账号", value: nickname });
    if (stats.likes !== null && stats.likes !== undefined) {
      extraItems.push({ label: "获赞与收藏", value: Number(stats.likes).toLocaleString("zh-CN") });
    }
    if (stats.following !== null && stats.following !== undefined) {
      extraItems.push({ label: "关注数", value: Number(stats.following).toLocaleString("zh-CN") });
    }

    return {
      ok: true,
      data: {
        value: stats.followers,
        numericValue: stats.followers,
        rawValue: stats.followersRaw,
        label: "小红书粉丝",
        unit: "",
        nickname,
        sourceType,
        extraItems,
        pageUrl: window.location.href,
        pageTitle: document.title || "",
      },
    };
  }

  root.xiaohongshu = {
    id: "xiaohongshu",
    name: "小红书粉丝与数据",
    parseCnCount,
    extractProfileId,
    matchesUrl,
    extract,
  };
})();
