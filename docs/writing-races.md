# Writing Your Own Race

Every race is a directory: two to five racers, an optional `settings.json`, and
optional setup/teardown scripts. Scaffold one with `race-for-the-prize --init
my-race`, or build it by hand from the two modes below.

Every race needs at least two contenders (up to five), in one of two modes.

## Mode 1: Multi-spec mode

Use this when each racer needs custom logic. Create one `.spec.js` file per racer:

```text
races/my-race/
  contender-a.spec.js   # Racer 1 (filename = racer name)
  contender-b.spec.js   # Racer 2
  contender-c.spec.js   # Racer 3 (optional — up to 5 racers)
  settings.json          # Optional: race conditions
  setup.sh               # Optional: runs before the race (see Setup and Teardown)
  teardown.sh            # Optional: runs after the race
```

## Mode 2: Shared-spec mode

Use this when racers share the same script but differ by variables (URL, commit, feature flags). Keep one `race.spec.js` and define racers in `settings.json`:

```text
races/my-race/
  race.spec.js           # Shared script used by all racers
  settings.json          # Required: defines racers + vars
  race.setup.sh          # Optional: shared per-racer setup in shared-spec mode
  setup.sh               # Optional: global setup
  teardown.sh            # Optional: global teardown
```

```json
{
  "racers": {
    "commit-a": { "vars": { "URL": "https://app.example.com?ref=a" } },
    "commit-b": { "vars": { "URL": "https://app.example.com?ref=b" } }
  }
}
```

In shared-spec mode, racer order follows key declaration order in `racers`. Use non-numeric racer names (integer-like names such as `"0"` are rejected to keep ordering deterministic). Access per-racer values via `race.vars`:

```js
await page.goto(race.vars.URL);
```

Setup scripts are optional in both modes.
If both modes are technically possible, prefer shared-spec mode for faster A/B experiments with less duplicated code.
In shared-spec mode, `race.setup.sh`/`.js` can be used as a shared per-racer setup convention (still overridable per racer in `settings.racers.<name>.setup`).

Each script gets a Playwright `page` object with race timing built in:

```js
// Navigate and wait for the page to be ready
await page.goto('https://example.com', { waitUntil: 'load' });
await page.waitForSelector('.action-button');

// Start recording early — gives viewers context before the action
await page.raceRecordingStart();
await page.waitForTimeout(1500);

// Drop the flag — start the clock
await page.raceStart('Full Page Load');

// Do whatever you're measuring
await page.click('.action-button');
await page.waitForSelector('.result-loaded');

// Checkered flag — stop the clock
page.raceEnd('Full Page Load');

// Hold the frame so the video doesn't cut abruptly
await page.waitForTimeout(1500);
await page.raceRecordingEnd();
```

## The Race API

| Method | What it does |
|---|---|
| `await page.raceStart(name)` | Starts the stopwatch for a named measurement |
| `page.raceEnd(name)` | Stops the stopwatch — time is recorded |
| `await page.raceRecordingStart()` | Manually start the video segment |
| `await page.raceRecordingEnd()` | Manually end the video segment |
| `page.raceMessage(text)` | Send a status message to the CLI terminal |
| `await page.raceWaitForVisualStability(opts?)` | Wait for rendering to settle before measuring |

If you skip `raceRecordingStart`/`End`, the video automatically wraps your first `raceStart` to last `raceEnd`.


## Setup and Teardown Scripts

Need to start a dev server before racing, or clean up after? Drop setup and teardown scripts into your race directory — they run automatically.

### Convention-based discovery

```text
races/my-race/
  setup.sh              # Global setup — runs before all races
  teardown.sh           # Global teardown — runs after all races (even on failure)
  contender-a.spec.js
  contender-a.setup.sh  # Per-racer setup — runs before this racer
  contender-a.teardown.sh
  contender-b.spec.js
  settings.json
```

Supported extensions: `.sh` (shell, requires bash) and `.js` (Node.js). When both exist, `.sh` takes priority. Note: `.js` files run according to Node's module resolution rules (ESM or CommonJS depends on the nearest `package.json` with `"type": "module"`).

Scripts receive the `RACE_DIR` environment variable pointing to the race directory. Per-racer setup and teardown scripts also receive each entry from that racer's `vars` (in `settings.json`) as `RACE_VAR_<KEY>` — useful for sharing one script across racers that only differ by a commit hash, branch name, etc.

### Settings-based configuration

For more control, configure scripts in `settings.json` with timeouts and service readiness polling:

```json
{
  "setup": {
    "command": "./start-server.sh",
    "timeout": 120000,
    "waitFor": {
      "url": "http://localhost:3000/health",
      "timeout": 30000,
      "interval": 1000
    }
  },
  "teardown": "./stop-server.sh",
  "racers": {
    "contender-a": {
      "setup": "./seed-db.sh",
      "teardown": "./cleanup-db.sh"
    }
  }
}
```

| Field | Type | Description |
|---|---|---|
| `setup` / `teardown` | `string` or `object` | Script path (relative to race dir) or config object |
| `command` | `string` | Script path when using object form |
| `timeout` | `number` | Max execution time in ms (default: 300000) |
| `waitFor.url` | `string` | Poll this URL after script completes |
| `waitFor.timeout` | `number` | Max polling time in ms (default: 30000) |
| `waitFor.interval` | `number` | Polling interval in ms (default: 1000) |

### Execution order

1. Global setup
2. For each racer, in order:
   - Per-racer setup (e.g., `contender-a.setup.sh`)
   - All runs of that racer
3. Per-racer teardown (for each racer, even on failure)
4. Global teardown (even on failure)

When per-racer setup scripts exist, racers run one at a time (split mode) so each setup can prepare the environment before its racer's runs. Without per-racer setups, all racers run together in each run.

Set `setup` or `teardown` to `false` or `""` in settings to explicitly disable a discovered script.


---

Next: [what you can race](use-cases.md) · [race flags and settings.json](cli.md)
