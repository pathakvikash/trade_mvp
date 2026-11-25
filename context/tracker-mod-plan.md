# feature-tracker mod: upgrade plan (v0.5.0 to v0.6.0)

Status: plan only. The mod folder `/Users/vikash/.claude/mods/feature-tracker` was not writable
(see Blockers), so nothing in it was changed and the stub files are not created yet.

## 1. How register.tsx works today

File: `/Users/vikash/.claude/mods/feature-tracker/hooks/register.tsx` (about 32 KB, one file).

Structure:
- Module-level constants (`DIR`, `PAGE=12`, `STALE_DAYS=3`, `CHART_DAYS=14`, `MARK`, `COLOR`, `STATUSES`, `MONTHS`).
- Pure, exported helpers, all unit-tested by `tests/pane.test.tsx` (imports `../hooks/register`):
  `parseDate`, `dayKey`, `activity`, `totals`, `finishedToday`, `runningNow`, `stale`, `stepMatches`,
  `listSteps`, `normalise`. `bar()` and `segments()` are module-private (`segments` is exported).
- Data: `refresh($)` lists `DIR`, `JSON.parse`s every `*.json`, runs `normalise`, writes the `loaded` atom.
  Called on `session.start`, on `command.run`, on `$.clock.every(5000)`, and from the reload button.
  Parse errors go into `errors[]`, not thrown.
- State: `atom({ plugin: 'feature-tracker', key })` for loaded, selected, expanded, tab, filter, order,
  limit, hideDecisions. Read with `read($, atom)`, written with `update($, atom, fn)`. `hideDecisions` is
  also persisted with `$.store`.
- Render: one handler, `on('ui.render', { component: 'Pane', requestId: PANE })`. It takes primitives
  from `$.ui.resolve(e)` (`Box, Text, Button, Link, Markdown`). Everything is inline closures inside the
  handler: `progress()`, `steps()`, `decisions()`, `spec()`, `feedback()`, then `body = {...}[tab]`.
  Layout order: Targets strip, Live now strip, feature switcher buttons, feature header (title, bar, updated,
  summary, links), that feature's Live list, tab buttons, footer (expand all, collapse all, reload, hide
  Decisions), body, errors.
- Styling: terminal (Ink-style) primitives, no CSS and no SVG. Colour via `color=`/`dimColor`/`inverse`,
  using the `COLOR` map (green done, yellow running, red failed, magenta blocked). Glyphs from `MARK`
  (`✓ ▶ · ‖ ✗`). Bars use `█`/`░`. Stacked bars use `segments()`.

Implication: a graphic ring or SVG is not possible. Everything visual must be text cells.

## 2. New components (to build, not wired in yet)

All go in `hooks/` next to `register.tsx`. Each takes plain props plus the resolved `ui` primitives, reads no
atoms, and does no I/O, so it can be tested like the pure helpers.

| File | Purpose | Inputs | Output |
|---|---|---|---|
| `hooks/ProgressRing.tsx` | Done/total for one feature. Text only: a 10-20 cell bar with percent, e.g. `██████░░░░ 60% · 6/10`. A true ring is not renderable. | done, total | Text row |
| `hooks/ActiveBanner.tsx` | The active step prominently at the top of the selected feature: name, note, elapsed (`▶ 2d 3h`), eta if set, estimate if set. Fallback order: running step, first blocked or failed, else "nothing running". | tracker, now | Box with 2-3 lines |
| `hooks/StepTimeline.tsx` | Steps as rows: marker, name, duration column (`2h 10m`, elapsed for running, `—` when no dates), and a duration bar scaled to the longest step. | steps, now | Vertical list |
| `hooks/StatusChart.tsx` | Counts per status (done/running/todo/blocked/failed) as one stacked bar plus a count line. Reuses `totals()`/`segments()`. | steps | Two Text rows |
| `hooks/Sparkline.tsx` | Progress over time: cumulative done steps per day over 14 days, drawn with `▁▂▃▄▅▆▇█`. Built from `finishedDates()` (to be exported). | series of numbers | One Text row |

Wiring (for the Sonnet pass, after the stubs exist): in `register.tsx` `ui.render`, render `ActiveBanner`
above the Steps/Decisions/Spec/Feedback tab bar when `tab !== 'progress'`. Render `ProgressRing` and
`StatusChart` in the header. Render `StepTimeline` in place of the Steps list only when the user toggles
a "timeline" view, so the existing Steps list is unchanged by default. Render `Sparkline` in the Progress tab.

Stub contract (to create once writable): each file exports one function with the props above, returning
a `null` placeholder, and type-checks under `hooks/../../tsconfig` (`include` already covers `../../hooks`).

## 3. Proposed optional JSON fields (backward compatible)

Nothing existing changes. Old files still validate and render as before.

- `steps[].estimateMin` (number, optional): planned minutes. Used by `StepTimeline` (bar of actual vs
  estimate) and `ActiveBanner` ("12m of 45m").
- `steps[].eta` (string, optional, same date format as `started`, e.g. "26 Nov 18:00"): expected finish of
  a running step. Shown in `ActiveBanner`.
- `eta` (string, optional, top level): expected feature finish. Shown in `ProgressRing` line and the header.

Not proposed: an `active` flag (the running status already says it), and any change to `started`/`finished`
(they already exist). Add the three fields to `types/index.d.ts` (`Step`, `Tracker`) and to the Shape
section of `~/.claude/skills/feature-tracker/SKILL.md` only after the code lands. `normalise()` already
spreads unknown fields, so no normaliser change is needed.

## 4. Pure logic to add (exported, tested)

- `durationMs(step, now)`: started to finished, or started to now when running. Returns undefined when
  `started` is missing or unparseable.
- `estimateFraction(step, now)`: elapsed / estimateMin, capped at a display limit.
- `sparkSeries(trackers, now, days)`: cumulative done per day, built from `finishedDates()`.
- `activeStep(tracker)`: running step, else first blocked or failed, else undefined.

## 5. Edge cases

- No timestamps (most files: `devchat-*`, `eng-25066`, `eng-27162`, `tracewise-*`, `open-public-data-platform`
  have no `started`/`finished` on every step): timeline shows `—`, sparkline shows "no finish dates",
  ActiveBanner still works from status and `note`.
- Date-only values (`"13 Oct"` with no time): duration is whole days, not hours.
- Year boundary: a year-less `started` of "28 Dec" with `finished` "3 Jan" parses as a past date in the same
  year, so the duration goes negative. Fix: if finished < started, add one year to finished. Test it.
- Finished before started, or unparseable text: show `?`, never a negative or NaN.
- Zero steps: `ProgressRing` shows "no steps" and 0%. Guard the divide (`bar()` and `totals()` already guard
  total 0). `ActiveBanner` falls back to `target`/`summary`.
- No running step and no blocked or failed step: banner says "nothing running", does not render an empty box.
- Large files (300 KB): `refresh()` re-reads and re-parses every file every 5 s. Options, in order: keep as is
  (current largest is 63.5 KB, so it is fine for now); skip files whose size/mtime did not change, if the
  `$.fs` API exposes stat (not verified, check the engine types before relying on it); cap timeline rows the
  same way steps are windowed (PAGE). Do not add a worker. Mark any shortcut with a `ponytail:` comment.
- A step with a huge `detail` only renders when expanded (already true), so no change there.

## 6. Commands

From the mod folder's parent, using the absolute path:

```
claude plugin validate /Users/vikash/.claude/mods/feature-tracker
claude plugin test /Users/vikash/.claude/mods/feature-tracker
python3 -m json.tool /Users/vikash/work/context/trackers/<file>.json   # only for files you own
```

Baseline run on 2026-11-25 (before any change):
- `validate`: exit 0, "Validation passed with warnings". Warnings: no author; `types` declares `$` members
  but none found; a pre-existing TypeScript error at `register.tsx` line 572 (`update($, tabs, ...)` overload
  mismatch, `Record<string, string>` vs `Record<string, Tab>`). Directory-only warnings: README, LICENSE and
  icon missing (not needed for local use).
- `test`: 12 pass, 0 fail (`tests/pane.test.tsx`). The sandbox printed denied network lines for telemetry
  hosts; they did not affect the result.

Acceptance for the upgrade: `validate` exit 0 with no new TS warnings (the line 572 one may be fixed while
there), `test` 12+ pass with new tests for the pure functions above, CHANGELOG line, `plugin.json` version
0.6.0, and types updated.

## 7. Blockers

- Writing to `/Users/vikash/.claude/mods/feature-tracker/hooks/` fails: `touch hooks/.probe` returned
  `Operation not permitted` (exit 1). Not worked around. Because of it:
  - the stub component files are NOT created;
  - this plan is in `/Users/vikash/personal/trade_mvp/context/tracker-mod-plan.md` instead of `PLAN.md` in the mod.
- Needs the user: whether the mod folder should be writable for this task (sandbox write rules), or whether
  the stubs should be created by a session with access.
- UX call to confirm: the "ring" is a text bar, since terminal cells cannot draw a circle.
