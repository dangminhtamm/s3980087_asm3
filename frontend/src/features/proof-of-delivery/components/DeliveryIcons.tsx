const iconClassName = 'size-5';
export const UserIcon = () => (
  <svg
    aria-hidden
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className={iconClassName}
  >
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
);
export const LocationIcon = () => (
  <svg
    aria-hidden
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className={iconClassName}
  >
    <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
    <circle cx="12" cy="10" r="2.5" />
  </svg>
);
export const CameraIcon = () => (
  <svg
    aria-hidden
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className={iconClassName}
  >
    <path d="M14.5 5 13 3h-2L9.5 5H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4.5Z" />
    <circle cx="12" cy="12" r="3.5" />
  </svg>
);
export const NavigationIcon = () => (
  <svg
    aria-hidden
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className={iconClassName}
  >
    <path d="m3 11 18-8-8 18-2-8-8-2Z" />
  </svg>
);
export const CheckIcon = ({ large = false }: { large?: boolean }) => (
  <svg
    aria-hidden
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    className={large ? 'size-10' : iconClassName}
  >
    <path d="m5 12 4 4L19 6" />
  </svg>
);
export const OfflineIcon = () => (
  <svg
    aria-hidden
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className="mt-0.5 size-5 shrink-0"
  >
    <path d="m3 3 18 18M8.5 8.5A6 6 0 0 1 18 13m-12.5.5A9 9 0 0 1 7 7m4.5 10.5a1 1 0 1 0 1 1" />
  </svg>
);
