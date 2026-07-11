// Pure message formatters (no DB) — used by notifications.ts and unit-tested.

// The message a customer receives when their order changes state. Returns null
// for states we don't notify on (e.g. DRAFT).
export function orderStatusMessage(orderNumber: number, status: string): string | null {
  const n = `#${orderNumber}`;
  switch (status) {
    case 'CONFIRMED':
      return `✅ Your order ${n} is confirmed! We'll pack it and let you know when it ships. Thank you 🙏`;
    case 'DISPATCHED':
      return `🚚 Good news — order ${n} has been shipped and is on its way to you.`;
    case 'DELIVERED':
      return `📦 Order ${n} has been delivered. Thank you for shopping with us! 💛`;
    case 'CANCELLED':
      return `Your order ${n} has been cancelled. If this is a mistake, just reply here and we'll help.`;
    case 'RETURNED':
      return `We've recorded a return for order ${n}. Reply here if you need anything.`;
    default:
      return null;
  }
}

// A ready-to-send product pitch (name + price, optional quantity line).
export function productPitch(name: string, price: number, quantity?: number): string {
  const priceLine = `${name} — ৳${Number(price).toFixed(0)}`;
  if (quantity && quantity > 1) {
    return `${priceLine}\nFor ${quantity} pcs: ৳${(Number(price) * quantity).toFixed(0)}. Want to order? 🙂`;
  }
  return `${priceLine}. Want to order? 🙂`;
}
