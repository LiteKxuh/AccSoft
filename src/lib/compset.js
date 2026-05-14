/* HotelOps · Comp-set / STR-style index framework
 * =================================================================
 * STR-style indices compare a property's performance to its
 * competitive set:
 *
 *   OCC index    = (property occupancy)  / (compset occupancy)  × 100
 *   ADR index    = (property ADR)        / (compset ADR)        × 100
 *   RevPAR index = (property RevPAR)     / (compset RevPAR)     × 100
 *
 * A value above 100 means the property is outperforming its set.
 *
 * Realism guardrails: tertiary-market hotels DO NOT magically
 * outperform luxury urban assets. The framework refuses to compute
 * indices when the comp-set's price tier is grossly mismatched with
 * the property's tier — that's a data error, not a market story.
 *
 * Inputs come from compsetSnapshots in state:
 *   { date, propertyId, compsetId, compsetOcc, compsetAdr, compsetRevpar, source }
 */

const TIER_BANDS = {
  economy:       { adrMin: 0,   adrMax: 100 },
  midscale:      { adrMin: 70,  adrMax: 160 },
  upscale:       { adrMin: 110, adrMax: 220 },
  "upper-upscale": { adrMin: 170, adrMax: 320 },
  luxury:        { adrMin: 250, adrMax: Infinity },
};

function classify(adr) {
  if (adr >= 250) return "luxury";
  if (adr >= 170) return "upper-upscale";
  if (adr >= 110) return "upscale";
  if (adr >= 70)  return "midscale";
  return "economy";
}

function within(value, band) {
  return value >= band.adrMin * 0.7 && value <= band.adrMax * 1.3;
}

function safe(n) { const v = Number(n); return Number.isFinite(v) ? v : 0; }

/**
 * @param {object} input
 * @param {Array}  input.snapshots  comp-set snapshots
 * @param {Array}  input.reports    property reports
 * @param {string} input.propertyId
 * @param {string} input.start
 * @param {string} input.end
 */
export function computeCompsetIndices({ snapshots, reports, propertyId, start, end }) {
  const own = (reports || []).filter(r => r.propertyId === propertyId && r.date >= start && r.date <= end);
  const snap = (snapshots || []).filter(s => s.propertyId === propertyId && s.date >= start && s.date <= end);
  if (!snap.length) return { status: "no-compset", message: "No comp-set snapshots loaded for the period." };
  if (!own.length)  return { status: "no-reports", message: "No property reports in the period." };

  // Median property ADR over the window
  const propAdrs = own.map(r => safe(r.adr)).filter(v => v > 0).sort((a, b) => a - b);
  const medianPropAdr = propAdrs.length ? propAdrs[Math.floor(propAdrs.length / 2)] : 0;
  const propTier = classify(medianPropAdr);

  // Median compset ADR
  const compAdrs = snap.map(s => safe(s.compsetAdr)).filter(v => v > 0).sort((a, b) => a - b);
  const medianCompAdr = compAdrs.length ? compAdrs[Math.floor(compAdrs.length / 2)] : 0;
  const compTier = classify(medianCompAdr);

  // Realism check: if the comp-set tier is wildly different from the property tier, refuse
  if (medianPropAdr > 0 && medianCompAdr > 0) {
    const ratio = medianCompAdr / medianPropAdr;
    if (ratio < 0.5 || ratio > 2.0) {
      return {
        status: "tier-mismatch",
        message: `Comp-set ADR ${medianCompAdr.toFixed(0)} (${compTier}) and property ADR ${medianPropAdr.toFixed(0)} (${propTier}) differ by ${ratio < 1 ? `${(1/ratio).toFixed(1)}×` : `${ratio.toFixed(1)}×`}. The comp-set is mis-matched to this property's market class.`,
        medianPropAdr, medianCompAdr, propTier, compTier,
      };
    }
  }

  // Pair daily reports with same-date compset snapshots
  const snapByDate = new Map(snap.map(s => [s.date, s]));
  const lines = [];
  let propOccSum = 0, compOccSum = 0;
  let propAdrSum = 0, compAdrSum = 0;
  let propRevparSum = 0, compRevparSum = 0;
  let n = 0;
  for (const r of own) {
    const s = snapByDate.get(r.date);
    if (!s) continue;
    const pOcc = safe(r.occupancy), pAdr = safe(r.adr), pRev = safe(r.revpar);
    const cOcc = safe(s.compsetOcc), cAdr = safe(s.compsetAdr), cRev = safe(s.compsetRevpar);
    if (cOcc === 0 || cAdr === 0) continue;
    lines.push({
      date: r.date,
      propertyOcc: pOcc, compsetOcc: cOcc, occIndex: cOcc > 0 ? (pOcc / cOcc) * 100 : null,
      propertyAdr: pAdr, compsetAdr: cAdr, adrIndex: cAdr > 0 ? (pAdr / cAdr) * 100 : null,
      propertyRevpar: pRev, compsetRevpar: cRev, revparIndex: cRev > 0 ? (pRev / cRev) * 100 : null,
    });
    propOccSum += pOcc; compOccSum += cOcc;
    propAdrSum += pAdr; compAdrSum += cAdr;
    propRevparSum += pRev; compRevparSum += cRev;
    n += 1;
  }
  if (!n) return { status: "no-overlap", message: "Property reports and compset snapshots do not overlap by date." };

  return {
    status: "ok",
    propertyId,
    period: { start, end, n },
    propTier, compTier,
    averages: {
      occIndex: compOccSum > 0 ? (propOccSum / compOccSum) * 100 : null,
      adrIndex: compAdrSum > 0 ? (propAdrSum / compAdrSum) * 100 : null,
      revparIndex: compRevparSum > 0 ? (propRevparSum / compRevparSum) * 100 : null,
    },
    lines,
  };
}

/** Helper exposed for tests / UI. */
export function classifyTier(adr) { return classify(adr); }
