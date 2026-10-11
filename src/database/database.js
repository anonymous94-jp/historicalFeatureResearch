import DatabaseLib from "better-sqlite3";

export class Database {

    constructor(path) {

        this.db = new DatabaseLib(path);

        this.db.pragma("journal_mode = WAL");

        this.createTables();
    }

    createTables() {

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS candles (

                id INTEGER PRIMARY KEY AUTOINCREMENT,

                market TEXT NOT NULL,

                symbol TEXT NOT NULL,

                interval TEXT NOT NULL,

                open_time INTEGER NOT NULL,

                close_time INTEGER NOT NULL,

                open REAL NOT NULL,

                high REAL NOT NULL,

                low REAL NOT NULL,

                close REAL NOT NULL,

                volume REAL NOT NULL,

                quote_volume REAL NOT NULL,

                trades INTEGER NOT NULL,

                taker_buy_volume REAL NOT NULL,

                taker_buy_quote_volume REAL NOT NULL,

                UNIQUE(
                    market,
                    symbol,
                    interval,
                    open_time
                )
            );

            CREATE INDEX IF NOT EXISTS idx_candles_lookup
            ON candles(
                market,
                symbol,
                interval,
                open_time
            );

            CREATE TABLE IF NOT EXISTS features (
                id INTEGER PRIMARY KEY AUTOINCREMENT,

                market TEXT NOT NULL,
                symbol TEXT NOT NULL,
                interval TEXT NOT NULL,
                open_time INTEGER NOT NULL,

                close REAL NOT NULL,
                volume REAL NOT NULL,

                return_1x REAL,
                return_4x REAL,
                return_16x REAL,

                ema20 REAL,
                ema50 REAL,
                ema200 REAL,

                price_vs_ema20 REAL,
                price_vs_ema50 REAL,

                ema20_above_ema50 INTEGER,

                rsi14 REAL,

                volume_sma20 REAL,
                volume_ratio REAL,

                atr14 REAL,
                volatility20 REAL,

                high20 REAL,
                low20 REAL,

                breakout_up INTEGER,
                breakout_down INTEGER,

                UNIQUE(market, symbol, interval, open_time)
            );

            CREATE INDEX IF NOT EXISTS idx_features_lookup
                ON features(
                    market,
                    symbol,
                    interval,
                    open_time
                );

            CREATE TABLE IF NOT EXISTS pump_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,

                market TEXT NOT NULL,
                symbol TEXT NOT NULL,
                interval TEXT NOT NULL,

                start_time INTEGER NOT NULL,
                end_time INTEGER NOT NULL,
                peak_time INTEGER NOT NULL,

                start_price REAL NOT NULL,
                peak_price REAL NOT NULL,

                return_pct REAL NOT NULL,
                duration_minutes INTEGER NOT NULL,

                UNIQUE(
                    market,
                    symbol,
                    interval,
                    start_time
                )
            );

            CREATE INDEX IF NOT EXISTS idx_pump_events_lookup
                ON pump_events(
                    market,
                    symbol,
                    interval,
                    start_time
                );
        `);
    }

    insertCandles(candles) {

        const statement = this.db.prepare(`
            INSERT OR IGNORE INTO candles (

                market,
                symbol,
                interval,

                open_time,
                close_time,

                open,
                high,
                low,
                close,

                volume,
                quote_volume,

                trades,

                taker_buy_volume,
                taker_buy_quote_volume

            )
            VALUES (

                @market,
                @symbol,
                @interval,

                @open_time,
                @close_time,

                @open,
                @high,
                @low,
                @close,

                @volume,
                @quote_volume,

                @trades,

                @taker_buy_volume,
                @taker_buy_quote_volume
            )
        `);

        const insertMany = this.db.transaction((rows) => {

            for (const row of rows) {

                statement.run(row);
            }
        });

        insertMany(candles);
    }

    getCandleCount(symbol, interval) {

        const row = this.db.prepare(`
            SELECT COUNT(*) AS count
            FROM candles
            WHERE market = 'USD-M'
            AND symbol = ?
            AND interval = ?
        `).get(symbol, interval);

        return row.count;
    }

    getCandles(symbol, interval) {

        return this.db.prepare(`
            SELECT
                market,
                symbol,
                interval,
                open_time,
                close_time,
                open,
                high,
                low,
                close,
                volume,
                quote_volume,
                trades,
                taker_buy_volume,
                taker_buy_quote_volume
            FROM candles
            WHERE market = 'USD-M'
            AND symbol = ?
            AND interval = ?
            ORDER BY open_time ASC
        `).all(symbol, interval);
    }

    insertFeatures(features) {

        const statement = this.db.prepare(`
            INSERT OR REPLACE INTO features (

                market,
                symbol,
                interval,
                open_time,

                close,
                volume,

                return_1x,
                return_4x,
                return_16x,

                ema20,
                ema50,
                ema200,

                price_vs_ema20,
                price_vs_ema50,

                ema20_above_ema50,

                rsi14,

                volume_sma20,
                volume_ratio,

                atr14,
                volatility20,

                high20,
                low20,

                breakout_up,
                breakout_down

            )
            VALUES (

                @market,
                @symbol,
                @interval,
                @open_time,

                @close,
                @volume,

                @return_1x,
                @return_4x,
                @return_16x,

                @ema20,
                @ema50,
                @ema200,

                @price_vs_ema20,
                @price_vs_ema50,

                @ema20_above_ema50,

                @rsi14,

                @volume_sma20,
                @volume_ratio,

                @atr14,
                @volatility20,

                @high20,
                @low20,

                @breakout_up,
                @breakout_down
            )
        `);

        const insertMany =
            this.db.transaction((rows) => {

                for (const row of rows) {
                    statement.run(row);
                }

            });

        insertMany(features);
    }

    insertPumpEvents(events) {
        if (events.length === 0) {
            return;
        }

        const statement = this.db.prepare(`
            INSERT OR IGNORE INTO pump_events (
                market,
                symbol,
                interval,
                start_time,
                end_time,
                peak_time,
                start_price,
                peak_price,
                return_pct,
                duration_minutes
            )
            VALUES (
                @market,
                @symbol,
                @interval,
                @start_time,
                @end_time,
                @peak_time,
                @start_price,
                @peak_price,
                @return_pct,
                @duration_minutes
            )
        `);

        const insertMany = this.db.transaction((rows) => {
            for (const row of rows) {
                statement.run(row);
            }
        });

        insertMany(events);
    }

    // get full features pre - of a pump event
    getPrePumpFeatures(market, symbol, interval, pumpStartTime) {
        return this.db.prepare(`
            SELECT *
            FROM features
            WHERE market = ?
            AND symbol = ?
            AND interval = ?
            AND open_time < ?
            ORDER BY open_time DESC
        `).all(market, symbol, interval, pumpStartTime);
    }


    close() {

        this.db.close();
    }
}