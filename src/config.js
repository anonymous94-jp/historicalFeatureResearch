export const config = {

    futures: {
        market: "USD-M",
        quoteAsset: "USDT",
        contractType: "PERPETUAL"
    },

    symbols: {

        // manual = tự chỉ định symbol
        // all    = sau này lấy toàn bộ Futures
        mode: "manual",

        list: [
            "SANDUSDT",
            "NEARUSDT",
            "NIGHTUSDT",
            "ZECUSDT",
            "OGNUSDT",
            "APTUSDT"
        ]
    },

    intervals: [
        "15m",
        "1h",
        "4h"
    ],

    historical: {

        // Phase 1 test trước
        days: 30,

        // Binance cho tối đa 1500 candle/request
        limit: 1500,

        // nghỉ giữa các request
        requestDelayMs: 100
    },

    database: {
        path: "./data/futures-research.db"
    },

    pumpDetection: {
        interval: "15m",

        // 4 candles × 15m = 1 hour
        windowCandles: 4,

        // Initial threshold, sẽ điều chỉnh sau khi xem data thực tế
        minReturnPct: 10,

        // Cho phép các candidate cách nhau tối đa 1 candle được gộp
        maxGapCandles: 1
    },
};