// ⟦f3-HALFWRITE1⟧ 的驅動:用【真的那支 upsertBatched】對【真的 PostgREST + Postgres】跑三個世界。
// 🔴 它答的是一句話:一次同步跑到一半失敗時, DB 裡【留下什麼】。
// 🛑 零正式庫:連線位址由呼叫端用環境變數給, 而本檔對 PGRST_URL 沒有預設值 —— 忘了給就當場炸。
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { upsertBatched } from './rpm-load';
import { runAtomicGroups, LOG_DIR } from './rpm-partial-report';
import { readdirSync, mkdirSync } from 'node:fs';

const URL = process.env.PGRST_URL;
if (!URL) { console.error('🔴 沒有 PGRST_URL ⇒ 沒有跑, 不是查無'); process.exit(3); }
const KEY = process.env.PGRST_KEY ?? 'x';
const TABLE = 'pcm_hw_probe';

// 🔴 supabase-js 會在 base URL 後面自己接 `/rest/v1` —— 而裸的 PostgREST 沒有那一層
//    ⇒ 回「Invalid path specified in request URL」, 而那與「表不存在」在呼叫端長得一樣。
//    ⇒ 把那一段拿掉再送出去。**這一格改的是我的鑽機, 不是受測的碼。**
const stripRestV1 = (input: RequestInfo | URL, init?: RequestInit) =>
  fetch(String(input).replace('/rest/v1', ''), init);
const client = () => createClient(URL, KEY, { global: { fetch: stripRestV1 } });
const N = 1200;                 // 分批大小 500 ⇒ 三批:0-499 / 500-999 / 1000-1199

function rows(badIndex: number) {
  return Array.from({ length: N }, (_, i) => ({
    sku: `zzq-hw-${String(i).padStart(5, '0')}`,
    n: i === badIndex ? -1 : i,   // -1 違反 CHECK (n >= 0)
  }));
}

async function count(c: SupabaseClient) {
  const { count: k, error } = await c.from(TABLE).select('*', { count: 'exact', head: true });
  if (error) throw new Error(`數列數失敗:${error.message}`);
  return k;
}

async function world(name: string, badIndex: number, expect: number) {
  const c = client();
  const { error: delErr } = await c.from(TABLE).delete().neq('sku', '');
  if (delErr) throw new Error(`清空失敗:${delErr.message}`);
  const before = await count(c);
  if (before !== 0) throw new Error(`清空之後不是 0 而是 ${before} ⇒ 這一發不算數`);

  let threw = null;
  try {
    await upsertBatched(c, TABLE, rows(badIndex), 'sku');
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e);
  }
  const after = await count(c);
  const ok = after === expect;
  console.log(`${ok ? 'PASS' : '🔴 FAIL'}  ${name}`);
  console.log(`        丟出來的錯:${threw ? threw.slice(0, 80) : '(沒有丟)'}`);
  console.log(`        跑完 DB 裡剩 ${after} 列(期望 ${expect})`);
  return ok ? 0 : 1;
}

// ══ 第二半:atomic 群迴圈(留痕就掛在它身上, 而上面那半碰不到它)══════════════
function logFiles() {
  try { return readdirSync(LOG_DIR).filter((f) => f.startsWith('rpm-import-partial-zzqhw-')); }
  catch { return []; }
}
async function atomicWorld(
  name: string,
  badGroupIdx: number,
  expectRows: number,
  expectLogs: number,
) {
  const c = client();
  const { error: delErr } = await c.from(TABLE).delete().neq('sku', '');
  if (delErr) throw new Error(`清空失敗:${delErr.message}`);
  mkdirSync(LOG_DIR, { recursive: true });
  const before = logFiles();

  const groups = Array.from({ length: 5 }, (_, i) => ({ externalId: `zzqhw-g${i}` }));
  let threw = null;
  try {
    await runAtomicGroups(groups, 'zzqhw', async (g: { externalId: string }) => {
      const i = Number(g.externalId.slice(-1));
      if (i === badGroupIdx) throw new Error(`zzqhw 群 ${g.externalId} 故意炸`);
      const { error } = await c.from(TABLE).insert({ sku: g.externalId, n: i });
      if (error) throw new Error(error.message);
    });
  } catch (e) { threw = e instanceof Error ? e.message : String(e); }

  const rows = await count(c);
  const newLogs = logFiles().filter((f: string) => !before.includes(f));
  const ok = rows === expectRows && newLogs.length === expectLogs;
  console.log(`${ok ? 'PASS' : '🔴 FAIL'}  ${name}`);
  console.log(`        丟出來的錯:${threw ? threw.slice(0, 60) : '(沒有丟)'}`);
  console.log(`        DB 裡剩 ${rows} 列(期望 ${expectRows})· 新的留痕檔 ${newLogs.length} 份(期望 ${expectLogs})`);
  if (newLogs.length) console.log(`        留痕檔:${newLogs.join(', ')}`);
  return ok ? 0 : 1;
}

async function main() {
  let bad = 0;
  // 🟢 成功那一發 —— A 2026-09-09 加的驗收:沒有它,「留下半寫入」與「它本來就長這樣」分不開。
  bad += await world('🟢 成功世界:1200 列全好', -1, N);
  // 🔴 主張:第 700 列壞 ⇒ 第一批(0-499)已 commit、第二批整批沒進去、第三批從來沒送出去
  bad += await world('🔴 中途失敗:第 700 列壞', 700, 500);
  // ⚪ 負對照:第 100 列壞(在第一批裡)⇒ 應該一列都不剩。
  //    少了這一格,上面那個 500 可以是任何原因;有了它,500 才等於「分批的邊界」。
  bad += await world('⚪ 負對照:第 100 列壞(第一批內)', 100, 0);
  console.log('');
  // 🟢 atomic 那半也要兩個世界 —— 成功那一發【不該】留下痕跡, 不然「有留痕」等於恆真。
  bad += await atomicWorld('🟢 atomic 成功世界:5 群全好', -1, 5, 0);
  bad += await atomicWorld('🔴 atomic 中途失敗:第 2 群炸', 2, 2, 1);
  console.log(`\n── 五個世界:${bad === 0 ? '全 PASS' : `🔴 ${bad} 格 FAIL`}`);
  process.exit(bad === 0 ? 0 : 1);

}

void main();
