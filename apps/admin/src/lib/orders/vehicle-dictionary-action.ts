'use server';

import { createSupabaseServiceClient } from '@pcm/adapters/server';
import { authorizeAdminMutation } from '../session/authorize';
import { looseIlikePattern, rankVehicleHits, splitVehicleText, type VehicleDictionaryHit } from './vehicle-dictionary';

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
  // 2026-10-02 Sean:跟顧客站一樣聰明。資料庫先粗篩(字元間插 %, 連字號 / 空格不擋路), 依車型排序撈回,
  //   再用顧客站同一套比對(rankVehicleHits ⇐ @pcm/domain vehicle-match)挑出真的對得到的並排序。
  //   ⛔ ~~`.ilike('model_code', %q%)` 不排序撈 200 列~~:打「GSX8s」對不到「GSX-8S」;打「GSX」時 GSX-8T 常落在那 200 列外。
  //   開頭命中與中段命中分兩發撈:短查詢(例「MT」中段命中 1,579 列)超過 1000 列時, 排最前的開頭命中不會被截掉。
  const anywhere = looseIlikePattern(q);
  const prefix = looseIlikePattern(q, true);
  if (anywhere === null || prefix === null) return [];
  const client = createSupabaseServiceClient();
  const fetchRows = (pattern: string) =>
    client.from('vehicle_taxonomy_public').select('moto_brand, model_code').ilike('model_code', pattern).order('model_code').limit(1000);
  const [a, b] = await Promise.all([fetchRows(prefix), fetchRows(anywhere)]);
  if (a.error || !a.data) return [];
  const rows = [...a.data, ...(b.error || !b.data ? [] : b.data)]
    .filter(
      (r): r is { moto_brand: string; model_code: string } =>
        typeof r.moto_brand === 'string' && typeof r.model_code === 'string',
    )
    .map((r) => ({ brand: r.moto_brand, model: r.model_code }));
  return rankVehicleHits(rows, q, MAX_HITS);
}
