import { useState, type FormEvent } from 'react';

import { Button, Modal } from '../../../components/ui';
import { createDriver } from '../api/drivers.client';
import type { FleetDriver } from '../../../types/admin';

export const CreateDriverDialog = ({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (driver: FleetDriver, fallback: boolean) => void;
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      const result = await createDriver({
        name: String(form.get('name')),
        phone: String(form.get('phone')),
        vehiclePlate: String(form.get('vehiclePlate')),
        currentArea: String(form.get('currentArea')),
        maxWeightKg: Number(form.get('maxWeightKg')),
        maxVolumeM3: Number(form.get('maxVolumeM3')),
      });
      onCreated(result.data, result.isFallback);
    } catch {
      setError('Unable to add the driver. Check the entered data.');
    } finally {
      setIsSubmitting(false);
    }
  };
  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Add new driver"
      description="Register a driver, vehicle and carrying capacity."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="create-driver-form" isLoading={isSubmitting}>
            Add driver
          </Button>
        </>
      }
    >
      <form id="create-driver-form" onSubmit={submit}>
        <div className="grid gap-4 text-xs sm:grid-cols-2">
          <Input name="name" label="Full name" placeholder="Alex Nguyen" />
          <Input name="phone" label="Phone (E.164)" placeholder="+84901234567" />
          <Input name="vehiclePlate" label="Vehicle plate" placeholder="51A-482.17" />
          <Input name="currentArea" label="Current area" placeholder="District 1" />
          <Input name="maxWeightKg" label="Max weight (kg)" placeholder="20" type="number" />
          <Input name="maxVolumeM3" label="Max volume (m³)" placeholder="0.25" type="number" />
        </div>
        {error && (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
};

const Input = ({
  name,
  label,
  placeholder,
  type = 'text',
}: {
  name: string;
  label: string;
  placeholder: string;
  type?: string;
}) => (
  <label>
    <span className="mb-2 block font-semibold text-neutral-600">{label}</span>
    <input
      required
      name={name}
      type={type}
      step={type === 'number' ? 'any' : undefined}
      min={type === 'number' ? '0.001' : undefined}
      placeholder={placeholder}
      className="h-11 w-full border border-neutral-200 px-3 outline-none focus:border-neutral-950"
    />
  </label>
);
