
import fs from "node:fs";
import path from "node:path";

import { config } from "../config.js";
import { BinanceFuturesClient } from "../clients/binanceFuturesClient.js";
import { Database } from "../database/database.js";
import { FeatureEngine } from "./featureEngine.js";
import { PumpEventDetector } from "./pumpEventDetector.js";

const MARKET = "USD-M";

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function intervalToMilliseconds(interval) {
    const value = Number(interval.slice(0, -1));
    const unit = interval.slice(-1);

    const units = {
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000
    };

    if (!units[unit] || !Number.isFinite(value)) {
        throw new Error(`Unsupported interval: ${interval}`);
    }

    return value * units[unit];
}

function normalizeKline(raw, symbol, interval) {
    return {
        market: MARKET,
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

function formatDate(timestamp) {
    return new Date(timestamp).toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
    });
}

function formatNumber(value, digits = 2) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
        return "N/A";
    }

    return Number(value).toFixed(digits);
}

export class PumpResearchService {
    constructor() {
        this.client = new BinanceFuturesClient(
            process.env.BINANCE_FUTURES_BASE_URL ||
            "https://fapi.binance.com"
        );

        fs.mkdirSync(path.dirname(config.database.path), {
            recursive: true
        });

        this.database = new Database(config.database.path);
        this.featureEngine = new FeatureEngine(this.database);
        this.pumpDetector = new PumpEventDetector(config.pumpDetection);
    }

    async researchSymbol(inputSymbol) {
        const symbol = String(inputSymbol).trim().toUpperCase();

        if (!/^[A-Z0-9]{2,30}USDT$/.test(symbol)) {
            throw new Error("Invalid symbol format. Example: NEARUSDT");
        }

        try {
            const exchangeInfo = await this.client.getExchangeInfo();

            const symbolInfo = exchangeInfo.symbols.find(
                (item) => item.symbol === symbol
            );

            if (!symbolInfo) {
                throw new Error(`${symbol} was not found on Binance Futures.`);
            }

            if (
                symbolInfo.status !== "TRADING" ||
                symbolInfo.contractType !== config.futures.contractType ||
                symbolInfo.quoteAsset !== config.futures.quoteAsset
            ) {
                throw new Error(
                    `${symbol} is not an active ${config.futures.contractType} ` +
                    `${config.futures.quoteAsset} Futures contract.`
                );
            }

            const downloadEndTime = Date.now();
            const downloadStartTime =
                downloadEndTime -
                config.historical.days * 24 * 60 * 60 * 1000;

            const downloadCounts = {};

            // Download history for this symbol only.
            for (const interval of config.intervals) {
                downloadCounts[interval] = await this.downloadCandles(
                    symbol,
                    interval,
                    downloadStartTime,
                    downloadEndTime
                );
            }

            const candlesByInterval = {};
            const featuresByInterval = {};

            // Recalculate features using the existing FeatureEngine.
            for (const interval of config.intervals) {
                const candles = this.database
                    .getCandles(symbol, interval)
                    .filter((candle) =>
                        candle.open_time >= downloadStartTime &&
                        candle.open_time <= downloadEndTime
                    );

                candlesByInterval[interval] = candles;

                if (candles.length === 0) {
                    featuresByInterval[interval] = [];
                    continue;
                }

                const features = this.featureEngine.calculate(candles);
                this.database.insertFeatures(features);
                featuresByInterval[interval] = features;
            }

            const pumpInterval = config.pumpDetection.interval;
            const pumpCandles = candlesByInterval[pumpInterval] || [];

            if (pumpCandles.length === 0) {
                throw new Error(
                    `No candles available for pump detection (${pumpInterval}).`
                );
            }

            // Detect pump events with the existing detector.
            const events = this.pumpDetector.detect(pumpCandles);
            this.database.insertPumpEvents(events);

            // Follow buildPumpStarts.js semantics:
            // pump start is the candle immediately before event.start_time.
            const results = [];

            for (const event of events) {
                const previousCandle = [...pumpCandles]
                    .reverse()
                    .find((candle) => candle.open_time < event.start_time);

                if (!previousCandle) {
                    continue;
                }

                const pumpStartTime = previousCandle.open_time;
                const featureRows = this.database.db.prepare(`
                    SELECT *
                    FROM features
                    WHERE market = ?
                    AND symbol = ?
                    AND interval = ?
                    AND open_time >= ?
                    AND open_time < ?
                    ORDER BY open_time DESC
                    LIMIT 4
                `).all(
                    MARKET,
                    symbol,
                    pumpInterval,
                    downloadStartTime,
                    pumpStartTime
                );

                results.push({
                    event,
                    pumpStartTime,
                    pumpStartPrice: previousCandle.close,
                    featuresBeforePump: featureRows
                });
            }

            return {
                symbol,
                periodDays: config.historical.days,
                intervals: config.intervals,
                downloadCounts,
                pumpInterval,
                eventsDetected: events.length,
                results
            };
        } finally {
            // Keep the database connection short-lived for each request.
            this.database.close();
        }
    }

    async downloadCandles(symbol, interval, startTime, endTime) {
        const intervalMs = intervalToMilliseconds(interval);
        let currentStart = startTime;
        let totalFetched = 0;

        while (currentStart < endTime) {
            const rawCandles = await this.client.getKlines({
                symbol,
                interval,
                startTime: currentStart,
                endTime,
                limit: config.historical.limit
            });

            if (!rawCandles.length) {
                break;
            }

            const candles = rawCandles.map((raw) =>
                normalizeKline(raw, symbol, interval)
            );

            this.database.insertCandles(candles);
            totalFetched += candles.length;

            const lastOpenTime = candles[candles.length - 1].open_time;
            const nextStart = lastOpenTime + intervalMs;

            if (nextStart <= currentStart) {
                throw new Error(
                    `Download cursor did not advance for ${symbol} ${interval}.`
                );
            }

            currentStart = nextStart;

            await sleep(config.historical.requestDelayMs);

            if (candles.length < config.historical.limit) {
                // Continue once more if necessary; the next request will
                // return an empty array when the period has been exhausted.
            }
        }

        return totalFetched;
    }
}

export function formatResearchResult(result) {
    const lines = [
        `📊 Historical Feature Research: ${result.symbol}`,
        `Period: ${result.periodDays} days`,
        `Pump timeframe: ${result.pumpInterval}`,
        "",
        "Candles fetched:"
    ];

    for (const interval of result.intervals) {
        lines.push(`• ${interval}: ${result.downloadCounts[interval] ?? 0}`);
    }

    lines.push(
        "",
        `Pump events detected: ${result.eventsDetected}`,
        ""
    );

    if (result.results.length === 0) {
        lines.push(
            "No pump events matched the current detection settings.",
            "You can adjust pumpDetection in src/config.js later if needed."
        );

        return lines.join("\n");
    }

    const maxEvents = 5;

    for (const [index, item] of result.results.slice(0, maxEvents).entries()) {
        const event = item.event;

        lines.push(
            `#${index + 1} ${event.symbol}`,
            `Event start: ${formatDate(event.start_time)}`,
            `Pump start: ${formatDate(item.pumpStartTime)}`,
            `Start price: ${formatNumber(item.pumpStartPrice, 6)}`,
            `Peak price: ${formatNumber(event.peak_price, 6)}`,
            `Rise: +${formatNumber(event.return_pct)}%`,
            `Duration: ${event.duration_minutes} minutes`,
            "Features before pump:"
        );

        if (item.featuresBeforePump.length === 0) {
            lines.push("• No earlier feature rows found.");
        } else {
            for (const feature of item.featuresBeforePump.slice(0, 3)) {
                const minutesBefore = Math.round(
                    (item.pumpStartTime - feature.open_time) / 60000
                );

                lines.push(
                    `• ${minutesBefore} min before | ` +
                    `RSI14=${formatNumber(feature.rsi14)} | ` +
                    `VolRatio=${formatNumber(feature.volume_ratio)} | ` +
                    `vsEMA20=${formatNumber(feature.price_vs_ema20)}% | ` +
                    `vsEMA50=${formatNumber(feature.price_vs_ema50)}% | ` +
                    `BreakoutUp=${feature.breakout_up ?? "N/A"}`
                );
            }
        }

        lines.push("");
    }

    if (result.results.length > maxEvents) {
        lines.push(
            `Showing ${maxEvents} of ${result.results.length} detected events.`
        );
    }

    return lines.join("\n");
}
