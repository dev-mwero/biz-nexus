import type { Types } from "mongoose";
import { ensureUniqueSlug } from "@/db/mixins/slug";
import { withTransaction } from "@/db/transaction";
import { SessionModel } from "@/modules/identity";
import {
  type Membership,
  MembershipModel,
  type Organization,
  OrganizationModel,
} from "@/modules/organizations";
import { provisionSystemRoles } from "@/modules/rbac/role.service";
import { AppError } from "@/shared/errors/app-error";

/**
 * Creating an organisation.
 *
 * The four system roles, the founder's membership, and the organisation itself
 * are one atomic unit. Splitting them is how you get a tenant whose owner
 * cannot see it: an organisation with no roles cannot grant its creator
 * anything, and a creator with no membership is locked out of the tenant they
 * just made. Neither is repairable through the UI, and both look like a bug
 * report rather than a failed request.
 *
 * Scoped here for 1.18 because the task is "provision on organisation
 * creation" and there was no organisation creation to hang that on. Settings
 * validation and the onboarding checklist belong to 1.34.
 */

export class OrganizationCreationError extends AppError {
  constructor(message: string) {
    super("ORGANIZATION_CREATION_FAILED", { message });
    this.name = "OrganizationCreationError";
  }
}

export interface CreateOrganizationInput {
  name: string;
  /** The founder. Receives the OWNER role and an ACTIVE membership. */
  ownerId: Types.ObjectId | string;
  /** Optional session to point at the new organisation, so it is the active one. */
  sessionId?: Types.ObjectId | string;
  timezone?: string;
  currency?: string;
  dateFormat?: string;
  weekStartsOn?: number;
}

export interface CreateOrganizationResult {
  organization: Organization;
  ownerRoleId: Types.ObjectId;
  membership: Membership;
}

/**
 * Pick a slug before opening the transaction.
 *
 * Inside a transaction the unique index still fires, and a duplicate-key error
 * aborts the whole transaction — which would roll back a perfectly good
 * organisation creation because somebody else holds "acme". Probing first
 * turns the ordinary case into a non-event. It is a probe, not a guarantee: a
 * concurrent creation can still win the race, and that surfaces as a retryable
 * abort rather than as a silently suffixed slug.
 */
async function reserveSlug(name: string): Promise<string> {
  return ensureUniqueSlug(OrganizationModel, name);
}

export async function createOrganization(
  input: CreateOrganizationInput,
): Promise<CreateOrganizationResult> {
  const name = input.name?.trim();
  if (!name) {
    throw new OrganizationCreationError("An organisation needs a name.");
  }
  if (!input.ownerId) {
    throw new OrganizationCreationError("An organisation needs an owner.");
  }

  const slug = await reserveSlug(name);
  const now = new Date();

  return withTransaction(async (session) => {
    const [organization] = await OrganizationModel.create(
      [
        {
          name,
          slug,
          createdBy: input.ownerId,
          updatedBy: input.ownerId,
          ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
          ...(input.currency === undefined ? {} : { currency: input.currency }),
          ...(input.dateFormat === undefined
            ? {}
            : { dateFormat: input.dateFormat }),
          ...(input.weekStartsOn === undefined
            ? {}
            : { weekStartsOn: input.weekStartsOn }),
        } as never,
      ],
      { session },
    );

    if (!organization) {
      throw new OrganizationCreationError("The organisation was not created.");
    }

    const roles = await provisionSystemRoles(
      organization._id,
      input.ownerId,
      session,
    );

    const ownerRole = roles.find((role) => role.key === "OWNER");
    if (!ownerRole) {
      throw new OrganizationCreationError(
        "The organisation was created without an owner role.",
      );
    }

    // ACTIVE rather than INVITED: the founder is not being invited, and
    // requiring them to accept their own invitation would be a strange
    // ceremony for the person who just signed up.
    const [membership] = await MembershipModel.create(
      [
        {
          organizationId: organization._id,
          userId: input.ownerId,
          roleId: ownerRole._id,
          // biome-ignore lint/suspicious/noExplicitAny: insertMany's array input widens this
          status: "ACTIVE" as any,
          joinedAt: new Date(),
        } as never,
      ],
      { session },
    );

    if (!membership) {
      throw new OrganizationCreationError(
        "The founder was not added to the organisation.",
      );
    }

    // Point the session at the organisation they just made, so their first
    // request lands somewhere. Same rule as everywhere else: the server
    // decides, never a value from the request.
    if (input.sessionId) {
      // Revoked, expired, and the owning user are all in the filter, not a
      // precondition. A session id arrives in a request body, so it is a bearer
      // value rather than a reference: pointing somebody else's live session at
      // a new organisation would pull that account into the tenant, and pointing
      // a dead one at it would hand a signed-out caller an organisation they
      // never finished creating. Filtering in the update also means none of it
      // can drift away from the write.
      const updated = await SessionModel.updateOne(
        {
          _id: input.sessionId,
          userId: input.ownerId,
          revokedAt: null,
          expiresAt: { $gt: now },
        },
        { $set: { activeOrganizationId: organization._id } },
        { session },
      );
      if (updated.matchedCount === 0) {
        throw new OrganizationCreationError(
          "The session could not be pointed at the new organisation.",
        );
      }
    }

    return { organization, ownerRoleId: ownerRole._id, membership };
  });
}
