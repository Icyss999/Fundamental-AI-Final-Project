// Deliberate smell: a UI page talks to the database directly (target of the planner's example goal).
import { getMenuItems } from "@/data/db";
import { MenuList } from "@/components/MenuList";
import { addToCart } from "@/state/cartStore";

export default function MenuPage() {
  return <MenuList items={getMenuItems()} onAdd={addToCart} highlightId="m1" />;
}
