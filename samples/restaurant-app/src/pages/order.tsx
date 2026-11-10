// Deliberate smell: a UI page talks to the database directly.
import { saveOrder, getMenuItems } from "@/data/db";
import { Cart } from "@/components/Cart";
import { getCart } from "@/state/cartStore";
import { sum } from "@/lib/utils";

export default function OrderPage() {
  const place = () =>
    saveOrder({ id: `o${sum([Date.now()])}`, items: getCart(), paid: false });
  return (
    <div>
      <p>{getMenuItems().length} dishes available</p>
      <Cart />
      <button onClick={place}>Place order</button>
    </div>
  );
}
