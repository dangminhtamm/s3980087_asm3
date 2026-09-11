import type { ReactNode } from 'react';

import { cn } from '../../utils/cn';
import { Button } from './Button';

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  compact?: boolean;
}

export const ErrorState = ({
  title = 'Something went wrong',
  message,
  onRetry,
  compact = false,
}: ErrorStateProps) => (
  <div
    role="alert"
    className={cn(
      'border border-red-200 bg-red-50 text-red-900',
      compact ? 'flex items-center justify-between gap-4 px-4 py-3' : 'p-7 text-center',
    )}
  >
    <div className={cn(!compact && 'mx-auto max-w-md')}>
      <p className="text-xs font-bold">{title}</p>
      <p className="mt-1 text-[11px] leading-5 text-red-700">{message}</p>
    </div>
    {onRetry && (
      <Button variant="secondary" size="sm" onClick={onRetry}>
        Retry
      </Button>
    )}
  </div>
);

interface EmptyStateProps {
  eyebrow?: string;
  title: string;
  description: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export const EmptyState = ({
  eyebrow = 'All clear',
  title,
  description,
  icon,
  action,
  className,
}: EmptyStateProps) => (
  <section
    className={cn(
      'border border-dashed border-neutral-300 bg-white px-6 py-12 text-center',
      className,
    )}
  >
    {icon && (
      <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-700">
        {icon}
      </span>
    )}
    <p className="mt-5 text-[9px] font-bold tracking-[0.18em] text-neutral-400 uppercase">
      {eyebrow}
    </p>
    <h2 className="mt-2 text-lg font-semibold tracking-tight text-neutral-950">{title}</h2>
    <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-neutral-500">{description}</p>
    {action && <div className="mt-6 flex justify-center">{action}</div>}
  </section>
);

export const Skeleton = ({ className }: { className?: string }) => (
  <div className={cn('animate-pulse rounded-lg bg-neutral-200/70', className)} />
);

export const PageSkeleton = () => (
  <div className="space-y-6" aria-label="Loading content" role="status">
    <div className="space-y-3">
      <Skeleton className="h-3 w-28" />
      <Skeleton className="h-9 w-72 max-w-full" />
      <Skeleton className="h-3 w-96 max-w-full" />
    </div>
    <div className="grid gap-4 sm:grid-cols-3">
      {Array.from({ length: 3 }, (_, index) => (
        <Skeleton key={index} className="h-36" />
      ))}
    </div>
    <Skeleton className="h-72" />
  </div>
);
