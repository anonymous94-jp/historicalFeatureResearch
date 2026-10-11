import {config} from "../config.js";
import { Database } from "../database/database.js";

const database = new Database(config.database.path);

try {
    database.db.exec(`
        CREATE TABLE IF NOT EXISTS pump_starts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            market TEXT NOT NULL,
            symbol TEXT NOT NULL,
            interval TEXT NOT NULL,

            event_start_time INTEGER NOT NULL,
            pump_start_time INTEGER NOT NULL,
            pump_start_price REAL NOT NULL,

            UNIQUE(market, symbol, interval, event_start_time)
        );

        CREATE INDEX IF NOT EXISTS idx_pump_starts_lookup
        ON pump_starts(market, symbol, interval, pump_start_time);
    `);

    const events = database.db.prepare(`
        SELECT *
        FROM pump_events
        ORDER BY market, symbol, interval, start_time
    `).all();

    const findPreviousCandle = database.db.prepare(`
        SELECT open_time, close
        FROM candles
        WHERE market = ?
          AND symbol = ?
          AND interval = ?
          AND open_time < ?
        ORDER BY open_time DESC
        LIMIT 1
    `);

    const insert = database.db.prepare(`
        INSERT OR REPLACE INTO pump_starts (
            market,
            symbol,
            interval,
            event_start_time,
            pump_start_time,
            pump_start_price
        )
        VALUES (?, ?, ?, ?, ?, ?)
    `);

    let processed = 0;
    let skipped = 0;

    const run = database.db.transaction(() => {
        for (const event of events) {
            const previous = findPreviousCandle.get(
                event.market,
                event.symbol,
                event.interval,
                event.start_time
            );

            if (!previous) {
                skipped++;
                continue;
            }

            insert.run(
                event.market,
                event.symbol,
                event.interval,
                event.start_time,
                previous.open_time,
                previous.close
            );

            processed++;

            console.log(
                `${event.symbol} | Event: ${new Date(event.start_time).toISOString()}`
                + ` | Pump start: ${new Date(previous.open_time).toISOString()}`
                + ` | Price: ${previous.close}`
            );
        }
    });

    run();

    console.log(`\nDone. Processed: ${processed}, skipped: ${skipped}`);
} finally {
    database.close();
}

