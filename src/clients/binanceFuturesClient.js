import axios from "axios";

export class BinanceFuturesClient {

    constructor(baseUrl) {

        this.baseUrl = baseUrl;

        this.http = axios.create({
            baseURL: this.baseUrl,
            timeout: 15000
        });
    }

    async getExchangeInfo() {

        const response = await this.http.get(
            "/fapi/v1/exchangeInfo"
        );

        return response.data;
    }

    async getKlines({
        symbol,
        interval,
        startTime,
        endTime,
        limit = 1500
    }) {

        const response = await this.http.get(
            "/fapi/v1/klines",
            {
                params: {
                    symbol,
                    interval,
                    startTime,
                    endTime,
                    limit
                }
            }
        );

        return response.data;
    }
}