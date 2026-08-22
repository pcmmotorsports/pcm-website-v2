import { describe, expect, it } from 'vitest';
import {
  PCM_PROD_PROJECT_REF,
  PROD_DB_BYPASS_ENV,
  checkProdDbInDev,
  describeProdDbInDev,
} from './dev-db-guard';

// 🔴 **這支測試的存在理由 = 那道閘要能【該紅的紅、該綠的綠】。**
//    只驗「指向正式庫會擋」= 只證明它會擋,沒證明它不是【恆擋】——
//    一個恆擋的閘會讓所有人在所有工作樹上都跑不起來,而它在稽核裡長得跟「有效」一樣。

const PROD_URL = `https://${PCM_PROD_PROJECT_REF}.supabase.co`;
const LOCAL_URL = 'http://127.0.0.1:54321';

describe('checkProdDbInDev', () => {
  it('該紅的:任何一個 env 值含正式庫 ref ⇒ blocked,並指名是哪一個 key', () => {
    const v = checkProdDbInDev({ NEXT_PUBLIC_SUPABASE_URL: PROD_URL });
    expect(v).toEqual({ kind: 'blocked', matchedKey: 'NEXT_PUBLIC_SUPABASE_URL' });
  });

  it('🔴 該綠的:指向拋棄式 PG ⇒ ok(證明它不是恆擋)', () => {
    expect(checkProdDbInDev({ NEXT_PUBLIC_SUPABASE_URL: LOCAL_URL })).toEqual({ kind: 'ok' });
  });

  it('空 env ⇒ ok', () => {
    expect(checkProdDbInDev({})).toEqual({ kind: 'ok' });
  });

  // 🔴 具名清單會漂:明天有人加一支沒人想到的變數名,閘不可以安靜回綠。
  it('ref 出現在【任何】變數名底下都要抓到,不只是那幾支具名的', () => {
    const v = checkProdDbInDev({ SOME_FUTURE_DB_URL: `postgres://${PCM_PROD_PROJECT_REF}.x/db` });
    expect(v).toEqual({ kind: 'blocked', matchedKey: 'SOME_FUTURE_DB_URL' });
  });

  it('逃生門 =1 ⇒ bypassed(放行),而仍然指名 key', () => {
    const v = checkProdDbInDev({
      NEXT_PUBLIC_SUPABASE_URL: PROD_URL,
      [PROD_DB_BYPASS_ENV]: '1',
    });
    expect(v).toEqual({ kind: 'bypassed', matchedKey: 'NEXT_PUBLIC_SUPABASE_URL' });
  });

  // 🔴 逃生門只認 '1'。'true' / 'yes' / '0' 都不放行 —— 否則「我以為我關掉了」會變成一個沉默的開著。
  it.each(['true', 'yes', '0', ''])('逃生門 =%s ⇒ 仍然 blocked', (value) => {
    const v = checkProdDbInDev({ NEXT_PUBLIC_SUPABASE_URL: PROD_URL, [PROD_DB_BYPASS_ENV]: value });
    expect(v.kind).toBe('blocked');
  });
});

describe('describeProdDbInDev', () => {
  it('訊息要講出【是哪個變數】與【下一步做什麼】,不只說不行', () => {
    const msg = describeProdDbInDev('NEXT_PUBLIC_SUPABASE_URL');
    expect(msg).toContain('NEXT_PUBLIC_SUPABASE_URL');
    expect(msg).toContain(PCM_PROD_PROJECT_REF);
    expect(msg).toContain('/private/tmp/pcm-refund-4c');
    expect(msg).toContain(PROD_DB_BYPASS_ENV);
  });
});
