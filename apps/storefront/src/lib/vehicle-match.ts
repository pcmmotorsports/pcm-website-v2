// vehicle-match.ts — 2026-10-02 起本體搬到 @pcm/domain(packages/domain/src/catalog/vehicle-match.ts),
//   讓後台車種搜尋共用同一套比對(Sean:不要另寫一份)。這裡只轉出, 顧客站既有的 import 路徑不用改。
export {
  normalizeVehicleQuery,
  looseVehicleKey,
  filterVehicleOptions,
  uniqueExactMatch,
  vehicleLabel,
} from '@pcm/domain';
