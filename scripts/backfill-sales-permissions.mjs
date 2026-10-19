#!/usr/bin/env node
/**
 * One-off Stage 2 permission backfill.
 *
 * Why this exists: permissions are code and roles are per-organisation data
 * (ADR-0004). Adding sales codes to `SYSTEM_ROLE_PERMISSIONS` changes what a
 * *new* organisation receives; it does not rewrite the four role documents an
 * existing organisation already has. Until this script runs, an existing
 * MEMBER cannot create a quotation even though the deployed code says the role
 * should be able to.
 *
 * The lists below are deliberately hardcoded. This is a migration, not a
 * second source of truth: it must keep describing Stage 2 after the catalogue
 * moves on. `tests/unit/rbac/backfill-sales-permissions.test.ts` asserts the
 * lists match the catalogue's sales domains today, so they cannot silently
 * diverge while Stage 2 is the current shape.
 *
 * Properties the script guarantees:
 *   - additive: unions with whatever the role holds, never removes a code;
 *   - idempotent: a second run writes nothing;
 *   - system roles only: a custom role is the tenant's decision;
 *   - writes only `permissions`: no other field is loaded or rewritten;
 *   - exits non-zero on failure, so a deploy pipeline stops.
 *
 * Run order is deploy code -> run this -> announce Stage 2. The UI hides the
 * sales navigation until the session's permissions include the reads.
 */

import { pathToFileURL } from "node:url";
import mongoose from "mongoose";

export const STAGE2_SALES_PERMISSIONS = Object.freeze({
  VIEWER: Object.freeze([
    "products.read",
    "quotations.read",
    "salesOrders.read",
  ]),
  MEMBER: Object.freeze([
    "products.read",
    "quotations.read",
    "quotations.create",
    "quotations.update",
    "quotations.delete",
    "quotations.send",
    "quotations.accept",
    "quotations.convert",
    "salesOrders.read",
    "salesOrders.update",
  ]),
  ADMIN: Object.freeze([
    "products.read",
    "products.create",
    "products.update",
    "products.delete",
    "quotations.read",
    "quotations.create",
    "quotations.update",
    "quotations.delete",
    "quotations.send",
    "quotations.accept",
    "quotations.convert",
    "salesOrders.read",
    "salesOrders.update",
  ]),
  OWNER: Object.freeze([
    "products.read",
    "products.create",
    "products.update",
    "products.delete",
    "quotations.read",
    "quotations.create",
    "quotations.update",
    "quotations.delete",
    "quotations.send",
    "quotations.accept",
    "quotations.convert",
    "salesOrders.read",
    "salesOrders.update",
  ]),
});

export const SYSTEM_ROLE_KEYS = Object.freeze([
  "OWNER",
  "ADMIN",
  "MEMBER",
  "VIEWER",
]);

/**
 * Union, preserving order and keeping anything the role already had.
 *
 * Not a filter. A role may hold a custom or older code that the current
 * catalogue does not know; removing it would be a destructive migration with
 * no rollback, and a stale code grants nothing.
 */
/**
 * @param {readonly string[] | null | undefined} current
 * @param {readonly string[]} additions
 * @returns {string[]}
 */
export function mergePermissions(current, additions) {
  const existing = Array.isArray(current) ? current : [];
  return [...new Set([...existing, ...additions])];
}

function roleAdditions(key) {
  const additions = STAGE2_SALES_PERMISSIONS[key];
  if (!additions) {
    throw new Error(`No Stage 2 permissions are defined for role "${key}".`);
  }
  return additions;
}

/**
 * Run the migration. Returns per-role counts and never prints a secret.
 *
 * @param {object} [options]
 * @param {string} [options.uri] MongoDB connection string; defaults to MONGODB_URI.
 * @param {{ info?: (...args: unknown[]) => void }} [options.log]
 * @param {import("mongoose").Mongoose | null} [options.connection] An existing
 *   connection, used by the integration test so it does not open a second one.
 *
 * The collection handle is used directly because this is a `.mjs` script and
 * cannot import the TypeScript `RoleModel`. That is also why the update is
 * `$set: { permissions }` and nothing else: no schema middleware, no audit
 * stamps, no timestamp rewrite — the role documents describe access, not a
 * business record whose history this migration is entitled to change.
 */
export async function backfillSalesPermissions({
  uri = process.env.MONGODB_URI,
  log = console,
  connection = null,
} = {}) {
  if (!connection && !uri) {
    throw new Error(
      "MONGODB_URI is required (or pass an existing connection for tests).",
    );
  }

  const ownedConnection = !connection;
  const client = connection ?? (await mongoose.connect(uri));

  try {
    const roles = client.connection.collection("roles");
    const summary = [];

    for (const key of SYSTEM_ROLE_KEYS) {
      const additions = roleAdditions(key);
      let scanned = 0;
      let updated = 0;

      const cursor = roles.find({
        key,
        isSystem: true,
        deletedAt: null,
      });

      for await (const role of cursor) {
        scanned += 1;
        const merged = mergePermissions(role.permissions, additions);

        if (merged.length !== (role.permissions?.length ?? 0)) {
          await roles.updateOne(
            { _id: role._id },
            { $set: { permissions: merged } },
          );
          updated += 1;
        }
      }

      summary.push({ key, scanned, updated });
      log.info?.(
        `[backfill-sales-permissions] ${key}: scanned ${scanned}, updated ${updated}`,
      );
    }

    return summary;
  } finally {
    if (ownedConnection) {
      await mongoose.disconnect();
    }
  }
}

function isMainModule() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

if (isMainModule()) {
  backfillSalesPermissions()
    .then((summary) => {
      const total = summary.reduce((sum, row) => sum + row.updated, 0);
      console.info(
        `[backfill-sales-permissions] complete: ${total} role(s) updated.`,
      );
    })
    .catch((error) => {
      console.error("[backfill-sales-permissions] failed:", error);
      process.exitCode = 1;
    });
}
