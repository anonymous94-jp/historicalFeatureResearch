
import "dotenv/config";
import TelegramBot from "node-telegram-bot-api";
import {
    PumpResearchService,
    formatResearchResult
} from "./services/pumpResearchService.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
const allowedUserId = process.env.TELEGRAM_ALLOWED_USER_ID;

if (!token) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN in .env");
}

if (!allowedUserId) {
    throw new Error("Missing TELEGRAM_ALLOWED_USER_ID in .env");
}

const bot = new TelegramBot(token, {
    polling: true
});

const MENU_KEYBOARD = {
    inline_keyboard: [
        [
            {
                text: "Get Feature Pump Token",
                callback_data: "get_pump_features"
            }
        ]
    ]
};

const waitingForSymbol = new Set();

function isAuthorized(msg) {
    return String(msg.from?.id) === String(allowedUserId);
}

// Hiển thị menu chính khi người dùng gửi /start
bot.onText(/^\/start$/, async (msg) => {
    if (!isAuthorized(msg)) {
        await bot.sendMessage(
            msg.chat.id,
            "You are not authorized to use this bot."
        );
        return;
    }

    waitingForSymbol.delete(msg.chat.id);

    await bot.sendMessage(
        msg.chat.id,
        "Historical Feature Research\n\nSelect an action:",
        {
            reply_markup: MENU_KEYBOARD
        }
    );
});

// Xử lý khi người dùng bấm nút menu

bot.on("callback_query", async (query) => {
  console.log("[Telegram callback]", query.data);

  // Xác nhận ngay để tránh callback hết hạn
  try {
    await bot.answerCallbackQuery(query.id);
  } catch (error) {
    console.error("[answerCallbackQuery]", error.message);
  }

  const msg = query.message;
  if (!msg) return;

  // Kiểm tra quyền truy cập
  if (String(query.from.id) !== String(allowedUserId)) {
    await bot.sendMessage(
      msg.chat.id,
      "You are not authorized to use this bot."
    );
    return;
  }

  if (query.data === "get_pump_features") {
    waitingForSymbol.add(msg.chat.id);

    await bot.sendMessage(
      msg.chat.id,
      "Enter a Binance USD-M Futures symbol.\n\n" +
      "Example: NEARUSDT\n\n" +
      "Send /menu to return to the main menu."
    );
  }
});


// Nhận symbol người dùng nhập
bot.on("message", async (msg) => {
    if (!msg.text || msg.text.startsWith("/")) return;
    if (!isAuthorized(msg)) return;
    if (!waitingForSymbol.has(msg.chat.id)) return;

    const symbol = msg.text.trim().toUpperCase();

    if (!/^[A-Z0-9]{2,30}USDT$/.test(symbol)) {
        await bot.sendMessage(
            msg.chat.id,
            "Invalid symbol format. Example: NEARUSDT"
        );
        return;
    }

    waitingForSymbol.delete(msg.chat.id);

    // await bot.sendMessage(
    //     msg.chat.id,
    //     `Received symbol: ${symbol}\n\n` +
    //     "The research service will be connected in the next step.",
    //     {
    //         reply_markup: MENU_KEYBOARD
    //     }
    // );

    await bot.sendMessage(
        msg.chat.id,
        `🔍 Starting historical research for ${symbol}...\n` +
        `This may take a few minutes while candles are downloaded.`
    );

    try {
        const service = new PumpResearchService();
        const result = await service.researchSymbol(symbol);
        const report = formatResearchResult(result);

        await bot.sendMessage(msg.chat.id, report, {
            reply_markup: MENU_KEYBOARD
        });
    } catch (error) {
        console.error(`[Research failed] ${symbol}`, error);

        await bot.sendMessage(
            msg.chat.id,
            `❌ Research failed for ${symbol}.\n\n` +
            `${error.message}\n\n` +
            `Send /menu to try again.`,
            {
                reply_markup: MENU_KEYBOARD
            }
        );
    }

});

// Quay lại menu chính
bot.onText(/^\/menu$/, async (msg) => {
    if (!isAuthorized(msg)) return;

    waitingForSymbol.delete(msg.chat.id);

    await bot.sendMessage(
        msg.chat.id,
        "Select an action:",
        {
            reply_markup: MENU_KEYBOARD
        }
    );
});

// Hiển thị lỗi polling
bot.on("polling_error", (error) => {
    console.error("[Telegram polling error]", error.message);
});

console.log("[Telegram] Bot started.");
