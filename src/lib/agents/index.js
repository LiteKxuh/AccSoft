/* HotelOps · Agent registry */

import { NIGHT_AUDIT_AGENT } from "./nightAuditAgent.js";
import { REVENUE_AGENT } from "./revenueAgent.js";
import { LABOR_AGENT } from "./laborAgent.js";
import { AP_REVIEW_AGENT } from "./apReviewAgent.js";
import { CONTROLLER_AGENT } from "./controllerAgent.js";
import { GM_BRIEFING_AGENT } from "./gmBriefingAgent.js";
import { SCHEDULING_AGENT } from "./schedulingAgent.js";
import { PAYROLL_AUDIT_AGENT } from "./payrollAuditAgent.js";
import { OVERTIME_PREVENTION_AGENT } from "./overtimePreventionAgent.js";
import { HOUSEKEEPING_AGENT } from "./housekeepingProductivityAgent.js";
import { GM_LABOR_BRIEFING_AGENT } from "./gmLaborBriefingAgent.js";

export const AGENTS = [
  GM_BRIEFING_AGENT,
  GM_LABOR_BRIEFING_AGENT,
  NIGHT_AUDIT_AGENT,
  REVENUE_AGENT,
  LABOR_AGENT,
  SCHEDULING_AGENT,
  OVERTIME_PREVENTION_AGENT,
  HOUSEKEEPING_AGENT,
  AP_REVIEW_AGENT,
  PAYROLL_AUDIT_AGENT,
  CONTROLLER_AGENT,
];

export function agentById(id) {
  return AGENTS.find(a => a.id === id) || null;
}

export { runAgent, isLlmAvailable } from "./agentRuntime.js";
