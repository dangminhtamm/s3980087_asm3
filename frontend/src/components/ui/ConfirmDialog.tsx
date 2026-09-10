import { Button } from './Button';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  isLoading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export const ConfirmDialog = ({ isOpen, title, description, confirmLabel = 'Confirm', isLoading, onConfirm, onClose }: ConfirmDialogProps) => (
  <Modal isOpen={isOpen} onClose={onClose} title={title} description={description} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button isLoading={isLoading} onClick={onConfirm}>{confirmLabel}</Button></>}>
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-xs leading-5 text-neutral-600">This action will be recorded in CloudFleet's operational history.</div>
  </Modal>
);
