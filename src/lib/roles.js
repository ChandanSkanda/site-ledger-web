// Shared role/project definitions used across AuthGate.jsx and App.jsx.

// Roles a person picks for themselves when JOINING an existing project
// with an invite code. "Owner" is deliberately excluded here — nobody can
// grant themselves ownership. Ownership comes from either creating the
// project, or being promoted by an existing owner on the Team tab.
export const SIGNUP_ROLES = [
  { value: "builder_admin", label: "Builder / site admin" },
  { value: "builder", label: "Builder" },
  { value: "civil_engineer", label: "Civil engineer" },
  { value: "carpenter", label: "Carpenter" },
  { value: "electrician", label: "Electrician" },
  { value: "plumber", label: "Plumber" },
  { value: "other", label: "Other" },
];

// Full list including "Owner" — used only on the owner-only Team tab,
// where promoting/demoting someone is a deliberate, gated action.
export const ALL_ROLES = [{ value: "owner", label: "Owner" }, ...SIGNUP_ROLES];

export const ROLE_LABELS = Object.fromEntries(ALL_ROLES.map((r) => [r.value, r.label]));

// What kind of project this is. Short list on purpose — expand later.
export const PROJECT_TYPES = ["House construction", "House purchase", "Land purchase", "Other"];

// Which tabs each role can see. "dashboard", "progress", "gallery", and
// "issues" are available to everyone on a project — the day-to-day,
// non-sensitive screens. Money, permissions, contacts, and documents are
// limited to owner and builder/site admin. Team and Audit Log are handled
// separately in App.jsx (owner-only, always).
const BASE_TABS = ["dashboard", "progress", "gallery", "issues"];
const MANAGEMENT_TABS = ["budget", "permissions", "people", "products", "documents"];

export const ROLE_TAB_ACCESS = {
  owner: [...BASE_TABS, ...MANAGEMENT_TABS],
  builder_admin: [...BASE_TABS, ...MANAGEMENT_TABS],
  builder: [...BASE_TABS, "people", "products"],
  civil_engineer: [...BASE_TABS, "people"],
  carpenter: BASE_TABS,
  electrician: BASE_TABS,
  plumber: BASE_TABS,
  other: BASE_TABS,
};
