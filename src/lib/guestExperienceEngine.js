/* HotelOps · Guest Experience Engine
 * =================================================================
 * Ingests guest feedback (reviews, complaints, service-recovery tickets)
 * and correlates with the operational graph to answer:
 *
 *   - what is going wrong for guests right now?
 *   - which department is the root cause?
 *   - is it getting worse or better?
 *   - is it correlated with operational pressure (staffing, HK delays,
 *     compression, audit failures)?
 *
 * Pure, deterministic — no model calls. Sentiment uses lexicon-based
 * scoring; categorization uses keyword maps. AI agents can layer
 * narrative on top, but the engine's output is auditable.
 *
 * Input record shape (caller supplies — these don't exist in state yet):
 *
 *   {
 *     id, propertyId, date, source, rating?,
 *     text, channel?, guestId?, resolution?
 *   }
 *
 * Output:
 *   {
 *     status, propertyId, period,
 *     volume, avgRating, complaintRate,
 *     sentimentDistribution,
 *     categories: [{ category, count, sentiment, severityBlend, exampleIds }],
 *     trend: { direction, slope, recentVsPrior },
 *     correlations: [{ opPressure, correlation, sample }],
 *     topComplaints: [...],
 *     repeatOffenders: [...]
 *   }
 */

const NEG_LEXICON = new Set([
  "dirty", "filthy", "stained", "rude", "slow", "broken", "loud", "noisy",
  "cold", "hot", "smell", "moldy", "horrible", "terrible", "awful", "worst",
  "disgusting", "unacceptable", "complaint", "complained", "refund", "refused",
  "ignored", "unhelpful", "unprofessional", "wait", "waited", "delay", "delayed",
  "leak", "stained", "smoke", "stink", "smelly", "mildew", "pest", "roach",
  "bug", "bugs", "wrong", "missing", "lost", "stolen", "overcharged", "scam",
]);

const POS_LEXICON = new Set([
  "amazing", "wonderful", "excellent", "spotless", "clean", "friendly",
  "helpful", "quick", "fast", "great", "perfect", "lovely", "comfortable",
  "best", "fantastic", "outstanding", "professional", "responsive",
  "polite", "courteous", "welcoming", "smooth", "easy",
]);

const CATEGORY_KEYWORDS = {
  housekeeping: ["dirty", "clean", "linen", "towel", "bedding", "stain", "dust", "mold", "mildew", "hair", "smell", "trash"],
  maintenance: ["broken", "leak", "ac", "hvac", "tv", "wifi", "internet", "plumbing", "shower", "toilet", "elevator", "door", "lock", "key", "lights"],
  front_desk: ["check-in", "checkin", "check in", "front desk", "reception", "rude", "wait", "line", "lobby", "key card", "keycard", "reservation"],
  food_beverage: ["restaurant", "bar", "breakfast", "buffet", "menu", "food", "drink", "coffee", "service", "wait staff", "server", "kitchen"],
  noise: ["loud", "noise", "noisy", "party", "music", "thin walls"],
  pricing: ["expensive", "overcharged", "scam", "hidden fee", "charge", "billing", "refund"],
  parking: ["parking", "valet", "garage"],
  cleanliness: ["dirty", "filthy", "spotless", "clean", "stained", "smell"],
  safety: ["unsafe", "robbed", "stolen", "broken in", "security", "fire alarm", "scared"],
  pets_pests: ["roach", "bug", "bedbug", "pest", "rodent", "mouse", "ants"],
};

function safe(n) { const v = Number(n); return Number.isFinite(v) ? v : 0; }
function lower(s) { return String(s || "").toLowerCase(); }

/* ---------- Sentiment scoring ---------- */

/** Returns a sentiment score in [-1, 1] from a feedback text. */
export function scoreSentiment(text) {
  const t = lower(text);
  if (!t) return 0;
  const words = t.split(/[^a-z]+/).filter(Boolean);
  let pos = 0, neg = 0;
  for (const w of words) {
    if (POS_LEXICON.has(w)) pos++;
    if (NEG_LEXICON.has(w)) neg++;
  }
  if (pos + neg === 0) return 0;
  return (pos - neg) / (pos + neg);
}

/* ---------- Categorization ---------- */

export function categorizeFeedback(text) {
  const t = lower(text);
  const hits = [];
  for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const w of words) {
      if (t.includes(w)) {
        hits.push(cat);
        break;
      }
    }
  }
  return hits;
}

/* ---------- Aggregate analysis ---------- */

/**
 * Analyze feedback records within a window.
 *
 * @param {object} opts
 * @param {Array}  opts.feedback   list of feedback records
 * @param {string} opts.propertyId
 * @param {object} opts.period     { start, end } ISO dates
 * @param {object} opts.opGraph    optional OperationalGraph for correlation
 * @param {number} opts.roomsSoldInPeriod  for complaint rate denominator
 */
export function analyzeGuestExperience({ feedback = [], propertyId = null, period = null, opGraph = null, roomsSoldInPeriod = null } = {}) {
  const { start = null, end = null } = period || {};
  const inPeriod = (d) => (!start || d >= start) && (!end || d <= end);
  const items = feedback
    .filter(f => !propertyId || f.propertyId === propertyId)
    .filter(f => !start && !end ? true : inPeriod(f.date));
  if (!items.length) {
    return { status: "no-feedback", propertyId, period };
  }

  // Per-item enrichment
  const enriched = items.map(f => ({
    ...f,
    _sentiment: typeof f.rating === "number" ? (f.rating - 3) / 2 : scoreSentiment(f.text),
    _categories: categorizeFeedback(f.text),
  }));

  const ratings = enriched.map(f => safe(f.rating)).filter(v => v > 0);
  const avgRating = ratings.length ? ratings.reduce((s, r) => s + r, 0) / ratings.length : null;
  const negative = enriched.filter(f => f._sentiment < -0.1);
  const positive = enriched.filter(f => f._sentiment > 0.1);
  const neutral = enriched.filter(f => Math.abs(f._sentiment) <= 0.1);
  const sentimentDistribution = {
    negative: negative.length,
    neutral: neutral.length,
    positive: positive.length,
    avgSentiment: enriched.reduce((s, f) => s + f._sentiment, 0) / enriched.length,
  };

  // Categories
  const catMap = new Map();
  for (const f of enriched) {
    for (const c of f._categories) {
      if (!catMap.has(c)) catMap.set(c, { category: c, count: 0, sentimentSum: 0, exampleIds: [] });
      const row = catMap.get(c);
      row.count++;
      row.sentimentSum += f._sentiment;
      if (row.exampleIds.length < 5) row.exampleIds.push(f.id);
    }
  }
  const categories = Array.from(catMap.values())
    .map(c => ({
      category: c.category,
      count: c.count,
      avgSentiment: c.count > 0 ? c.sentimentSum / c.count : 0,
      severityBlend: Math.min(1, (c.count / Math.max(1, enriched.length)) + Math.abs(Math.min(0, c.count > 0 ? c.sentimentSum / c.count : 0))),
      exampleIds: c.exampleIds,
    }))
    .sort((a, b) => b.severityBlend - a.severityBlend);

  // Trend: split window in half, compare avg sentiment
  let trend = { direction: "unknown", slope: 0, recentVsPrior: null };
  if (start && end && enriched.length >= 6) {
    const startD = new Date(start), endD = new Date(end);
    const mid = new Date((startD.getTime() + endD.getTime()) / 2).toISOString().slice(0, 10);
    const prior = enriched.filter(f => f.date < mid);
    const recent = enriched.filter(f => f.date >= mid);
    if (prior.length >= 2 && recent.length >= 2) {
      const priorAvg = prior.reduce((s, f) => s + f._sentiment, 0) / prior.length;
      const recentAvg = recent.reduce((s, f) => s + f._sentiment, 0) / recent.length;
      const slope = recentAvg - priorAvg;
      trend = {
        direction: slope > 0.1 ? "improving" : slope < -0.1 ? "deteriorating" : "stable",
        slope: Math.round(slope * 100) / 100,
        recentVsPrior: { prior: priorAvg, recent: recentAvg },
      };
    }
  }

  // Operational correlations — for each pressure point in the op graph,
  // does its presence correlate with worse sentiment?
  const correlations = [];
  if (opGraph?.status === "ok") {
    const stressKey = "staffingStressIndex";
    const stress = opGraph.indices?.[stressKey] || 0;
    if (stress >= 50 && sentimentDistribution.avgSentiment < 0) {
      correlations.push({
        opPressure: "high-staffing-stress",
        correlation: "labor pressure may be driving negative sentiment",
        sample: { staffingStressIndex: stress, avgSentiment: sentimentDistribution.avgSentiment },
      });
    }
    if (opGraph.snap?.compression && categories.some(c => c.category === "front_desk" && c.avgSentiment < 0)) {
      correlations.push({
        opPressure: "compression",
        correlation: "compression coincides with front-desk dissatisfaction",
        sample: { compression: true, frontDeskCategory: categories.find(c => c.category === "front_desk") },
      });
    }
    if (categories.some(c => c.category === "housekeeping" && c.severityBlend > 0.3) && opGraph.indices?.staffingStressIndex >= 40) {
      correlations.push({
        opPressure: "housekeeping-staffing",
        correlation: "housekeeping complaints + staffing stress — investigate rooms-per-attendant load",
        sample: { housekeepingCategory: categories.find(c => c.category === "housekeeping") },
      });
    }
  }

  // Top complaints
  const topComplaints = enriched
    .filter(f => f._sentiment < -0.2)
    .sort((a, b) => a._sentiment - b._sentiment)
    .slice(0, 10)
    .map(f => ({
      id: f.id, date: f.date, sentiment: Math.round(f._sentiment * 100) / 100,
      categories: f._categories, text: String(f.text || "").slice(0, 200),
    }));

  // Repeat offenders — guests with 2+ complaints
  const repeatOffenders = (() => {
    const byGuest = new Map();
    for (const f of negative) {
      if (!f.guestId) continue;
      if (!byGuest.has(f.guestId)) byGuest.set(f.guestId, []);
      byGuest.get(f.guestId).push(f);
    }
    return Array.from(byGuest.values())
      .filter(arr => arr.length >= 2)
      .map(arr => ({ guestId: arr[0].guestId, complaintCount: arr.length, latest: arr[arr.length - 1].date }));
  })();

  const complaintRate = (() => {
    if (typeof roomsSoldInPeriod === "number" && roomsSoldInPeriod > 0) {
      return negative.length / roomsSoldInPeriod;
    }
    return null;
  })();

  return {
    status: "ok",
    propertyId,
    period,
    volume: enriched.length,
    avgRating,
    complaintRate,
    sentimentDistribution,
    categories,
    trend,
    correlations,
    topComplaints,
    repeatOffenders,
    runAt: new Date().toISOString(),
  };
}

/* ---------- Guest signal for kernel ---------- */

/** Compact summary suitable for hotelOperatingKernel's guestSignal parameter. */
export function buildGuestSignal({ feedback, propertyId, period, roomsSoldInPeriod }) {
  const a = analyzeGuestExperience({ feedback, propertyId, period, roomsSoldInPeriod });
  if (a.status !== "ok") return null;
  return {
    avgRating: a.avgRating,
    complaintRate: a.complaintRate,
    avgSentiment: a.sentimentDistribution.avgSentiment,
    trend: a.trend.direction,
  };
}
