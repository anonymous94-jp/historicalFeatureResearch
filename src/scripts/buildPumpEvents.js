import { config } from "../config.js";
import { Database } from "../database/Database.js";
import { PumpEventDetector } from "../services/pumpEventDetector.js";

async function main() {

    console.log("=================================");
    console.log("PUMP EVENT DETECTOR");
    console.log("=================================");

    const database =
        new Database(config.database.path);

    const detector =
        new PumpEventDetector(
            config.pumpDetection
        );

    try {

        const interval =
            config.pumpDetection.interval;

        for (const symbol of config.symbols.list) {

            console.log("");
            console.log("---------------------------------");
            console.log(`Symbol   : ${symbol}`);
            console.log(`Interval : ${interval}`);
            console.log("---------------------------------");

            const candles =
                database.getCandles(
                    symbol,
                    interval
                );

            console.log(
                `Candles loaded: ${candles.length}`
            );

            if (candles.length === 0) {

                console.log(
                    "No candles found. Skip."
                );

                continue;
            }

            const events =
                detector.detect(candles);

            console.log(
                `Pump events detected: ${events.length}`
            );

            database.insertPumpEvents(events);

            for (const event of events) {

                console.log(
                    `[PUMP] ${event.symbol} ` +
                    `${new Date(event.start_time).toISOString()} → ` +
                    `${new Date(event.peak_time).toISOString()} ` +
                    `+${event.return_pct.toFixed(2)}%`
                );
            }
        }

        console.log("");
        console.log("=================================");
        console.log("PUMP EVENT BUILD COMPLETE");
        console.log("=================================");

    } finally {

        database.close();
    }
}

main().catch((error) => {

    console.error("");
    console.error("PUMP EVENT BUILD FAILED");
    console.error(error);

    process.exit(1);
});