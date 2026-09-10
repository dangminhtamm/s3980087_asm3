import { useEffect, type ReactNode } from 'react';

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export const Drawer = ({ isOpen, onClose, title, children }: DrawerProps) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  return (
    <div className={`fixed inset-0 z-50 ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`} aria-hidden={!isOpen}>
      <button type="button" aria-label="Close panel" onClick={onClose} className={`absolute inset-0 bg-neutral-950/40 transition-opacity ${isOpen ? 'opacity-100' : 'opacity-0'}`} />
      <aside className={`absolute inset-y-0 right-0 w-full max-w-xl overflow-y-auto border-l border-neutral-200 bg-white shadow-2xl transition-transform duration-300 ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-neutral-100 bg-white/95 px-6 py-5 backdrop-blur"><h2 className="text-lg font-semibold tracking-tight">{title}</h2><button type="button" onClick={onClose} className="flex size-8 items-center justify-center rounded-full text-xl text-neutral-400 hover:bg-neutral-100 hover:text-neutral-950">×</button></header>
        <div className="p-6">{children}</div>
      </aside>
    </div>
  );
};
