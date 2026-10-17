
import DatabaseLib from "better-sqlite3";
import { config } from "../config.js";
import { PumpEventDetector } from "../services/pumpEventDetector.js";

const INTERVAL = "15m";
const BACKTRACK_CANDLES = 16; // 4 hours
const MIN_BACKTRACK_RISE_PCT = 3;

const RULES = [
    { label: "15m", windowCandles: 1, minReturnPct: 10 },
    { label: "1h",  windowCandles: 4, minReturnPct: 10 },
    { label: "2h",  windowCandles: 8, minReturnPct: 10 },
    { label: "4h",  windowCandles: 16, minReturnPct: 15 },
];

function formatTime(timestamp) {
    return new Date(timestamp).toISOString();
}

function pctChange(from, to) {
    if (!Number.isFinite(from) || from <= 0) return 0;
    return ((to - from) / from) * 100;
}

function detectCandidates(candles) {
    const events = [];

    for (const rule of RULES) {
        const detector = new PumpEventDetector({
            windowCandles: rule.windowCandles,
            minReturnPct: rule.minReturnPct,
            maxGapCandles: config.pumpDetection.maxGapCandles ?? 1,
        });

        const detected = detector.detect(candles);

        console.log(
            `${rule.label.padEnd(4)} | Threshold +${rule.minReturnPct}%` +
            ` | Events: ${detected.length}`
        );

        for (const event of detected) {
            events.push({
                ...event,
                ruleLabel: rule.label,
                windowCandles: rule.windowCandles,
                thresholdPct: rule.minReturnPct,
            });
        }
    }

    // Find the earliest event in historical time.
    // Do not automatically prefer the shortest detection window.
    events.sort((a, b) =>
        a.start_time - b.start_time ||
        a.windowCandles - b.windowCandles
    );

    return events;
}

function backtrackStart(candles, event) {
    const anchorIndex = candles.findIndex(
        candle => Number(candle.open_time) === event.start_time
    );

    if (anchorIndex < 0) {
        throw new Error(
            `Cannot find candle at event start: ${event.start_time}`
        );
    }

    const anchorPrice = Number(candles[anchorIndex].close);
    const lookbackStart = Math.max(
        0,
        anchorIndex - BACKTRACK_CANDLES
    );

    let lowestIndex = anchorIndex;
    let lowestPrice = anchorPrice;

    // Find the lowest close before the detector's event start.
    for (let i = lookbackStart; i < anchorIndex; i++) {
        const close = Number(candles[i].close);

        if (Number.isFinite(close) && close > 0 && close < lowestPrice) {
            lowestPrice = close;
            lowestIndex = i;
        }
    }

    const risePct = pctChange(lowestPrice, anchorPrice);

    // Backtrack only if the price has risen enough from that low.
    const useBacktrack =
        lowestIndex < anchorIndex &&
        risePct >= MIN_BACKTRACK_RISE_PCT;

    const proposedIndex = useBacktrack
        ? lowestIndex
        : anchorIndex;

    return {
        anchorIndex,
        lookbackStart,
        lowestIndex,
        lowestPrice,
        risePct,
        proposedIndex,
        proposedCandle: candles[proposedIndex],
        anchorPrice,
        usedBacktrack: useBacktrack,
    };
}

function printEventCandidates(events) {
    console.log("\n=== EARLIEST DETECTED EVENTS ===");

    if (events.length === 0) {
        console.log("No pump events detected.");
        return;
    }

    for (const event of events.slice(0, 10)) {
        console.log(
            `[${event.ruleLabel}] ` +
            `${formatTime(event.start_time)} | ` +
            `Peak ${formatTime(event.peak_time)} | ` +
            `Return +${event.return_pct.toFixed(2)}%`
        );
    }

    if (events.length > 10) {
        console.log(`...and ${events.length - 10} more events.`);
    }
}

function printBacktrackPath(candles, result) {
    const {
        lookbackStart,
        anchorIndex,
        proposedIndex,
        proposedCandle,
        anchorPrice,
        lowestPrice,
        risePct,
        usedBacktrack,
    } = result;

    console.log("\n=== BACKTRACK RESULT ===");
    console.log(`Detector start : ${formatTime(candles[anchorIndex].open_time)}`);
    console.log(`Detector price : ${anchorPrice}`);
    console.log(`Lowest close   : ${lowestPrice}`);
    console.log(`Rise to detector start: ${risePct.toFixed(2)}%`);
    console.log(`Backtrack rule : minimum +${MIN_BACKTRACK_RISE_PCT}%`);
    console.log(`Backtrack used : ${usedBacktrack ? "YES" : "NO"}`);
    console.log(`Proposed start : ${formatTime(proposedCandle.open_time)}`);
    console.log(`Proposed price : ${Number(proposedCandle.close)}`);
    console.log(
        `Time moved back: ${Math.round(
            (candles[anchorIndex].open_time - proposedCandle.open_time) / 60000
        )} minutes`
    );

    console.log("\n=== CANDLE PATH FOR MANUAL REVIEW ===");
    console.log("UTC time              | Close       | Change/candle | From proposed start");

    const proposedPrice = Number(proposedCandle.close);

    for (let i = lookbackStart; i <= anchorIndex; i++) {
        const candle = candles[i];
        const close = Number(candle.close);
        const previousClose = i > 0
            ? Number(candles[i - 1].close)
            : close;

        const stepPct = pctChange(previousClose, close);
        const totalPct = pctChange(proposedPrice, close);

        let marker = " ";
        if (i === proposedIndex) marker = "*";
        if (i === anchorIndex) marker = "D";

        console.log(
            `${marker}${formatTime(candle.open_time)} | ` +
            `${close.toFixed(8).padStart(11)} | ` +
            `${stepPct.toFixed(2).padStart(7)}%       | ` +
            `${totalPct.toFixed(2).padStart(7)}%`
        );
    }

    console.log("\n* = proposed start; D = detector start");
}

async function main() {
    const symbols = process.argv.slice(2).length
        ? process.argv.slice(2).map(symbol => symbol.toUpperCase())
        : config.symbols.list;

    // Open the existing SQLite database in READ-ONLY mode.
    // This script does not insert or update any data.
    const db = new DatabaseLib(config.database.path, {
        readonly: true,
        fileMustExist: true,
    });

    try {
        for (const symbol of symbols) {
            console.log("\n========================================");
            console.log(`SYMBOL: ${symbol}`);
            console.log("========================================");

            const candles = db.prepare(`
                SELECT
                    market, symbol, interval, open_time, close_time,
                    open, high, low, close, volume, quote_volume,
                    trades, taker_buy_volume, taker_buy_quote_volume
                FROM candles
                WHERE market = 'USD-M'
                  AND symbol = ?
                  AND interval = ?
                ORDER BY open_time ASC
            `).all(symbol, INTERVAL);

            console.log(`Candles loaded: ${candles.length}`);

            if (candles.length === 0) {
                console.log("No candles found. Skip.");
                continue;
            }

            const events = detectCandidates(candles);
            printEventCandidates(events);

            if (events.length === 0) continue;

            // Select the earliest event across all four rules.
            const firstEvent = events[0];

            console.log("\n=== SELECTED FIRST PUMP CANDIDATE ===");
            console.log(`Detection rule : ${firstEvent.ruleLabel}`);
            console.log(`Threshold      : +${firstEvent.thresholdPct}%`);
            console.log(`Event start    : ${formatTime(firstEvent.start_time)}`);
            console.log(`Peak time      : ${formatTime(firstEvent.peak_time)}`);
            console.log(`Event end      : ${formatTime(firstEvent.end_time)}`);
            console.log(`Start price    : ${firstEvent.start_price}`);
            console.log(`Peak price     : ${firstEvent.peak_price}`);
            console.log(`Return to peak : +${firstEvent.return_pct.toFixed(2)}%`);

            const result = backtrackStart(candles, firstEvent);
            printBacktrackPath(candles, result);
        }
    } finally {
        db.close();
    }
}

main().catch(error => {
    console.error("\nTEST FAILED");
    console.error(error);
    process.exitCode = 1;
});
