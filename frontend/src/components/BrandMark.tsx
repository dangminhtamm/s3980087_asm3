import { Link } from 'react-router-dom';

interface BrandMarkProps {
  compact?: boolean;
  inverse?: boolean;
}

export const BrandMark = ({ compact = false, inverse = false }: BrandMarkProps) => (
  <Link to="/" className="flex items-center gap-3" aria-label="CloudFleet home">
    <span
      className={`flex size-9 shrink-0 items-center justify-center rounded-lg text-[10px] font-black tracking-tight ${
        inverse ? 'bg-white text-neutral-950' : 'bg-neutral-950 text-white'
      }`}
    >
      CF
    </span>
    {!compact && (
      <span>
        <span className="block text-sm font-bold tracking-tight">CloudFleet</span>
        <span className={`block text-[9px] font-semibold tracking-[0.18em] uppercase ${inverse ? 'text-neutral-500' : 'text-neutral-400'}`}>
          Logistics OS
        </span>
      </span>
    )}
  </Link>
);
