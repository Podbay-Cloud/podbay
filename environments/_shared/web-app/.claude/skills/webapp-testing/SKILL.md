---
name: webapp-testing
description: Toolkit for interacting with and testing local web applications using Playwright. Supports verifying frontend functionality, debugging UI behavior, capturing browser screenshots, and viewing browser logs.
license: Complete terms in LICENSE.txt
---

# Web Application Testing

## On a Podbay pod the browser is ALREADY installed — never install one

Chromium **and** the Playwright driver are **prebaked** at `/opt/ms-playwright`
(`$PLAYWRIGHT_BROWSERS_PATH` already points there). Python Playwright works out of the box —
`p.chromium.launch(headless=True)` just works. You do **not** need to install, download, or set
anything up.

- **NEVER run `playwright install` / `npx playwright install` / `pip install`-then-download.** That
  command tries to **download** a browser, and a pod egresses from a **datacenter** with restricted
  egress — the download fails. **That failure is EXPECTED and is NOT a "network wall" — it does NOT
  mean you can't test.** The browser is already here; you just tried to fetch a second copy you don't
  need. Do not conclude egress is blocked, and do not ask for more memory/resources: it's neither.
- **Do not look in `~/.cache/ms-playwright`** — that's Playwright's *default* path and it is **empty
  on a pod**. Finding it empty means nothing. The real browser is at `/opt/ms-playwright`, which
  `$PLAYWRIGHT_BROWSERS_PATH` already selects for you.
- **30-second sanity check** before deciding anything: `echo $PLAYWRIGHT_BROWSERS_PATH` → prints
  `/opt/ms-playwright`; `ls /opt/ms-playwright` → shows a `chromium-*` dir. Then write your script and
  launch — no install step.
- Only real failure mode: Chromium dies on `libnspr4.so: cannot open shared object file`. That means
  the pod predates the system-libs fix (Incus images before 2026-07-27) — say so and have the owner
  update the pod. Do **not** `sudo apt` your way around it.

To test local web applications, write native Python Playwright scripts.

**Helper Scripts Available**:
- `scripts/with_server.py` - Manages server lifecycle (supports multiple servers)

**Always run scripts with `--help` first** to see usage. DO NOT read the source until you try running the script first and find that a customized solution is abslutely necessary. These scripts can be very large and thus pollute your context window. They exist to be called directly as black-box scripts rather than ingested into your context window.

## Decision Tree: Choosing Your Approach

```
User task → Is it static HTML?
    ├─ Yes → Read HTML file directly to identify selectors
    │         ├─ Success → Write Playwright script using selectors
    │         └─ Fails/Incomplete → Treat as dynamic (below)
    │
    └─ No (dynamic webapp) → Is the server already running?
        ├─ No → Run: python scripts/with_server.py --help
        │        Then use the helper + write simplified Playwright script
        │
        └─ Yes → Reconnaissance-then-action:
            1. Navigate and wait for networkidle
            2. Take screenshot or inspect DOM
            3. Identify selectors from rendered state
            4. Execute actions with discovered selectors
```

## Example: Using with_server.py

To start a server, run `--help` first, then use the helper:

**Single server:**
```bash
python scripts/with_server.py --server "npm run dev" --port 5173 -- python your_automation.py
```

**Multiple servers (e.g., backend + frontend):**
```bash
python scripts/with_server.py \
  --server "cd backend && python server.py" --port 3000 \
  --server "cd frontend && npm run dev" --port 5173 \
  -- python your_automation.py
```

To create an automation script, include only Playwright logic (servers are managed automatically):
```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True) # Always launch chromium in headless mode
    page = browser.new_page()
    page.goto('http://localhost:5173') # Server already running and ready
    page.wait_for_load_state('networkidle') # CRITICAL: Wait for JS to execute
    # ... your automation logic
    browser.close()
```

## Reconnaissance-Then-Action Pattern

1. **Inspect rendered DOM**:
   ```python
   page.screenshot(path='/tmp/inspect.png', full_page=True)
   content = page.content()
   page.locator('button').all()
   ```

2. **Identify selectors** from inspection results

3. **Execute actions** using discovered selectors

## Common Pitfall

❌ **Don't** inspect the DOM before waiting for `networkidle` on dynamic apps
✅ **Do** wait for `page.wait_for_load_state('networkidle')` before inspection

## Best Practices

- **Use bundled scripts as black boxes** - To accomplish a task, consider whether one of the scripts available in `scripts/` can help. These scripts handle common, complex workflows reliably without cluttering the context window. Use `--help` to see usage, then invoke directly. 
- Use `sync_playwright()` for synchronous scripts
- Always close the browser when done
- Use descriptive selectors: `text=`, `role=`, CSS selectors, or IDs
- Add appropriate waits: `page.wait_for_selector()` or `page.wait_for_timeout()`

## Reference Files

- **examples/** - Examples showing common patterns:
  - `element_discovery.py` - Discovering buttons, links, and inputs on a page
  - `static_html_automation.py` - Using file:// URLs for local HTML
  - `console_logging.py` - Capturing console logs during automation