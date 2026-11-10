import type { MenuItem } from "@/data/schema";
import { MenuItemCard } from "./MenuItemCard";
import { byId } from "@/lib/utils";

export function MenuList({ items, onAdd, highlightId }: { items: MenuItem[]; onAdd: (id: string) => void; highlightId?: string }) {
  const highlighted = highlightId ? byId(items, highlightId) : undefined;
  return (
    <ul>
      {highlighted && <li>Chef's pick: {highlighted.name}</li>}
      {items.map((item) => (
        <li key={item.id}>
          <MenuItemCard item={item} onAdd={onAdd} />
        </li>
      ))}
    </ul>
  );
}
