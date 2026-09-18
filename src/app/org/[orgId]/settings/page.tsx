import { requireOrganizationMember } from "@/server/services/organization.service";

export default async function SettingsPage(props: {
  params: Promise<{ orgId: string }>;
}) {
  const params = await props.params;
  const ctx = await requireOrganizationMember(params.orgId);

  return (
    <div className="space-y-6 p-8">
      <h1 className="text-3xl font-bold">Settings</h1>
      <div className="bg-surface max-w-md space-y-4 rounded-lg p-6">
        <div>
          <label className="text-muted block text-sm">Organization Name</label>
          <input
            type="text"
            className="bg-tf-neutral-800 mt-1 w-full rounded p-2"
            defaultValue={ctx.organization.name}
            disabled
          />
        </div>
        <div>
          <label className="text-muted block text-sm">Slug</label>
          <input
            type="text"
            className="bg-tf-neutral-800 mt-1 w-full rounded p-2"
            defaultValue={ctx.organization.slug}
            disabled
          />
        </div>
        {/* We can add update buttons here if we implement the actions */}
      </div>
    </div>
  );
}
