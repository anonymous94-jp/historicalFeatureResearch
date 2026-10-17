
import DatabaseLib from "better-sqlite3";
import { config } from "../config.js";

const MARKET = config.futures?.market ?? "USD-M";
const INTERVAL = config.pumpDetection?.interval ?? "15m";

const HORIZONS_MINUTES = [15, 30, 60, 120, 240];
const CONTROL_STRIDE_CANDLES = 16;
const EXCLUSION_BEFORE_EVENT_MINUTES = 240;
const EXCLUSION_AFTER_EVENT_END_MINUTES = 240;

const NUMERIC_FEATURES = [
    ["return_1x", "Return 15m (%)", 1],
    ["return_4x", "Return 1h (%)", 1],
    ["return_16x", "Return 4h (%)", 1],
    ["price_vs_ema20", "Price vs EMA20 (%)", 1],
    ["price_vs_ema50", "Price vs EMA50 (%)", 1],
    ["ema20_above_ema50", "EMA20 > EMA50 (%)", 100],
    ["rsi14", "RSI14", 1],
    ["volume_ratio", "Volume ratio", 1],
    ["atr_pct", "ATR14 / close (%)", 1],
    ["volatility20_pct", "Volatility20 (%)", 1],
    ["breakout_up", "Breakout up (%)", 100],
    ["breakout_down", "Breakout down (%)", 100],
    ["range_1h_pct", "1h high-low range (%)", 1],
    ["range_4h_pct", "4h high-low range (%)", 1],
    ["close_position_4h_pct", "Close position in 4h range (%)", 1],
];

function toFinite(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function median(values) {
    const sorted = values
        .map(toFinite)
        .filter(value => value !== null)
        .sort((a, b) => a - b);

    if (!sorted.length) return null;

    const mid = Math.floor(sorted.length / 2);

    return sorted.length % 2
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
}

function fmt(value, multiplier = 1) {
    if (value === null || !Number.isFinite(value)) {
        return "n/a";
    }

    return (value * multiplier).toFixed(2);
}

function timeString(ms) {
    return new Date(Number(ms)).toISOString();
}

function getWindowMetrics(candles, index, count) {
    if (index < count - 1) return null;

    const window = candles.slice(index - count + 1, index + 1);
    const highs = window.map(c => Number(c.high));
    const lows = window.map(c => Number(c.low));
    const close = Number(window[window.length - 1].close);

    const high = Math.max(...highs);
    const low = Math.min(...lows);
    const width = high - low;

    return {
        rangePct: close > 0 ? (width / close) * 100 : null,
        closePositionPct: width > 0
            ? ((close - low) / width) * 100
            : 50,
    };
}

function makeSnapshot(feature, candleIndex, candles) {
    const close = Number(feature.close);

    const range1h = getWindowMetrics(candles, candleIndex, 4);
    const range4h = getWindowMetrics(candles, candleIndex, 16);

    return {
        ...feature,

        atr_pct:
            close > 0 && toFinite(feature.atr14) !== null
                ? Number(feature.atr14) / close * 100
                : null,

        volatility20_pct:
            toFinite(feature.volatility20) !== null
                ? Number(feature.volatility20) * 100
                : null,

        range_1h_pct: range1h?.rangePct ?? null,
        range_4h_pct: range4h?.rangePct ?? null,
        close_position_4h_pct: range4h?.closePositionPct ?? null,
    };
}

function latestFeatureAtOrBefore(features, targetTime) {
    let low = 0;
    let high = features.length - 1;
    let answer = -1;

    while (low <= high) {
        const mid = (low + high) >> 1;

        if (Number(features[mid].open_time) <= targetTime) {
            answer = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    return answer;
}

function isInsideEventExclusion(anchorTime, events) {
    const beforeMs = EXCLUSION_BEFORE_EVENT_MINUTES * 60_000;
    const afterMs = EXCLUSION_AFTER_EVENT_END_MINUTES * 60_000;

    return events.some(event =>
        anchorTime >= Number(event.start_time) - beforeMs &&
        anchorTime <= Number(event.end_time) + afterMs
    );
}

function hasPumpSoon(anchorTime, events) {
    const futureLimit = anchorTime + 240 * 60_000;

    return events.some(event =>
        Number(event.start_time) > anchorTime &&
        Number(event.start_time) <= futureLimit
    );
}

function collectSamplesForSymbol(symbol, events, features, candles) {
    const candleIndexByTime = new Map(
        candles.map((candle, index) => [
            Number(candle.open_time),
            index,
        ])
    );

    const pumpSamples = [];

    // Sample each known pump at multiple times before its event start.
    for (const event of events) {
        for (const horizon of HORIZONS_MINUTES) {
            const targetTime =
                Number(event.start_time) - horizon * 60_000;

            const featureIndex =
                latestFeatureAtOrBefore(features, targetTime);

            if (featureIndex < 0) continue;

            const feature = features[featureIndex];
            const featureTime = Number(feature.open_time);
            const candleIndex = candleIndexByTime.get(featureTime);

            if (candleIndex === undefined) continue;

            // Prevent a sample from using the event candle or later candles.
            if (featureTime >= Number(event.start_time)) continue;

            pumpSamples.push({
                symbol,
                horizon,
                label: "pump",
                eventStart: Number(event.start_time),
                sampleTime: featureTime,
                snapshot: makeSnapshot(
                    feature,
                    candleIndex,
                    candles
                ),
            });
        }
    }

    // Create control anchors approximately every four hours.
    // Exclude periods close to recorded pumps and periods followed
    // by a recorded pump in the next four hours.
    const controlAnchors = [];

    for (
        let i = CONTROL_STRIDE_CANDLES;
        i < features.length;
        i += CONTROL_STRIDE_CANDLES
    ) {
        const anchor = Number(features[i].open_time);

        if (isInsideEventExclusion(anchor, events)) continue;
        if (hasPumpSoon(anchor, events)) continue;

        controlAnchors.push(anchor);
    }

    const controlSamples = [];

    for (const anchorTime of controlAnchors) {
        for (const horizon of HORIZONS_MINUTES) {
            const targetTime =
                anchorTime - horizon * 60_000;

            const featureIndex =
                latestFeatureAtOrBefore(features, targetTime);

            if (featureIndex < 0) continue;

            const feature = features[featureIndex];
            const featureTime = Number(feature.open_time);
            const candleIndex = candleIndexByTime.get(featureTime);

            if (candleIndex === undefined) continue;
            if (isInsideEventExclusion(featureTime, events)) continue;

            controlSamples.push({
                symbol,
                horizon,
                label: "control",
                eventStart: null,
                sampleTime: featureTime,
                snapshot: makeSnapshot(
                    feature,
                    candleIndex,
                    candles
                ),
            });
        }
    }

    return { pumpSamples, controlSamples };
}

function printPumpEventSamples(samples) {
    console.log("\n=== PUMP EVENT SNAPSHOTS ===");

    const pump = samples.filter(s => s.label === "pump");

    if (!pump.length) {
        console.log(
            "No pump snapshots. Check pump_events and features tables."
        );
        return;
    }

    for (const sample of pump) {
        const s = sample.snapshot;

        console.log(
            `${sample.symbol} | ` +
            `event=${timeString(sample.eventStart)} | ` +
            `-${sample.horizon}m sample=${timeString(sample.sampleTime)} | ` +
            `ret15m=${fmt(s.return_1x)}% | ` +
            `ret1h=${fmt(s.return_4x)}% | ` +
            `volRatio=${fmt(s.volume_ratio)} | ` +
            `RSI=${fmt(s.rsi14)} | ` +
            `range1h=${fmt(s.range_1h_pct)}% | ` +
            `range4h=${fmt(s.range_4h_pct)}% | ` +
            `vsEMA20=${fmt(s.price_vs_ema20)}% | ` +
            `vsEMA50=${fmt(s.price_vs_ema50)}%`
        );
    }
}

function printSummary(samples) {
    console.log("\n=== PUMP VS CONTROL: MEDIAN FEATURE VALUES ===");

    console.log(
        "Controls are sampled periods with no recorded pump " +
        "event in the following four hours."
    );

    console.log(
        "These descriptive statistics do not prove predictive value."
    );

    for (const horizon of HORIZONS_MINUTES) {
        const pump = samples.filter(
            s => s.label === "pump" && s.horizon === horizon
        );

        const control = samples.filter(
            s => s.label === "control" && s.horizon === horizon
        );

        console.log(
            `\n--- ${horizon} minutes before event/anchor | ` +
            `pump n=${pump.length}, control n=${control.length} ---`
        );

        console.log(
            "Feature                          | Pump median | " +
            "Control median | Difference"
        );

        console.log(
            "---------------------------------|-------------|" +
            "----------------|-----------"
        );

        for (const [key, label, multiplier] of NUMERIC_FEATURES) {
            const pumpMedian = median(
                pump.map(s => s.snapshot[key])
            );

            const controlMedian = median(
                control.map(s => s.snapshot[key])
            );

            const difference =
                pumpMedian !== null && controlMedian !== null
                    ? pumpMedian - controlMedian
                    : null;

            console.log(
                `${label.padEnd(32)} | ` +
                `${fmt(pumpMedian, multiplier).padStart(11)} | ` +
                `${fmt(controlMedian, multiplier).padStart(14)} | ` +
                `${fmt(difference, multiplier).padStart(9)}`
            );
        }
    }
}

function main() {
    const requestedSymbols = process.argv
        .slice(2)
        .map(s => s.toUpperCase());

    const symbols = requestedSymbols.length
        ? requestedSymbols
        : config.symbols.list;

    if (!symbols.length) {
        console.log("No symbols configured.");
        return;
    }

    // Read-only database connection: no inserts, updates or deletes.
    const db = new DatabaseLib(config.database.path, {
        readonly: true,
        fileMustExist: true,
    });

    try {
        const placeholders = symbols.map(() => "?").join(",");

        const events = db.prepare(`
            SELECT market, symbol, interval, start_time, end_time,
                   peak_time, start_price, peak_price,
                   return_pct, duration_minutes
            FROM pump_events
            WHERE market = ?
              AND interval = ?
              AND symbol IN (${placeholders})
            ORDER BY symbol, start_time
        `).all(MARKET, INTERVAL, ...symbols);

        if (!events.length) {
            console.log(
                `No pump_events found for market=${MARKET}, ` +
                `interval=${INTERVAL}, symbols=${symbols.join(", ")}.`
            );

            console.log(
                "This script does not create pump events. " +
                "Check whether the existing event-building step has run."
            );

            return;
        }

        const featureRows = db.prepare(`
            SELECT market, symbol, interval, open_time, close, volume,
                   return_1x, return_4x, return_16x,
                   price_vs_ema20, price_vs_ema50, ema20_above_ema50,
                   rsi14, volume_ratio, atr14, volatility20,
                   breakout_up, breakout_down
            FROM features
            WHERE market = ?
              AND interval = ?
              AND symbol IN (${placeholders})
            ORDER BY symbol, open_time
        `).all(MARKET, INTERVAL, ...symbols);

        const candleRows = db.prepare(`
            SELECT market, symbol, interval, open_time,
                   high, low, close, volume
            FROM candles
            WHERE market = ?
              AND interval = ?
              AND symbol IN (${placeholders})
            ORDER BY symbol, open_time
        `).all(MARKET, INTERVAL, ...symbols);

        const allSamples = [];

        for (const symbol of symbols) {
            const symbolEvents = events.filter(
                e => e.symbol === symbol
            );

            const symbolFeatures = featureRows.filter(
                f => f.symbol === symbol
            );

            const symbolCandles = candleRows.filter(
                c => c.symbol === symbol
            );

            console.log(`\n${symbol}:`);
            console.log(`  Events: ${symbolEvents.length}`);
            console.log(`  Features: ${symbolFeatures.length}`);
            console.log(`  Candles: ${symbolCandles.length}`);

            if (!symbolFeatures.length || !symbolCandles.length) {
                console.log("Missing features or candles; skipped.");
                continue;
            }

            const { pumpSamples, controlSamples } =
                collectSamplesForSymbol(
                    symbol,
                    symbolEvents,
                    symbolFeatures,
                    symbolCandles
                );

            console.log(`  Pump samples: ${pumpSamples.length}`);
            console.log(`  Control samples: ${controlSamples.length}`);

            allSamples.push(...pumpSamples, ...controlSamples);
        }

        printPumpEventSamples(allSamples);
        printSummary(allSamples);

        console.log(
            "\nRead-only analysis complete. " +
            "No database rows were inserted, updated, or deleted."
        );
    } finally {
        db.close();
    }
}

try {
    main();
} catch (error) {
    console.error("Analysis failed:", error);
    process.exitCode = 1;
}
