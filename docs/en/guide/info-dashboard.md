# Info Dashboard & Automation

The **Info** view turns ShibaPlan into a **programmable personal monitoring and information dashboard**. With a few lines of Python/PowerShell/Node.js, a CLI command, an HTTP endpoint, or an external Webhook push, you can render live KPI cards, tables, lists, and action buttons on a customizable canvas.

---

## 1. Multi-Board Canvas & Layout Modes

- **Multiple Dashboard Tabs**: Create dedicated boards for different contexts (`Local & Server Health`, `CI/CD Builds`, `Daily Feeds`).
- **Three Layout Modes**:
  - **Free Canvas (`free`)**: Pixel-level drag positioning and resizing with optional grid overlay, snap-to-grid, and overlap prevention;
  - **12-Column Grid (`grid`)**: Structured responsive column alignment;
  - **Compact Flow (`compact`)**: Auto-packed card layout.
- **Board Lock**: Lock a board once arranged to prevent accidental dragging when clicking card actions.

---

## 2. Six Widget Source Types

When creating or editing a widget, choose from six `source.kind` modes:

| Type | `kind` | Best For & Execution Model |
| :--- | :--- | :--- |
| **Script** | `script` | Write inline code or pick a local script file in **Python, PowerShell, Node.js, Batch, or Bash** (UTF-8 & Windows `.ps1` BOM handled automatically with hidden console windows) |
| **CLI Command** | `command` | Run one-line shell commands (`git status -s`, `docker ps`, `nvidia-smi`) and render `stdout` |
| **HTTP Request** | `http` | Poll REST APIs (`GET/POST/PUT/PATCH/DELETE`, custom headers, and **JSONPath** extraction such as `$.data.items`) |
| **External Push** | `push` | **Zero polling overhead**: External cron jobs, servers, or CI pipelines `POST` directly to port `18421` (supports `staleAfterMinutes` staleness indicator) |
| **Container** | `container` | Visual group frame on the canvas to organize related child cards |
| **Control** | `control` | Atomic toggle switch or icon button that triggers a script, command, URL, or local file path on click |

---

## 3. Scheduling & Process Safety

Pull-based widgets (`script` / `command` / `http`) support three schedule modes:
1. **Manual (`manual`)**: Runs only when you click refresh on the card or **Refresh All Info Widgets**.
2. **Interval (`interval`)**: Repeats every $N$ seconds, with optional **Run on Startup** and per-card pause.
3. **Cron (`cron`)**: Standard 5-field cron expressions (e.g., `*/15 * * * *` every 15 minutes, `0 9 * * 1-5` weekdays at 09:00).

**Built-in Safeguards**:
- Per-widget execution timeout (`30s` default, configurable `2s ~ 300s`) with full child process-tree termination (`taskkill /F /T` on Windows) upon timeout or cancellation;
- `1MB` output cap per stream and persistent result caching in `info-cache/results.json` for instant display on startup.

---

## 4. Seven Display Views

Set a card's display view to **Auto (`auto`)** or coerce any output into a specific presentation:
- **Auto**: Renders rich multi-block layouts when given [`shibaplan-info/v1` JSON](/en/api/info-protocol), or gracefully falls back for arbitrary JSON, Markdown, and terminal text.
- **Forced Views**: **KPI Metrics (`metrics`)**, **List (`list`)**, **Key-Value Panel (`kv`, click value to copy)**, **Data Table (`table`)**, **Markdown (`markdown`)**, or **Monospace Text (`text`)**.

::: info Next Steps: API Reference & Live Debugger
- Pushing from external scripts or CI? Read [External Push Webhook API (`:18421`)](/en/api/push-webhook)
- Writing custom scripts? Read [Info Source Protocol (`shibaplan-info/v1`)](/en/api/info-protocol)
:::
