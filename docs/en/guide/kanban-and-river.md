# Board, Free Canvas & Idea River

The **Board** and bottom **Idea River** form ShibaPlan's core daily loop: **capture fleeting thoughts frictionlessly, then drag what matters into structured columns when you are ready to execute**.

---

## Custom Kanban Board

### 1. Flexible Column Management
- **Custom Columns & Semantic Colors**: Create columns tailored to your workflow (`Backlog`, `Design`, `Implementation`, `Evaluation`) with 6 muted accent colors.
- **Drag Reordering & Resizing**: Drag column headers horizontally with drop indicators; drag a column's right edge to resize its width, or right-click the header to **Reset width**.
- **Double-Click Collapse**: Double-click any column header to fold it into a compact summary card.
- **Per-Column Display Controls**: Right-click a column header to independently toggle **Effort**, **Schedule**, **Notes**, and **Images**.

### 2. Freeform Dot Canvas Mode
Switch from linear columns to a **Free Canvas** whenever you want spatial organization:
- **Pan**: Hold `Space + Left-Drag` (or middle-mouse drag).
- **Zoom & Arrange**: Zoom smoothly with the wheel, snap columns with smart alignment guides, or click **Auto Arrange** / **Fit View**.

### 3. Native OS File & Folder Cards
In the desktop app, drag files or project folders directly from Windows Explorer or macOS Finder onto any column:
- **Expandable Folder Cards**: Click **Expand files** right on the card to browse its live contents and click any item to open it in its default OS app.
- **Hover + `Ctrl + V` Instant Paste**: Hover over any column and press `Ctrl + V` to save a clipboard screenshot into `assets/` as an image card, or paste text directly into a new task.

### 4. Focus Timer & 30-Step Undo/Redo
- Assign effort estimates (`S: 30m` / `M: 90m` / `L: 180m` or custom minutes), priority stars, and urgency colors.
- Click **Start Focus** on a task card to log actual elapsed minutes into `focusLogs`.
- Press `Ctrl + Z` / `Ctrl + Shift + Z` anywhere to undo or redo up to **30 workspace snapshots**.

---

## Idea River & Global Quick Capture

### 1. Drifting Idea Dock
Docked at the bottom of the main window, the Idea River lets raw thoughts drift calmly across multiple lanes without cluttering your active task board:
- **River & List Modes**: Switch between drifting **River** mode (adjustable Slow / Medium / Fast speed or Pause) and paginated **List** mode (flip pages with mouse wheel).
- **Bidirectional Drag & Drop**:
  - Drag any idea pill upward into a **Board column** or onto a **Calendar date** to convert it into a scheduled task;
  - Hold `Alt` while dragging to **copy** the idea instead of moving it to the Recycle Bin;
  - Double-click the **Idea River** header to collapse or expand the dock, or drag its top border to resize height.
- **Idea Recycle Bin**: Converted or deleted ideas are safely retained in the Recycle Bin and can be restored anytime or searched via `Ctrl + K`.

### 2. Global Quick Capture Window
Even while working fullscreen in Figma, Blender, CAD, VS Code, or a browser:
- Press **`Alt + Space`** (automatically falls back to **`Ctrl + Shift + Space`** if `Alt + Space` is occupied by another utility) to summon a centered frameless capture window.
- Type notes, press `Ctrl + V` to attach screenshots, or drop files, then hit `Enter` (`Ctrl + Enter`) to save instantaneously.

### 3. One-Click AI Markdown Prompt Export
Click any idea to open **Idea Details & AI Prompt**:
- **Copy for AI**: Copies a clean, structured Markdown prompt to your clipboard;
- **Export `.md`**: Saves the idea to `ideas/*.md` inside your local data folder.
