/* HotelOps · Year-end e-file
 * =================================================================
 * Generate SSA EFW2 files for W-2 batches and IRS FIRE files for
 * 1099-NEC batches. The user downloads the produced text file and
 * uploads it to the SSA Business Services Online (BSO) portal or
 * the IRS FIRE system. We never transmit on the user's behalf —
 * payroll-tax filing has too many liability questions to do that
 * automatically without a paid filing service.
 *
 * Both formats are fixed-width ASCII; rows are 512 chars (EFW2) or
 * 750 chars (FIRE). All values are right-padded with spaces unless
 * they are numeric (right-justified, zero-filled).
 */

// ============================================================
// SSA EFW2 (W-2)
// Spec: SSA Pub. 42-007 (https://www.ssa.gov/employer/efw/)
// We implement the minimum required record set:
//   RA — Submitter
//   RE — Employer
//   RW — Employee Wage
//   RT — Total
//   RF — Final
// Multi-employer scenarios add another RE/RW group.
// ============================================================

export function generateEFW2({ submitter, employer, w2s, taxYear }) {
  if (!submitter?.ein || !submitter?.name) throw new Error("EFW2: submitter EIN + name required");
  if (!employer?.ein || !employer?.name) throw new Error("EFW2: employer EIN + name required");
  if (!Array.isArray(w2s) || w2s.length === 0) throw new Error("EFW2: at least one W-2 required");
  if (!taxYear) throw new Error("EFW2: taxYear required");

  const records = [];

  // ---- RA: Submitter ----
  records.push(buildRA({ submitter }));

  // ---- RE: Employer ----
  records.push(buildRE({ employer, taxYear }));

  // ---- RW: per-employee ----
  let totals = { wages: 0, fitWh: 0, ssWages: 0, ssTax: 0, medWages: 0, medTax: 0, count: 0 };
  for (const w2 of w2s) {
    records.push(buildRW(w2));
    totals.wages += Number(w2.wages) || 0;
    totals.fitWh += Number(w2.federalIncomeTaxWithheld) || 0;
    totals.ssWages += Number(w2.socialSecurityWages || w2.wages) || 0;
    totals.ssTax += Number(w2.socialSecurityTax) || 0;
    totals.medWages += Number(w2.medicareWages || w2.wages) || 0;
    totals.medTax += Number(w2.medicareTax) || 0;
    totals.count += 1;
  }

  // ---- RT: Totals for this RE ----
  records.push(buildRT(totals));

  // ---- RF: Final ----
  records.push(buildRF({ employeeCount: totals.count }));

  const content = records.map(r => pad(r, 512, " ", "right").slice(0, 512)).join("\n") + "\n";
  return {
    content,
    filename: `W2_EFW2_${taxYear}_${stripNonAlnum(employer.name).slice(0, 12)}.txt`,
    summary: { ...totals, taxYear, employer: employer.name },
  };
}

function buildRA({ submitter }) {
  return "RA" +
    pad(stripNonDigits(submitter.ein), 9, "0", "left") +              // 3-11 EIN
    pad("", 5, " ", "right") +                                          // 12-16 user ID (PIN), often blank for first submission
    pad("", 9, " ", "right") +                                          // 17-25 software vendor code (blank ok)
    pad("", 1, " ", "right") +                                          // 26 resub indicator
    pad("", 6, " ", "right") +                                          // 27-32 resub WFID
    pad("", 1, " ", "right") +                                          // 33 software code (blank)
    pad(submitter.name, 57, " ", "right") +                             // 34-90 submitter name
    pad(submitter.address || "", 22, " ", "right") +                    // 91-112 location address
    pad(submitter.deliveryAddr || "", 22, " ", "right") +               // 113-134 delivery address
    pad(submitter.city || "", 22, " ", "right") +                       // 135-156
    pad(submitter.state || "", 2, " ", "right") +                       // 157-158
    pad(submitter.zip || "", 5, " ", "right") +                         // 159-163
    pad(submitter.zip4 || "", 4, " ", "right") +                        // 164-167
    pad("", 5, " ", "right") +                                          // 168-172 blank
    pad("", 23, " ", "right") +                                         // 173-195 foreign state/province
    pad("", 15, " ", "right") +                                         // 196-210 foreign postal
    pad("", 2, " ", "right") +                                          // 211-212 country code
    pad("", 57, " ", "right") +                                         // 213-269 contact name
    pad("", 15, " ", "right") +                                         // 270-284 phone
    pad("", 5, " ", "right") +                                          // 285-289 ext
    pad("", 40, " ", "right") +                                         // 290-329 email
    pad("", 10, " ", "right") +                                         // 330-339 fax
    pad("", 1, " ", "right") +                                          // 340 method of notification
    pad("", 1, " ", "right") +                                          // 341 preparer code
    pad("", 171, " ", "right");                                         // 342-512 blank
}

function buildRE({ employer, taxYear }) {
  return "RE" +
    pad(taxYear, 4, "0", "left") +                                      // 3-6 tax year
    pad("", 1, " ", "right") +                                          // 7 agent indicator
    pad(stripNonDigits(employer.ein), 9, "0", "left") +                 // 8-16 EIN
    pad("", 9, " ", "right") +                                          // 17-25 agent EIN
    pad("", 1, " ", "right") +                                          // 26 terminating business indicator
    pad("", 4, " ", "right") +                                          // 27-30 establishment number
    pad("", 9, " ", "right") +                                          // 31-39 other EIN
    pad(employer.name, 57, " ", "right") +                              // 40-96
    pad(employer.address || "", 22, " ", "right") +
    pad(employer.deliveryAddr || "", 22, " ", "right") +
    pad(employer.city || "", 22, " ", "right") +
    pad(employer.state || "", 2, " ", "right") +
    pad(employer.zip || "", 5, " ", "right") +
    pad(employer.zip4 || "", 4, " ", "right") +
    pad("", 5, " ", "right") +
    pad("", 23, " ", "right") +
    pad("", 15, " ", "right") +
    pad("", 2, " ", "right") +
    pad(employer.kindOfEmployer || "R", 1, " ", "right") +              // R=Regular S=State T=501c
    pad("", 1, " ", "right") +                                          // ESIN indicator
    pad("", 9, " ", "right") +                                          // Other EIN
    pad("", 6, " ", "right") +
    pad("", 1, " ", "right") +                                          // 3rd party sick pay indicator
    pad("", 282, " ", "right");
}

function buildRW(w2) {
  return "RW" +
    pad(stripNonDigits(w2.ssn), 9, "0", "left") +                       // SSN
    pad(w2.firstName || "", 15, " ", "right") +
    pad(w2.middleName || "", 15, " ", "right") +
    pad(w2.lastName || "", 20, " ", "right") +
    pad(w2.suffix || "", 4, " ", "right") +
    pad(w2.address || "", 22, " ", "right") +
    pad(w2.deliveryAddr || "", 22, " ", "right") +
    pad(w2.city || "", 22, " ", "right") +
    pad(w2.state || "", 2, " ", "right") +
    pad(w2.zip || "", 5, " ", "right") +
    pad(w2.zip4 || "", 4, " ", "right") +
    pad("", 5, " ", "right") +
    pad("", 23, " ", "right") +
    pad("", 15, " ", "right") +
    pad("", 2, " ", "right") +
    money(w2.wages) +                                                    // box 1
    money(w2.federalIncomeTaxWithheld) +                                 // box 2
    money(w2.socialSecurityWages) +                                      // box 3
    money(w2.socialSecurityTax) +                                        // box 4
    money(w2.medicareWages) +                                            // box 5
    money(w2.medicareTax) +                                              // box 6
    money(w2.socialSecurityTips) +                                       // box 7
    money(w2.allocatedTips) +                                            // box 8
    money(0) +                                                            // (deprecated)
    money(w2.dependentCare) +                                            // box 10
    money(w2.nonqualifiedPlans) +                                        // box 11
    money(w2.deferred401k) +                                             // 12 codes summed
    money(w2.deferred403b) +
    money(w2.deferred408k) +
    money(w2.deferred457b) +
    money(w2.deferred501c18) +
    money(w2.militaryEmpBasicQtrs) +
    money(0) +
    money(0) +
    money(w2.nontaxableCombatPay) +
    money(0) +
    pad("0", 1, "0", "left") +                                          // statutory employee
    pad("0", 1, "0", "left") +                                          // retirement plan
    pad("0", 1, "0", "left") +                                          // 3rd party sick pay
    pad("", 175, " ", "right");
}

function buildRT({ wages, fitWh, ssWages, ssTax, medWages, medTax, count }) {
  return "RT" +
    pad(count, 7, "0", "left") +
    money(wages) +
    money(fitWh) +
    money(ssWages) +
    money(ssTax) +
    money(medWages) +
    money(medTax) +
    money(0) + money(0) + money(0) +
    money(0) + money(0) + money(0) + money(0) + money(0) + money(0) +
    money(0) + money(0) + money(0) + money(0) + money(0) + money(0) +
    pad("", 281, " ", "right");
}

function buildRF({ employeeCount }) {
  return "RF" +
    pad("", 7, " ", "right") +
    pad(employeeCount, 9, "0", "left") +
    pad("", 494, " ", "right");
}

// ============================================================
// IRS FIRE — 1099-NEC (Nonemployee Compensation)
// Spec: IRS Pub. 1220
// Records: T (transmitter), A (payer), B (payee, one per 1099),
//          C (end of payer summary), F (end of file)
// 750-char fixed-width.
// ============================================================

export function generate1099NECFire({ transmitter, payer, payees, taxYear }) {
  if (!transmitter?.tin || !transmitter?.name) throw new Error("FIRE: transmitter TIN + name required");
  if (!payer?.tin || !payer?.name) throw new Error("FIRE: payer TIN + name required");
  if (!Array.isArray(payees) || payees.length === 0) throw new Error("FIRE: at least one payee required");
  if (!taxYear) throw new Error("FIRE: taxYear required");

  const records = [];
  records.push(fireT({ transmitter, taxYear }));
  records.push(fireA({ payer, taxYear }));

  let total = 0;
  payees.forEach((p, i) => {
    records.push(fireB({ payee: p, taxYear, sequenceNumber: i + 1 }));
    total += Number(p.nonemployeeCompensation) || 0;
  });

  records.push(fireC({ payeeCount: payees.length, total }));
  records.push(fireF());

  const content = records.map(r => pad(r, 750, " ", "right").slice(0, 750)).join("\n") + "\n";
  return {
    content,
    filename: `1099NEC_FIRE_${taxYear}_${stripNonAlnum(payer.name).slice(0, 12)}.txt`,
    summary: { taxYear, payer: payer.name, payeeCount: payees.length, total },
  };
}

function fireT({ transmitter, taxYear }) {
  return "T" +
    pad(taxYear, 4, "0", "left") +
    pad(transmitter.priorYear ? "P" : " ", 1, " ", "right") +
    pad(stripNonDigits(transmitter.tin), 9, "0", "left") +
    pad(transmitter.tcc || "", 5, " ", "right") +                       // 5-char Transmitter Control Code from IRS
    pad("", 7, " ", "right") +
    pad(transmitter.testFile ? "T" : " ", 1, " ", "right") +
    pad("", 1, " ", "right") +
    pad("", 1, " ", "right") +                                          // foreign entity
    pad(transmitter.name, 80, " ", "right") +
    pad(transmitter.contactName || transmitter.name, 40, " ", "right") +
    pad(transmitter.address || "", 40, " ", "right") +
    pad(transmitter.city || "", 40, " ", "right") +
    pad(transmitter.state || "", 2, " ", "right") +
    pad(stripNonDigits(transmitter.zip || ""), 9, "0", "left") +
    pad(transmitter.contactPhone || "", 15, " ", "right") +
    pad(transmitter.contactEmail || "", 50, " ", "right") +
    pad("", 91, " ", "right") +
    pad("00000001", 8, "0", "left") +                                   // sequence
    pad("", 10, " ", "right") +
    pad("I", 1, " ", "right") +                                          // vendor indicator
    pad("", 230, " ", "right") +
    pad("", 105, " ", "right");
}

function fireA({ payer, taxYear }) {
  return "A" +
    pad(taxYear, 4, "0", "left") +
    pad(" ", 1, " ", "right") +
    pad("", 5, " ", "right") +
    pad(stripNonDigits(payer.tin), 9, "0", "left") +
    pad(payer.payerNameControl || "", 4, " ", "right") +
    pad(payer.lastFiling ? "1" : " ", 1, " ", "right") +
    pad("NE", 2, " ", "right") +                                         // Type of return = NEC
    pad("1", 1, " ", "right") +                                          // Box 1 amount indicator (NEC)
    pad("", 8, " ", "right") +
    pad(" ", 1, " ", "right") +                                          // foreign indicator
    pad(payer.name, 80, " ", "right") +
    pad(payer.shippingAddress || payer.address || "", 40, " ", "right") +
    pad("", 40, " ", "right") +
    pad(payer.address || "", 40, " ", "right") +
    pad(payer.city || "", 40, " ", "right") +
    pad(payer.state || "", 2, " ", "right") +
    pad(stripNonDigits(payer.zip || ""), 9, "0", "left") +
    pad(payer.phone || "", 15, " ", "right") +
    pad("", 260, " ", "right") +
    pad("00000002", 8, "0", "left") +
    pad("", 196, " ", "right");
}

function fireB({ payee, taxYear, sequenceNumber }) {
  const amount1 = padAmount(payee.nonemployeeCompensation, 12);          // box 1 - NEC
  const amount4 = padAmount(payee.federalIncomeTaxWithheld, 12);         // box 4
  const zeroAmt = pad("0", 12, "0", "left");
  return "B" +
    pad(taxYear, 4, "0", "left") +
    pad(" ", 1, " ", "right") +                                          // corrected indicator
    pad(payee.nameControl || "", 4, " ", "right") +
    pad("2", 1, " ", "right") +                                          // type of TIN = 2 (SSN) or 1 (EIN)
    pad(stripNonDigits(payee.tin), 9, "0", "left") +
    pad(payee.accountNumber || "", 20, " ", "right") +
    pad("", 4, " ", "right") +
    pad("", 8, " ", "right") +
    pad("", 1, " ", "right") +
    amount1 +                                                             // box 1
    zeroAmt + zeroAmt + zeroAmt + amount4 +                              // 2,3 unused; 4
    zeroAmt + zeroAmt + zeroAmt + zeroAmt + zeroAmt +
    zeroAmt + zeroAmt + zeroAmt + zeroAmt + zeroAmt +
    pad(" ", 1, " ", "right") +                                          // foreign country
    pad(payee.name, 40, " ", "right") +
    pad("", 40, " ", "right") +
    pad(payee.address || "", 40, " ", "right") +
    pad("", 40, " ", "right") +
    pad(payee.city || "", 40, " ", "right") +
    pad(payee.state || "", 2, " ", "right") +
    pad(stripNonDigits(payee.zip || ""), 9, "0", "left") +
    pad("", 1, " ", "right") +
    pad(String(sequenceNumber).padStart(8, "0"), 8, "0", "left") +
    pad("", 36, " ", "right") +
    pad("", 207, " ", "right");
}

function fireC({ payeeCount, total }) {
  return "C" +
    pad(payeeCount, 8, "0", "left") +
    pad("", 6, " ", "right") +
    padAmount(total, 18) +                                                // box 1 control total
    pad("0", 18, "0", "left").repeat(8) +                                 // remaining controls
    pad("0", 18, "0", "left").repeat(7) +
    pad("", 196, " ", "right") +
    pad("00000003", 8, "0", "left") +
    pad("", 241, " ", "right");
}

function fireF() {
  return "F" +
    pad(1, 8, "0", "left") +
    pad("0", 21, "0", "left") +
    pad("", 469, " ", "right") +
    pad("00000004", 8, "0", "left") +
    pad("", 243, " ", "right");
}

// ---------------- helpers ----------------
function pad(val, width, char, side) {
  let s = String(val ?? "");
  if (s.length >= width) return s.slice(0, width);
  const fill = char.repeat(width - s.length);
  return side === "left" ? fill + s : s + fill;
}
function money(amount) {
  // EFW2 money: 11 digits, no decimal, dollars-and-cents (so $123.45 → "00000012345")
  const cents = Math.round((Number(amount) || 0) * 100);
  return pad(Math.max(0, cents), 11, "0", "left");
}
function padAmount(amount, width) {
  // FIRE money: width digits, dollars-and-cents
  const cents = Math.round((Number(amount) || 0) * 100);
  return pad(Math.max(0, cents), width, "0", "left");
}
function stripNonDigits(s) { return String(s || "").replace(/\D/g, ""); }
function stripNonAlnum(s) { return String(s || "").replace(/[^A-Za-z0-9]/g, ""); }
