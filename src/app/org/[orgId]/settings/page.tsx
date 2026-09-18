import { requireOrganizationMember } from "@/server/services/organization.service";

export default async function SettingsPage(props: { params: Promise<{ orgId: string }> }) {
  const params = await props.params;
  const ctx = await requireOrganizationMember(params.orgId);
  
  return (
    <div className="p-8 space-y-6">
      <h1 className="text-3xl font-bold">Settings</h1>
      <div className="max-w-md bg-surface p-6 rounded-lg space-y-4">
        <div>
          <label className="block text-sm text-muted">Organization Name</label>
          <input type="text" className="w-full bg-tf-neutral-800 p-2 rounded mt-1" defaultValue={ctx.organization.name} disabled />
        </div>
        <div>
          <label className="block text-sm text-muted">Slug</label>
          <input type="text" className="w-full bg-tf-neutral-800 p-2 rounded mt-1" defaultValue={ctx.organization.slug} disabled />
        </div>
        {/* We can add update buttons here if we implement the actions */}
      </div>
    </div>
  );
}
