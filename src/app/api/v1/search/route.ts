import type { Types } from "mongoose";
import { connectToDatabase } from "@/db/connection";
import {
  CompanyModel,
  ContactModel,
  DealModel,
  TaskModel,
} from "@/modules/crm";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";

/**
 * GET /api/v1/search?q=query
 *
 * Global search across contacts, companies, deals, and tasks.
 * Scoped to the active organization. Returns ranked results (max 20 per collection).
 * Ranking: name 3x, email 2x, notes 1x. Exact > prefix > fuzzy.
 * Requires: search.read
 */
export const GET = withApi(async (request: Request): Promise<Response> => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("search.read");

  await connectToDatabase();

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim();

  if (!q || q.length < 2) {
    throw new AppError("BAD_REQUEST", {
      message: "Search query must be at least 2 characters.",
    });
  }

  if (q.length > 200) {
    throw new AppError("BAD_REQUEST", { message: "Search query too long." });
  }

  const organizationId = context.organization._id;
  const limit = 20;

  // Escape special regex characters for safe text search
  const escapedQuery = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Build text search queries for each collection
  // We'll use $text search with a custom score weighting approach
  const searchPromises = [
    searchContacts(organizationId, escapedQuery, limit),
    searchCompanies(organizationId, escapedQuery, limit),
    searchDeals(organizationId, escapedQuery, limit),
    searchTasks(organizationId, escapedQuery, limit),
  ];

  const [contacts, companies, deals, tasks] = await Promise.all(searchPromises);

  // Merge and rank all results
  const allResults = [
    ...contacts.map((c) => ({ ...c, entityType: "contact" as const })),
    ...companies.map((c) => ({ ...c, entityType: "company" as const })),
    ...deals.map((d) => ({ ...d, entityType: "deal" as const })),
    ...tasks.map((t) => ({ ...t, entityType: "task" as const })),
  ];

  // Sort by score descending
  allResults.sort((a, b) => b.score - a.score);

  // Limit total results
  const results = allResults.slice(0, 50);

  return Response.json({ data: results });
});

interface SearchResult {
  id: string;
  title: string;
  subtitle?: string;
  entityType: "contact" | "company" | "deal" | "task";
  score: number;
  url: string;
  metadata?: Record<string, unknown>;
}

/**
 * The projected fields each search reads.
 *
 * These name exactly what the `.select(...)` above them asks for. `score` is
 * deliberately not among them: it is produced by the text index and arrives as a
 * projection alongside the document, so it is added to each row type at the
 * `.lean()` call rather than being declared as a stored field here.
 */
interface ContactSearchRow {
  _id: Types.ObjectId;
  firstName: string;
  lastName: string;
  primaryEmail?: string | null;
  companyId?: Types.ObjectId | null;
  status?: string | null;
}

interface CompanySearchRow {
  _id: Types.ObjectId;
  name: string;
  email?: string | null;
  industry?: string | null;
  status?: string | null;
}

interface DealSearchRow {
  _id: Types.ObjectId;
  name: string;
  value: number;
  status: string;
  stageId?: Types.ObjectId | null;
  pipelineId?: Types.ObjectId | null;
}

interface TaskSearchRow {
  _id: Types.ObjectId;
  title: string;
  status: string;
  priority: string;
  dueAt?: Date | null;
  assigneeId?: Types.ObjectId | null;
}

async function searchContacts(
  organizationId: Types.ObjectId,
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  // Use text search with projection for score
  const results = await ContactModel.find(
    { organizationId, $text: { $search: query } },
    { score: { $meta: "textScore" } },
  )
    .sort({ score: { $meta: "textScore" } })
    .limit(limit)
    .select("firstName lastName primaryEmail companyId status")
    // `score` is projected by MongoDB's text index rather than stored on the
    // document, so it is not on the model type and has to be named here.
    .lean<Array<ContactSearchRow & { score: number }>>();

  return results.map((c) => ({
    id: c._id.toString(),
    title: `${c.firstName} ${c.lastName}`,
    subtitle: c.primaryEmail ?? "No email",
    entityType: "contact" as const,
    score: c.score,
    url: `/crm/contacts/${c._id}`,
    metadata: { status: c.status, companyId: c.companyId?.toString() },
  }));
}

async function searchCompanies(
  organizationId: Types.ObjectId,
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  const results = await CompanyModel.find(
    { organizationId, $text: { $search: query } },
    { score: { $meta: "textScore" } },
  )
    .sort({ score: { $meta: "textScore" } })
    .limit(limit)
    .select("name email industry status")
    .lean<Array<CompanySearchRow & { score: number }>>();

  return results.map((c) => ({
    id: c._id.toString(),
    title: c.name,
    subtitle: c.email ?? c.industry ?? "No details",
    entityType: "company" as const,
    score: c.score,
    url: `/crm/companies/${c._id}`,
    metadata: { status: c.status, industry: c.industry },
  }));
}

async function searchDeals(
  organizationId: Types.ObjectId,
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  const results = await DealModel.find(
    { organizationId, $text: { $search: query } },
    { score: { $meta: "textScore" } },
  )
    .sort({ score: { $meta: "textScore" } })
    .limit(limit)
    .select("name value status stageId pipelineId")
    .lean<Array<DealSearchRow & { score: number }>>();

  return results.map((d) => ({
    id: d._id.toString(),
    title: d.name,
    subtitle: `${d.status} • ${d.value.toLocaleString()}`,
    entityType: "deal" as const,
    score: d.score,
    url: `/deals/${d._id}`,
    metadata: { value: d.value, status: d.status },
  }));
}

async function searchTasks(
  organizationId: Types.ObjectId,
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  const results = await TaskModel.find(
    { organizationId, $text: { $search: query } },
    { score: { $meta: "textScore" } },
  )
    .sort({ score: { $meta: "textScore" } })
    .limit(limit)
    .select("title status priority dueAt assigneeId")
    .lean<Array<TaskSearchRow & { score: number }>>();

  return results.map((t) => ({
    id: t._id.toString(),
    title: t.title,
    subtitle: `${t.status} • ${t.priority}${t.dueAt ? ` • Due ${t.dueAt.toLocaleDateString()}` : ""}`,
    entityType: "task" as const,
    score: t.score,
    url: `/tasks/${t._id}`,
    metadata: { status: t.status, priority: t.priority, dueAt: t.dueAt },
  }));
}
