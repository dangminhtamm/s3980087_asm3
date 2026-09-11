import axios from 'axios';
import { useEffect, useState, type FormEvent } from 'react';

import { Button, Modal, useToast } from '../../../components/ui';
import { listDrivers } from '../../drivers/api/drivers.client';
import { createRoute } from '../../routes/api/routes.client';
import { createOrder, importOrdersCsv, validateAddress } from '../api/orders.client';
import type { AdminOrder, FleetDriver, GeocodingCandidate } from '../../../types/admin';

export const CreateOrderDialog = ({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (order: AdminOrder, fallback: boolean) => void;
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [region, setRegion] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [candidates, setCandidates] = useState<GeocodingCandidate[]>([]);
  const [isValidating, setIsValidating] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const result = await createOrder({
        customerName: String(form.get('customerName')),
        customerPhone: String(form.get('customerPhone')),
        dropoffAddress: address,
        region,
        lat: Number(lat),
        lng: Number(lng),
        timeWindowStart: form.get('timeWindowStart')
          ? new Date(String(form.get('timeWindowStart'))).toISOString()
          : null,
        timeWindowEnd: form.get('timeWindowEnd')
          ? new Date(String(form.get('timeWindowEnd'))).toISOString()
          : null,
        packageWeightKg: Number(form.get('packageWeightKg')),
        packageVolumeM3: Number(form.get('packageVolumeM3')),
        serviceDurationMinutes: Number(form.get('serviceDurationMinutes')),
      });
      onCreated(result.data, result.isFallback);
    } catch (submitError: unknown) {
      const apiMessage = axios.isAxiosError(submitError)
        ? (submitError.response?.data?.error?.message as string | undefined)
        : undefined;
      setError(apiMessage ?? 'Unable to create the order.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="New delivery order"
      description="Create a validated destination with its delivery constraints."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="create-order-form" isLoading={isSubmitting}>
            Create order
          </Button>
        </>
      }
    >
      <form id="create-order-form" onSubmit={handleSubmit}>
        <div className="space-y-4 text-xs">
          <Field label="Customer name" name="customerName" placeholder="Alex Nguyen" />
          <Field label="Phone (E.164)" name="customerPhone" type="tel" placeholder="+84901234567" />
          <label className="block">
            <span className="mb-2 block font-semibold text-neutral-600">Drop-off address</span>
            <div className="flex gap-2">
              <input
                required
                value={address}
                onChange={(event) => {
                  setAddress(event.target.value);
                  setCandidates([]);
                }}
                placeholder="72 Nguyen Hue Street, District 1"
                className="h-11 min-w-0 flex-1 border border-neutral-200 px-3 outline-none focus:border-neutral-950"
              />
              <Button
                type="button"
                variant="secondary"
                isLoading={isValidating}
                onClick={() => {
                  setIsValidating(true);
                  setError(null);
                  void validateAddress(address)
                    .then(setCandidates)
                    .catch(() =>
                      setError(
                        'Address validation is unavailable. You can still enter coordinates manually.',
                      ),
                    )
                    .finally(() => setIsValidating(false));
                }}
              >
                Validate
              </Button>
            </div>
          </label>
          {candidates.length > 0 && (
            <div className="border border-neutral-200 bg-neutral-50 p-2">
              {candidates.map((candidate) => (
                <button
                  type="button"
                  key={candidate.placeId}
                  onClick={() => {
                    setAddress(candidate.formattedAddress);
                    setRegion(candidate.region ?? region);
                    setLat(String(candidate.lat));
                    setLng(String(candidate.lng));
                    setCandidates([]);
                  }}
                  className="block w-full border-b border-neutral-200 p-2 text-left text-[10px] last:border-0 hover:bg-white"
                >
                  {candidate.formattedAddress}
                </button>
              ))}
            </div>
          )}
          <label className="block">
            <span className="mb-2 block font-semibold text-neutral-600">Region</span>
            <input
              required
              value={region}
              onChange={(event) => setRegion(event.target.value)}
              placeholder="District 1"
              className="h-11 w-full border border-neutral-200 px-3 outline-none focus:border-neutral-950"
            />
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label>
              <span className="mb-2 block font-semibold text-neutral-600">Latitude</span>
              <input
                required
                value={lat}
                onChange={(event) => setLat(event.target.value)}
                type="number"
                step="any"
                placeholder="10.77428"
                className="h-11 w-full border border-neutral-200 px-3 outline-none focus:border-neutral-950"
              />
            </label>
            <label>
              <span className="mb-2 block font-semibold text-neutral-600">Longitude</span>
              <input
                required
                value={lng}
                onChange={(event) => setLng(event.target.value)}
                type="number"
                step="any"
                placeholder="106.70391"
                className="h-11 w-full border border-neutral-200 px-3 outline-none focus:border-neutral-950"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Window start"
              name="timeWindowStart"
              type="datetime-local"
              placeholder=""
              required={false}
            />
            <Field
              label="Window end"
              name="timeWindowEnd"
              type="datetime-local"
              placeholder=""
              required={false}
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Weight (kg)" name="packageWeightKg" type="number" placeholder="2.5" />
            <Field label="Volume (m³)" name="packageVolumeM3" type="number" placeholder="0.03" />
            <Field
              label="Service (min)"
              name="serviceDurationMinutes"
              type="number"
              placeholder="10"
            />
          </div>
        </div>
        {error && (
          <p className="mt-4 border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
};

export const ImportCsvDialog = ({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) => {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!file) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await importOrdersCsv(file);
      toast({
        title: `${result.created} orders imported`,
        description: result.failed
          ? `${result.failed} rows need correction.`
          : 'Every row was accepted.',
        tone: result.failed ? 'info' : 'success',
      });
      onImported();
    } catch (submitError: unknown) {
      setError(
        axios.isAxiosError(submitError)
          ? String(submitError.response?.data?.error?.message ?? 'Unable to import CSV.')
          : 'Unable to import CSV.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };
  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Import orders from CSV"
      description="Up to 100 rows. Required headers: customerName, customerPhone, dropoffAddress, region, lat, lng."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!file} isLoading={isSubmitting} onClick={() => void submit()}>
            Import
          </Button>
        </>
      }
    >
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        className="w-full border border-dashed border-neutral-300 p-6 text-xs"
      />
      {error && (
        <p className="mt-4 border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</p>
      )}
    </Modal>
  );
};

export const CreateRouteDialog = ({
  orderIds,
  onClose,
  onCreated,
}: {
  orderIds: string[];
  onClose: () => void;
  onCreated: (routeId: string) => void;
}) => {
  const { toast } = useToast();
  const [drivers, setDrivers] = useState<FleetDriver[]>([]);
  const [driverId, setDriverId] = useState('');
  const [scheduledDate, setScheduledDate] = useState(new Date().toISOString().slice(0, 10));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void listDrivers()
      .then((result) => {
        const eligible = result.data.filter((driver) => driver.status !== 'OFFLINE');
        setDrivers(eligible);
        setDriverId(eligible[0]?.driverId ?? '');
      })
      .catch(() => setError('Unable to load drivers.'));
  }, []);
  const submit = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const route = await createRoute({ driverId, orderIds, scheduledDate });
      toast({
        title: 'Route planned',
        description: `${route.stopCount} stops assigned to ${route.driverId}.`,
        tone: 'success',
      });
      onCreated(route.routeId);
    } catch (submitError: unknown) {
      setError(
        axios.isAxiosError(submitError)
          ? String(submitError.response?.data?.error?.message ?? 'Unable to create route.')
          : 'Unable to create route.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };
  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Plan a multi-stop route"
      description={`${orderIds.length} selected orders will be assigned atomically after capacity checks.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!driverId} isLoading={isSubmitting} onClick={() => void submit()}>
            Create route
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-xs">
        <label className="block">
          <span className="mb-2 block font-semibold text-neutral-600">Driver / capacity</span>
          <select
            value={driverId}
            onChange={(event) => setDriverId(event.target.value)}
            className="h-11 w-full border border-neutral-200 px-3"
          >
            {drivers.map((driver) => (
              <option key={driver.driverId} value={driver.driverId}>
                {driver.name} · {driver.maxWeightKg ?? 20} kg / {driver.maxVolumeM3 ?? 0.25} m³
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-2 block font-semibold text-neutral-600">Scheduled date</span>
          <input
            type="date"
            required
            value={scheduledDate}
            onChange={(event) => setScheduledDate(event.target.value)}
            className="h-11 w-full border border-neutral-200 px-3"
          />
        </label>
        {error && <p className="border border-red-200 bg-red-50 p-3 text-red-700">{error}</p>}
      </div>
    </Modal>
  );
};

const Field = ({
  label,
  name,
  placeholder,
  type = 'text',
  required = true,
}: {
  label: string;
  name: string;
  placeholder: string;
  type?: string;
  required?: boolean;
}) => (
  <label className="block">
    <span className="mb-2 block font-semibold text-neutral-600">{label}</span>
    <input
      required={required}
      name={name}
      type={type}
      min={type === 'number' ? '0' : undefined}
      step={type === 'number' ? 'any' : undefined}
      placeholder={placeholder}
      className="h-11 w-full border border-neutral-200 px-3 outline-none focus:border-neutral-950"
    />
  </label>
);
