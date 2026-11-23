# Token Launch Radar model

The radar ranks candidate protocols using a single dated snapshot.
Its unit of comparison is a protocol slug, and its scoring unit is whole US dollars.
Start with the ranked board to find candidates and open a row to trace its score.

## Reading implied launch value

Implied launch value is the model's estimate of launch-scale valuation based on recorded protocol activity.
TVL, or total value locked, is the starting measure of scale.
The score adjusts that baseline for the kind of activity, recent growth, recorded age, and chain breadth.
Two protocols with identical TVL can receive different estimates because their inputs differ.

The model has no token supply, circulating float, or exchange price input.
Those omissions put per-token prices, circulating market caps, and fully diluted valuations outside its remit.
The estimate says nothing about whether or when a launch will happen or whether a wallet qualifies for a reward.
Treat the dollar figure as a way to order research, with uncertainty around both inputs and assumptions.
TVL can change as asset prices move, even when no new deposits arrive.
Recorded age measures time since the snapshot's listing date, which can differ from the project's founding date.

## How `radar-contour-1` scores a row

Multiply TVL by the category multiple, then multiply by a combined adjustment.
Compute the adjustment by multiplying maturity by growth, adding the chain bonus, and subtracting the young discount.
Round once to whole dollars and bound the result between $1 and $100 trillion.
For example, $100 million of lending TVL with a combined adjustment of 0.90 scores $30.6 million.

### Category multiples

The first matching category pattern determines the tier, using case-insensitive matching.
The table follows the order in which the classifier tries those patterns.

| Model tier | Category label pattern | TVL multiple |
| --- | --- | ---: |
| `lending` | lend, CDP, collateral | 0.34× |
| `dex` | DEX, liquidity manager | 0.39× |
| `bridge` | bridge | 0.12× |
| `staking` | stak | 0.17× |
| `derivatives` | perpetual, derivative, options, basis trading, synthetic | 0.31× |
| `prediction` | prediction | 0.29× |
| `stable` | stable, RWA, reserve currency | 0.15× |
| `insurance` | insurance | 0.20× |
| `launchpad` | launchpad | 0.22× |
| `other` | missing or unmatched category | 0.19× |

Each multiple is a fixed modeling assumption shared across the tier.
The classifier also selects the entry and weekly activity described in the farm plan.

### Growth, maturity, and chain coverage

Seven-day TVL growth is expressed in percentage points and limited to the interval from −45% to +75%.
Missing growth contributes zero change, for a growth multiplier of 1.
Take the square root of the absolute clamped change divided by 100.
Subtract 0.48 times that root for a decline, or add 0.24 times the root for a gain.
The same absolute move inside both limits therefore has twice the effect on the downside.

Age is the elapsed number of UTC days between the recorded listing date and the snapshot date.
A future listing date is treated as zero days. Missing or invalid dates remain unknown in the board.
Use 90 days for the score when recorded age is unknown.
For the maturity multiplier, take the natural log of one plus age capped at 1,460 days.
Divide by the natural log of 1,461, multiply by 0.28, and add 0.72.
Maturity starts at 0.72 and reaches 1.00 at the cap, with the largest per-day gains early on.

The young discount is a second age adjustment, applied after multiplying maturity and growth.
For ages below 75 days, subtract 0.10 times one minus the square of age divided by 75.
The square applies to the age ratio. At half the window, the discount is 0.075.
At day 75 and beyond, the discount is zero. The 90-day scoring default also yields zero discount.

Count distinct chain names and give each chain beyond the first a bonus of 0.028.
The bonus covers at most four extra chains, for a maximum adjustment of 0.112.
An empty chain list contributes zero, and repeated chain entries count once.

## Board membership and ranks

The pre-token test requires the token ID, ticker symbol, and market cap fields to all be null.
The 40 watchlist protocols enter through their slugs after passing that test.
The remaining 160 slots go to the highest-TVL eligible pre-token protocols strictly below the snapshot's TVL floor.
That second selection excludes watchlist slugs, centralized exchanges, and protocol names with a trailing version suffix.
An exact TVL tie for early selection is resolved in ascending slug order.
The floor applies to early selection. Watchlist membership uses the explicit slug list and the pre-token test.

Once membership is set, score all 200 together and sort by descending implied value.
An equal rounded score sorts in ascending slug order, with rank assigned from the resulting position.
The sealed snapshot yields a strictly decreasing sequence of scores.

A separate live-token view holds up to 24 rows from protocols with at least one recorded token signal.
It orders them by reported market cap, using slug order for ties and a score of −1 for missing market caps when sorting.
These rows supply market context. Their market caps are kept outside the pre-token ranking and its implied-value total.

## Farm plans

Each ranked row has an ordered list. The board checker accepts 3–12 strings of 20–600 characters after trimming.
The generator emits six steps covering setup, entry, weekly review, a review window, claim checks, and recordkeeping.
Plans use the first distinct recorded chain. A bridge plan uses the next distinct chain as its destination when available.

- Set up the wallet in 10 minutes at $0, with gas reserved separately.
- Allow 15 minutes for the category-specific entry and check live fees and minimums against the stated budgets.
- Spend 5 minutes each week checking the published qualification rules and reviewing the position.
- Schedule two 5-minute checks in the review window and budget for an on-chain exit where applicable.
- Check the official rewards page at $0 and allow 5 minutes for a verified claim, with gas quoted before signing.
- Allow 5 minutes and $0 per log update for quotes, fees, eligibility rules, and transaction IDs.

The gas ceiling is $15 on Ethereum and $3 on other recorded routes.
The entry budget starts at $25 for most tiers and $15 for derivatives, prediction, launchpad, and other.
It rises by $15 per full tenfold increase in TVL above $5 million, capped at $125 or $35 respectively.
The review window is 14 days for unknown ages or ages under 120 days, 21 days through day 539, and 28 days from day 540.
For transfers, sales, and insurance, use the relevant settlement, unlock, or expiry milestone.
These amounts and times structure the plan. Actual fees and eligibility come from the app and the network.

## Dashboard

Open `dashboard/index.html` in the generated output. It loads the adjacent output bundle's `data.js` locally.
The board shows TVL, seven-day growth, token status, and the valuation metric for the selected view.
Ranked rows also show recorded age. Click a sortable heading to change the display order while keeping original ranks.
Choose a category or enter search words. Every word must match the combined name, slug, category, and chain text.
The clear button resets the filters. The footer below the table shows the matching row count and pre-token implied-value sum.
The live view shows a dash in the implied-value total, and the page footer identifies the snapshot source.

Open a ranked row to see the raw facts, the inputs actually used for scoring, the multipliers, and the farm plan.
The live detail focuses on reported market cap and snapshot facts. Close the detail to return to the table.

## Run and verify locally

Use Node.js with native TypeScript support and run from the repository root.
The commands below assume the kit is unpacked next to the repository. Set `snapshot` to your local path if it differs.

```sh
snapshot=../kit/token-radar-01-kit/input/snapshot.json
out_a=$(mktemp -d /tmp/token-radar-a.XXXXXX)
out_b=$(mktemp -d /tmp/token-radar-b.XXXXXX)
node main.ts --input "$snapshot" --output "$out_a"
node main.ts --input "$snapshot" --output "$out_b"
diff -r "$out_a" "$out_b"
node -e '
  const assert = require("node:assert/strict");
  const read = p => JSON.parse(require("node:fs").readFileSync(p, "utf8"));
  const { watchlist } = read(process.argv[1]);
  const { rows } = read(process.argv[2]);
  assert.equal(rows.length, 200);
  const slugs = new Set(rows.map(row => row.slug));
  assert.equal(slugs.size, 200);
  assert.equal(new Set(watchlist).size, 40);
  assert.ok(watchlist.every(slug => slugs.has(slug)));
  rows.forEach((row, i) => {
    assert.equal(row.rank, i + 1);
    assert.ok(Number.isSafeInteger(row.implied_value_usd) && row.implied_value_usd > 0);
    assert.ok(i === 0 || row.implied_value_usd < rows[i - 1].implied_value_usd);
    assert.ok(Array.isArray(row.farm_steps) && row.farm_steps.length >= 3 && row.farm_steps.length <= 12);
    assert.ok(row.farm_steps.every(step => typeof step === "string" && step.length >= 20 && step.length <= 600));
  });
' "$snapshot" "$out_a/board.json"
```

Both runs should report 200 ranked rows and 24 live rows. `diff` and the assertion script should exit silently with status zero.
When checking a comments-only change, also compare `board.json` with a baseline made before editing using the same snapshot.
In a browser, check that filtering updates the count and sum, that a ranked detail opens, and that the live view contains 24 rows.
