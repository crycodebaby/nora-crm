import type { User } from "jsr:@supabase/supabase-js@2";
import { getUserSale } from "../getUserSale.ts";

export const isActiveAdmin = async (
  user: User,
): Promise<
  | { ok: true; sale: NonNullable<Awaited<ReturnType<typeof getUserSale>>> }
  | { ok: false }
> => {
  const sale = await getUserSale(user);
  if (!sale || sale.disabled) {
    return { ok: false };
  }
  if (sale.role !== "admin" && sale.administrator !== true) {
    return { ok: false };
  }
  return { ok: true, sale };
};
