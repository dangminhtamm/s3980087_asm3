import type { ChangeEvent } from 'react';

import { Button } from '../../../components/ui';
import type { SubmissionPhase } from '../model/delivery.types';
import { SignaturePad } from './SignaturePad';
import { CameraIcon, CheckIcon } from './DeliveryIcons';

interface ProofCaptureProps {
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
  onRecipientName(value: string): void;
  onSignature(value: string | null): void;
  onBarcode(value: string): void;
  onNotes(value: string): void;
  onSelect(event: ChangeEvent<HTMLInputElement>): void;
  onRemove(): void;
  onUpload(): void;
  onConfirm(): void;
}

export const ProofCapture = (props: ProofCaptureProps) => {
  const uploading = props.phase === 'uploading' || props.phase === 'registering';
  const confirming = props.phase === 'confirming';
  const inputId = `proof-${props.orderId}`;
  return (
    <section className="mt-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold tracking-wider text-teal-700 uppercase">
            Proof of Delivery
          </p>
          <h2 className="mt-1 text-lg font-black">Capture and review</h2>
        </div>
        {props.registered && (
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-bold text-emerald-700">
            Secured
          </span>
        )}
      </div>
      <input
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        onChange={props.onSelect}
        disabled={uploading || confirming || props.registered}
        className="sr-only"
      />
      {!props.proofFile && !props.registered && <CapturePrompt inputId={inputId} />}
      {props.proofFile && !props.registered && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
          <img
            src={props.previewUrl ?? undefined}
            alt="Proof of Delivery review"
            className="aspect-[4/3] w-full bg-slate-100 object-cover"
          />
          <div className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="truncate text-xs font-bold">{props.proofFile.name}</p>
              <p className="mt-1 text-[10px] text-slate-400">
                {(props.proofFile.size / 1024 / 1024).toFixed(2)} MB · review before upload
              </p>
            </div>
            <div className="flex gap-2">
              <label
                htmlFor={inputId}
                className="cursor-pointer rounded-lg border border-slate-200 px-3 py-2 text-[10px] font-bold hover:border-slate-500"
              >
                Retake
              </label>
              <button
                type="button"
                onClick={props.onRemove}
                className="rounded-lg border border-slate-200 px-3 py-2 text-[10px] font-bold text-red-700 hover:border-red-300"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
      {!props.registered && <ProofMetadata {...props} />}
      {uploading && (
        <div className="mt-4 rounded-2xl border border-slate-200 p-4">
          <div className="flex justify-between text-[10px] font-bold">
            <span>
              {props.phase === 'registering'
                ? 'Verifying secure upload…'
                : 'Uploading to secure storage…'}
            </span>
            <span>{props.progress}%</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-teal-600 transition-all duration-300"
              style={{ width: `${props.progress}%` }}
            />
          </div>
        </div>
      )}
      {!props.registered && props.proofFile && !uploading && (
        <Button className="mt-4 w-full" onClick={props.onUpload} disabled={!props.isOnline}>
          {props.phase === 'upload-error' ? 'Retry proof upload' : 'Upload proof securely'}
        </Button>
      )}
      {props.registered && (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <div className="flex gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-emerald-600 text-white">
              <CheckIcon />
            </span>
            <div>
              <p className="text-sm font-black text-emerald-950">Proof verified</p>
              <p className="mt-1 text-xs leading-5 text-emerald-800">
                The image is stored and its metadata is attached to this order.
              </p>
            </div>
          </div>
          <Button
            className="mt-5 w-full"
            onClick={props.onConfirm}
            isLoading={confirming}
            disabled={!props.isOnline}
          >
            {props.phase === 'confirm-error' ? 'Retry delivery confirmation' : 'Confirm delivery'}
          </Button>
        </div>
      )}
    </section>
  );
};

const CapturePrompt = ({ inputId }: { inputId: string }) => (
  <label
    htmlFor={inputId}
    className="mt-4 flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center transition hover:border-teal-500 hover:bg-teal-50"
  >
    <span className="grid size-11 place-items-center rounded-xl bg-white text-slate-700 shadow-sm">
      <CameraIcon />
    </span>
    <span className="mt-3 text-sm font-black">Take or choose a photo</span>
    <span className="mt-1 text-[10px] text-slate-400">JPEG, PNG or WebP · maximum 10 MB</span>
  </label>
);

const ProofMetadata = (props: ProofCaptureProps) => (
  <div className="mt-4 space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-[10px] font-bold text-slate-500">
        Received by
        <input
          value={props.recipientName}
          onChange={(event) => props.onRecipientName(event.target.value)}
          maxLength={120}
          className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-950 outline-none focus:border-teal-600"
        />
      </label>
      <label className="text-[10px] font-bold text-slate-500">
        Parcel barcode
        <input
          value={props.barcode}
          onChange={(event) => props.onBarcode(event.target.value)}
          maxLength={128}
          placeholder="Scan from photo or enter code"
          className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 font-mono text-xs text-slate-950 outline-none focus:border-teal-600"
        />
      </label>
    </div>
    <label className="block text-[10px] font-bold text-slate-500">
      Delivery notes
      <textarea
        value={props.notes}
        onChange={(event) => props.onNotes(event.target.value)}
        maxLength={500}
        rows={2}
        placeholder="Gate, recipient or parcel condition"
        className="mt-1 w-full resize-none rounded-lg border border-slate-200 bg-white p-3 text-xs font-normal text-slate-950 outline-none focus:border-teal-600"
      />
    </label>
    <SignaturePad value={props.signatureDataUrl} onChange={props.onSignature} />
    <p className="text-[9px] leading-4 text-slate-400">
      GPS coordinates and accuracy are attached automatically when device location is available.
    </p>
  </div>
);
