export type ProofContentType = 'image/jpeg' | 'image/png' | 'image/webp';
export type SubmissionPhase =
  'idle' | 'uploading' | 'registering' | 'ready' | 'confirming' | 'upload-error' | 'confirm-error';
export type DeliveryFeedback = { type: 'success' | 'error'; message: string } | null;
export interface UploadedObject {
  objectKey: string;
  contentType: ProofContentType;
  size: number;
}
