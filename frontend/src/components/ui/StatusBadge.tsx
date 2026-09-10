import { cn } from '../../utils/cn';

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

interface StatusBadgeProps {
  label: string;
  tone?: StatusTone;
  className?: string;
  pulse?: boolean;
}

const tones: Record<StatusTone, string> = {
  neutral: 'bg-neutral-400',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
  info: 'bg-blue-500',
};

export const StatusBadge = ({ label, tone = 'neutral', className, pulse = false }: StatusBadgeProps) => (
  <span className={cn('inline-flex items-center gap-2 text-[11px] font-semibold text-neutral-600', className)}>
    <span className="relative flex size-2">
      {pulse && <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-30', tones[tone])} />}
      <span className={cn('relative inline-flex size-2 rounded-full', tones[tone])} />
    </span>
    {label}
  </span>
);
