interface AdminPageHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}

export const AdminPageHeader = ({ eyebrow, title, description, action }: AdminPageHeaderProps) => (
  <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
    <div>
      <p className="text-[10px] font-bold tracking-[0.2em] text-neutral-400 uppercase">{eyebrow}</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-[-0.045em] text-neutral-950 sm:text-4xl">
        {title}
      </h1>
      <p className="mt-3 max-w-2xl text-xs leading-5 text-neutral-500">{description}</p>
    </div>
    {action}
  </div>
);
