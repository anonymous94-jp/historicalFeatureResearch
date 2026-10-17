
import { config } from "../config.js";
import { Database } from "../database/database.js";
import { PumpEventDetector } from "../services/pumpEventDetector.js";

const MARKET = "USD-M";
const INTERVAL = config.pumpDetection.interval;

const TEST_RULES = [
    {
        label: "1h",
        windowCandles: 4,
        minReturnPct: 10
    },
    {
        label: "2h",
        windowCandles: 8,
        minReturnPct: 10
    },
    {
        label: "4h",
        windowCandles: 16,
        minReturnPct: 15
    }
];

function formatTime(timestamp) {
    return new Date(timestamp).toISOString();
}

function printEvent(event, index) {
    console.log(
        `  #${index + 1} ${event.symbol}`
    );
    console.log(
        `     Start : ${formatTime(event.start_time)}`
    );
    console.log(
        `     Peak  : ${formatTime(event.peak_time)}`
    );
    console.log(
        `     End   : ${formatTime(event.end_time)}`
    );
    console.log(
        `     Price : ${event.start_price} -> ${event.peak_price}`
    );
    console.log(
        `     Return: +${event.return_pct.toFixed(2)}%`
    );
    console.log(
        `     Duration to peak: ${event.duration_minutes} minutes`
    );
}

async function main() {
    const requestedSymbols = process.argv
        .slice(2)
        .map(symbol => symbol.toUpperCase().trim())
        .filter(Boolean);

    const symbols = [
        ...new Set(
            requestedSymbols.length
                ? requestedSymbols
                : config.symbols.list
        )
    ];

    const database = new Database(config.database.path);

    try {
        console.log("========================================");
        console.log("PUMP DETECTION DRY RUN");
        console.log("========================================");
        console.log(`Market   : ${MARKET}`);
        console.log(`Interval : ${INTERVAL}`);
        console.log(`Symbols  : ${symbols.join(", ")}`);
        console.log("Database : READ ONLY for event results");
        console.log("No pump events will be inserted or deleted.");

        for (const symbol of symbols) {
            const candles = database.getCandles(
                symbol,
                INTERVAL
            );

            console.log("\n========================================");
            console.log(`${symbol} | Candles: ${candles.length}`);
            console.log("========================================");

            if (candles.length === 0) {
                console.log(
                    "No candles found. Check symbol, interval and database."
                );
                continue;
            }

            for (const rule of TEST_RULES) {
                const detector = new PumpEventDetector({
                    windowCandles: rule.windowCandles,
                    minReturnPct: rule.minReturnPct,
                    maxGapCandles:
                        config.pumpDetection.maxGapCandles
                });

                const events = detector.detect(candles);

                console.log(
                    `\n[${rule.label}] ` +
                    `window=${rule.windowCandles} candles, ` +
                    `threshold=${rule.minReturnPct}%`
                );
                console.log(`Events detected: ${events.length}`);

                events.forEach(printEvent);
            }
        }

        console.log("\n========================================");
        console.log("DRY RUN COMPLETE");
        console.log("No event data was written.");
        console.log("========================================");
    } finally {
        database.close();
    }
}

main().catch(error => {
    console.error("PUMP DETECTION DRY RUN FAILED");
    console.error(error);
    process.exitCode = 1;
});
