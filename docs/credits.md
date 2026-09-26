# Credits

No car reaches the grid on its own. RaceForThePrize is a thin layer of
showmanship on top of other people's hard work — here is the pit crew.

> The same list is on the website as
> [credits.html](https://kertal.github.io/race-for-the-prize/credits.html).
> GitHub Pages serves this folder as written (there is no build step and no
> Jekyll), so the site keeps an HTML twin of this page. Change one, change the
> other — `tests/site.test.js` fails if they drift apart.

## The engine

| What | Why it's here |
|---|---|
| [Playwright](https://playwright.dev/) | Launches and drives every racer, records the video, and collects the traces the player is calibrated from. Apache-2.0. |
| [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/) | Network and CPU throttling, and every number on the performance profile. |
| [Node.js](https://nodejs.org/) | The whole CLI. MIT. |
| [ffmpeg.wasm](https://ffmpegwasm.net/) | In-browser video conversion when you export a side-by-side clip from the player, so no install is needed to leave with a file. |
| [FFmpeg](https://ffmpeg.org/) | The real thing, used by `--ffmpeg` for physically trimmed side-by-side composition. Licensed under the LGPL/GPL by its own authors. |
| [Vitest](https://vitest.dev/) | Every unit and integration test in the garage. MIT. |

Those are the only runtime dependencies, and that is on purpose — see the
dependency rule in [Working on the Tool](development.md).

## The name

The tool is named after "[Race for the Prize](https://www.youtube.com/watch?v=bs56ygZplQA)"
by [The Flaming Lips](https://www.flaminglips.com/) — two scientists racing for
the good of all mankind, which is roughly the energy two browsers bring to a
Wikipedia article. The song is theirs; this project just borrows the title and
plays it in the paddock.

## The track

The bundled demo races drive real public pages. Thanks to everyone who keeps
them up:

| Race | Where it drives |
|---|---|
| `demo:lauda-vs-hunt`, `demo:lebron-vs-curry` | [Wikipedia](https://en.wikipedia.org/) — Niki Lauda, James Hunt, LeBron James, Stephen Curry |
| `demo:react-vs-angular` | [React](https://react.dev/), [Angular](https://angular.dev/), [Svelte](https://svelte.dev/) and [htmx](https://htmx.org/) |
| `demo:caching-comparison` | [hush-hush-db](https://kertal.github.io/hush-hush-db/) |

The demos read those pages the way a visitor would — one page load, one scroll
— and nothing is republished here beyond the recordings you make yourself. Race
your own pages instead: see [Writing Your Own Race](writing-races.md).

## The crew

- Built by [@kertal](https://github.com/kertal).
- Everyone on the
  [contributors list](https://github.com/kertal/race-for-the-prize/graphs/contributors)
  — more very welcome, the grid has room.
- Everyone who has filed an
  [issue](https://github.com/kertal/race-for-the-prize/issues): a good bug
  report is a lap time.

## License

RaceForThePrize is released under the [MIT license](https://opensource.org/license/mit).
Every dependency above keeps its own — check theirs before you ship a build
that bundles them.
