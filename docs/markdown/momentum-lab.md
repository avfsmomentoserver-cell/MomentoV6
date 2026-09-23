# Momentum Lab (v6.1)

The Momentum Lab (`/dashboard/momentum`) adds a structure layer on top of the
prediction pipeline. Every module here reads the same measured round history the
Accuracy Engine verifies against — nothing is hand-tuned, everything is computed
from data.

## Combined hit points (time-bucketed candles)

Every round lands in the time bucket that contains its end time (1m / 5m / 15m
selectable). Each bucket renders as a candle: open/high/low/close come from the
actual multipliers inside the bucket.

**Mega-hit splitting:** a round ≥ 10× is treated as spanning multiple buckets —
`span = ceil(multiplier / 10)` capped at 4. A 15× hit over 5-minute buckets
contributes 7.5 to its own bucket and 7.5 to the next ("divided by half or
equivalent"). The bucket's **combined hit-point energy** is the split-adjusted
sum; raw sums are shown separately. Mega splits are visible as amber chips under
the energy chart and feed the FX payload and the continuous assessment module.

## Anchors

An anchor is a local peak: a round strictly above its previous neighbour and at
or above its next neighbour (`1.2x → 3x → 2.1x`: the 3x is the anchor). The
structure spans the surrounding troughs and **can contain any number of rounds**
— the lab reports each anchor's size (rounds), peak, and legs.

The **direction effect** is measured, not assumed: after each anchor completes
(its right trough forms), the next 10 rounds are compared to the global mean.
The panel reports the share of anchors followed by above-average drift, split by
structure size (small <5 / medium 5-15 / large >15 rounds). The live state shows
whether an anchor is **forming** (rising run since the last trough, with the
running potential peak) or was just **released**.

## Range momentum

For each threshold range (2×+, 5×+, 10×+, 50×+, 100×+):

- **medianGap** — median rounds between hits, all history
- **recentGap** — median of the last 3 gaps
- **momentum** — `medianGap / recentGap`, clamped to 3. Very short intervals
  between e.g. 5×+ hits push the score above 1: the range is heating
- **trend** — accelerating / steady / cooling, plus the current run since the
  last hit

## Moonshot conditions research

For every historical ≥10× hit the module records the preceding state: rounds
since the previous moonshot, the sub-2× streak, the mean of the prior 10 rounds,
whether an anchor peak sat within the last 6 rounds, and the prior 5-minute
bucket energy. Medians and quartiles form the researched profile; the live state
is scored against it into a **readiness gauge (0-100)** with a per-condition
checklist. This is a pressure gauge, not a guarantee — the note in the panel
says exactly that.

## Range-filtered prediction

Bands (2-5×, 5-10×, 10×+) are each forecast on their own filtered hit series:
per-round probability blends the band's measured rate with the geometric
estimate from its median gap, then window probabilities follow the live cadence.

## Inverted forecast — the backwards lens

The inverted lens reads everything backwards: the series order is reversed (the
latest round is read as the last round) and magnitudes are compressed from the
top — `multiplier' = median / multiplier`, so 1× rounds spread out and high
rounds compress together. A "high" in the inverted lens is a **sub-threshold
round in real space**, so its window read is the **dip probability** — the
bearish companion to the standard forecast. Shown side-by-side with the standard
windows; when standard P(hit) is high and the inverted dip probability is low,
both lenses agree the window should clear.

## Continuous assessment

Between window resolutions, the assessment module watches every open
prediction: progress through the window, max seen so far, whether the threshold
has already cleared, and pace vs the expected cadence. It also scores the
recent 5-minute hit-point buckets against their own trailing 6-bucket mean
(**agreement** within ±50%, and a **drift index** where 1.0 = flat). The same
data appears on the Accuracy Engine page — accuracy stays verified at
unlimited scale while assessment keeps watching live.

## API

- `GET /api/v1/momentum/overview?bucketMs=300000` — everything above
- `GET /api/v1/momentum/hitpoints?bucketMs=` — buckets only
- `GET /api/v1/momentum/anchors` — anchor structures + direction stats
- `GET /api/v1/momentum/assessment` — continuous assessment of open predictions
- `GET /api/v1/pipeline/forecast` — now carries `inverted` alongside the
  standard windows; `GET /api/v1/fx` embeds hit points, anchor state, and range
  momentum
