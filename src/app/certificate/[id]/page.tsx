import { notFound, redirect } from "next/navigation";
import { findPublicCertificateId } from "@/server/services/certificate.service";
import { certificateVerifyPath } from "@/lib/certificateStatus";

/**
 * Legacy link by internal certificate ID. The canonical, status-aware page is
 * /verify/[certificateId]; this page never renders a verification itself.
 */
export default async function LegacyCertificatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const certificateId = await findPublicCertificateId(id);
  if (!certificateId) notFound();
  redirect(certificateVerifyPath(certificateId));
}
