<div align="center">

<img src="./app-icon.svg" alt="ShibaPlan" width="72" height="72" />

# ShibaPlan

**A minimalist, cross-platform workspace for designers, developers, and evaluators.**  
Custom Kanban · Freeform Canvas · Idea River · Timeline · AI-Ready Workflow

[English](./README.md) · [简体中文](./README.zh-CN.md)

![Tauri 2](https://img.shields.io/badge/Tauri-2.0-24C8DB?style=flat-square&logo=tauri&logoColor=white)
![React 18](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white)
![shadcn/ui](https://img.shields.io/badge/Design-shadcn%2Fui-18181B?style=flat-square)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-52525B?style=flat-square)

</div>

---

## Overview

**ShibaPlan** is built for multi-role makers juggling design, development, and evaluation. Instead of bloated project suites, it combines a customizable Kanban board, a freeform spatial canvas, a monthly schedule view, and a gently drifting **Idea River** at the bottom — keeping your tasks structured and your raw inspirations ready to feed directly into AI tools.

## Key Features

### Board & Freeform Canvas
- **Custom Columns**: Create, rename, color-code, drag-reorder, and drag-resize column widths and column gaps.
- **Folder-Style Folding**: Double-click any column header to fold it into a compact folder summary card showing pending/done counts, estimated hours, and progress.
- **Freeform Canvas Mode**: Drag columns freely with smart alignment guides and magnetic snapping (`Alt` to bypass). Supports direct wheel zoom on empty canvas, `Ctrl + Wheel` zoom, `Space + Drag` pan, one-click tidy grid, and fit-to-screen.
- **Local File & Folder Shortcuts**: Drag local folders or files directly into any column to create expandable directory browsers and one-click OS openers.
- **Hover-to-Paste & Double-Click**: Hover over any column and press `Ctrl + V` to insert clipboard text or screenshots immediately into edit mode, or double-click empty space to add a card.

### Idea River & AI Workflow
- **Drifting Idea River**: Multi-row horizontal stream of rounded idea pills with hover-to-read previews, mouse-wheel scrolling, resizable height, collapsible dock, and a paginated List view.
- **Bidirectional Drag**: Drag ideas up into any Kanban column or Calendar date (auto-archived to Recycle Bin), or drag Kanban cards down into the river (`Alt` to copy).
- **Global Quick Capture**: Press `Alt + Space` (auto-fallback `Ctrl + Shift + Space`) from any app to jot down thoughts or paste screenshots.
- **AI Integration**: One-click structured Markdown Prompt export, plus optional OpenAI-compatible / DeepSeek / local Ollama API integration for breaking an idea into 3–5 Kanban cards and generating a daily priority plan.

### Timeline, Search & Aesthetics
- **Calendar View**: Monthly grid with hover day previews, drag-and-drop rescheduling, and idea-to-date dropping.
- **Command Palette & Undo Stack**: `Ctrl + K` global search across tasks, folders, ideas, and trash; `Ctrl + Z` / `Ctrl + Shift + Z` 30-step undo/redo history.
- **Themes & Paper Grain**: Built on **shadcn/ui** semantic tokens with **Dark**, **Light**, and **Paper** themes, plus an independent fine paper grain texture toggle.
- **Extensible i18n & Local Sync**: Built-in English and Simplified Chinese with JSON language pack import/export. Store data locally as JSON + Markdown and sync across Windows and macOS via OneDrive, iCloud, or Git.

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Alt + Space` / `Ctrl + Shift + Space` | Toggle global Quick Capture window (Win / macOS) |
| `Ctrl + K` / `Cmd + K` | Open global Command Palette & Search |
| `Ctrl + Z` / `Ctrl + Shift + Z` | Undo / Redo workspace changes |
| `Ctrl + V` (while hovering column/river/date) | Auto-insert clipboard text, screenshot, or folder path |
| `Wheel` / `Ctrl + Wheel` (Canvas) | Zoom canvas around cursor |
| `Space + Drag` / `Middle Drag` (Canvas) | Pan freeform canvas |
| `Ctrl + 0` / `Ctrl + +` / `Ctrl + -` (Canvas) | Reset zoom / Zoom in / Zoom out |

---

## Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) >= 18
- [Rust](https://www.rust-lang.org/tools/install) (for Tauri 2.0 desktop build)

### Development
```bash
# Install dependencies
npm install

# Run desktop app (Windows / macOS)
npm run tauri dev

# Or run web preview only
npm run dev
```

### Production Build
```bash
# Build native installer (.msi / .exe on Windows, .dmg on macOS)
npm run tauri build
```

---

## Custom Languages

1. Open **Settings** -> **Interface Language** -> click **Export Language JSON**.
2. Translate the strings in the exported `shibaplan-lang-*.json` file and update `code` and `name`.
3. Click **Import Language JSON** to activate your custom language immediately.

---

## Tech Stack

- **Desktop Runtime**: Tauri 2.0 (Rust) + `tauri-plugin-global-shortcut`
- **Frontend**: React 18, TypeScript, Vite 6
- **Design System**: shadcn/ui, Radix UI, Tailwind CSS, Lucide Icons

## License

MIT
