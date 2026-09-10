import axios from 'axios';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import type { DriverLocationTracking, TrackingStatus } from '../hooks/useDriverLocationTracking';
import { cloudFleetApi } from '../services/api';
import { getDeliveryProof, updateOrderStatus } from '../services/operations';
import { getPendingProof, removePendingProof, savePendingProof } from '../services/offline-store';
import type { MapCoordinate } from '../types/map';
import type { ApiEnvelope, DeliveryOrder, PresignedUpload } from '../types/order';
import { formatDistance, formatLocationFreshness, haversineDistanceKm } from '../utils/geo';
import { Button, ConfirmDialog } from './ui';
import { DeliveryMap } from './DeliveryMap';

interface DriverOrderDetailsProps {
  order: DeliveryOrder;
  driverId: string;
  driverLocation?: MapCoordinate | null;
  routePath?: MapCoordinate[];
  locationTracking: DriverLocationTracking;
  isOnline: boolean;
  nextDelivery?: DeliveryOrder | null;
  onStarted: (orderId: string) => void;
  onArrived: (orderId: string) => void;
  onException: (orderId: string) => void;
  onDelivered: (orderId: string) => void;
  onContinue: () => void;
}

type ProofContentType = 'image/jpeg' | 'image/png' | 'image/webp';
type SubmissionPhase = 'idle' | 'uploading' | 'registering' | 'ready' | 'confirming' | 'upload-error' | 'confirm-error';
type Feedback = { type: 'success' | 'error'; message: string } | null;
interface UploadedObject { objectKey: string; contentType: ProofContentType; size: number }

const ALLOWED_IMAGE_TYPES: ProofContentType[] = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PROOF_SIZE = 10 * 1024 * 1024;
const EMPTY_ROUTE_PATH: MapCoordinate[] = [];
const WORKFLOW_STEPS = ['View', 'Start', 'Arrive', 'Capture', 'Review', 'Upload', 'Confirm', 'Complete'];

const isAllowedImageType = (contentType: string): contentType is ProofContentType =>
  ALLOWED_IMAGE_TYPES.some((allowed) => allowed === contentType);

const getApiErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const providerMessage = (error.response?.data as { error?: { message?: string } })?.error?.message;
    if (providerMessage) return providerMessage;
    if (!error.response) return 'Network connection lost. Your proof is still on this device—retry when online.';
  }
  return 'CloudFleet could not complete this step. Please try again.';
};

const getNavigationUrl = (destination: MapCoordinate, origin: MapCoordinate | null): string => {
  if (!origin) return `https://www.openstreetmap.org/?mlat=${destination[0]}&mlon=${destination[1]}#map=17/${destination[0]}/${destination[1]}`;
  const route = `${origin[0]},${origin[1]};${destination[0]},${destination[1]}`;
  return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${encodeURIComponent(route)}`;
};

export const DriverOrderDetails = ({
  order,
  driverId,
  driverLocation = null,
  routePath = EMPTY_ROUTE_PATH,
  locationTracking,
  isOnline,
  nextDelivery = null,
  onStarted,
  onArrived,
  onException,
  onDelivered,
  onContinue,
}: DriverOrderDetailsProps) => {
  const [hasArrived, setHasArrived] = useState(false);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadedObject, setUploadedObject] = useState<UploadedObject | null>(null);
  const [isProofRegistered, setIsProofRegistered] = useState(false);
  const [phase, setPhase] = useState<SubmissionPhase>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [showStartConfirmation, setShowStartConfirmation] = useState(false);
  const [recipientName, setRecipientName] = useState(order.customerName);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [barcode, setBarcode] = useState('');
  const [notes, setNotes] = useState('');

  const destination = useMemo<MapCoordinate>(() => [order.lat, order.lng], [order.lat, order.lng]);
  const shortOrderId = useMemo(() => order.orderId.slice(0, 8).toUpperCase(), [order.orderId]);
  const distanceKm = useMemo(
    () => driverLocation ? haversineDistanceKm(driverLocation, destination) : null,
    [destination, driverLocation],
  );
  const estimatedMinutes = distanceKm === null ? null : Math.max(2, Math.round((distanceKm / 25) * 60));
  const navigationUrl = useMemo(() => getNavigationUrl(destination, driverLocation), [destination, driverLocation]);

  useEffect(() => {
    if (!proofFile) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(proofFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [proofFile]);

  useEffect(() => {
    let active = true;
    void getPendingProof(order.orderId).then((pending) => {
      if (!active || !pending) return;
      setProofFile(pending.file);
      setRecipientName(pending.recipientName);
      setSignatureDataUrl(pending.signatureDataUrl);
      setBarcode(pending.barcode);
      setNotes(pending.notes);
      setFeedback({ type: 'success', message: 'Recovered the draft proof saved on this device.' });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [order.orderId]);

  useEffect(() => {
    if (!proofFile || isProofRegistered) return;
    void savePendingProof({ orderId: order.orderId, file: proofFile, recipientName, signatureDataUrl, barcode, notes }).catch(() => undefined);
  }, [barcode, isProofRegistered, notes, order.orderId, proofFile, recipientName, signatureDataUrl]);

  useEffect(() => {
    if (order.status === 'ARRIVED') setHasArrived(true);
  }, [order.status]);

  // Resume at confirmation after a reload when proof metadata already exists.
  useEffect(() => {
    if (order.status !== 'ARRIVED') return;
    let active = true;
    void getDeliveryProof(order.orderId)
      .then(() => {
        if (active) { setIsProofRegistered(true); setHasArrived(true); setPhase('ready'); }
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [order.orderId, order.status]);

  const currentStep = useMemo(() => {
    if (order.status === 'DELIVERED') return 8;
    if (order.status === 'ASSIGNED') return 2;
    if (order.status === 'ARRIVED' && !proofFile && !isProofRegistered) return 4;
    if (phase === 'confirming' || phase === 'confirm-error' || phase === 'ready' || isProofRegistered) return 7;
    if (phase === 'uploading' || phase === 'registering' || phase === 'upload-error') return 6;
    if (proofFile) return 5;
    if (hasArrived) return 4;
    return 3;
  }, [hasArrived, isProofRegistered, order.status, phase, proofFile]);

  const handleProofSelected = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    setFeedback(null);
    if (!file) return;
    if (!isAllowedImageType(file.type)) {
      setFeedback({ type: 'error', message: 'Only JPEG, PNG or WebP images are accepted.' });
      return;
    }
    if (file.size <= 0 || file.size > MAX_PROOF_SIZE) {
      setFeedback({ type: 'error', message: 'The proof image must be between 1 byte and 10 MB.' });
      return;
    }
    setProofFile(file);
    setUploadedObject(null);
    setIsProofRegistered(false);
    setUploadProgress(0);
    setPhase('idle');
    const Detector = (globalThis as typeof globalThis & { BarcodeDetector?: new () => { detect: (source: Blob) => Promise<Array<{ rawValue: string }> > } }).BarcodeDetector;
    if (Detector) void new Detector().detect(file).then((codes) => {
      const detected = codes[0]?.rawValue;
      if (detected) setBarcode(detected.slice(0, 128));
    }).catch(() => undefined);
  }, []);

  const removeProof = useCallback(() => {
    setProofFile(null);
    setUploadedObject(null);
    setUploadProgress(0);
    setPhase('idle');
    setFeedback(null);
    void removePendingProof(order.orderId).catch(() => undefined);
  }, [order.orderId]);

  const startRoute = useCallback(async () => {
    setIsStarting(true); setFeedback(null);
    try {
      const result = await updateOrderStatus(order.orderId, 'IN_PROGRESS', undefined, driverId);
      onStarted(order.orderId);
      setShowStartConfirmation(false);
      if (result.isQueued) setFeedback({ type: 'success', message: 'Route start saved offline and will sync automatically.' });
    } catch (error: unknown) { setFeedback({ type: 'error', message: getApiErrorMessage(error) }); }
    finally { setIsStarting(false); }
  }, [driverId, onStarted, order.orderId]);

  const uploadProof = useCallback(async () => {
    if (!proofFile || isProofRegistered) return;
    if (!isAllowedImageType(proofFile.type)) {
      setFeedback({ type: 'error', message: 'The selected file type is no longer valid.' });
      return;
    }
    const contentType = proofFile.type;
    if (!isOnline) { setPhase('upload-error'); setFeedback({ type: 'error', message: 'You are offline. Keep this screen open and retry when connected.' }); return; }
    setFeedback(null);
    try {
      let object = uploadedObject;
      if (!object) {
        setPhase('uploading'); setUploadProgress(1);
        const uploadResponse = await cloudFleetApi.get<ApiEnvelope<PresignedUpload>>(
          `/api/orders/${order.orderId}/proof/upload-url`,
          { params: { contentType } },
        );
        const { uploadUrl, objectKey, requiredHeaders } = uploadResponse.data.data;
        await axios.put(uploadUrl, proofFile, {
          headers: requiredHeaders,
          timeout: 30_000,
          onUploadProgress: (progressEvent) => {
            const total = progressEvent.total ?? proofFile.size;
            setUploadProgress(Math.min(100, Math.round((progressEvent.loaded / total) * 100)));
          },
        });
        object = { objectKey, contentType, size: proofFile.size };
        setUploadedObject(object);
      }
      setPhase('registering');
      await cloudFleetApi.post(`/api/orders/${order.orderId}/proof`, {
        ...object,
        recipientName: recipientName.trim() || undefined,
        signatureDataUrl: signatureDataUrl ?? undefined,
        barcode: barcode.trim() || undefined,
        notes: notes.trim() || undefined,
        gps: locationTracking.lastLocation ? {
          lat: locationTracking.lastLocation.lat,
          lng: locationTracking.lastLocation.lng,
          accuracy: locationTracking.lastLocation.accuracy,
          recordedAt: locationTracking.lastLocation.recordedAt,
        } : undefined,
      });
      setUploadProgress(100);
      setIsProofRegistered(true);
      setPhase('ready');
      await removePendingProof(order.orderId);
      setFeedback({ type: 'success', message: 'Proof secured. Review the order and confirm delivery.' });
    } catch (error: unknown) {
      setPhase('upload-error');
      setFeedback({ type: 'error', message: getApiErrorMessage(error) });
    }
  }, [barcode, isOnline, isProofRegistered, locationTracking.lastLocation, notes, order.orderId, proofFile, recipientName, signatureDataUrl, uploadedObject]);

  const recordArrival = useCallback(async () => {
    setFeedback(null);
    try {
      const result = await updateOrderStatus(order.orderId, 'ARRIVED', undefined, driverId);
      setHasArrived(true);
      onArrived(order.orderId);
      if (result.isQueued) setFeedback({ type: 'success', message: 'Arrival saved offline and queued for sync.' });
    } catch (error: unknown) {
      setFeedback({ type: 'error', message: getApiErrorMessage(error) });
    }
  }, [driverId, onArrived, order.orderId]);

  const confirmDelivery = useCallback(async () => {
    if (!isProofRegistered) return;
    if (!isOnline) { setPhase('confirm-error'); setFeedback({ type: 'error', message: 'Reconnect to confirm this delivery.' }); return; }
    setPhase('confirming'); setFeedback(null);
    try {
      await updateOrderStatus(order.orderId, 'DELIVERED', undefined, driverId);
      onDelivered(order.orderId);
    } catch (error: unknown) {
      setPhase('confirm-error');
      setFeedback({ type: 'error', message: getApiErrorMessage(error) });
    }
  }, [driverId, isOnline, isProofRegistered, onDelivered, order.orderId]);

  const reportFailure = useCallback(async () => {
    const notes = window.prompt('Why could this delivery not be completed?');
    if (notes === null) return;
    try {
      const result = await updateOrderStatus(order.orderId, 'DELIVERY_FAILED', { reason: 'OTHER', notes: notes || undefined }, driverId);
      onException(order.orderId);
      if (result.isQueued) setFeedback({ type: 'success', message: 'Exception saved offline and queued for sync.' });
    } catch (error: unknown) {
      setFeedback({ type: 'error', message: getApiErrorMessage(error) });
    }
  }, [driverId, onException, order.orderId]);

  if (order.status === 'DELIVERED') {
    return <CompletionReceipt order={order} nextDelivery={nextDelivery} onContinue={onContinue} />;
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-[10px] font-bold tracking-[0.2em] text-teal-700 uppercase">Current assignment</p><h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">CF-{shortOrderId}</h1></div>
        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold ${order.status === 'ASSIGNED' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}><span className={`size-1.5 rounded-full ${order.status === 'ASSIGNED' ? 'bg-amber-500' : 'animate-pulse bg-blue-500'}`} />{order.status === 'ASSIGNED' ? 'Assigned' : order.status === 'ARRIVED' || hasArrived ? 'At destination' : 'In transit'}</span>
      </header>

      <WorkflowProgress currentStep={currentStep} />

      {!isOnline && <div role="status" className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-semibold leading-5 text-amber-900"><OfflineIcon /><p>Offline mode. Route events and GPS are queued on this device; proof photos and signatures remain here until upload is possible.</p></div>}

      <section className="mt-5 overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-[0_18px_60px_-34px_rgba(15,23,42,0.32)]">
        <div className="grid lg:grid-cols-[0.92fr_1.08fr]">
          <div className="p-5 sm:p-7 lg:p-9">
            <div className="grid grid-cols-2 gap-3"><Metric label="Distance" value={distanceKm === null ? 'Waiting for GPS' : formatDistance(distanceKm)} /><Metric label="Estimated arrival" value={estimatedMinutes === null ? 'Calculating…' : `${estimatedMinutes} min`} /></div>
            <div className="mt-7 space-y-5"><OrderField icon={<UserIcon />} label="Recipient" value={order.customerName} /><OrderField icon={<LocationIcon />} label="Destination" value={order.dropoffAddress} /></div>
            <a href={navigationUrl} target="_blank" rel="noreferrer" className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white text-sm font-bold transition hover:border-slate-950"><NavigationIcon />Open navigation</a>
            <LocationPermissionCard tracking={locationTracking} active={order.status === 'IN_PROGRESS' || order.status === 'ARRIVED'} />
            {feedback && <FeedbackBanner feedback={feedback} />}

            {order.status === 'ASSIGNED' ? (
              <section className="mt-6 rounded-2xl bg-slate-950 p-5 text-white"><p className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">Ready to depart</p><p className="mt-2 text-sm leading-6 text-slate-300">Starting records the departure and enables live location sharing, even if the event must sync later.</p><Button className="mt-5 w-full bg-white text-slate-950 hover:bg-slate-100" onClick={() => setShowStartConfirmation(true)}>Start route</Button></section>
            ) : !hasArrived ? (
              <section className="mt-6 rounded-2xl border border-teal-200 bg-teal-50 p-5"><p className="text-sm font-black text-teal-950">Arrived at the destination?</p><p className="mt-1 text-xs leading-5 text-teal-800">Confirm arrival before collecting Proof of Delivery.</p><Button className="mt-4 w-full bg-teal-700 hover:bg-teal-800" onClick={() => void recordArrival()}>I have arrived</Button></section>
            ) : (
              <ProofWorkflow orderId={order.orderId} proofFile={proofFile} previewUrl={previewUrl} phase={phase} progress={uploadProgress} registered={isProofRegistered} isOnline={isOnline} recipientName={recipientName} signatureDataUrl={signatureDataUrl} barcode={barcode} notes={notes} onRecipientName={setRecipientName} onSignature={setSignatureDataUrl} onBarcode={setBarcode} onNotes={setNotes} onSelect={handleProofSelected} onRemove={removeProof} onUpload={() => void uploadProof()} onConfirm={() => void confirmDelivery()} />
            )}
          </div>

          <div className="relative min-h-90 overflow-hidden border-t border-slate-200 bg-slate-100 lg:min-h-155 lg:border-t-0 lg:border-l">
            <DeliveryMap orderLocation={destination} driverLocation={driverLocation} routePath={routePath} address={order.dropoffAddress} />
            <div className="pointer-events-none absolute right-4 bottom-4 left-4 rounded-2xl border border-white/80 bg-white/92 p-4 shadow-xl backdrop-blur sm:right-auto sm:max-w-sm"><p className="text-[9px] font-bold tracking-wider text-slate-400 uppercase">Route status</p><p className="mt-1 text-sm font-bold">{distanceKm === null ? 'Waiting for live location' : `${formatDistance(distanceKm)} remaining · ETA ${estimatedMinutes} min`}</p></div>
          </div>
        </div>
      </section>

      {['IN_PROGRESS', 'ARRIVED'].includes(order.status) && <div className="mt-4 flex justify-end"><Button variant="ghost" onClick={() => void reportFailure()}>Report a delivery problem</Button></div>}

      {nextDelivery && <NextDeliveryPreview order={nextDelivery} />}
      <ConfirmDialog isOpen={showStartConfirmation} onClose={() => setShowStartConfirmation(false)} onConfirm={() => void startRoute()} isLoading={isStarting} title="Start this route?" description="The order will move to In transit and CloudFleet will request location access for live tracking." confirmLabel="Start route" />
    </main>
  );
};

const WorkflowProgress = ({ currentStep }: { currentStep: number }) => <ol aria-label="Delivery workflow" className="mt-6 grid grid-cols-4 gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 sm:grid-cols-8">{WORKFLOW_STEPS.map((label, index) => { const number = index + 1; const complete = number < currentStep; const active = number === currentStep; return <li key={label} className={`min-w-0 bg-white px-2 py-3 text-center ${active ? 'bg-slate-950 text-white' : ''}`}><span className={`mx-auto grid size-5 place-items-center rounded-full text-[9px] font-black ${complete ? 'bg-emerald-500 text-white' : active ? 'bg-white text-slate-950' : 'bg-slate-100 text-slate-400'}`}>{complete ? '✓' : number}</span><span className={`mt-1.5 block truncate text-[8px] font-bold uppercase ${!active && !complete ? 'text-slate-400' : ''}`}>{label}</span></li>; })}</ol>;

interface ProofWorkflowProps {
  orderId: string;
  proofFile: File | null;
  previewUrl: string | null;
  phase: SubmissionPhase;
  progress: number;
  registered: boolean;
  isOnline: boolean;
  recipientName: string;
  signatureDataUrl: string | null;
  barcode: string;
  notes: string;
  onRecipientName: (value: string) => void;
  onSignature: (value: string | null) => void;
  onBarcode: (value: string) => void;
  onNotes: (value: string) => void;
  onSelect: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
  onUpload: () => void;
  onConfirm: () => void;
}

const ProofWorkflow = ({ orderId, proofFile, previewUrl, phase, progress, registered, isOnline, recipientName, signatureDataUrl, barcode, notes, onRecipientName, onSignature, onBarcode, onNotes, onSelect, onRemove, onUpload, onConfirm }: ProofWorkflowProps) => {
  const uploading = phase === 'uploading' || phase === 'registering';
  const confirming = phase === 'confirming';
  return <section className="mt-6"><div className="flex items-center justify-between"><div><p className="text-[10px] font-bold tracking-wider text-teal-700 uppercase">Proof of Delivery</p><h2 className="mt-1 text-lg font-black">Capture and review</h2></div>{registered && <span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-bold text-emerald-700">Secured</span>}</div>
    <input id={`proof-${orderId}`} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={onSelect} disabled={uploading || confirming || registered} className="sr-only" />
    {!proofFile && !registered ? <label htmlFor={`proof-${orderId}`} className="mt-4 flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center transition hover:border-teal-500 hover:bg-teal-50"><span className="grid size-11 place-items-center rounded-xl bg-white text-slate-700 shadow-sm"><CameraIcon /></span><span className="mt-3 text-sm font-black">Take or choose a photo</span><span className="mt-1 text-[10px] text-slate-400">JPEG, PNG or WebP · maximum 10 MB</span></label> : null}
    {proofFile && !registered && <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200"><img src={previewUrl ?? undefined} alt="Proof of Delivery review" className="aspect-[4/3] w-full bg-slate-100 object-cover" /><div className="flex items-center justify-between gap-3 p-4"><div className="min-w-0"><p className="truncate text-xs font-bold">{proofFile.name}</p><p className="mt-1 text-[10px] text-slate-400">{(proofFile.size / 1024 / 1024).toFixed(2)} MB · review before upload</p></div><div className="flex gap-2"><label htmlFor={`proof-${orderId}`} className="cursor-pointer rounded-lg border border-slate-200 px-3 py-2 text-[10px] font-bold hover:border-slate-500">Retake</label><button type="button" onClick={onRemove} className="rounded-lg border border-slate-200 px-3 py-2 text-[10px] font-bold text-red-700 hover:border-red-300">Remove</button></div></div></div>}
    {!registered && <div className="mt-4 space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-[10px] font-bold text-slate-500">Received by<input value={recipientName} onChange={(event) => onRecipientName(event.target.value)} maxLength={120} className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-950 outline-none focus:border-teal-600" /></label>
        <label className="text-[10px] font-bold text-slate-500">Parcel barcode<input value={barcode} onChange={(event) => onBarcode(event.target.value)} maxLength={128} inputMode="text" placeholder="Scan from photo or enter code" className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs text-slate-950 outline-none focus:border-teal-600" /></label>
      </div>
      <label className="block text-[10px] font-bold text-slate-500">Delivery notes<textarea value={notes} onChange={(event) => onNotes(event.target.value)} maxLength={500} rows={2} placeholder="Gate, recipient or parcel condition" className="mt-1 w-full resize-none rounded-lg border border-slate-200 bg-white p-3 text-xs font-normal text-slate-950 outline-none focus:border-teal-600" /></label>
      <SignaturePad value={signatureDataUrl} onChange={onSignature} />
      <p className="text-[9px] leading-4 text-slate-400">GPS coordinates and accuracy are attached automatically when device location is available.</p>
    </div>}
    {uploading && <div className="mt-4 rounded-2xl border border-slate-200 p-4"><div className="flex justify-between text-[10px] font-bold"><span>{phase === 'registering' ? 'Verifying secure upload…' : 'Uploading to secure storage…'}</span><span>{progress}%</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-teal-600 transition-all duration-300" style={{ width: `${progress}%` }} /></div></div>}
    {!registered && proofFile && !uploading && <Button className="mt-4 w-full" onClick={onUpload} disabled={!isOnline}>{phase === 'upload-error' ? 'Retry proof upload' : 'Upload proof securely'}</Button>}
    {registered && <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><div className="flex gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-emerald-600 text-white"><CheckIcon /></span><div><p className="text-sm font-black text-emerald-950">Proof verified</p><p className="mt-1 text-xs leading-5 text-emerald-800">The image is stored and its metadata is attached to this order.</p></div></div><Button className="mt-5 w-full" onClick={onConfirm} isLoading={confirming} disabled={!isOnline}>{phase === 'confirm-error' ? 'Retry delivery confirmation' : 'Confirm delivery'}</Button></div>}
  </section>;
};

const SignaturePad = ({ value, onChange }: { value: string | null; onChange: (value: string | null) => void }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !value) return;
    const image = new Image();
    image.onload = () => canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.src = value;
  }, [value]);

  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const bounds = canvas.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) * canvas.width / bounds.width, y: (event.clientY - bounds.top) * canvas.height / bounds.height };
  };
  const start = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const context = event.currentTarget.getContext('2d');
    const next = point(event);
    context?.beginPath(); context?.moveTo(next.x, next.y);
  };
  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const context = event.currentTarget.getContext('2d');
    const next = point(event);
    if (context) { context.strokeStyle = '#0f172a'; context.lineWidth = 3; context.lineCap = 'round'; context.lineTo(next.x, next.y); context.stroke(); }
  };
  const finish = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(event.currentTarget.toDataURL('image/png'));
  };
  const clear = () => {
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    onChange(null);
  };

  return <div><div className="flex items-center justify-between"><p className="text-[10px] font-bold text-slate-500">Recipient signature</p><button type="button" onClick={clear} className="text-[9px] font-bold text-teal-700">Clear</button></div><canvas ref={canvasRef} width={720} height={220} onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} className="mt-1 h-28 w-full touch-none rounded-lg border border-dashed border-slate-300 bg-white" aria-label="Recipient signature pad" /><p className="mt-1 text-[9px] text-slate-400">{value ? 'Signature captured' : 'Sign inside the box'}</p></div>;
};

const CompletionReceipt = ({ order, nextDelivery, onContinue }: { order: DeliveryOrder; nextDelivery: DeliveryOrder | null; onContinue: () => void }) => <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12"><section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white text-center shadow-[0_24px_80px_-38px_rgba(15,23,42,0.4)]"><div className="bg-slate-950 px-6 py-10 text-white"><div className="cloudfleet-success-mark mx-auto grid size-20 place-items-center rounded-full bg-emerald-400 text-slate-950"><CheckIcon large /></div><p className="mt-6 text-[10px] font-bold tracking-[0.24em] text-emerald-300 uppercase">Delivery complete</p><h1 className="mt-2 text-3xl font-black tracking-tight">Great work.</h1><p className="mt-2 text-sm text-slate-400">The customer notification workflow has been triggered.</p></div><div className="p-6 text-left sm:p-8"><div className="grid gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 sm:grid-cols-2"><ReceiptField label="Order" value={`CF-${order.orderId.slice(0, 8).toUpperCase()}`} mono /><ReceiptField label="Recipient" value={order.customerName} /><ReceiptField label="Completed" value={new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(order.deliveredAt ?? Date.now()))} /><ReceiptField label="Proof status" value="Secured in storage" /></div><div className="mt-6 grid gap-3 sm:grid-cols-2"><Link to="/driver/history" className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 text-xs font-bold hover:border-slate-950">View delivery history</Link>{nextDelivery ? <Button onClick={onContinue}>View next delivery</Button> : <Button variant="secondary" onClick={onContinue}>Return to workspace</Button>}</div></div></section>{nextDelivery && <NextDeliveryPreview order={nextDelivery} />}</main>;

const NextDeliveryPreview = ({ order }: { order: DeliveryOrder }) => <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="text-[9px] font-bold tracking-[0.18em] text-slate-400 uppercase">Next delivery</p><p className="mt-2 text-sm font-black">{order.customerName}</p><p className="mt-1 truncate text-xs text-slate-500">{order.dropoffAddress}</p></div><span className="shrink-0 font-mono text-[9px] font-bold text-slate-400">CF-{order.orderId.slice(0, 8).toUpperCase()}</span></div></section>;

const LocationPermissionCard = ({ tracking, active }: { tracking: DriverLocationTracking; active: boolean }) => {
  const labels: Record<TrackingStatus, { title: string; detail: string; tone: string }> = {
    idle: { title: 'Location inactive', detail: 'Location sharing begins after Start route.', tone: 'bg-slate-400' },
    requesting: { title: 'Location permission required', detail: 'Approve the browser prompt to share live route progress.', tone: 'bg-amber-500' },
    tracking: { title: 'Live location enabled', detail: formatLocationFreshness(tracking.lastUpdatedAt), tone: 'bg-emerald-500' },
    denied: { title: 'Location permission denied', detail: 'Enable location for this site in browser settings, then retry.', tone: 'bg-red-500' },
    unsupported: { title: 'Location unavailable', detail: 'This browser does not support geolocation.', tone: 'bg-red-500' },
    error: { title: 'Location update failed', detail: 'Check device location services and network connectivity.', tone: 'bg-red-500' },
  };
  const state = labels[active ? tracking.status : 'idle'];
  return <div className="mt-5 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4"><span className={`size-2 shrink-0 rounded-full ${state.tone}`} /><div className="min-w-0 flex-1"><p className="text-xs font-bold">{state.title}</p><p className="mt-1 text-[10px] leading-4 text-slate-500">{state.detail}</p></div>{active && (tracking.status === 'denied' || tracking.status === 'error') && <button type="button" onClick={tracking.retry} className="text-[10px] font-bold text-teal-700">Retry</button>}</div>;
};

const Metric = ({ label, value }: { label: string; value: string }) => <div className="rounded-xl bg-slate-50 p-4"><p className="text-[9px] font-bold tracking-wider text-slate-400 uppercase">{label}</p><p className="mt-1 text-sm font-black">{value}</p></div>;
const OrderField = ({ icon, label, value }: { icon: ReactNode; label: string; value: string }) => <div className="flex gap-4"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">{icon}</span><div><p className="text-[9px] font-bold tracking-wider text-slate-400 uppercase">{label}</p><p className="mt-1 text-sm font-bold leading-5">{value}</p></div></div>;
const ReceiptField = ({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) => <div className="bg-white p-4"><p className="text-[9px] font-bold tracking-wider text-slate-400 uppercase">{label}</p><p className={`mt-2 text-xs font-bold ${mono ? 'font-mono' : ''}`}>{value}</p></div>;
const FeedbackBanner = ({ feedback }: { feedback: Exclude<Feedback, null> }) => <div role={feedback.type === 'error' ? 'alert' : 'status'} className={`mt-5 rounded-xl border px-4 py-3 text-xs font-semibold leading-5 ${feedback.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>{feedback.message}</div>;

const iconClassName = 'size-5';
const UserIcon = () => <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={iconClassName}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>;
const LocationIcon = () => <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={iconClassName}><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></svg>;
const CameraIcon = () => <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={iconClassName}><path d="M14.5 5 13 3h-2L9.5 5H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4.5Z" /><circle cx="12" cy="12" r="3.5" /></svg>;
const NavigationIcon = () => <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={iconClassName}><path d="m3 11 18-8-8 18-2-8-8-2Z" /></svg>;
const CheckIcon = ({ large = false }: { large?: boolean }) => <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={large ? 'size-10' : iconClassName}><path d="m5 12 4 4L19 6" /></svg>;
const OfflineIcon = () => <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 size-5 shrink-0"><path d="m3 3 18 18M8.5 8.5A6 6 0 0 1 18 13m-12.5.5A9 9 0 0 1 7 7m4.5 10.5a1 1 0 1 0 1 1" /></svg>;
