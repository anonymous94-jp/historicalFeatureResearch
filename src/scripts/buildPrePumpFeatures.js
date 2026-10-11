import {config} from "../config.js";
import { Database } from "../database/database.js";

const database = new Database(config.database.path);

try {
    database.db.exec(`
        CREATE TABLE IF NOT EXISTS pre_pump_features (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            market TEXT NOT NULL,
            symbol TEXT NOT NULL,
            interval TEXT NOT NULL,

            event_start_time INTEGER NOT NULL,
            pump_start_time INTEGER NOT NULL,
            feature_time INTEGER NOT NULL,

            minutes_before_pump INTEGER NOT NULL,

            close REAL,
            volume REAL,

            return_1x REAL,
            return_4x REAL,
            return_16x REAL,

            price_vs_ema20 REAL,
            price_vs_ema50 REAL,
            ema20_above_ema50 INTEGER,

            rsi14 REAL,
            volume_ratio REAL,

            atr14 REAL,
            volatility20 REAL,

            breakout_up INTEGER,
            breakout_down INTEGER,

            UNIQUE(
                market,
                symbol,
                interval,
                event_start_time,
                feature_time
            )
        );

        CREATE INDEX IF NOT EXISTS idx_pre_pump_features_lookup
        ON pre_pump_features(
            symbol,
            interval,
            event_start_time,
            feature_time
        );
    `);

    const pumpStarts = database.db.prepare(`
        SELECT *
        FROM pump_starts
        ORDER BY symbol, pump_start_time
    `).all();

    const getFeatures = database.db.prepare(`
        SELECT *
        FROM features
        WHERE market = ?
          AND symbol = ?
          AND interval = ?
          AND open_time < ?
        ORDER BY open_time ASC
    `);

    const insert = database.db.prepare(`
        INSERT OR REPLACE INTO pre_pump_features (
            market,
            symbol,
            interval,
            event_start_time,
            pump_start_time,
            feature_time,
            minutes_before_pump,
            close,
            volume,
            return_1x,
            return_4x,
            return_16x,
            price_vs_ema20,
            price_vs_ema50,
            ema20_above_ema50,
            rsi14,
            volume_ratio,
            atr14,
            volatility20,
            breakout_up,
            breakout_down
        )
        VALUES (
            @market,
            @symbol,
            @interval,
            @event_start_time,
            @pump_start_time,
            @feature_time,
            @minutes_before_pump,
            @close,
            @volume,
            @return_1x,
            @return_4x,
            @return_16x,
            @price_vs_ema20,
            @price_vs_ema50,
            @ema20_above_ema50,
            @rsi14,
            @volume_ratio,
            @atr14,
            @volatility20,
            @breakout_up,
            @breakout_down
        )
    `);

    let totalInserted = 0;

    const run = database.db.transaction(() => {
        for (const pump of pumpStarts) {
            const rows = getFeatures.all(
                pump.market,
                pump.symbol,
                pump.interval,
                pump.pump_start_time
            );

            for (const row of rows) {
                const minutesBeforePump = Math.round(
                    (pump.pump_start_time - row.open_time) / 60000
                );

                insert.run({
                    ...row,
                    event_start_time: pump.event_start_time,
                    pump_start_time: pump.pump_start_time,
                    feature_time: row.open_time,
                    minutes_before_pump: minutesBeforePump
                });

                totalInserted++;
            }

            console.log(
                `${pump.symbol} | features: ${rows.length}`
            );
        }
    });

    run();

    console.log(`\nDone. Rows processed: ${totalInserted}`);
} finally {
    database.close();
}

