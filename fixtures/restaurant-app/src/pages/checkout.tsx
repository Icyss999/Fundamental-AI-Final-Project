import { pay } from "@/services/paymentService";
import { Cart } from "@/components/Cart";
import { formatPrice } from "@/lib/format";
import { cartTotal } from "@/services/pricing";

export default function CheckoutPage({ orderId }: { orderId: string }) {
  return (
    <div>
      <Cart />
      <p>Total: {formatPrice(cartTotal())}</p>
      <button onClick={() => pay(orderId)}>Pay</button>
    </div>
  );
}
