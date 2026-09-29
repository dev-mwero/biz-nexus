// Defined in the role model alongside the schema, but part of the role
// service's public contract, so it is re-exported here rather than making
// every caller reach into the organizations module for it.
export {
  SYSTEM_ROLE_KEYS,
  type SystemRoleKey,
} from "@/modules/organizations/role.model";
export * from "./permissions";
export {
  DEFAULT_ROLE_KEY,
  findDefaultRole,
  provisionSystemRoles,
  RoleProvisioningError,
  SYSTEM_ROLE_DESCRIPTIONS,
  SYSTEM_ROLE_NAMES,
  SYSTEM_ROLE_PERMISSIONS,
} from "./role.service";
