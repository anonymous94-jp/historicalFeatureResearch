import fs from "fs";

import { config } from "./config.js";
import { BinanceFuturesClient } from "./clients/BinanceFuturesClient.js";
import { Database } from "./database/Database.js";


function sleep(ms) {

    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}


function intervalToMilliseconds(interval) {

    const units = {
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000
    };

    const value = Number(
        interval.slice(0, -1)
    );

    const unit = interval.slice(-1);

    return value * units[unit];
}


function normalizeKline(
    raw,
    symbol,
    interval
) {

    return {

        market: "USD-M",

        symbol,

        interval,

        open_time: Number(raw[0]),
        open: Number(raw[1]),

        high: Number(raw[2]),
        low: Number(raw[3]),
        close: Number(raw[4]),

        volume: Number(raw[5]),

        close_time: Number(raw[6]),

        quote_volume: Number(raw[7]),

        trades: Number(raw[8]),

        taker_buy_volume: Number(raw[9]),

        taker_buy_quote_volume: Number(raw[10])
    };
}


async function downloadHistoricalCandles(
    client,
    database,
    symbol,
    interval
) {

    const intervalMs =
        intervalToMilliseconds(interval);

    const endTime = Date.now();

    const startTime =
        endTime -
        (
            config.historical.days *
            24 *
            60 *
            60 *
            1000
        );

    let currentStart = startTime;

    let totalFetched = 0;

    console.log(
        `\n[DOWNLOAD] ${symbol} ${interval}`
    );

    console.log(
        `Period: ${new Date(startTime).toISOString()}`
        + " → "
        + `${new Date(endTime).toISOString()}`
    );

    while (currentStart < endTime) {

        const candles =
            await client.getKlines({

                symbol,

                interval,

                startTime: currentStart,

                endTime,

                limit: config.historical.limit
            });

        if (!candles.length) {

            console.log(
                "[INFO] No more candles."
            );

            break;
        }

        const normalized =
            candles.map(raw =>
                normalizeKline(
                    raw,
                    symbol,
                    interval
                )
            );

        database.insertCandles(
            normalized
        );

        totalFetched += normalized.length;

        const lastOpenTime =
            normalized[
                normalized.length - 1
            ].open_time;

        console.log(
            `[FETCHED] ${normalized.length}`
            + ` | total=${totalFetched}`
            + ` | last=${new Date(lastOpenTime).toISOString()}`
        );

        /*
         * Quan trọng:
         * request tiếp theo bắt đầu sau candle cuối.
         */

        currentStart =
            lastOpenTime + intervalMs;

        /*
         * Tránh request quá nhanh.
         */

        await sleep(
            config.historical.requestDelayMs
        );

        /*
         * Nếu Binance trả ít hơn limit,
         * thường đã gần/cuối khoảng dữ liệu.
         */

        if (
            candles.length <
            config.historical.limit
        ) {

            if (currentStart >= endTime) {
                break;
            }
        }
    }

    const count =
        database.getCandleCount(
            symbol,
            interval
        );

    console.log(
        `[DATABASE] ${symbol} ${interval}`
        + ` = ${count} candles`
    );
}


async function main() {

    console.log("");
    console.log("======================================");
    console.log(" Futures Feature Research");
    console.log(" Phase 1 - Historical Candles");
    console.log(" Binance USD-M Futures");
    console.log("======================================");

    fs.mkdirSync(
        "./data",
        {
            recursive: true
        }
    );

    const client =
        new BinanceFuturesClient(
            process.env.BINANCE_FUTURES_BASE_URL
            || "https://fapi.binance.com"
        );

    const database =
        new Database(
            config.database.path
        );

    try {

        console.log("\n[CONFIG]");

        console.log(
            "Market:",
            config.futures.market
        );

        console.log(
            "Contract:",
            config.futures.contractType
        );

        console.log(
            "Symbols:",
            config.symbols.list.join(", ")
        );

        console.log(
            "Intervals:",
            config.intervals.join(", ")
        );

        console.log(
            "Historical days:",
            config.historical.days
        );

        /*
         * Kiểm tra Futures API
         * trước khi download.
         */

        console.log(
            "\n[CHECK] Binance Futures exchange info..."
        );

        const exchangeInfo =
            await client.getExchangeInfo();

        console.log(
            `[CHECK] Binance returned `
            + `${exchangeInfo.symbols.length} symbols`
        );

        /*
         * Xác nhận symbol người dùng nhập
         * thực sự tồn tại và đang TRADING.
         */

        const availableSymbols =
            new Map(
                exchangeInfo.symbols.map(
                    item => [
                        item.symbol,
                        item
                    ]
                )
            );

        for (
            const symbol
            of config.symbols.list
        ) {

            const info =
                availableSymbols.get(
                    symbol
                );

            if (!info) {

                console.log(
                    `\n[SKIP] ${symbol}`
                    + " does not exist."
                );

                continue;
            }

            if (
                info.status !== "TRADING"
            ) {

                console.log(
                    `\n[SKIP] ${symbol}`
                    + ` status=${info.status}`
                );

                continue;
            }

            if (
                info.contractType !==
                config.futures.contractType
            ) {

                console.log(
                    `\n[SKIP] ${symbol}`
                    + ` contractType=${info.contractType}`
                );

                continue;
            }

            for (
                const interval
                of config.intervals
            ) {

                try {

                    await downloadHistoricalCandles(
                        client,
                        database,
                        symbol,
                        interval
                    );

                } catch (error) {

                    console.error(
                        `\n[ERROR] ${symbol} ${interval}`
                    );

                    console.error(
                        error.response?.data
                        || error.message
                    );
                }
            }
        }

        console.log(
            "\n======================================"
        );

        console.log(
            "Download completed."
        );

        console.log(
            "======================================"
        );

    } catch (error) {

        console.error(
            "\n[FATAL ERROR]"
        );

        console.error(
            error.response?.data
            || error.message
        );

    } finally {

        database.close();
    }
}


main();