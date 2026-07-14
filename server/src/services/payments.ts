// Shared payment settlement — used by the authed webhook/pay routes AND the
// public customer pay link. One atomic transaction: invoice + ledger + order
// move together, and the same transactionId can never settle twice.
import { basePrisma, setTenantGuc } from '../lib/prisma';
import { ApiError } from '../lib/errors';

// Round to exactly 2 decimal places (money!)
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function settlePayment(tenantId: string, invoiceId: string, transactionId: string) {
  return basePrisma.$transaction(async (tx: any) => {
    await setTenantGuc(tx, tenantId); // RLS: scope this transaction to the tenant
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: { order: true },
    });
    if (!invoice) throw new ApiError(404, 'Unknown invoice — webhook rejected and logged');
    if (invoice.order.status === 'CANCELLED') {
      throw new ApiError(422, 'Order was cancelled — payment webhook rejected');
    }

    // IDEMPOTENCY: already settled? Return the existing result — exactly once.
    if (invoice.status === 'PAID') {
      return { invoice, duplicate: true as const };
    }
    const dupTxn = await tx.invoice.findUnique({ where: { transactionId } });
    if (dupTxn) return { invoice: dupTxn, duplicate: true as const };

    // 1. Mark the invoice paid with its unique transaction id
    const paid = await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: 'PAID', transactionId, paidAt: new Date() },
    });

    // 2. Ledger entry: gross, 1% MDR fee, 15% VAT on the fee, net
    const gross = Number(invoice.amount);
    const fee = round2(gross * 0.01);
    const vat = round2(fee * 0.15);
    const net = round2(gross - fee - vat);
    await tx.ledgerEntry.create({
      data: { tenantId, orderId: invoice.orderId, invoiceId: invoice.id, gross, fee, vat, net },
    });

    // 3. Update the order's payment status
    const allInvoices = await tx.invoice.findMany({ where: { orderId: invoice.orderId, tenantId } });
    const totalPaid = allInvoices
      .filter((i: { status: string }) => i.status === 'PAID')
      .reduce((s: number, i: { amount: unknown }) => s + Number(i.amount), 0);
    const fullyPaid = totalPaid >= Number(invoice.order.totalAmount) - 0.01;

    await tx.order.update({
      where: { id: invoice.orderId },
      data: {
        paymentStatus: fullyPaid ? 'PAID' : 'PARTIAL',
        events: {
          create: {
            tenantId,
            type: 'PAYMENT',
            note: `Payment received: ৳${gross.toFixed(2)} (txn ${transactionId}) — fee ৳${fee.toFixed(2)} + VAT ৳${vat.toFixed(2)}, net ৳${net.toFixed(2)}`,
          },
        },
      },
    });

    return { invoice: paid, duplicate: false as const };
  });
}
