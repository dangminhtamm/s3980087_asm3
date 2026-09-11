import { Button, ConfirmDialog } from '../../../components/ui';

interface Props {
  status: string;
  hasArrived: boolean;
  showStartConfirmation: boolean;
  isStarting: boolean;
  onShowStart(value: boolean): void;
  onStart(): void;
  onArrive(): void;
}

export const DeliveryStatusActions = (props: Props) => (
  <>
    {props.status === 'ASSIGNED' ? (
      <section className="mt-6 rounded-2xl bg-slate-950 p-5 text-white">
        <p className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">
          Ready to depart
        </p>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Starting records the departure and enables live location sharing, even if the event must
          sync later.
        </p>
        <Button
          className="mt-5 w-full bg-white text-slate-950 hover:bg-slate-100"
          onClick={() => props.onShowStart(true)}
        >
          Start route
        </Button>
      </section>
    ) : !props.hasArrived ? (
      <section className="mt-6 rounded-2xl border border-teal-200 bg-teal-50 p-5">
        <p className="text-sm font-black text-teal-950">Arrived at the destination?</p>
        <p className="mt-1 text-xs leading-5 text-teal-800">
          Confirm arrival before collecting Proof of Delivery.
        </p>
        <Button className="mt-4 w-full bg-teal-700 hover:bg-teal-800" onClick={props.onArrive}>
          I have arrived
        </Button>
      </section>
    ) : null}
    <ConfirmDialog
      isOpen={props.showStartConfirmation}
      onClose={() => props.onShowStart(false)}
      onConfirm={props.onStart}
      isLoading={props.isStarting}
      title="Start this route?"
      description="The order will move to In transit and CloudFleet will request location access for live tracking."
      confirmLabel="Start route"
    />
  </>
);

export const DeliveryProblemAction = ({
  status,
  onFailure,
}: {
  status: string;
  onFailure(): void;
}) =>
  ['IN_PROGRESS', 'ARRIVED'].includes(status) ? (
    <div className="mt-4 flex justify-end">
      <Button variant="ghost" onClick={onFailure}>
        Report a delivery problem
      </Button>
    </div>
  ) : null;
