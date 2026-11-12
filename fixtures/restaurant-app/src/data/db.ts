import type { MenuItem, Order } from "./schema";
import { log } from "@/lib/logger";
import { byId } from "@/lib/utils";

const menu: MenuItem[] = [
  { id: "m1", name: "Pho", price: 9.5 },
  { id: "m2", name: "Banh Mi", price: 6 },
];
const orders: Order[] = [];

export function getMenuItems(): MenuItem[] {
  log("getMenuItems");
  return menu;
}

export function getMenuItem(id: string): MenuItem | undefined {
  return byId(menu, id);
}

export function saveOrder(order: Order): void {
  log(`saveOrder ${order.id}`);
  orders.push(order);
}

export function getOrder(id: string): Order | undefined {
  return byId(orders, id);
}
