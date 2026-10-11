export class FeatureEngine {

    constructor(database) {
        this.database = database;
    }

    calculate(candles) {

        const results = [];

        for (let i = 0; i < candles.length; i++) {

            const candle = candles[i];

            const close = candle.close;

            const result = {

                market: candle.market,
                symbol: candle.symbol,
                interval: candle.interval,

                open_time: candle.open_time,

                close,
                volume: candle.volume,

                return_1x:
                    this.returnPercent(
                        candles,
                        i,
                        this.intervalMinutes(candle.interval)
                    ),

                return_4x:
                    this.returnPercent(
                        candles,
                        i,
                        this.intervalMinutes(candle.interval) * 4
                    ),

                return_16x:
                    this.returnPercent(
                        candles,
                        i,
                        this.intervalMinutes(candle.interval) * 16
                    ),

                ema20:
                    this.ema(
                        candles,
                        i,
                        20
                    ),

                ema50:
                    this.ema(
                        candles,
                        i,
                        50
                    ),

                ema200:
                    this.ema(
                        candles,
                        i,
                        200
                    ),

                rsi14:
                    this.rsi(
                        candles,
                        i,
                        14
                    ),

                volume_sma20:
                    this.smaVolume(
                        candles,
                        i,
                        20
                    ),

                atr14:
                    this.atr(
                        candles,
                        i,
                        14
                    ),

                volatility20:
                    this.volatility(
                        candles,
                        i,
                        20
                    ),

                high20:
                    this.high(
                        candles,
                        i,
                        20
                    ),

                low20:
                    this.low(
                        candles,
                        i,
                        20
                    )
            };

            if (
                result.volume_sma20 !== null &&
                result.volume_sma20 > 0
            ) {

                result.volume_ratio =
                    candle.volume /
                    result.volume_sma20;

            } else {

                result.volume_ratio = null;
            }

            if (
                result.ema20 !== null &&
                result.ema20 !== 0
            ) {

                result.price_vs_ema20 =
                    (
                        close -
                        result.ema20
                    ) /
                    result.ema20 *
                    100;

            } else {

                result.price_vs_ema20 = null;
            }

            if (
                result.ema50 !== null &&
                result.ema50 !== 0
            ) {

                result.price_vs_ema50 =
                    (
                        close -
                        result.ema50
                    ) /
                    result.ema50 *
                    100;

            } else {

                result.price_vs_ema50 = null;
            }

            result.ema20_above_ema50 =
                (
                    result.ema20 !== null &&
                    result.ema50 !== null &&
                    result.ema20 >
                    result.ema50
                )
                    ? 1
                    : 0;

            if (
                result.high20 !== null &&
                close > result.high20
            ) {

                result.breakout_up = 1;

            } else {

                result.breakout_up = 0;
            }

            if (
                result.low20 !== null &&
                close < result.low20
            ) {

                result.breakout_down = 1;

            } else {

                result.breakout_down = 0;
            }

            results.push(result);
        }

        return results;
    }


    returnPercent(
        candles,
        index,
        minutes
    ) {

        const current =
            candles[index];

        const interval =
            current.interval;

        const intervalMinutes =
            this.intervalMinutes(
                interval
            );

        const offset =
            Math.round(
                minutes /
                intervalMinutes
            );

        const previousIndex =
            index - offset;

        if (previousIndex < 0) {
            return null;
        }

        const previous =
            candles[previousIndex];

        if (!previous.close) {
            return null;
        }

        return (
            (
                current.close -
                previous.close
            ) /
            previous.close
        ) * 100;
    }


    intervalMinutes(interval) {

        const value =
            Number(
                interval.slice(0, -1)
            );

        const unit =
            interval.slice(-1);

        if (unit === "m") {
            return value;
        }

        if (unit === "h") {
            return value * 60;
        }

        if (unit === "d") {
            return value * 1440;
        }

        throw new Error(
            `Unsupported interval: ${interval}`
        );
    }


    smaVolume(
        candles,
        index,
        period
    ) {

        if (index < period - 1) {
            return null;
        }

        let sum = 0;

        for (
            let i = index - period + 1;
            i <= index;
            i++
        ) {

            sum += candles[i].volume;
        }

        return sum / period;
    }


    ema(
        candles,
        index,
        period
    ) {

        if (index < period - 1) {
            return null;
        }

        const multiplier =
            2 / (period + 1);

        let ema =
            candles[
                index - period + 1
            ].close;

        for (
            let i = index - period + 2;
            i <= index;
            i++
        ) {

            ema =
                (
                    candles[i].close -
                    ema
                ) *
                multiplier +
                ema;
        }

        return ema;
    }


    rsi(
        candles,
        index,
        period
    ) {

        if (index < period) {
            return null;
        }

        let gains = 0;
        let losses = 0;

        for (
            let i = index - period + 1;
            i <= index;
            i++
        ) {

            const change =
                candles[i].close -
                candles[i - 1].close;

            if (change > 0) {

                gains += change;

            } else {

                losses += Math.abs(change);
            }
        }

        const averageGain =
            gains / period;

        const averageLoss =
            losses / period;

        if (averageLoss === 0) {
            return 100;
        }

        const rs =
            averageGain /
            averageLoss;

        return 100 - (
            100 /
            (1 + rs)
        );
    }


    atr(
        candles,
        index,
        period
    ) {

        if (index < period) {
            return null;
        }

        const trs = [];

        for (
            let i = index - period + 1;
            i <= index;
            i++
        ) {

            const current =
                candles[i];

            const previous =
                candles[i - 1];

            const tr =
                Math.max(
                    current.high -
                    current.low,

                    Math.abs(
                        current.high -
                        previous.close
                    ),

                    Math.abs(
                        current.low -
                        previous.close
                    )
                );

            trs.push(tr);
        }

        return (
            trs.reduce(
                (sum, value) =>
                    sum + value,
                0
            ) / period
        );
    }


    volatility(
        candles,
        index,
        period
    ) {

        if (index < period) {
            return null;
        }

        const returns = [];

        for (
            let i = index - period + 1;
            i <= index;
            i++
        ) {

            const previous =
                candles[i - 1];

            const current =
                candles[i];

            const change =
                (
                    current.close -
                    previous.close
                ) /
                previous.close;

            returns.push(change);
        }

        const mean =
            returns.reduce(
                (sum, value) =>
                    sum + value,
                0
            ) /
            returns.length;

        const variance =
            returns.reduce(
                (sum, value) =>
                    sum +
                    Math.pow(
                        value - mean,
                        2
                    ),
                0
            ) /
            returns.length;

        return Math.sqrt(variance);
    }


    high(
        candles,
        index,
        period
    ) {

        if (index < period) {
            return null;
        }

        let highest =
            -Infinity;

        /*
         * Không lấy candle hiện tại.
         * Đây là điểm rất quan trọng:
         * breakout phải so với vùng giá
         * TRƯỚC candle hiện tại.
         */

        for (
            let i = index - period;
            i < index;
            i++
        ) {

            highest =
                Math.max(
                    highest,
                    candles[i].high
                );
        }

        return highest;
    }


    low(
        candles,
        index,
        period
    ) {

        if (index < period) {
            return null;
        }

        let lowest =
            Infinity;

        for (
            let i = index - period;
            i < index;
            i++
        ) {

            lowest =
                Math.min(
                    lowest,
                    candles[i].low
                );
        }

        return lowest;
    }
}