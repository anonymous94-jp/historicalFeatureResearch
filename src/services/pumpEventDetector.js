export class PumpEventDetector {

    constructor(config) {
        this.config = config;
    }

    detect(candles) {

        const {
            windowCandles,
            minReturnPct,
            maxGapCandles
        } = this.config;

        if (candles.length <= windowCandles) {
            return [];
        }

        const candidates = [];

        // --------------------------------------------------
        // STEP 1
        // Find raw pump candidates
        // --------------------------------------------------

        for (
            let i = windowCandles;
            i < candles.length;
            i++
        ) {

            const startCandle =
                candles[i - windowCandles];

            const endCandle =
                candles[i];

            const startPrice =
                Number(startCandle.close);

            const endPrice =
                Number(endCandle.close);

            if (
                !Number.isFinite(startPrice) ||
                !Number.isFinite(endPrice) ||
                startPrice <= 0
            ) {
                continue;
            }

            const returnPct =
                ((endPrice - startPrice) / startPrice) * 100;

            if (returnPct >= minReturnPct) {

                candidates.push({
                    startIndex: i - windowCandles,
                    endIndex: i,
                    returnPct
                });
            }
        }

        if (candidates.length === 0) {
            return [];
        }

        // --------------------------------------------------
        // STEP 2
        // Merge overlapping / nearby candidates
        // --------------------------------------------------

        const groups = [];

        let currentGroup = [candidates[0]];

        for (let i = 1; i < candidates.length; i++) {

            const previous =
                candidates[i - 1];

            const current =
                candidates[i];

            const gap =
                current.startIndex -
                previous.endIndex;

            if (gap <= maxGapCandles) {

                currentGroup.push(current);

            } else {

                groups.push(currentGroup);

                currentGroup = [current];
            }
        }

        groups.push(currentGroup);

        // --------------------------------------------------
        // STEP 3
        // Convert groups into Pump Events
        // --------------------------------------------------

        const events = [];

        for (const group of groups) {

            const first =
                group[0];

            const last =
                group[group.length - 1];

            const startIndex =
                first.startIndex;

            const endIndex =
                last.endIndex;

            const eventCandles =
                candles.slice(
                    startIndex,
                    endIndex + 1
                );

            if (eventCandles.length === 0) {
                continue;
            }

            // --------------------------------------------------
            // Find peak
            // --------------------------------------------------

            let peakIndex = startIndex;
            let peakPrice =
                Number(candles[startIndex].high);

            for (
                let i = startIndex;
                i <= endIndex;
                i++
            ) {

                const high =
                    Number(candles[i].high);

                if (high > peakPrice) {

                    peakPrice = high;
                    peakIndex = i;
                }
            }

            const startPrice =
                Number(candles[startIndex].close);

            if (
                !Number.isFinite(startPrice) ||
                !Number.isFinite(peakPrice) ||
                startPrice <= 0
            ) {
                continue;
            }

            const returnPct =
                ((peakPrice - startPrice) /
                    startPrice) * 100;

            const startTime =
                Number(candles[startIndex].open_time);

            const endTime =
                Number(candles[endIndex].open_time);

            const peakTime =
                Number(candles[peakIndex].open_time);

            const durationMinutes =
                Math.round(
                    (peakTime - startTime) / 60000
                );

            events.push({

                market: candles[startIndex].market,

                symbol: candles[startIndex].symbol,

                interval: candles[startIndex].interval,

                start_time: startTime,

                end_time: endTime,

                peak_time: peakTime,

                start_price: startPrice,

                peak_price: peakPrice,

                return_pct: returnPct,

                duration_minutes:
                    durationMinutes
            });
        }

        return events;
    }
}