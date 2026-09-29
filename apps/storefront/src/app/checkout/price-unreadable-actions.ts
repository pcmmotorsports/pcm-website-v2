'use server';

// P-M5 紀錄(主視窗 09-29):前台在送出前擋下「價格讀不到」時, 讓伺服器記一行, 貼板 252 之後查得到次數。
//   擋下的地方在瀏覽器(useChargePayment), 瀏覽器寫不進伺服器紀錄, 所以另開這支只記數字的 action。
//   🔴 只記原因碼與兩個列數, 不收也不記身分、商品、價格;收到的數字不合理就寫 null(不把任意值寫進紀錄)。
//   英文關鍵字 pcm_price_unreadable:vercel logs -q 查中文沒有驗證過, 查英文關鍵字確定會比對到紀錄內容(09-29 實測)。
//   ponytail:沒有限流, 任何人都能打;它只印一行小紀錄、不碰資料庫, 被灌也只是紀錄多幾行。
import { safeLog } from '@/lib/safe-log';

const count = (v: unknown, max: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= max ? v : null;

export async function reportPriceUnreadableAction(lines: number, unreadable: number): Promise<void> {
  const l = count(lines, 200);
  safeLog('info', '[checkout] pcm_price_unreadable 前台擋下 價格讀不到', {
    reason: 'price_unreadable',
    lines: l,
    unreadable: count(unreadable, l ?? 200),
  });
}
