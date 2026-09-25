// 瀏覽器端 BotID(2026-09-25 Q7 甲):送出註冊表單時附上檢查資料, 伺服器端 registerAction 用 checkBotId() 判斷。
// 註冊是 server action, 表單 POST 到頁面路徑 /register(比對的是 pathname, ?next= 不影響)。
import { initBotId } from 'botid/client/core';

initBotId({ protect: [{ path: '/register', method: 'POST' }] });
