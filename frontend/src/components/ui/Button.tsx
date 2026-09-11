import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '../../utils/cn';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leadingIcon?: ReactNode;
}

const variants: Record<ButtonVariant, string> = {
  primary: 'border-neutral-950 bg-neutral-950 text-white hover:bg-neutral-800',
  secondary:
    'border-neutral-200 bg-white text-neutral-950 hover:border-neutral-400 hover:bg-neutral-50',
  ghost:
    'border-transparent bg-transparent text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950',
  danger: 'border-red-700 bg-red-700 text-white hover:bg-red-800',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-[11px]',
  md: 'h-10 px-4 text-xs',
  lg: 'h-12 px-5 text-sm',
};

export const Button = ({
  children,
  className,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  leadingIcon,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) => (
  <button
    type={type}
    disabled={disabled || isLoading}
    aria-busy={isLoading || undefined}
    className={cn(
      'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border font-bold transition duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:opacity-45',
      variants[variant],
      sizes[size],
      className,
    )}
    {...props}
  >
    {isLoading ? <Spinner /> : leadingIcon}
    {children}
  </button>
);

const Spinner = () => (
  <span
    aria-hidden="true"
    className="size-3.5 animate-spin rounded-full border border-current border-r-transparent"
  />
);
