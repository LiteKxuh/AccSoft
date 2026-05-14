/* HotelOps · Workforce — job codes & pay classes
 * =================================================================
 * Standard hotel labor codes. Real hospitality companies map every
 * shift to a job code so labor allocation rolls up to the right
 * department in the P&L.
 *
 * Each job code has:
 *   - id, label, departmentId
 *   - tier: "operations" | "supervisory" | "management"
 *   - defaultRate (optional baseline; employee.hourlyRate wins)
 *   - tippedEligible: boolean
 *   - banquetEligible: boolean
 *   - glDepartment: maps to chart-of-accounts department prefix
 */

export const STANDARD_JOB_CODES = [
  // Rooms
  { id: "room_attendant",   label: "Room Attendant",       departmentId: "housekeeping", tier: "operations",  glDepartment: "rooms-expense" },
  { id: "housekeeping_sup", label: "Housekeeping Supervisor", departmentId: "housekeeping", tier: "supervisory", glDepartment: "rooms-expense" },
  { id: "laundry_attendant", label: "Laundry Attendant",   departmentId: "housekeeping", tier: "operations",  glDepartment: "rooms-expense" },
  { id: "front_desk_agent", label: "Front Desk Agent",     departmentId: "front_office", tier: "operations",  glDepartment: "rooms-expense" },
  { id: "night_auditor",    label: "Night Auditor",        departmentId: "front_office", tier: "operations",  glDepartment: "rooms-expense" },
  { id: "guest_services_sup", label: "Guest Services Supervisor", departmentId: "front_office", tier: "supervisory", glDepartment: "rooms-expense" },
  { id: "bellperson",       label: "Bellperson",           departmentId: "front_office", tier: "operations",  tippedEligible: true, glDepartment: "rooms-expense" },
  { id: "valet",            label: "Valet",                departmentId: "front_office", tier: "operations",  tippedEligible: true, glDepartment: "rooms-expense" },

  // F&B
  { id: "server",           label: "Server",               departmentId: "restaurant",   tier: "operations",  tippedEligible: true, glDepartment: "fb-expense" },
  { id: "bartender",        label: "Bartender",            departmentId: "restaurant",   tier: "operations",  tippedEligible: true, glDepartment: "fb-expense" },
  { id: "host",             label: "Host",                 departmentId: "restaurant",   tier: "operations",  glDepartment: "fb-expense" },
  { id: "cook",             label: "Cook",                 departmentId: "restaurant",   tier: "operations",  glDepartment: "fb-expense" },
  { id: "dishwasher",       label: "Dishwasher",           departmentId: "restaurant",   tier: "operations",  glDepartment: "fb-expense" },
  { id: "restaurant_mgr",   label: "Restaurant Manager",   departmentId: "restaurant",   tier: "management",  glDepartment: "fb-expense" },

  // Banquets
  { id: "banquet_server",   label: "Banquet Server",       departmentId: "banquets",     tier: "operations",  banquetEligible: true, glDepartment: "fb-expense" },
  { id: "banquet_captain",  label: "Banquet Captain",      departmentId: "banquets",     tier: "supervisory", banquetEligible: true, glDepartment: "fb-expense" },
  { id: "banquet_setup",    label: "Banquet Setup",        departmentId: "banquets",     tier: "operations",  banquetEligible: true, glDepartment: "fb-expense" },

  // Maintenance
  { id: "engineer",         label: "Engineer",             departmentId: "maintenance",  tier: "operations",  glDepartment: "fixed-expense" },
  { id: "maintenance_lead", label: "Maintenance Lead",     departmentId: "maintenance",  tier: "supervisory", glDepartment: "fixed-expense" },

  // Sales & A&G
  { id: "sales_manager",    label: "Sales Manager",        departmentId: "sales",        tier: "management",  glDepartment: "ag-expense" },
  { id: "accounting_clerk", label: "Accounting Clerk",     departmentId: "accounting",   tier: "operations",  glDepartment: "ag-expense" },
  { id: "controller",       label: "Controller",           departmentId: "accounting",   tier: "management",  glDepartment: "ag-expense" },
  { id: "gm",               label: "General Manager",      departmentId: "executive",    tier: "management",  glDepartment: "ag-expense" },
];

const BY_ID = new Map(STANDARD_JOB_CODES.map(j => [j.id, j]));

export function getJobCode(id) {
  return BY_ID.get(id) || null;
}

export function jobCodesByDepartment(deptId) {
  return STANDARD_JOB_CODES.filter(j => j.departmentId === deptId);
}

export function jobCodesByGlDepartment(glDept) {
  return STANDARD_JOB_CODES.filter(j => j.glDepartment === glDept);
}

/** Allocation map: how should a shift's cost flow into the P&L? */
export function glAllocationFor(jobCodeId) {
  const j = getJobCode(jobCodeId);
  return j?.glDepartment || "ag-expense";
}

export const DEPARTMENTS = [
  { id: "housekeeping",  label: "Housekeeping",   glDepartment: "rooms-expense" },
  { id: "front_office",  label: "Front Office",   glDepartment: "rooms-expense" },
  { id: "restaurant",    label: "Restaurant",     glDepartment: "fb-expense" },
  { id: "banquets",      label: "Banquets",       glDepartment: "fb-expense" },
  { id: "maintenance",   label: "Maintenance",    glDepartment: "fixed-expense" },
  { id: "sales",         label: "Sales & Mktg",   glDepartment: "ag-expense" },
  { id: "accounting",    label: "Accounting",     glDepartment: "ag-expense" },
  { id: "executive",     label: "Executive",      glDepartment: "ag-expense" },
];
