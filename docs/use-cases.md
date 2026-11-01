# Use Cases: What You Can Race

Anything two browsers can both do, one of them faster. Here are the races
people actually run.


## A/B testing different versions of your app

Ship a performance regression? Find out before your users do. You can race two builds with either separate scripts (multi-spec mode) or one shared script (shared-spec mode).

### Multi-spec mode example

```text
races/checkout-v2-vs-v3/
  checkout-v2.spec.js    # Production: https://app.example.com
  checkout-v3.spec.js    # Staging: https://staging.example.com
```

### Shared-spec mode example (single codebase, commit-to-commit)

Use one script and switch commits per racer in a per-racer setup script:

```text
races/checkout-commits/
  race.spec.js
  checkout-commit.sh
  settings.json
```

`settings.json`:

```json
{
  "racers": {
    "main": {
      "setup": "./checkout-commit.sh",
      "vars": { "COMMIT_SHA": "origin/main", "URL": "http://localhost:5601/app/home" }
    },
    "candidate": {
      "setup": "./checkout-commit.sh",
      "vars": { "COMMIT_SHA": "feature/checkout-fast", "URL": "http://localhost:5601/app/home" }
    }
  }
}
```

`checkout-commit.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
git -C /path/to/your/repo checkout "$RACE_VAR_COMMIT_SHA"
```

`race.spec.js`:

```js
await page.goto(race.vars.URL);
await page.waitForSelector('.product-list');
await page.raceRecordingStart();
await page.waitForTimeout(1500);

await page.raceStart('Add to cart flow');
await page.click('.add-to-cart');
await page.waitForSelector('.cart-badge');
page.raceEnd('Add to cart flow');

await page.waitForTimeout(1500);
await page.raceRecordingEnd();
```

Run it under realistic conditions with throttling to see how it feels on real devices:

```bash
race-for-the-prize ./races/checkout-v2-vs-v3 --network=fast-3g --cpu=4 --runs=5
```

## Comparing competing products or frameworks

Which dashboard loads faster — yours or the competition? Which CSS framework renders a complex layout quicker? Set up a head-to-head:

```text
races/react-vs-svelte-todo/
  react-todo.spec.js      # React TodoMVC
  svelte-todo.spec.js     # Svelte TodoMVC
```

## Measuring the impact of a single change

Want to know if lazy-loading images actually helped? Create two racers that hit the same page — one with the feature flag on, one off:

```text
races/lazy-loading-impact/
  with-lazy.spec.js       # ?feature=lazy-images
  without-lazy.spec.js    # ?feature=eager-images
```

## Monitoring third-party script cost

Quantify the performance tax of analytics, chat widgets, or ad scripts by racing a page with and without them.

## Simulating real-world conditions

Combine network throttling and CPU slowdown to approximate mobile users on spotty connections:

```bash
race-for-the-prize ./races/my-race --network=slow-3g --cpu=6 --runs=3
```

Both `--network` and `--cpu` accept a list. Every combination is raced separately, each into its own results subdirectory:

```bash
race-for-the-prize ./races/my-race --cpu=1,4              # cpu1x/, cpu4x/
race-for-the-prize ./races/my-race --network=slow-3g,4g --cpu=1,4  # slow-3g-cpu1x/, slow-3g-cpu4x/, 4g-cpu1x/, 4g-cpu4x/
```

Afterwards you get a **performance matrix** — network presets down the side, CPU rates across the top, every racer's total time in each cell — printed to the terminal and rendered as the top-level `index.html`, where each cell links to that condition's own results:

```text
  ⚡ Performance Matrix
  Network  CPU 1x            CPU 4x
  none     🏆 lauda  0.900s  🏆 lauda  3.600s
              hunt   1.100s     hunt   4.400s

  slow-3g  🏆 hunt   2.720s  🏆 hunt  10.880s
              lauda  2.880s     lauda 11.520s
  Conditions won: lauda 2 · hunt 2
```

One race per condition tells you who won each; the matrix tells you how the field holds up as conditions get harder — and whether the winner flips somewhere along the way.

The HTML matrix also has a **Compare** picker: switch the whole grid from total time to any performance-profile metric that was captured — network transfer, request count, script execution, layout time, TTFB, FCP, LCP, CLS, DOM timings, JS heap — for the measured section or the total recording. Bars rescale to the chosen metric, and a cell is only called a win when the difference clears that metric's significance threshold; anything smaller shows as a tie.

The `--runs` flag takes the median, smoothing out noise and giving you a number you can trust. In multi-run mode, each racer independently picks the run closest to their own median — so if Racer A performed best in Run 2 and Racer B in Run 4, each gets their own representative video. The results page shows which runs were selected (e.g., "Runs 2, 4").


---

Next: [race flags and settings.json](cli.md) · [reading the results](results.md)
