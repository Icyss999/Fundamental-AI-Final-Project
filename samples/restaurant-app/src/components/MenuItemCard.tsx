import type { MenuItem } from "@/data/schema";
import { formatPrice } from "@/lib/format";

export function MenuItemCard({ item, onAdd }: { item: MenuItem; onAdd: (id: string) => void }) {
  return (
    <div>
      <span>{item.name}</span> <span>{formatPrice(item.price)}</span>
      <button onClick={() => onAdd(item.id)}>Add</button>
    </div>
  );
}
