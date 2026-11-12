// The service pages are meant to use for menu data — yet menu.tsx and order.tsx still go straight to the database.
import { getMenuItem, getMenuItems } from "@/data/db";

export function listMenu() {
  return getMenuItems();
}

export function findDish(id: string) {
  return getMenuItem(id);
}
