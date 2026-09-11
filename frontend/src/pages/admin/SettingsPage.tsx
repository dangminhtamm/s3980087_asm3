import { AdminPageHeader } from '../../components/admin/AdminPageHeader';
import { Button, StatusBadge, useToast } from '../../components/ui';

const integrations = [
  ['Amazon Web Services', 'DynamoDB, S3, Lambda and ECS', 'Connected'],
  ['OpenStreetMap', 'Open map tiles rendered with Leaflet', 'Connected'],
  ['Twilio', 'Delivery status SMS notifications', 'Connected'],
] as const;

export const SettingsPage = () => {
  const { toast } = useToast();
  return (
    <main className="mx-auto max-w-[94rem] px-5 py-8 sm:px-8 sm:py-10 xl:px-12 xl:py-12">
      <AdminPageHeader
        eyebrow="Workspace / Settings"
        title="Platform settings"
        description="Manage your workspace profile, integrations and operational defaults."
      />
      <div className="mt-10 grid gap-6 xl:grid-cols-[0.75fr_1.25fr]">
        <section className="border border-neutral-200 bg-white p-6">
          <p className="text-[9px] font-bold tracking-[0.17em] text-neutral-400 uppercase">
            Workspace
          </p>
          <h2 className="mt-3 text-base font-bold">CloudFleet Vietnam</h2>
          <div className="mt-6 space-y-4 text-xs">
            <label className="block">
              <span className="mb-2 block text-neutral-500">Organization name</span>
              <input
                defaultValue="CloudFleet Vietnam"
                className="h-10 w-full border border-neutral-200 px-3 outline-none focus:border-neutral-950"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-neutral-500">Default region</span>
              <select className="h-10 w-full border border-neutral-200 bg-white px-3 outline-none">
                <option>Ho Chi Minh City</option>
              </select>
            </label>
            <Button
              className="mt-2"
              onClick={() =>
                toast({
                  title: 'Workspace preferences saved',
                  description: 'Your local interface settings have been updated.',
                  tone: 'success',
                })
              }
            >
              Save changes
            </Button>
          </div>
        </section>
        <section className="border border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 px-6 py-5">
            <h2 className="text-sm font-bold">Integrations</h2>
            <p className="mt-1 text-[10px] text-neutral-400">
              External services connected to CloudFleet
            </p>
          </div>
          <div className="divide-y divide-neutral-100">
            {integrations.map(([name, description, status]) => (
              <div key={name} className="flex items-center justify-between gap-4 px-6 py-5">
                <div>
                  <p className="text-xs font-bold">{name}</p>
                  <p className="mt-1 text-[10px] text-neutral-400">{description}</p>
                </div>
                <StatusBadge label={status} tone={status === 'Connected' ? 'success' : 'warning'} />
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
};
