import type { CustomerId } from './types';

export type VehicleId = string;

/**
 * CustomerVehicle: 會員愛車 entity(M-1-14)。
 *
 * 對齊 PRD docs/specs/m-1-14-customer-schema.md §4.2 + Supabase migration
 * `20260523034911_init_customers_and_subtables` customer_vehicles 表(M-1-14a);
 * 逐欄對齊 design AccountPages.jsx InlineVehicleForm L760-798。
 *
 * year / km / mods 用 string(非 number):design 為 text input、km 含千分位 + 單位、mods 為簡述文字。
 * 每 customer 至多一輛 isPrimary(DB partial unique index 守、對齊 [[customer]])。
 * Phase 2 升級為獨立 Vehicle entity 接 vehicle service ecosystem
 * (docs/features/vehicle-service-ecosystem.md)。
 */
export type CustomerVehicle = {
  id: VehicleId;
  customerUserId: CustomerId;
  isPrimary: boolean;
  name: string; // 車型(例 YAMAHA YZF-R6)
  year: string;
  engine: string; // 引擎號
  km: string; // 里程(含千分位 + 單位)
  mods: string; // 已改裝(簡述)
  service: string | null; // 最近保養 ISO date or null
  // V-1d:車輛字典鍵(taxonomy brand.name / model.name 名稱字面逐字;NULL=自由輸入/舊資料)。
  // 恆成對(同 null 或同非 null;DB CHECK + schema 成對驗證雙層守)。首頁愛車 chips:
  // 有值走精確 lookup 直套、null 走 REQUIRED-2 字面比對流。
  dictBrandName: string | null;
  dictModelName: string | null;
  createdAt: string;
  updatedAt: string;
};
