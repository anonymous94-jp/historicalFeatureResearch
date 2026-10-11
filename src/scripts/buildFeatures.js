import { config } from "../config.js";
import { Database } from "../database/database.js";
import { FeatureEngine } from "../services/featureEngine.js";

async function main() {

    console.log("=================================");
    console.log("FEATURE ENGINE");
    console.log("=================================");

    const database = new Database(config.database.path);
    const featureEngine = new FeatureEngine(database);

    try {

        for (const symbol of config.symbols.list) {

            for (const interval of config.intervals) {

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

                const features =
                    featureEngine.calculate(candles);

                console.log(
                    `Features calculated: ${features.length}`
                );

                database.insertFeatures(features);

                console.log(
                    `Features inserted: ${features.length}`
                );
            }
        }

        console.log("");
        console.log("=================================");
        console.log("FEATURE BUILD COMPLETE");
        console.log("=================================");

    } finally {

        database.close();
    }
}

main().catch((error) => {

    console.error("");
    console.error("FEATURE BUILD FAILED");
    console.error(error);

    process.exit(1);
});