import { useCallback, useEffect, useMemo, useState } from 'react';

import { updateOrderStatus } from '../../orders/api/orders.client';
import type { AdminOrderStatus } from '../../../types/admin';
import type { DeliveryFeedback, SubmissionPhase } from '../model/delivery.types';
import { getDeliveryErrorMessage } from '../model/delivery-errors';

interface Options {
  orderId: string;
  orderStatus: AdminOrderStatus;
  driverId: string;
  proofFile: File | null;
  proofRegistered: boolean;
  phase: SubmissionPhase;
  setPhase(phase: SubmissionPhase): void;
  isOnline: boolean;
  onFeedback: (feedback: DeliveryFeedback) => void;
  onStarted(orderId: string): void;
  onArrived(orderId: string): void;
  onException(orderId: string): void;
  onDelivered(orderId: string): void;
}

export const useDeliveryWorkflow = (options: Options) => {
  const [hasArrived, setHasArrived] = useState(options.orderStatus === 'ARRIVED');
  const [isStarting, setIsStarting] = useState(false);
  const [showStartConfirmation, setShowStartConfirmation] = useState(false);

  useEffect(() => {
    if (options.orderStatus === 'ARRIVED') setHasArrived(true);
  }, [options.orderStatus]);
  const mutate = useCallback(
    async (
      status: Exclude<AdminOrderStatus, 'PENDING' | 'ASSIGNED'>,
      callback: (orderId: string) => void,
      queuedMessage?: string,
      exception?: { reason: 'OTHER'; notes?: string },
    ) => {
      try {
        const result = await updateOrderStatus(
          options.orderId,
          status,
          exception,
          options.driverId,
        );
        callback(options.orderId);
        if (result.isQueued && queuedMessage)
          options.onFeedback({ type: 'success', message: queuedMessage });
        return true;
      } catch (error: unknown) {
        options.onFeedback({ type: 'error', message: getDeliveryErrorMessage(error) });
        return false;
      }
    },
    [options],
  );

  const startRoute = useCallback(async () => {
    setIsStarting(true);
    options.onFeedback(null);
    if (
      await mutate(
        'IN_PROGRESS',
        options.onStarted,
        'Route start saved offline and will sync automatically.',
      )
    )
      setShowStartConfirmation(false);
    setIsStarting(false);
  }, [mutate, options]);
  const recordArrival = useCallback(async () => {
    options.onFeedback(null);
    if (await mutate('ARRIVED', options.onArrived, 'Arrival saved offline and queued for sync.'))
      setHasArrived(true);
  }, [mutate, options]);
  const reportFailure = useCallback(async () => {
    const notes = window.prompt('Why could this delivery not be completed?');
    if (notes === null) return;
    await mutate(
      'DELIVERY_FAILED',
      options.onException,
      'Exception saved offline and queued for sync.',
      { reason: 'OTHER', notes: notes || undefined },
    );
  }, [mutate, options]);
  const confirmDelivery = useCallback(async () => {
    if (!options.proofRegistered) return;
    if (!options.isOnline) {
      options.setPhase('confirm-error');
      return options.onFeedback({ type: 'error', message: 'Reconnect to confirm this delivery.' });
    }
    options.setPhase('confirming');
    if (!(await mutate('DELIVERED', options.onDelivered))) options.setPhase('confirm-error');
  }, [mutate, options]);

  const currentStep = useMemo(() => {
    if (options.orderStatus === 'DELIVERED') return 8;
    if (options.orderStatus === 'ASSIGNED') return 2;
    if (options.orderStatus === 'ARRIVED' && !options.proofFile && !options.proofRegistered)
      return 4;
    if (['confirming', 'confirm-error', 'ready'].includes(options.phase) || options.proofRegistered)
      return 7;
    if (['uploading', 'registering', 'upload-error'].includes(options.phase)) return 6;
    if (options.proofFile) return 5;
    return hasArrived ? 4 : 3;
  }, [hasArrived, options.orderStatus, options.phase, options.proofFile, options.proofRegistered]);

  return {
    hasArrived,
    isStarting,
    showStartConfirmation,
    setShowStartConfirmation,
    currentStep,
    startRoute,
    recordArrival,
    reportFailure,
    confirmDelivery,
  };
};
