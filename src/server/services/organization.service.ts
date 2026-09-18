import { db } from "@/server/db";
import { requireAuthenticatedUser } from "./auth.service";
import { OrganizationRole } from "@prisma/client";

export async function requireOrganizationMember(orgId: string) {
  const user = await requireAuthenticatedUser();
  const member = await db.organizationMember.findUnique({
    where: { orgId_userId: { orgId, userId: user.id } },
    include: { organization: true },
  });

  if (!member) {
    throw new Error("UNAUTHORIZED_ORG_ACCESS");
  }

  return { user, member, organization: member.organization };
}

export async function requireOrganizationRole(
  orgId: string,
  allowedRoles: OrganizationRole[]
) {
  const ctx = await requireOrganizationMember(orgId);
  if (!allowedRoles.includes(ctx.member.role)) {
    throw new Error("INSUFFICIENT_ORG_ROLE");
  }
  return ctx;
}

export async function createOrganization(data: { name: string; slug: string }) {
  const user = await requireAuthenticatedUser();

  const existing = await db.organization.findUnique({ where: { slug: data.slug } });
  if (existing) {
    throw new Error("SLUG_TAKEN");
  }

  return await db.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        name: data.name,
        slug: data.slug,
        ownerId: user.id,
        members: {
          create: {
            userId: user.id,
            role: "OWNER",
          },
        },
      },
    });

    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "ORG_CREATED",
        resource: "Organization",
        resourceId: org.id,
      },
    });

    return org;
  });
}

export async function getOrganizationMembers(orgId: string) {
  await requireOrganizationRole(orgId, ["OWNER", "ADMIN", "RECRUITER", "REVIEWER"]);

  return await db.organizationMember.findMany({
    where: { orgId },
    include: {
      user: { select: { id: true, displayName: true, email: true, avatarUrl: true } },
    },
    orderBy: { joinedAt: "desc" },
  });
}

export async function updateOrganizationMemberRole(
  orgId: string,
  targetMemberId: string,
  newRole: OrganizationRole
) {
  const ctx = await requireOrganizationRole(orgId, ["OWNER", "ADMIN"]);

  const targetMember = await db.organizationMember.findUnique({
    where: { id: targetMemberId },
  });

  if (!targetMember || targetMember.orgId !== orgId) {
    throw new Error("MEMBER_NOT_FOUND");
  }

  // Only OWNER can modify another OWNER or change someone to OWNER
  if (targetMember.role === "OWNER" || newRole === "OWNER") {
    if (ctx.member.role !== "OWNER") {
      throw new Error("INSUFFICIENT_ORG_ROLE");
    }
  }

  const updated = await db.organizationMember.update({
    where: { id: targetMemberId },
    data: { role: newRole },
  });

  await db.auditLog.create({
    data: {
      userId: ctx.user.id,
      action: "MEMBER_ROLE_CHANGED",
      resource: "OrganizationMember",
      resourceId: targetMemberId,
      metadata: { newRole },
    },
  });

  return updated;
}

export async function removeOrganizationMember(orgId: string, targetMemberId: string) {
  const ctx = await requireOrganizationRole(orgId, ["OWNER", "ADMIN"]);

  const targetMember = await db.organizationMember.findUnique({
    where: { id: targetMemberId },
  });

  if (!targetMember || targetMember.orgId !== orgId) {
    throw new Error("MEMBER_NOT_FOUND");
  }

  // Only OWNER can remove an OWNER
  if (targetMember.role === "OWNER" && ctx.member.role !== "OWNER") {
    throw new Error("INSUFFICIENT_ORG_ROLE");
  }

  if (targetMember.userId === ctx.organization.ownerId) {
    throw new Error("CANNOT_REMOVE_PRIMARY_OWNER");
  }

  await db.organizationMember.delete({
    where: { id: targetMemberId },
  });

  await db.auditLog.create({
    data: {
      userId: ctx.user.id,
      action: "MEMBER_REMOVED",
      resource: "OrganizationMember",
      resourceId: targetMemberId,
    },
  });
}

export async function inviteOrganizationMember(
  orgId: string,
  email: string,
  role: OrganizationRole
) {
  const ctx = await requireOrganizationRole(orgId, ["OWNER", "ADMIN"]);

  // Here we would normally create an invite token and send an email
  // For now, we'll just log it.
  const inviteId = "invite_" + Math.random().toString(36).substr(2, 9);

  await db.auditLog.create({
    data: {
      userId: ctx.user.id,
      action: "MEMBER_INVITED",
      resource: "OrganizationInvite",
      resourceId: inviteId,
      metadata: { email, role },
    },
  });

  return inviteId;
}
