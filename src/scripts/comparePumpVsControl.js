import { config } from "../config.js";
import { Database } from "../database/database.js";

const database = new Database(config.database.path);

const INTERVAL = "15m";
const INTERVAL_MS = 15 * 60 * 1000;

// Loại vùng 1 giờ trước pump đến 2 giờ sau khi event kết thúc.
const EXCLUDE_BEFORE_MS = 4 * INTERVAL_MS;
const EXCLUDE_AFTER_MS = 8 * INTERVAL_MS;

// Lấy mẫu đối chứng cách nhau tối thiểu khoảng 1 giờ.
const CONTROL_STEP = 4;

const OFFSETS = [15, 30, 45, 60];

const METRICS = [
    {
        key: "rsi14",
        label: "RSI14",
        digits: 2
    },
    {
        key: "volume_ratio",
        label: "VolRatio",
        digits: 2
    },
    {
        key: "price_vs_ema20",
        label: "PriceVsEMA20",
        digits: 2
    },
    {
        key: "price_vs_ema50",
        label: "PriceVsEMA50",
        digits: 2
    },
    {
        key: "atr14",
        label: "ATR14",
        digits: 6
    },
    {
        key: "volatility20",
        label: "Volatility20",
        digits: 4
    }
];

function median(values) {
    if (values.length === 0) return null;

    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    return sorted.length % 2
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values, p) {
    if (values.length === 0) return null;

    const sorted = [...values].sort((a, b) => a - b);
    const index = (sorted.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);

    if (lower === upper) return sorted[lower];

    return sorted[lower]
        + (sorted[upper] - sorted[lower]) * (index - lower);
}

function format(value, digits = 2) {
    return value === null || !Number.isFinite(value)
        ? "N/A"
        : value.toFixed(digits);
}

function getValidValues(rows, key) {
    return rows
        .map(row => row[key])
        .filter(value =>
            value !== null &&
            value !== undefined &&
            Number.isFinite(Number(value))
        )
        .map(Number);
}

function rate(rows, predicate) {
    const valid = rows.filter(row =>
        row !== null && row !== undefined
    );

    if (valid.length === 0) return null;

    return 100 * valid.filter(predicate).length / valid.length;
}

function isInExcludedWindow(time, events) {
    return events.some(event => {
        const from = event.start_time - EXCLUDE_BEFORE_MS;
        const to = event.end_time + EXCLUDE_AFTER_MS;

        return time >= from && time <= to;
    });
}

function buildControlRows(symbols, events) {
    const controls = [];

    const getFeatures = database.db.prepare(`
        SELECT *
        FROM features
        WHERE market = ?
          AND symbol = ?
          AND interval = ?
        ORDER BY open_time ASC
    `);

    for (const symbol of symbols) {
        const rows = getFeatures.all(
            "USD-M",
            symbol,
            INTERVAL
        );

        const symbolEvents = events.filter(
            event => event.symbol === symbol
        );

        let eligibleIndex = 0;

        for (const row of rows) {
            if (isInExcludedWindow(row.open_time, symbolEvents)) {
                continue;
            }

            // Lấy mỗi cây nến thứ 4 trong các mốc đủ điều kiện.
            if (eligibleIndex % CONTROL_STEP === 0) {
                controls.push(row);
            }

            eligibleIndex++;
        }

        console.log(
            `${symbol} | feature rows: ${rows.length}`
        );
    }

    return controls;
}

function printMetricComparison(label, pumpRows, controlRows) {
    console.log(`\n  ${label}`);

    for (const metric of METRICS) {
        const pumpValues = getValidValues(
            pumpRows,
            metric.key
        );

        const controlValues = getValidValues(
            controlRows,
            metric.key
        );

        const pumpMedian = median(pumpValues);
        const controlMedian = median(controlValues);

        const pumpQ25 = percentile(pumpValues, 0.25);
        const pumpQ75 = percentile(pumpValues, 0.75);

        const controlQ25 = percentile(controlValues, 0.25);
        const controlQ75 = percentile(controlValues, 0.75);

        const difference =
            pumpMedian !== null && controlMedian !== null
                ? pumpMedian - controlMedian
                : null;

        console.log(
            `${metric.label.padEnd(15)}`
            + ` Pump median=${format(pumpMedian, metric.digits)}`
            + ` [Q25=${format(pumpQ25, metric.digits)},`
            + ` Q75=${format(pumpQ75, metric.digits)}]`
            + ` | Control median=${format(controlMedian, metric.digits)}`
            + ` [Q25=${format(controlQ25, metric.digits)},`
            + ` Q75=${format(controlQ75, metric.digits)}]`
            + ` | Diff=${format(difference, metric.digits)}`
        );
    }

    const comparisons = [
        {
            label: "RSI14 >= 70",
            pump: rate(pumpRows, r => r.rsi14 !== null && r.rsi14 >= 70),
            control: rate(controlRows, r => r.rsi14 !== null && r.rsi14 >= 70)
        },
        {
            label: "VolRatio >= 2",
            pump: rate(pumpRows, r =>
                r.volume_ratio !== null && r.volume_ratio >= 2
            ),
            control: rate(controlRows, r =>
                r.volume_ratio !== null && r.volume_ratio >= 2
            )
        },
        {
            label: "PriceVsEMA20 > 0",
            pump: rate(pumpRows, r =>
                r.price_vs_ema20 !== null && r.price_vs_ema20 > 0
            ),
            control: rate(controlRows, r =>
                r.price_vs_ema20 !== null && r.price_vs_ema20 > 0
            )
        },
        {
            label: "PriceVsEMA50 > 0",
            pump: rate(pumpRows, r =>
                r.price_vs_ema50 !== null && r.price_vs_ema50 > 0
            ),
            control: rate(controlRows, r =>
                r.price_vs_ema50 !== null && r.price_vs_ema50 > 0
            )
        },
        {
            label: "BreakoutUp = 1",
            pump: rate(pumpRows, r => r.breakout_up === 1),
            control: rate(controlRows, r => r.breakout_up === 1)
        }
    ];

    console.log("\n  Frequency comparison:");

    for (const item of comparisons) {
        console.log(
            `  ${item.label.padEnd(20)}`
            + ` Pump=${format(item.pump)}%`
            + ` | Control=${format(item.control)}%`
        );
    }

    console.log(
        `  Sample size: Pump=${pumpRows.length},`
        + ` Control=${controlRows.length}`
    );
}

try {
    const events = database.db.prepare(`
        SELECT symbol, start_time, end_time
        FROM pump_events
        WHERE market = 'USD-M'
          AND interval = ?
        ORDER BY symbol, start_time
    `).all(INTERVAL);

    const symbols = [
        ...new Set(events.map(event => event.symbol))
    ];

    if (events.length === 0) {
        console.log(
            `No pump events found for ${INTERVAL}.`
        );
        process.exitCode = 1;
    } else {
        const getPumpSamples = database.db.prepare(`
            SELECT *
            FROM pre_pump_features
            WHERE market = 'USD-M'
              AND symbol = ?
              AND interval = ?
              AND event_start_time = ?
              AND minutes_before_pump = ?
        `);

        const pumpSamplesByOffset = new Map();

        for (const offset of OFFSETS) {
            const samples = [];

            for (const event of events) {
                samples.push(
                    ...getPumpSamples.all(
                        event.symbol,
                        INTERVAL,
                        event.start_time,
                        offset
                    )
                );
            }

            pumpSamplesByOffset.set(offset, samples);
        }

        const controlRows = buildControlRows(
            symbols,
            events
        );

        console.log("\n======================================");
        console.log(" PUMP vs NORMAL CONTROL COMPARISON");
        console.log(` Interval: ${INTERVAL}`);
        console.log(` Pump events: ${events.length}`);
        console.log(` Control samples: ${controlRows.length}`);
        console.log("======================================");

        for (const offset of OFFSETS) {
            const pumpRows =
                pumpSamplesByOffset.get(offset);

            console.log(
                `\n--- ${offset} minutes before pump ---`
            );

            printMetricComparison(
                `${offset}m`,
                pumpRows,
                controlRows
            );
        }
    }
} finally {
    database.close();
}