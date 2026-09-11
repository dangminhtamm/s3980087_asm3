import axios from 'axios';
import { useCallback, useEffect, useState, type ChangeEvent } from 'react';

import type { DriverLocationTracking } from '../../../hooks/useDriverLocationTracking';
import { cloudFleetApi } from '../../../shared/api/http-client';
import type { ApiEnvelope, PresignedUpload } from '../../../types/order';
import { getPendingProof, removePendingProof, savePendingProof } from '../../offline-sync';
import { sendFrontendTelemetry } from '../../../services/telemetry';
import { getDeliveryProof } from '../api/proof.client';
import { getDeliveryErrorMessage } from '../model/delivery-errors';
import type {
  DeliveryFeedback,
  ProofContentType,
  SubmissionPhase,
  UploadedObject,
} from '../model/delivery.types';

const ALLOWED_TYPES: ProofContentType[] = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 10 * 1024 * 1024;
const isAllowedType = (value: string): value is ProofContentType =>
  ALLOWED_TYPES.some((type) => type === value);

interface Options {
  orderId: string;
  orderStatus: string;
  customerName: string;
  isOnline: boolean;
  locationTracking: DriverLocationTracking;
  onFeedback: (feedback: DeliveryFeedback) => void;
}

export const useProofOfDelivery = ({
  orderId,
  orderStatus,
  customerName,
  isOnline,
  locationTracking,
  onFeedback,
}: Options) => {
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadedObject, setUploadedObject] = useState<UploadedObject | null>(null);
  const [registered, setRegistered] = useState(false);
  const [phase, setPhase] = useState<SubmissionPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [recipientName, setRecipientName] = useState(customerName);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [barcode, setBarcode] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!proofFile) return setPreviewUrl(null);
    const url = URL.createObjectURL(proofFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [proofFile]);

  useEffect(() => {
    let active = true;
    void getPendingProof(orderId)
      .then((pending) => {
        if (!active || !pending) return;
        setProofFile(pending.file);
        setRecipientName(pending.recipientName);
        setSignatureDataUrl(pending.signatureDataUrl);
        setBarcode(pending.barcode);
        setNotes(pending.notes);
        onFeedback({ type: 'success', message: 'Recovered the draft proof saved on this device.' });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [onFeedback, orderId]);

  useEffect(() => {
    if (!proofFile || registered) return;
    void savePendingProof({
      orderId,
      file: proofFile,
      recipientName,
      signatureDataUrl,
      barcode,
      notes,
    }).catch(() => undefined);
  }, [barcode, notes, orderId, proofFile, recipientName, registered, signatureDataUrl]);

  useEffect(() => {
    if (orderStatus !== 'ARRIVED') return;
    let active = true;
    void getDeliveryProof(orderId)
      .then(() => {
        if (active) {
          setRegistered(true);
          setPhase('ready');
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [orderId, orderStatus]);

  const selectProof = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      onFeedback(null);
      if (!file) return;
      if (!isAllowedType(file.type))
        return onFeedback({
          type: 'error',
          message: 'Only JPEG, PNG or WebP images are accepted.',
        });
      if (file.size <= 0 || file.size > MAX_SIZE)
        return onFeedback({
          type: 'error',
          message: 'The proof image must be between 1 byte and 10 MB.',
        });
      setProofFile(file);
      setUploadedObject(null);
      setRegistered(false);
      setProgress(0);
      setPhase('idle');
      const Detector = (
        globalThis as typeof globalThis & {
          BarcodeDetector?: new () => {
            detect: (source: Blob) => Promise<Array<{ rawValue: string }>>;
          };
        }
      ).BarcodeDetector;
      if (Detector)
        void new Detector()
          .detect(file)
          .then((codes) => {
            const detected = codes[0]?.rawValue;
            if (detected) setBarcode(detected.slice(0, 128));
          })
          .catch(() => undefined);
    },
    [onFeedback],
  );

  const removeProof = useCallback(() => {
    setProofFile(null);
    setUploadedObject(null);
    setProgress(0);
    setPhase('idle');
    onFeedback(null);
    void removePendingProof(orderId).catch(() => undefined);
  }, [onFeedback, orderId]);

  const upload = useCallback(async () => {
    if (!proofFile || registered) return;
    if (!isAllowedType(proofFile.type))
      return onFeedback({ type: 'error', message: 'The selected file type is no longer valid.' });
    if (!isOnline) {
      setPhase('upload-error');
      return onFeedback({
        type: 'error',
        message: 'You are offline. Keep this screen open and retry when connected.',
      });
    }
    onFeedback(null);
    try {
      let object = uploadedObject;
      if (!object) object = await uploadObject(orderId, proofFile, setPhase, setProgress);
      setUploadedObject(object);
      setPhase('registering');
      await cloudFleetApi.post(`/api/orders/${orderId}/proof`, {
        ...object,
        recipientName: recipientName.trim() || undefined,
        signatureDataUrl: signatureDataUrl ?? undefined,
        barcode: barcode.trim() || undefined,
        notes: notes.trim() || undefined,
        gps: locationTracking.lastLocation ?? undefined,
      });
      setProgress(100);
      setRegistered(true);
      setPhase('ready');
      await removePendingProof(orderId);
      onFeedback({
        type: 'success',
        message: 'Proof secured. Review the order and confirm delivery.',
      });
    } catch (error: unknown) {
      setPhase('upload-error');
      onFeedback({ type: 'error', message: getDeliveryErrorMessage(error) });
    }
  }, [
    barcode,
    isOnline,
    locationTracking.lastLocation,
    notes,
    onFeedback,
    orderId,
    proofFile,
    recipientName,
    registered,
    signatureDataUrl,
    uploadedObject,
  ]);

  return {
    proofFile,
    previewUrl,
    registered,
    phase,
    progress,
    recipientName,
    signatureDataUrl,
    barcode,
    notes,
    setRecipientName,
    setSignatureDataUrl,
    setBarcode,
    setNotes,
    setPhase,
    selectProof,
    removeProof,
    upload,
  };
};

const uploadObject = async (
  orderId: string,
  file: File,
  setPhase: (phase: SubmissionPhase) => void,
  setProgress: (progress: number) => void,
): Promise<UploadedObject> => {
  setPhase('uploading');
  setProgress(1);
  const response = await cloudFleetApi.get<ApiEnvelope<PresignedUpload>>(
    `/api/orders/${orderId}/proof/upload-url`,
    { params: { contentType: file.type } },
  );
  const { uploadUrl, objectKey, requiredHeaders } = response.data.data;
  const startedAt = performance.now();
  try {
    await axios.put(uploadUrl, file, {
      headers: requiredHeaders,
      timeout: 30_000,
      onUploadProgress: ({ loaded, total }) =>
        setProgress(Math.min(100, Math.round((loaded / (total ?? file.size)) * 100))),
    });
    sendFrontendTelemetry({
      type: 'POD_UPLOAD',
      outcome: 'success',
      durationMs: performance.now() - startedAt,
      sizeBytes: file.size,
    });
  } catch (error: unknown) {
    sendFrontendTelemetry({
      type: 'POD_UPLOAD',
      outcome: 'error',
      durationMs: performance.now() - startedAt,
      sizeBytes: file.size,
    });
    throw error;
  }
  return { objectKey, contentType: file.type as ProofContentType, size: file.size };
};
