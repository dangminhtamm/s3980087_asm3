import { useEffect, type ReactNode } from 'react';

import { cn } from '../../utils/cn';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export const Modal = ({ isOpen, onClose, title, description, children, footer, className }: ModalProps) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  return (
    <div role="presentation" className="fixed inset-0 z-50 grid place-items-center bg-neutral-950/55 p-4 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section role="dialog" aria-modal="true" aria-labelledby="modal-title" className={cn('max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-neutral-200 bg-white shadow-2xl', className)}>
        <header className="flex items-start justify-between gap-6 border-b border-neutral-100 px-6 py-5">
          <div><p className="text-[9px] font-bold tracking-[0.18em] text-neutral-400 uppercase">CloudFleet</p><h2 id="modal-title" className="mt-2 text-xl font-semibold tracking-tight">{title}</h2>{description && <p className="mt-2 text-xs leading-5 text-neutral-500">{description}</p>}</div>
          <button type="button" aria-label="Close dialog" onClick={onClose} className="flex size-8 items-center justify-center rounded-full text-xl text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-950">×</button>
        </header>
        <div className="px-6 py-6">{children}</div>
        {footer && <footer className="flex justify-end gap-3 border-t border-neutral-100 px-6 py-4">{footer}</footer>}
      </section>
    </div>
  );
};
