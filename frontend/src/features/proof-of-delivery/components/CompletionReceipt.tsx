import { Link } from 'react-router-dom';

import { Button } from '../../../components/ui';
import type { DeliveryOrder } from '../../../types/order';
import { NextDeliveryPreview } from './DeliveryPresentation';
import { CheckIcon } from './DeliveryIcons';

interface Props {
  order: DeliveryOrder;
  nextDelivery: DeliveryOrder | null;
  onContinue(): void;
}

export const CompletionReceipt = ({ order, nextDelivery, onContinue }: Props) => (
  <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
    <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white text-center shadow-[0_24px_80px_-38px_rgba(15,23,42,0.4)]">
      <div className="bg-slate-950 px-6 py-10 text-white">
        <div className="cloudfleet-success-mark mx-auto grid size-20 place-items-center rounded-full bg-emerald-400 text-slate-950">
          <CheckIcon large />
        </div>
        <p className="mt-6 text-[10px] font-bold tracking-[0.24em] text-emerald-300 uppercase">
          Delivery complete
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">Great work.</h1>
        <p className="mt-2 text-sm text-slate-400">
          The customer notification workflow has been triggered.
        </p>
      </div>
      <div className="p-6 text-left sm:p-8">
        <div className="grid gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 sm:grid-cols-2">
          <ReceiptField
            label="Order"
            value={`CF-${order.orderId.slice(0, 8).toUpperCase()}`}
            mono
          />
          <ReceiptField label="Recipient" value={order.customerName} />
          <ReceiptField
            label="Completed"
            value={new Intl.DateTimeFormat('en-AU', {
              dateStyle: 'medium',
              timeStyle: 'short',
            }).format(new Date(order.deliveredAt ?? Date.now()))}
          />
          <ReceiptField label="Proof status" value="Secured in storage" />
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Link
            to="/driver/history"
            className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 text-xs font-bold hover:border-slate-950"
          >
            View delivery history
          </Link>
          {nextDelivery ? (
            <Button onClick={onContinue}>View next delivery</Button>
          ) : (
            <Button variant="secondary" onClick={onContinue}>
              Return to workspace
            </Button>
          )}
        </div>
      </div>
    </section>
    {nextDelivery && <NextDeliveryPreview order={nextDelivery} />}
  </main>
);

const ReceiptField = ({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) => (
  <div className="bg-white p-4">
    <p className="text-[9px] font-bold tracking-wider text-slate-400 uppercase">{label}</p>
    <p className={`mt-1 text-xs font-bold ${mono ? 'font-mono' : ''}`}>{value}</p>
  </div>
);
