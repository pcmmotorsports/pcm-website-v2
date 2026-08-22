// dev-db-guard-gate.ts — 正式庫閘的【接線層】:給 next.config 呼叫的那一面。
//
// 與判定層(dev-db-guard.ts)分開的理由:本檔 import node:fs,而判定層被 proxy.ts
// (runtime-neutral、不得帶 node:fs)引用 —— fs 只能住在這裡。
// 兩支 next.config(admin / storefront)共用本檔,不各自複製 —— 複製的那天起兩道閘就開始漂。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PROD_DB_BYPASS_ENV,
  checkProdDbInDev,
  describeProdDbInDev,
  type EnvLike,
} from './dev-db-guard';

// next dev(dev phase)會載進 process.env 的四支檔;.env.production* 不在 dev 的載入集。
const ENV_FILES = ['.env.local', '.env.development.local', '.env.development', '.env'];

/**
 * 逃生門是不是被**寫進 .env 檔**(⇒ 會被下一個人不知情地繼承)。
 * 🔴 只認「值=1」的寫法(可帶引號)—— runtime 也只有 '1' 會放行,檔裡寫 `=0`/`=true`
 *    都不構成檔面授權、不觸發拒絕(R2 nit:原版 regex 在 `=` 後不看值,檔裡寫 `=0` 也被拒,
 *    而訊息卻說「偵測到 =1」—— 字面與檔案內容不符)。
 * 🔴 `dir` 必須是【config 檔自己所在目錄】,不是 `process.cwd()`(R2 MF-1):
 *    Next 載 .env 用的是專案目錄(= config 所在目錄),cwd 是「人從哪裡打指令」。
 *    ⚠️ 2026-08-23 量到:今天的 Next 16.3 legacy TS-config loader 下,cwd≠專案目錄的調用
 *    (如從 repo 根跑 `next dev apps/admin`)會因 config 相對 import 解析失敗而 fail-safe 崩潰,
 *    到不了本函式 —— 修這格護的是【未來 loader 修好之後】的世界與函式契約本身,不是今天的復現路徑。
 */
export function bypassWrittenInEnvFile(dir: string): boolean {
  // 引號用反向引用強制成對(codex R1 nit):`"1'` 這種不成對寫法不算檔面 =1 ——
  // runtime 解析它的值也不會恰好是 '1',兩層判定一致。
  const line = new RegExp(
    `^\\s*(export\\s+)?${PROD_DB_BYPASS_ENV}\\s*=\\s*(["'])?1\\2\\s*(#.*)?$`,
    'm',
  );
  return ENV_FILES.some((name) => {
    const path = join(dir, name);
    if (!existsSync(path)) return false;
    return line.test(readFileSync(path, 'utf8'));
  });
}

/** dev phase 的閘本體:blocked ⇒ throw(server 起不來)、bypassed ⇒ 印警告放行。 */
export function assertDevDbGate(configDir: string, env: EnvLike = process.env): void {
  const verdict = checkProdDbInDev(env, { bypassFromEnvFile: bypassWrittenInEnvFile(configDir) });
  if (verdict.kind === 'blocked') {
    throw new Error(describeProdDbInDev(verdict.matches, verdict.bypassRefused));
  }
  if (verdict.kind === 'bypassed') {
    console.warn(
      `⚠️ ${verdict.matches.map((m) => m.key).join(', ')} 指向非本機資料庫,而 ${PROD_DB_BYPASS_ENV}=1 ⇒ 放行。` +
        '你正在把一個 dev server 接上遠端資料庫。',
    );
  }
}
