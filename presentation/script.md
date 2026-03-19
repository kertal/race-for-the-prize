# RaceForThePrize — Presentation Speaker Script

> **Format:** 18 slides · ~15 minutes · Q&A optional
>
> **Audience:** Developers, engineering managers, DevOps/platform teams
>
> **Goal:** Convince the audience that RaceForThePrize is the most natural way to answer "which one is faster?" for web browser performance.

---

## Slide 1 — Title

*[Pause for the room to settle. Speak with energy from the start.]*

"Welcome to race day."

That's how the README opens, and I mean it literally. What I'm about to show you is a tool that turns browser performance testing into a race — two browsers, side by side, competing on a track you define. No statistics degree required. No dashboard to configure. Just: write two scripts, fire the starting gun, and the browser that finishes first wins.

The tool is called **RaceForThePrize**. It runs on Node.js, it's powered by Playwright, and you can be up and running in under a minute.

---

## Slide 2 — The Problem

Let me start with the question every front-end developer has asked at some point:

*"Is the new version actually faster?"*

You've shipped a refactor. You've swapped frameworks. You've added lazy loading. And someone in code review asks: "But how much faster is it, really?" And you fumble for an answer.

Lighthouse gives you a score — but it's a snapshot of one page, not a comparison. Manual timing with DevTools is error-prone and not reproducible. A/B testing requires production traffic. Synthetic benchmarks rarely reflect real user flows.

None of these answer the question cleanly. **What you actually need is a head-to-head race.** You need two contenders, the same conditions, and a finish line. That's exactly what RaceForThePrize provides.

---

## Slide 3 — What Is It?

At its core, RaceForThePrize is a **CLI tool** that takes two Playwright `.spec.js` files — your "racers" — and runs them against each other.

Each racer gets its own Chromium browser. Both execute the same user journey: clicking, scrolling, navigating, typing — whatever the real scenario is. You mark the start and end of each measurement with a simple API call, and the tool does the rest: records the session, captures timings, and generates a full race report.

The diagram on this slide shows the structure. Racer A gets Browser 1. Racer B gets Browser 2. Both cross the same finish line. You get a winner.

The beauty is that *any* Playwright script can become a racer. If you already have end-to-end tests, you're most of the way there.

---

## Slide 4 — Quick Start

Let me show you how fast this is.

If you want to install globally:

```bash
npm install -g race-for-the-prize
```

Then scaffold a new race:

```bash
race-for-the-prize --init my-race
```

That creates a folder with two starter spec files and a settings file. Then:

```bash
race-for-the-prize my-race
```

And you're off. Two Chromium windows open, you watch them race in the terminal with a live animation, and in 30 seconds you have a result.

*Or*, if you cloned the repo, just run:

```bash
node race.js ./races/lauda-vs-hunt
```

That fires up one of the built-in races. Which brings me to my favourite demo.

---

## Slide 5 — The Race API

Before I show you the demo, let me show you what a racer script actually looks like.

*[Point to the code on screen.]*

This is `lauda.spec.js` — one of the two racers in the built-in Lauda vs Hunt race. The first line is a plain Playwright `page.goto()`. Nothing special. Then:

- `raceRecordingStart()` — tells the tool to begin recording video from this moment
- `raceStart('Scroll to Bottom')` — starts the stopwatch for a named measurement
- The scroll loop in the middle is standard Playwright — mouse wheel events, `waitForTimeout`, `page.evaluate` to check scroll position
- `raceEnd('Scroll to Bottom')` — stops the stopwatch
- `raceMessage()` — sends a live message to the terminal animation (optional)
- `raceRecordingEnd()` — finishes the recording

That's it. Five injected methods — six if you count `raceWaitForVisualStability`, an advanced helper for ensuring the page has settled before timing begins. The rest is normal Playwright code.

*[Emphasise:]* Any existing Playwright test can become a racer in minutes.

---

## Slide 6 — The Demo GIF

Now for the main event.

*[Display the GIF and let it run.]*

This is the Lauda vs Hunt race. Niki Lauda — "The Computer" — on the left. James Hunt — "The Shunt" — on the right. Both are scrolling to the bottom of their Wikipedia pages. Both are doing it with human-like mouse wheel events — random step sizes, short pauses between steps.

You can see the terminal animation at the top: elapsed time, live status messages from each racer, the spinner indicating they're running.

At the end, one of them crosses the finish line first. The report drops into your terminal. Winner declared. No arguments.

This is, on purpose, a silly race. But it demonstrates the entire pipeline: two scripts, two browsers, one winner. Replace the Wikipedia scrolling with your app's critical user journey and you've got a real benchmark.

---

## Slide 7 — What You Get

After every race, a timestamped results folder is created. Let me walk you through what's in it.

`README.md` is a human-readable race report: medal table, timings, percentage differences, machine info. This is what you'd share with your team or paste into a pull request.

`summary.json` is the machine-readable version. Every CI pipeline can read this.

`index.html` is an interactive HTML player — open it in a browser, and you get the race video with a timeline, calibrated timestamps, and trace analysis. You can scrub to any point in the race and see exactly what was happening.

The `<racer>.race.webm` files are the trimmed race videos and `<racer>.full.webm` is the full uncut recording. The `<racer>.trace.json` files are Chrome DevTools performance traces — if you want to go deep on what caused the timing difference, the data is there.

*[Beat:]* You're not just getting a number. You're getting full forensic evidence.

---

## Slide 8 — Race Report Sample

Here's what the markdown race report actually looks like.

*[Point to the medal table.]*

It shows each racer's placement, their time for each named measurement, and the percentage difference versus the winner. If you run multiple times, the report shows all individual run times alongside the median.

The machine section captures the OS, Node version, network throttle setting, and CPU multiplier. This matters because reproducing a benchmark means knowing *exactly* what conditions it ran under. If someone questions your numbers, you have receipts.

This format is designed to be dropped straight into a GitHub PR description or a Confluence page. No reformatting needed.

---

## Slide 9 — Race Conditions

Here's where it gets powerful for real-world testing.

Not all your users are on fiber. Not all of them are running a MacBook Pro. If your app is used on mobile, or in regions with slow networks, you need to test it under those conditions.

*[Walk through the flags.]*

`--network=slow-3g` simulates a slow 3G connection via CDP — Chrome DevTools Protocol. The throttling happens at the browser level, so it affects all requests, not just `fetch()` calls.

`--cpu=4` means the JavaScript engine runs at one-quarter speed. This simulates a low-end Android device. If your app is struggling there, `--cpu=4` will expose it.

`--runs=5` runs the race five times and reports the **median**. This filters out one-off garbage collection pauses or OS scheduling noise. Your result reflects a typical run, not a lucky one.

`--parallel` runs both browsers simultaneously — useful for visual demos or when you want to capture both browsers in the same video. Sequential mode is the default because it's more accurate; parallel mode is great for presentations exactly like this one.

---

## Slide 10 — Architecture

I want to take 60 seconds on the architecture because a few design decisions explain *why* the tool is accurate.

*[Point to the diagram.]*

There are two processes. `race.js` is the CLI — it handles argument parsing, terminal animation, and report generation. It's written in ESM (modern JavaScript modules).

`runner.cjs` is the Playwright engine — it runs as a **subprocess**. This is a deliberate design choice. Playwright has requirements that make CommonJS the right format for the runner. By running it as a subprocess, we also get isolation: if the browser crashes, it doesn't take down your CLI session.

The runner launches two Chromium instances, injects the race API, records video, applies CDP throttling, and outputs JSON results on stdout. The CLI reads that JSON and builds the report.

The video timing is worth highlighting. Most tools just record the full session and hope you can figure out which frames to look at. RaceForThePrize injects **colored pixel cues** into the page at the exact moment `raceRecordingStart()` and `raceRecordingEnd()` are called. The Canvas API detects those cues frame by frame, giving you millisecond-accurate trim points. No guessing, no approximation.

---

## Slide 11 — Use Cases

Let me give you four concrete scenarios where this tool changes the conversation.

**Framework comparisons.** If your team is evaluating React vs Angular for a new project, you can write the same user flow in both and race them. The `races/react-vs-angular` directory in the repo is exactly this.

**Feature impact measurement.** Say you've added lazy loading to your app. Write `before.spec.js` that loads the page without it, and `after.spec.js` with it. Race them. Your PR comment now says "this saves 1.2 seconds on 4G" — not "should be faster".

**Regression detection in CI.** Check out `main` and `your-branch`, write specs that exercise the critical path, and run the race in your pipeline. If the branch regressed, the CI job fails. This is the most powerful use case for teams shipping frequently.

**Third-party script cost.** Run your page with and without that analytics tag, that chat widget, that A/B testing library. Put a number on it. Make an informed decision about whether it's worth the cost.

---

## Slide 12 — Built-in Races

The repo ships with several races out of the box. They're not just demos — they're templates.

`lauda-vs-hunt` is the simplest: one measurement, two scroll strategies, one winner. Perfect for understanding the basics.

`lebron-vs-curry` goes deeper. It simulates basketball physics — a bouncing dribble with gravity and deceleration — synchronized across both browsers using a `SyncBarrier`. Then both scroll back to the top using different easing curves. It's fun, but it's also demonstrating that you can synchronize complex multi-step interactions across two browsers and measure specific segments of a longer journey.

`grafana-vs-kibana` is a real-world comparison of two production dashboards. That's the kind of race that matters in a team choosing between tools.

*[Pause:]* Every race tells a story. What story do you need to tell?

---

## Slide 13 — Parallel Mode

Parallel mode deserves a slide of its own because it's visually compelling.

In sequential mode — the default — Racer A runs completely, then Racer B runs. This gives you maximum accuracy because they're not competing for CPU and network resources.

In parallel mode, both browsers race *simultaneously*. You see both terminal bars updating in real time. You watch one pull ahead, then the other catches up. It's genuinely exciting to watch, and it makes for great demo material.

The `SyncBarrier` class ensures a fair start. Both browsers reach a "ready" checkpoint before either is allowed to begin. So you don't get one racer with a head start just because it initialized faster. The gun fires for both at the same moment.

For presentations — like this one — parallel mode is the right choice. For CI pipelines where accuracy matters, stick with sequential.

---

## Slide 14 — Video Output

The video output is one of the most underrated features.

By default, recordings are WebM — no external dependencies, just Playwright's built-in recording. The HTML player trims them virtually using the calibrated timestamps, so the video starts at `raceRecordingStart()` and ends at `raceRecordingEnd()` without any file processing.

With `--ffmpeg`, you get **physical trimming** — the video file is actually cut, so you can share it directly. You can also get GIFs, which embed in GitHub comments, Slack messages, and Confluence pages. The side-by-side composition takes both browser recordings and stitches them into a single video — like the race GIF I showed you earlier.

`--slowmo` lets you replay at a fraction of normal speed. If you're trying to spot a layout shift or a jank frame, slow-motion replay makes it visible.

*[Key point:]* The video shows exactly what was measured. Because the cues are detected at the pixel level, the trim is frame-accurate. What you see is what was timed.

---

## Slide 15 — CI/CD Integration

For teams that care about performance regressions — which should be all teams — this is the most important slide.

Every race produces `summary.json`. You can read it in a post-race script, check whether the winner is the expected contender, and fail the CI job if performance regressed.

*[Walk through the JSON.]*

The `overallWinner` field tells you who won. `comparisons` gives you an array of per-measurement results — name, winner, and timings for each racer. `wins` maps each racer's name to how many individual measurements they won. `runs` records how many times the race was repeated.

You can write a ten-line Node script that reads this JSON and sets your exit code. Or you can pipe it into a dashboard, a Slack notification, a database — whatever your observability stack looks like.

The key point: **performance is now a pass/fail criterion**, just like your unit tests. The race either confirms you didn't regress, or it catches the slowdown before it ships.

---

## Slide 16 — Getting Started

Three paths to getting started:

Option 1 is global install. You install once, and you can run `race-for-the-prize` from any directory on your machine. `--init` scaffolds a starter race with a settings file and two spec files. You're writing your first real race in under five minutes.

Option 2 is `npx`. No global install, no commitment. Run it once, see if you like it.

Option 3 is cloning the repo to explore the built-in races and the source code. If you want to understand the architecture, the test suite, or contribute — this is the starting point.

Requirements are minimal: Node 18+, and Chromium (which installs automatically via the `postinstall` script). FFmpeg is optional — only needed if you want physical video trimming or GIF export.

---

## Slide 17 — Summary

Let me bring this back to the question we started with:

*"Is the new version actually faster?"*

With RaceForThePrize, you can answer that question in minutes, with video evidence, reproducible results, and a machine-readable report you can drop into your PR or your CI pipeline.

*[Walk through the table.]*

It's Playwright-native — no extra instrumentation, no SDK to wrap your app in. The race API is five core methods. Frame-accurate video means the evidence is unambiguous. Real-world throttling means your numbers reflect actual user conditions. And `summary.json` means performance can be a quality gate in your pipeline.

The last line of the README says it best:

*"No judges, no bias — just cold, hard milliseconds on the clock."*

---

## Slide 18 — Thank You / Q&A

*[End with energy.]*

Thank you. That's RaceForThePrize.

If you want to try it right now, you can get started with one command:

```bash
npx race-for-the-prize --init my-race
```

And you'll have your first race running in under a minute.

I'm happy to take questions — on the tool, the architecture, use cases, or anything else.

*[If time permits, offer to live-demo `node race.js ./races/lauda-vs-hunt`.]*

---

## Presentation Tips

**Timing:** ~15 minutes at a comfortable pace. Each slide is roughly 45–60 seconds. Allow 5 minutes of buffer for questions or the live demo.

**Demo opportunity:** After Slide 6 (or Slide 4), offer to run a live race if the environment allows it. `node race.js ./races/lauda-vs-hunt --headless` takes about 20–30 seconds and makes a strong impression.

**Audience adaptation:**
- *For developers:* Spend more time on Slides 5, 10, and 13 (API, architecture, parallel mode).
- *For managers/leads:* Emphasise Slides 2, 11, and 15 (problem, use cases, CI integration).
- *For DevOps/platform:* Focus on Slides 9, 15, and 10 (conditions, CI, architecture).

**Key phrases to land:**
- "Any existing Playwright test can become a racer in minutes."
- "The video shows exactly what was measured."
- "Performance is now a pass/fail criterion, just like your unit tests."
- "No judges, no bias — just cold, hard milliseconds on the clock."
