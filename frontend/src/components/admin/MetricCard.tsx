interface MetricCardProps {
  label: string;
  value: string;
  detail: string;
  dotClassName: string;
}

export const MetricCard = ({ label, value, detail, dotClassName }: MetricCardProps) => (
  <article className="border border-neutral-200 bg-white p-5 sm:p-6">
    <div className="flex items-center justify-between gap-4">
      <p className="text-[10px] font-bold tracking-[0.16em] text-neutral-400 uppercase">{label}</p>
      <span className={`size-1.5 rounded-full ${dotClassName}`} />
    </div>
    <p className="mt-6 text-3xl font-semibold tracking-[-0.04em] text-neutral-950 sm:text-4xl">
      {value}
    </p>
    <p className="mt-3 text-[11px] font-medium text-neutral-400">{detail}</p>
  </article>
);
