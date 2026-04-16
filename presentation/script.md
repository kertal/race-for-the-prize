# RaceForThePrize — Presentation Speaker Script

> **Format:** 10 slides · ~12 minutes · Q&A optional
>
> **Audience:** Developers, engineering managers, DevOps/platform teams
>
> **Goal:** Convince the audience that RaceForThePrize is the most natural way to answer "which one is faster?" for web browser performance.

---

## Slide 1 — Title

*[Pause for the room to settle. Speak with energy from the start.]*

"Welcome to race day."

That's how the README opens, and I mean it literally. What I'm about to show you is a tool that turns browser performance testing into a race — 2 to 5 browsers, side by side, competing on a track you define. No statistics degree required. No dashboard to configure. Just: write your scripts, fire the starting gun, and the browser that finishes first wins.

The tool is called **RaceForThePrize**. It runs on Node.js, it's powered by Playwright, and you can be up and running in under a minute.

---

## Slide 2 — Numbers Tell You What. Racing Shows You Why.

Let me start with a question every front-end developer has asked at some point: *"Is the new version actually faster?"*

You've shipped a refactor. You've swapped frameworks. You've added lazy loading. Lighthouse gives you a score — but it's a snapshot, not a comparison. A CI metric moved by 8% — but what does that look like to a user?

*[Point to the table.]*

Traditional benchmarking tools and RaceForThePrize are **complementary**. Lighthouse tells you the LCP improved from 3.2s to 2.1s. RaceForThePrize shows you both pages loading side by side so you can *see* what that difference feels like. When a metric moves, race it to understand why.

---

## Slide 3 — How It Works

At its core, RaceForThePrize is a CLI tool that takes 2 to 5 Playwright `.spec.js` files — your "racers" — and pits them against each other.

Each racer gets its own Chromium browser. They all execute their user journey: clicking, scrolling, navigating. You mark the start and end of each measurement with a simple API call, and the tool does the rest: records the session, captures timings, and generates a full race report.

*[Point to the code.]*

```bash
npm install && npx playwright install chromium
node race.js --init my-race          # scaffold a starter race
node race.js ./races/lauda-vs-hunt   # run a built-in race
```

You can scaffold a new race with `--init`, or jump straight into one of the built-in examples. Browsers launch, the race runs, and the winner is declared. Any existing Playwright test can become a racer in minutes.

---

## Slide 4 — The Race API

*[Point to the code on screen.]*

This is all you need to instrument a race. A few calls wrapped around your existing Playwright interactions:

- `raceRecordingStart()` — begin recording video
- `raceStart('name')` — start the stopwatch for a named measurement
- `raceMessage('text')` — send live status updates to the terminal
- `raceEnd('name')` — stop the stopwatch
- `raceRecordingEnd()` — finish the recording

There's also `raceWaitForVisualStability()` — useful when you need rendering to settle before you start measuring. Think of it as "wait for the page to stop moving."

Everything in between is normal Playwright code. If you already have end-to-end tests, you're most of the way there.

*[Emphasise:]* Any existing Playwright test can become a racer in minutes.

---

## Slide 5 — Live Race — Lauda vs Hunt

Now for the main event.

*[Display the GIF and let it run.]*

This is the Lauda vs Hunt race. Niki Lauda on the left, James Hunt on the right. Both scrolling to the bottom of their Wikipedia pages with human-like mouse wheel events.

You can see the terminal animation: elapsed time, live status from each racer. At the end, one crosses the finish line first. Winner declared. No arguments.

This is a deliberately simple race — but replace the Wikipedia scrolling with your app's critical user journey and you've got a real benchmark.

---

## Slide 6 — What Can You Race?

*[This is the "imagination" slide — help the audience see their own use cases.]*

The built-in examples are fun, but the real power is in your own workflows.

A/B testing: point two racers at production vs staging. Same checkout flow, different builds. You'll see the difference before your users do.

Framework comparison: the `react-vs-angular` example ships with four racers — React, Angular, Svelte, and htmx — all loading the same benchmark. Up to five racers in a single heat.

Single-change measurement: lazy loading on vs off? Feature flag enabled vs disabled? Two racers, same page, different query params.

Third-party cost: race a page with and without your analytics script. You'll finally have a number to attach to "the marketing tag is slowing us down."

And you can run these in CI on a schedule — fail the build if performance regresses.

---

## Slide 7 — What You Get

After every race, a timestamped results folder is created.

*[Walk through the table.]*

`index.html` is an interactive HTML player — open it in a browser and get the race video with segment navigation, calibrated timestamps, and a timeline. You can jump directly to any named measurement.

`README.md` is a human-readable report: medal table, timings, percentage differences, machine info. Drop it straight into a PR description.

`summary.json` is the machine-readable version. Every CI pipeline can read this — check the winner, fail the job if performance regressed.

Every race also generates Chrome performance traces you can open in `chrome://tracing`, and with `--har` you get full network traffic logs.

The recordings are frame-accurate: colored pixel cues are injected at `raceRecordingStart/End`, detected via Canvas API, so the video shows *exactly* what was measured.

---

## Slide 8 — Advanced Features

*[This slide is a quick tour — don't dwell on every row. Pick two or three to highlight based on your audience.]*

Multiple runs with `--runs=5` gives you the median, which smooths out noise. Each racer independently picks their own median run — so the representative video is always fair.

Network and CPU throttling simulate real-world conditions. `--network=slow-3g --cpu=4` approximates a mobile user on a spotty connection. This is where you catch regressions that don't show up on your MacBook Pro.

Setup and teardown scripts let you start dev servers, seed databases, and clean up — all automatically. Drop a `setup.sh` into your race directory and it runs before the race starts.

Parallel mode is the demo day showpiece — all browsers racing side by side in real time. Not the most accurate for timing, but it looks spectacular in presentations.

*[Point out:]* CLI flags always override `settings.json` — so you can have defaults in the race directory and override them on the command line for specific situations.

---

## Slide 9 — CI Integration

*[For DevOps-heavy audiences, spend more time here. For developer audiences, keep it brief.]*

Running races in CI is straightforward. `--headless` means no visible browser, `--no-serve` skips the auto-open, and `--runs=3` gives you stable results.

The `summary.json` output is designed for machines. Parse it in your CI pipeline to check the winner, compare timings, or fail the build if a threshold is exceeded.

The `README.md` report is designed for humans. Copy-paste it into a PR description and reviewers can see the performance impact at a glance.

Performance becomes a pass/fail criterion — just like your unit tests. That's the goal.

---

## Slide 10 — Get Started

*[End with energy.]*

Three steps:

1. Clone the repo and install
2. Run `node race.js ./races/lauda-vs-hunt`
3. Explore the built-ins: `lauda-vs-hunt`, `lebron-vs-curry`, `react-vs-angular`

You can also install globally with `npm install -g race-for-the-prize` and run `race-for-the-prize --init my-race` from any directory.

You'll have your first race running in under a minute. I'm happy to take questions — on the tool, the architecture, or use cases.

*[If time permits, offer to live-demo `node race.js ./races/lauda-vs-hunt`.]*

---

## Presentation Tips

**Timing:** ~12 minutes at a comfortable pace. Each slide is roughly 60–90 seconds. Allow 3–5 minutes buffer for questions or a live demo.

**Demo opportunity:** After Slide 5, offer to run a live race if the environment allows it. `node race.js ./races/lauda-vs-hunt --headless` takes about 20–30 seconds and makes a strong impression.

**Short version:** For a 7-minute talk, skip Slides 6 (Use Cases), 8 (Advanced Features), and 9 (CI Integration). The core story flows naturally from Title → Positioning → How It Works → API → Demo → What You Get → Get Started.

**Audience adaptation:**
- *For developers:* Spend more time on Slides 4 and 7 (API, what you get).
- *For managers/leads:* Emphasise Slides 2, 6, and 7 (positioning, use cases, outputs).
- *For DevOps/platform:* Focus on Slides 8 and 9 (advanced features, CI integration).

**Key phrases to land:**
- "Any existing Playwright test can become a racer in minutes."
- "The video shows exactly what was measured."
- "Performance is now a pass/fail criterion, just like your unit tests."
- "Up to five racers in a single heat."
- "May the fastest browser win."
