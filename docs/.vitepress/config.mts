import { defineConfig } from "vitepress";

const isGhPages = process.env.DOCS_DEPLOY === "gh-pages";

export default defineConfig({
  title: "ShibaPlan",
  description: "Restrained, local-first personal workspace for design, dev & eval workflows.",
  base: isGhPages ? "/ShibaPlan/" : "/docs/",
  outDir: isGhPages ? ".vitepress/dist" : "../public/docs",
  cleanUrls: false,
  lastUpdated: false,
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: `${isGhPages ? "/ShibaPlan/" : "/docs/"}logo.svg` }],
  ],
  themeConfig: {
    logo: "/logo.svg",
    socialLinks: [
      { icon: "github", link: "https://github.com/Wonvy/ShibaPlan" },
    ],
    search: {
      provider: "local",
      options: {
        miniSearch: {
          options: {
            tokenize: (str: string) =>
              str.match(/[\u4e00-\u9fa5]|[a-zA-Z0-9_.-]+/g) ?? [],
          },
          searchOptions: {
            fuzzy: 0.1,
            prefix: true,
            boost: { title: 4, text: 2, titles: 1 },
          },
        },
        locales: {
          root: {
            translations: {
              button: {
                buttonText: "搜索文档",
                buttonAriaLabel: "搜索文档",
              },
              modal: {
                displayDetails: "显示详细列表",
                resetButtonTitle: "清除查询条件",
                backButtonTitle: "返回",
                noResultsText: "未找到相关内容",
                footer: {
                  selectText: "选择",
                  selectKeyAriaLabel: "回车确认",
                  navigateText: "切换",
                  navigateUpKeyAriaLabel: "向上",
                  navigateDownKeyAriaLabel: "向下",
                  closeText: "关闭",
                  closeKeyAriaLabel: "Esc",
                },
              },
            },
          },
          en: {
            translations: {
              button: {
                buttonText: "Search docs",
                buttonAriaLabel: "Search documentation",
              },
            },
          },
        },
      },
    },
  },
  locales: {
    root: {
      label: "简体中文",
      lang: "zh-CN",
      title: "ShibaPlan 文档",
      description: "克制、本地优先的个人工作台说明手册与接口规范",
      themeConfig: {
        nav: [
          { text: "首页", link: "/" },
          { text: "使用指南", link: "/guide/getting-started" },
          { text: "接口与协议", link: "/api/overview" },
          { text: "OpenAPI 规范", link: "/api/openapi" },
          { text: "版本下载", link: "https://github.com/Wonvy/ShibaPlan/releases" },
        ],
        sidebar: {
          "/guide/": [
            {
              text: "快速入门",
              items: [
                { text: "安装与快速上手", link: "/guide/getting-started" },
              ],
            },
            {
              text: "核心工作流",
              items: [
                { text: "看板、画布与灵感流", link: "/guide/kanban-and-river" },
                { text: "过往项目归档与检索", link: "/guide/projects-archive" },
                { text: "时间日历与备忘录", link: "/guide/calendar-and-memos" },
                { text: "信息仪表盘与自动化", link: "/guide/info-dashboard" },
              ],
            },
            {
              text: "进阶与维护",
              items: [
                { text: "AI、局域网同步与个性化", link: "/guide/ai-lan-and-settings" },
              ],
            },
          ],
          "/api/": [
            {
              text: "接口与协议参考",
              items: [
                { text: "接口总览与架构", link: "/api/overview" },
                { text: "外部推送 Webhook API", link: "/api/push-webhook" },
                { text: "标准数据源协议 (v1)", link: "/api/info-protocol" },
                { text: "局域网同步与数据模型", link: "/api/lan-workspace-api" },
                { text: "OpenAPI 3.1 规范全文", link: "/api/openapi" },
              ],
            },
          ],
        },
        outline: {
          label: "本页目录",
          level: [2, 3],
        },
        docFooter: {
          prev: "上一篇",
          next: "下一篇",
        },
        darkModeSwitchLabel: "外观主题",
        lightModeSwitchTitle: "切换到浅色模式",
        darkModeSwitchTitle: "切换到深色模式",
        sidebarMenuLabel: "目录菜单",
        returnToTopLabel: "返回顶部",
        langMenuLabel: "切换语言 / Language",
      },
    },
    en: {
      label: "English",
      lang: "en-US",
      link: "/en/",
      title: "ShibaPlan Docs",
      description: "User Guide & API Reference for ShibaPlan Local-First Workspace",
      themeConfig: {
        nav: [
          { text: "Home", link: "/en/" },
          { text: "User Guide", link: "/en/guide/getting-started" },
          { text: "API Reference", link: "/en/api/overview" },
          { text: "OpenAPI Spec", link: "/en/api/openapi" },
          { text: "Releases", link: "https://github.com/Wonvy/ShibaPlan/releases" },
        ],
        sidebar: {
          "/en/guide/": [
            {
              text: "Getting Started",
              items: [
                { text: "Installation & Quickstart", link: "/en/guide/getting-started" },
              ],
            },
            {
              text: "Core Workflows",
              items: [
                { text: "Board, Canvas & Idea River", link: "/en/guide/kanban-and-river" },
                { text: "Project Archive & Search", link: "/en/guide/projects-archive" },
                { text: "Timeline Calendar & Memos", link: "/en/guide/calendar-and-memos" },
                { text: "Info Dashboard & Automation", link: "/en/guide/info-dashboard" },
              ],
            },
            {
              text: "Advanced & Maintenance",
              items: [
                { text: "AI, LAN Sync & Customization", link: "/en/guide/ai-lan-and-settings" },
              ],
            },
          ],
          "/en/api/": [
            {
              text: "API & Protocol Reference",
              items: [
                { text: "Overview & Architecture", link: "/en/api/overview" },
                { text: "External Push Webhook API", link: "/en/api/push-webhook" },
                { text: "Info Source Protocol (v1)", link: "/en/api/info-protocol" },
                { text: "LAN Sync & Data Schema", link: "/en/api/lan-workspace-api" },
                { text: "Full OpenAPI 3.1 Spec", link: "/en/api/openapi" },
              ],
            },
          ],
        },
        outline: {
          label: "On this page",
          level: [2, 3],
        },
        langMenuLabel: "Language / 切换语言",
      },
    },
  },
});
