import type { ICustomerRepository } from '@pcm/ports';
import type { Customer, CustomerId } from '@pcm/domain';

/**
 * updateProfile:更新會員 name / phone / birthday use-case(M-1-14e-1b、PRD §8.1)。
 *
 * **信任邊界(codex 關卡1 must-fix #5,守 boundary 後落在 delivery + 型別 + DB 三層)**:
 * - `currentUserId` 只由 server-side session 取(caller 傳入)、**絕不從表單 body 取**。
 * - `patch` 型別 `Partial<Pick<Customer,'name'|'phone'|'birthday'>>`(對齊 ICustomerRepository.update、
 *   欄可選)→ 白名單 keys 令 **typed caller 只能傳 name/phone/birthday**(tier / id / wallet 進不來、第 2 層);
 *   **runtime 不信 client** 仍由 delivery 層(f1 server action)`@pcm/schemas` re-parse + strip 未知欄
 *   (server 端、第 1 層)+ DB GRANT(第 3 層)守。
 * - 走 ICustomerRepository.update(M-1-14d:白名單 mapper + DB GRANT 無 tier UPDATE = 第 3 層)。
 */
export async function updateProfile(
  customerRepo: ICustomerRepository,
  currentUserId: CustomerId,
  patch: Partial<Pick<Customer, 'name' | 'phone' | 'birthday'>>,
): Promise<Customer> {
  return customerRepo.update(currentUserId, patch);
}
