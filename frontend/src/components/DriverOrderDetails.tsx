import { useCallback, useMemo, useState } from 'react';

import type { DriverLocationTracking } from '../hooks/useDriverLocationTracking';
import type { MapCoordinate } from '../types/map';
import type { DeliveryOrder } from '../types/order';
import { formatDistance, haversineDistanceKm } from '../utils/geo';
import { DeliveryMap } from './DeliveryMap';
import { useProofOfDelivery } from '../features/proof-of-delivery/hooks/useProofOfDelivery';
import { useDeliveryWorkflow } from '../features/proof-of-delivery/hooks/useDeliveryWorkflow';
import type { DeliveryFeedback } from '../features/proof-of-delivery/model/delivery.types';
import { CompletionReceipt } from '../features/proof-of-delivery/components/CompletionReceipt';
import { ProofCapture } from '../features/proof-of-delivery/components/ProofCapture';
import {
  DeliveryProblemAction,
  DeliveryStatusActions,
} from '../features/proof-of-delivery/components/DeliveryStatusActions';
import {
  FeedbackBanner,
  LocationPermissionCard,
  Metric,
  NextDeliveryPreview,
  OfflineBanner,
  OrderField,
  WorkflowProgress,
} from '../features/proof-of-delivery/components/DeliveryPresentation';
import {
  LocationIcon,
  NavigationIcon,
  UserIcon,
} from '../features/proof-of-delivery/components/DeliveryIcons';

interface DriverOrderDetailsProps {
  order: DeliveryOrder;
  driverId: string;
  driverLocation?: MapCoordinate | null;
  routePath?: MapCoordinate[];
  locationTracking: DriverLocationTracking;
  isOnline: boolean;
  nextDelivery?: DeliveryOrder | null;
  onStarted(orderId: string): void;
  onArrived(orderId: string): void;
  onException(orderId: string): void;
  onDelivered(orderId: string): void;
  onContinue(): void;
}

const EMPTY_PATH: MapCoordinate[] = [];

export const DriverOrderDetails = ({
  order,
  driverId,
  driverLocation = null,
  routePath = EMPTY_PATH,
  locationTracking,
  isOnline,
  nextDelivery = null,
  onStarted,
  onArrived,
  onException,
  onDelivered,
  onContinue,
}: DriverOrderDetailsProps) => {
  const [feedback, setFeedback] = useState<DeliveryFeedback>(null);
  const handleFeedback = useCallback((value: DeliveryFeedback) => setFeedback(value), []);
  const proof = useProofOfDelivery({
    orderId: order.orderId,
    orderStatus: order.status,
    customerName: order.customerName,
    isOnline,
    locationTracking,
    onFeedback: handleFeedback,
  });
  const workflow = useDeliveryWorkflow({
    orderId: order.orderId,
    orderStatus: order.status,
    driverId,
    proofFile: proof.proofFile,
    proofRegistered: proof.registered,
    phase: proof.phase,
    setPhase: proof.setPhase,
    isOnline,
    onFeedback: handleFeedback,
    onStarted,
    onArrived,
    onException,
    onDelivered,
  });
  const destination = useMemo<MapCoordinate>(() => [order.lat, order.lng], [order.lat, order.lng]);
  const distanceKm = useMemo(
    () => (driverLocation ? haversineDistanceKm(driverLocation, destination) : null),
    [destination, driverLocation],
  );
  const etaMinutes = distanceKm === null ? null : Math.max(2, Math.round((distanceKm / 25) * 60));
  const navigationUrl = useMemo(
    () => buildNavigationUrl(destination, driverLocation),
    [destination, driverLocation],
  );

  if (order.status === 'DELIVERED') {
    return <CompletionReceipt order={order} nextDelivery={nextDelivery} onContinue={onContinue} />;
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold tracking-[0.2em] text-teal-700 uppercase">
            Current assignment
          </p>
          <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">
            CF-{order.orderId.slice(0, 8).toUpperCase()}
          </h1>
        </div>
        <span
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${order.status === 'ASSIGNED' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}
        >
          <span
            className={`size-1.5 rounded-full ${order.status === 'ASSIGNED' ? 'bg-amber-500' : 'animate-pulse bg-blue-500'}`}
          />
          {order.status === 'ASSIGNED'
            ? 'Assigned'
            : order.status === 'ARRIVED' || workflow.hasArrived
              ? 'At destination'
              : 'In transit'}
        </span>
      </header>
      <WorkflowProgress currentStep={workflow.currentStep} />
      {!isOnline && <OfflineBanner />}
      <section className="mt-5 overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-[0_18px_60px_-34px_rgba(15,23,42,0.32)]">
        <div className="grid lg:grid-cols-[0.92fr_1.08fr]">
          <div className="p-5 sm:p-7 lg:p-9">
            <div className="grid grid-cols-2 gap-3">
              <Metric
                label="Distance"
                value={distanceKm === null ? 'Waiting for GPS' : formatDistance(distanceKm)}
              />
              <Metric
                label="Estimated arrival"
                value={etaMinutes === null ? 'Calculating…' : `${etaMinutes} min`}
              />
            </div>
            <div className="mt-7 space-y-5">
              <OrderField icon={<UserIcon />} label="Recipient" value={order.customerName} />
              <OrderField
                icon={<LocationIcon />}
                label="Destination"
                value={order.dropoffAddress}
              />
            </div>
            <a
              href={navigationUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white text-sm font-bold transition hover:border-slate-950"
            >
              <NavigationIcon /> Open navigation
            </a>
            <LocationPermissionCard
              tracking={locationTracking}
              active={order.status === 'IN_PROGRESS' || order.status === 'ARRIVED'}
            />
            {feedback && <FeedbackBanner feedback={feedback} />}
            <DeliveryStatusActions
              status={order.status}
              hasArrived={workflow.hasArrived}
              showStartConfirmation={workflow.showStartConfirmation}
              isStarting={workflow.isStarting}
              onShowStart={workflow.setShowStartConfirmation}
              onStart={() => void workflow.startRoute()}
              onArrive={() => void workflow.recordArrival()}
            />
            {workflow.hasArrived && (
              <ProofCapture
                orderId={order.orderId}
                proofFile={proof.proofFile}
                previewUrl={proof.previewUrl}
                phase={proof.phase}
                progress={proof.progress}
                registered={proof.registered}
                isOnline={isOnline}
                recipientName={proof.recipientName}
                signatureDataUrl={proof.signatureDataUrl}
                barcode={proof.barcode}
                notes={proof.notes}
                onRecipientName={proof.setRecipientName}
                onSignature={proof.setSignatureDataUrl}
                onBarcode={proof.setBarcode}
                onNotes={proof.setNotes}
                onSelect={proof.selectProof}
                onRemove={proof.removeProof}
                onUpload={() => void proof.upload()}
                onConfirm={() => void workflow.confirmDelivery()}
              />
            )}
          </div>
          <div className="relative min-h-90 overflow-hidden border-t border-slate-200 bg-slate-100 lg:min-h-155 lg:border-t-0 lg:border-l">
            <DeliveryMap
              orderLocation={destination}
              driverLocation={driverLocation}
              routePath={routePath}
              address={order.dropoffAddress}
            />
            <div className="pointer-events-none absolute right-4 bottom-4 left-4 rounded-2xl border border-white/80 bg-white/92 p-4 shadow-xl backdrop-blur sm:right-auto sm:max-w-sm">
              <p className="text-[9px] font-bold tracking-wider text-slate-400 uppercase">
                Route status
              </p>
              <p className="mt-1 text-sm font-bold">
                {distanceKm === null
                  ? 'Waiting for live location'
                  : `${formatDistance(distanceKm)} remaining · ETA ${etaMinutes} min`}
              </p>
            </div>
          </div>
        </div>
      </section>
      <DeliveryProblemAction
        status={order.status}
        onFailure={() => void workflow.reportFailure()}
      />
      {nextDelivery && <NextDeliveryPreview order={nextDelivery} />}
    </main>
  );
};

const buildNavigationUrl = (destination: MapCoordinate, origin: MapCoordinate | null): string => {
  if (!origin)
    return `https://www.openstreetmap.org/?mlat=${destination[0]}&mlon=${destination[1]}#map=17/${destination[0]}/${destination[1]}`;
  return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${encodeURIComponent(`${origin[0]},${origin[1]};${destination[0]},${destination[1]}`)}`;
};
