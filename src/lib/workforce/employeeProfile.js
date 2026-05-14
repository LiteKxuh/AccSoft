/* HotelOps · Workforce — extended employee profile
 * =================================================================
 * Augments the existing employee model with workforce-specific fields
 * a real hospitality operator needs but the v1.x roster didn't carry:
 *
 *   - payClass: hourly | salaried | tipped | contractor | banquet
 *   - status: active | on-leave | terminated
 *   - hireDate, terminationDate
 *   - propertyAccess (multi-property)
 *   - homeDepartment, allowedDepartments (for department transfers)
 *   - jobCodes (array of job-code IDs they can work)
 *   - tippedRate / cashTipsTracked
 *   - overtimeEligible
 *   - certifications (e.g. food handler, CPR)
 *   - emergencyContact
 *   - i9Verified, w4OnFile
 *
 * Pure functions: validate/extend the input employee object without
 * mutating the original.
 *
 *   normalizeEmployee(emp) → extended employee
 *   isActive(emp, asOf?) → boolean
 *   canWorkJob(emp, jobCodeId) → boolean
 *   canWorkDepartment(emp, deptId) → boolean
 *   validateForPayroll(emp) → { ok, issues[] }
 */

export const PAY_CLASSES = ["hourly", "salaried", "tipped", "contractor", "banquet"];

const REQUIRED_PAYROLL_FIELDS = {
  hourly:     ["hourlyRate", "homeDepartment", "i9Verified", "w4OnFile"],
  salaried:   ["salary", "homeDepartment", "i9Verified", "w4OnFile"],
  tipped:     ["hourlyRate", "homeDepartment", "tippedRate", "i9Verified", "w4OnFile"],
  contractor: ["taxId"],
  banquet:    ["banquetRate", "homeDepartment", "i9Verified", "w4OnFile"],
};

export function normalizeEmployee(emp) {
  if (!emp || !emp.id) throw new Error("normalizeEmployee: id required");
  const payClass = emp.payClass || (emp.salary ? "salaried" : "hourly");
  if (!PAY_CLASSES.includes(payClass)) {
    throw new Error(`normalizeEmployee: unknown payClass "${payClass}"`);
  }
  return {
    id: emp.id,
    name: emp.name || emp.fullName || `${emp.firstName || ""} ${emp.lastName || ""}`.trim() || emp.id,
    title: emp.title || emp.role || "",
    payClass,
    status: emp.status || (emp.terminationDate ? "terminated" : "active"),
    hireDate: emp.hireDate || emp.createdAt?.slice(0, 10) || null,
    terminationDate: emp.terminationDate || null,
    propertyAccess: emp.propertyAccess || (emp.propertyId ? [emp.propertyId] : []),
    homeDepartment: emp.homeDepartment || emp.department || null,
    allowedDepartments: emp.allowedDepartments || (emp.homeDepartment ? [emp.homeDepartment] : (emp.department ? [emp.department] : [])),
    jobCodes: emp.jobCodes || [],
    hourlyRate: emp.hourlyRate != null ? Number(emp.hourlyRate) : null,
    salary: emp.salary != null ? Number(emp.salary) : null,
    tippedRate: emp.tippedRate != null ? Number(emp.tippedRate) : null,
    banquetRate: emp.banquetRate != null ? Number(emp.banquetRate) : null,
    overtimeEligible: emp.overtimeEligible !== false && payClass !== "salaried" && payClass !== "contractor",
    cashTipsTracked: emp.cashTipsTracked === true || payClass === "tipped",
    taxId: emp.taxId || null,
    i9Verified: emp.i9Verified === true,
    w4OnFile: emp.w4OnFile === true,
    certifications: emp.certifications || [],
    emergencyContact: emp.emergencyContact || null,
    payGroupId: emp.payGroupId || null,
    managerId: emp.managerId || null,
    // Preserve any legacy fields verbatim
    _legacy: { role: emp.role, department: emp.department, propertyId: emp.propertyId },
  };
}

export function isActive(emp, asOf = null) {
  if (!emp) return false;
  if (emp.status && emp.status !== "active") return false;
  const date = asOf ? new Date(asOf) : new Date();
  if (emp.hireDate && new Date(emp.hireDate) > date) return false;
  if (emp.terminationDate && new Date(emp.terminationDate) < date) return false;
  return true;
}

export function canWorkJob(emp, jobCodeId) {
  if (!emp || !jobCodeId) return false;
  if (!emp.jobCodes || emp.jobCodes.length === 0) return true; // unrestricted
  return emp.jobCodes.includes(jobCodeId);
}

export function canWorkDepartment(emp, deptId) {
  if (!emp || !deptId) return false;
  if (emp.allowedDepartments?.length) return emp.allowedDepartments.includes(deptId);
  return emp.homeDepartment === deptId;
}

export function validateForPayroll(emp) {
  const issues = [];
  if (!emp) return { ok: false, issues: ["employee record missing"] };
  if (!emp.status || emp.status === "terminated") {
    issues.push(`Employee status: ${emp.status || "unknown"}`);
  }
  const required = REQUIRED_PAYROLL_FIELDS[emp.payClass] || [];
  for (const f of required) {
    if (emp[f] == null || emp[f] === "" || emp[f] === false) {
      issues.push(`Missing ${f}`);
    }
  }
  if (emp.payClass === "hourly" && !(emp.hourlyRate > 0)) {
    issues.push("hourlyRate must be > 0");
  }
  if (emp.payClass === "salaried" && !(emp.salary > 0)) {
    issues.push("salary must be > 0");
  }
  if (emp.payClass === "tipped" && !(emp.tippedRate > 0)) {
    issues.push("tippedRate must be > 0");
  }
  return { ok: issues.length === 0, issues };
}

export function classifyDepartmentByTitle(title) {
  const t = String(title || "").toLowerCase();
  if (/housekeep|room attend|laundry|public area/.test(t)) return "Housekeeping";
  if (/front desk|guest service|night audit|reservation|concierge|bell|valet/.test(t)) return "Front Office";
  if (/restaurant|kitchen|server|host|bartender|cook|chef|barback/.test(t)) return "F&B";
  if (/banquet|catering|event/.test(t)) return "Banquets";
  if (/maintenance|engineer|facilities|groundskeep/.test(t)) return "Maintenance";
  if (/sales|marketing|revenue/.test(t)) return "Sales & Marketing";
  if (/accounting|controller|hr|admin|general manager|gm/.test(t)) return "A&G";
  return "Other";
}
