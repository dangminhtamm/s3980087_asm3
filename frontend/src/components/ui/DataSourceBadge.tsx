import { StatusBadge } from './StatusBadge';

export const DataSourceBadge = ({ isFallback }: { isFallback: boolean }) => (
  <span className="inline-flex rounded-full border border-neutral-200 bg-white px-3 py-1.5 shadow-sm">
    <StatusBadge
      label={isFallback ? 'Demo data' : 'Live data'}
      tone={isFallback ? 'warning' : 'success'}
      pulse={!isFallback}
    />
  </span>
);
