import { getCart, cartSummary } from "@/state/cartStore";
import { formatPrice } from "@/lib/format";
import { getMenuItem } from "@/data/db";
import { round2 } from "@/lib/utils";

export function Cart() {
  return (
    <div>
      <p>{cartSummary()}</p>
      {getCart().map((l) => (
        <p key={l.itemId}>
          {getMenuItem(l.itemId)?.name} x{l.qty} = {formatPrice(round2((getMenuItem(l.itemId)?.price ?? 0) * l.qty))}
        </p>
      ))}
    </div>
  );
}
