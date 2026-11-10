import { getOrder, saveOrder } from "@/data/db";
import { cartTotal } from "./pricing";
import { log } from "@/lib/logger";

export function pay(orderId: string): boolean {
  const order = getOrder(orderId);
  if (!order) return false;
  log(`charging ${cartTotal()} for ${orderId}`);
  saveOrder({ ...order, paid: true });
  return true;
}
