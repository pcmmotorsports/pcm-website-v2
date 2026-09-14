'use server';

import { createSupabaseServiceClient } from '@pcm/adapters/server';
import { authorizeAdminMutation } from '../session/authorize';
import { splitVehicleText, type VehicleDictionaryHit } from './vehicle-dictionary';

// vehicle-dictionary-action.ts — 建單「車種」一格邊打邊查字典(#956 乙;主視窗 2026-09-14 補點 (1):走既有員工閘、最多 20 筆、不下 12k 整包)。
//
// 🔴 只讀 `vehicle_taxonomy_public`(service_role 可 SELECT, 20260905260000:223;不新開 RPC / GRANT)。
// 🔴 員工閘 = `authorizeAdminMutation`(與查抬頭那支同一道);沒票 ⇒ 回空, 不丟錯(這一格查不到就當字典沒有, 照打照存)。
// 🔴 關鍵字 ≥ 2 字才查;model_code 前綴命中優先、其次包含;去重(同廠牌同 model 多個年份區間只出一列)。

const MAX_HITS = 20;

export async function searchVehicleDictionaryAction(args: { q: string }): Promise<VehicleDictionaryHit[]> {
  const auth = await authorizeAdminMutation().catch(() => null);
  if (auth === null) return [];
  const { q } = splitVehicleText(typeof args?.q === 'string' ? args.q : '');
  if (q.length < 2) return [];
  // PostgREST ilike 的 % / _ 是萬用字元;員工打的字裡有這兩個就拿掉(車款代號沒有這兩個字元)。
  const safe = q.replace(/[%_]/g, '');
  if (safe.length < 2) return [];
  const { data, error } = await createSupabaseServiceClient()
    .from('vehicle_taxonomy_public')
    .select('moto_brand, model_code')
    .ilike('model_code', `%${safe}%`)
    .limit(200);
  if (error || !data) return [];
  const lower = safe.toLowerCase();
  const rows = data
    .filter(
      (r): r is { moto_brand: string; model_code: string } =>
        typeof r.moto_brand === 'string' && typeof r.model_code === 'string',
    )
    .sort((a, b) => {
      // 前綴命中排前面, 其餘照字母。
      const ap = a.model_code.toLowerCase().startsWith(lower) ? 0 : 1;
      const bp = b.model_code.toLowerCase().startsWith(lower) ? 0 : 1;
      return ap - bp || a.model_code.localeCompare(b.model_code) || a.moto_brand.localeCompare(b.moto_brand);
    });
  const seen = new Set<string>();
  const hits: VehicleDictionaryHit[] = [];
  for (const r of rows) {
    const key = `${r.moto_brand}|${r.model_code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({ brand: r.moto_brand, model: r.model_code });
    if (hits.length >= MAX_HITS) break;
  }
  return hits;
}
