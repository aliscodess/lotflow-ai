/**
 * LotFlow rule-based language engine.
 * Deterministic extraction used in DEMO_MODE (no AI key) and as the fallback when an LLM
 * call fails or returns something that does not validate. Tuned for how lot associates
 * actually talk, including Indian English ("tyre", "bonnet", "windscreen").
 */

const NUM_WORDS = {
  zero: 0, oh: 0, one: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, five: 5, six: 6, seven: 7, eight: 8, ate: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const ROW_WORDS = { a: 'A', ay: 'A', eh: 'A', b: 'B', bee: 'B', be: 'B', c: 'C', see: 'C', sea: 'C', d: 'D', dee: 'D', e: 'E', ee: 'E', f: 'F', eff: 'F', ef: 'F' };

/** "twenty eight forty seven" -> "2847", "row b position twelve" -> "row b position 12" */
function wordsToDigits(text) {
  const tokens = text.split(/(\s+)/);
  const out = [];
  let buffer = [];
  const flush = () => {
    if (!buffer.length) return;
    // combine tens + ones pairs into two-digit groups, then concatenate groups
    const groups = [];
    for (let i = 0; i < buffer.length; i += 1) {
      const w = buffer[i];
      if (TENS[w] !== undefined) {
        const next = buffer[i + 1];
        if (next && NUM_WORDS[next] !== undefined && NUM_WORDS[next] < 10) {
          groups.push(String(TENS[w] + NUM_WORDS[next]));
          i += 1;
        } else groups.push(String(TENS[w]));
      } else if (NUM_WORDS[w] !== undefined) groups.push(String(NUM_WORDS[w]));
      else if (w === 'hundred' && groups.length) groups[groups.length - 1] = String(Number(groups[groups.length - 1]) * 100);
    }
    out.push(groups.join(''));
    buffer = [];
  };
  for (const tok of tokens) {
    const w = tok.toLowerCase();
    const isNumWord = (TENS[w] !== undefined || (NUM_WORDS[w] !== undefined && !['to', 'too', 'for', 'ate', 'oh'].includes(w)) || (w === 'hundred' && buffer.length));
    if (/^\s+$/.test(tok)) {
      if (!buffer.length) out.push(tok);
      continue;
    }
    if (isNumWord) buffer.push(w);
    else {
      if (buffer.length) {
        flush();
        out.push(' ');
      }
      out.push(tok);
    }
  }
  flush();
  return out.join('').replace(/\s{2,}/g, ' ');
}

function normalise(raw) {
  let t = ` ${String(raw || '')} `
    .replace(/[“”"]/g, ' ')
    .replace(/(\d)\s*-\s*(\d)/g, '$1$2')
    .replace(/\s+/g, ' ');
  t = wordsToDigits(t);
  // join spoken digit groups like "28 47" after vehicle keywords
  t = t.replace(/\b(vehicle|stock|unit|car|number|tag)\s+(?:number\s+|no\.?\s+|#\s*)?(\d{1,3})\s+(\d{1,3})\b(?!\s*(?:km|%|percent))/gi, (m, kw, a, b) =>
    (a + b).length >= 3 && (a + b).length <= 6 ? `${kw} ${a}${b}` : m,
  );
  return t;
}

/* ---------------- entity extraction ---------------- */

function extractVehicleId(text, known = []) {
  const knownSet = new Set(known);
  const patterns = [
    /\b(?:vehicle|stock|unit|car|suv|sedan|hatchback|tag|number)\s*(?:number|no\.?|id|#)?\s*[:#-]?\s*#?\s*(\d{3,6})\b/i,
    /#\s*(\d{3,6})\b/,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) return { value: m[1], inferred: false };
  }
  // fall back to any 3–6 digit number that is a known stock number
  const nums = [...text.matchAll(/\b(\d{3,6})\b/g)].map((m) => m[1]);
  const knownHit = nums.find((n) => knownSet.has(n));
  if (knownHit) return { value: knownHit, inferred: true };
  const plausible = nums.find((n) => !/^(19|20)\d{2}$/.test(n) && n.length === 4);
  if (plausible) return { value: plausible, inferred: true };
  return null;
}

function rowFrom(word) {
  return ROW_WORDS[String(word).toLowerCase()] || null;
}

function extractLocation(text) {
  const rowWord = '(a|b|c|d|e|f|ay|bee|be|see|sea|dee|ee|eff|ef)';
  const pos = '(\\d{1,2})';
  const patterns = [
    [new RegExp(`\\brow\\s+${rowWord}\\b[\\s,]*(?:(?:at|in|on)\\s+)?(?:position|pos|spot|slot|space|stall|bay|number|no\\.?)?\\s*#?\\s*${pos}\\b`, 'i'), 1, 2],
    [new RegExp(`\\b(?:position|spot|slot|stall|space)\\s+${pos}\\s*(?:,|in|of|on)?\\s*row\\s+${rowWord}\\b`, 'i'), 2, 1],
    [new RegExp(`\\b(?:position|spot|slot|stall|space|parked at|parked in|at|in|to)\\s+([a-f])\\s*-?\\s*${pos}\\b`, 'i'), 1, 2],
    [new RegExp(`\\brow\\s+${rowWord}\\b`, 'i'), 1, null],
  ];
  for (const [re, ri, pi] of patterns) {
    const m = re.exec(text);
    if (!m) continue;
    const row = rowFrom(m[ri]);
    if (!row) continue;
    if (pi === null) return { row, position: null, partial: true };
    return { row, position: Number(m[pi]) };
  }
  return null;
}

/* ---------------- issues ---------------- */

const AREA_PATTERNS = [
  // tyres with positions: "left rear tyre", "rear left tire", "front right tyre"
  {
    re: /\b(?:(front|rear|back)\s+)?(?:(left|right|driver(?:'s)?(?:\s+side)?|passenger(?:'s)?(?:\s+side)?)\s+)?(?:(front|rear|back)\s+)?(?:side\s+)?(tyre|tire|wheel|rim|alloy)s?\b/i,
    build: (m) => {
      const fr = (m[1] || m[3] || '').replace('back', 'rear');
      const side = (m[2] || '').replace(/driver(?:'s)?(?:\s+side)?/, 'right').replace(/passenger(?:'s)?(?:\s+side)?/, 'left');
      return [side, fr, m[4].toLowerCase()].filter(Boolean).join(' ');
    },
  },
  { re: /\b(front|rear|back)\s+(bumper)\b/i, build: (m) => `${m[1].toLowerCase().replace('back', 'rear')} bumper` },
  { re: /\b(?:(front|rear)\s+)?(?:(left|right|driver|passenger)(?:'s)?\s+(?:side\s+)?)?(?:(front|rear)\s+)?(door|fender|mirror|side mirror|headlight|headlamp|tail ?light|tail ?lamp|fog lamp|quarter panel|window|orvm)s?\b/i,
    build: (m) => [m[2] && m[2].replace('driver', 'right').replace('passenger', 'left'), m[1] || m[3], m[4].toLowerCase().replace('orvm', 'side mirror')].filter(Boolean).join(' ') },
  { re: /\b(windshield|windscreen|front glass)\b/i, build: () => 'windshield' },
  { re: /\b(rear windshield|rear windscreen|rear glass)\b/i, build: () => 'rear windshield' },
  { re: /\b(bonnet|hood)\b/i, build: () => 'bonnet' },
  { re: /\b(bumper)\b/i, build: () => 'bumper' },
  { re: /\b(roof|sunroof|tailgate|boot lid|boot|grille|spoiler|running board|paint|body panel|underbody)\b/i, build: (m) => m[1].toLowerCase() },
  { re: /\b(12 ?v battery|battery|hv battery|charge|charging port)\b/i, build: (m) => m[1].toLowerCase().replace('12 v', '12v') },
  { re: /\b(brakes?|brake pads?|brake discs?|engine|clutch|gearbox|suspension|steering|coolant|exhaust|horn|ac|air ?con(?:ditioning|ditioner)?|wipers?)\b/i, build: (m) => m[1].toLowerCase().replace(/^air ?con.*/, 'ac') },
  { re: /\b(seats?|dashboard|dash|upholstery|carpet|headliner|infotainment|touchscreen|console|interior|cabin|steering wheel)\b/i, build: (m) => m[1].toLowerCase().replace(/^dash$/, 'dashboard') },
  { re: /\b(fuel|tank)\b/i, build: () => 'fuel' },
];

const CONDITION_PATTERNS = [
  { re: /\b(?:deep|big|large|long|bad)\s+scratch(?:es)?\b/i, desc: 'deep scratch', sev: 'medium' },
  { re: /\bscratch(?:es|ed)?\b/i, desc: 'minor scratch', sev: 'low' },
  { re: /\bscuff(?:s|ed| marks?)?\b/i, desc: 'scuff marks', sev: 'low' },
  { re: /\bswirl marks?\b/i, desc: 'swirl marks', sev: 'low' },
  { re: /\b(?:big|large|deep)\s+dent\b/i, desc: 'large dent', sev: 'medium' },
  { re: /\bdent(?:s|ed)?\b|\bding(?:s|ed)?\b/i, desc: 'dent', sev: 'medium' },
  { re: /\bcrack(?:s|ed)?\b/i, desc: 'cracked', sev: 'high' },
  { re: /\bchip(?:s|ped)?\b/i, desc: 'chip', sev: 'medium' },
  { re: /\bbroken\b|\bsmashed\b|\bshattered\b/i, desc: 'broken', sev: 'high' },
  { re: /\bflat\b|\bdeflated\b/i, desc: 'flat', sev: 'high' },
  { re: /\bpunctur(?:e|ed)\b/i, desc: 'puncture', sev: 'high' },
  { re: /\bwarning (?:light|lamp)\b|\bcheck engine\b|\bmil (?:light|lamp)\b/i, desc: 'warning light on', sev: 'high' },
  { re: /\bleak(?:s|ing)?\b|\bdripping\b/i, desc: 'leak', sev: 'high' },
  { re: /\bdead\b|\bwon'?t start\b|\bnot starting\b/i, desc: 'dead / not starting', sev: 'high' },
  { re: /\bunder ?inflated\b|\blow (?:air|pressure)\b|\b(?:looks?|seems?|is|are|bit|slightly|quite|very|running)\s+low\b/i, desc: 'low pressure', sev: 'medium' },
  { re: /\bworn(?: out)?\b|\bbald\b|\bthin\b/i, desc: 'worn', sev: 'medium' },
  { re: /\bweak\b|\bdrained\b|\blow charge\b/i, desc: 'weak', sev: 'medium' },
  { re: /\bsqueal\w*|\bgrind\w*|\brattl\w*|\bnois[ey]\w*|\bvibrat\w*/i, desc: 'abnormal noise', sev: 'medium' },
  { re: /\bnot (?:working|cooling|charging)\b|\bfaulty\b|\bmalfunction\w*|\bstopped working\b/i, desc: 'not working', sev: 'medium' },
  { re: /\btorn\b|\btear\b|\bripped\b/i, desc: 'torn', sev: 'medium' },
  { re: /\brust\w*\b|\bcorro\w+/i, desc: 'rust', sev: 'medium' },
  { re: /\bmissing\b/i, desc: 'missing', sev: 'medium' },
  { re: /\bstain(?:s|ed)?\b|\bspill\w*/i, desc: 'stain', sev: 'low' },
  { re: /\bfaded\b|\boxidi[sz]ed\b|\bdull\b/i, desc: 'faded', sev: 'low' },
  { re: /\bdirty\b|\bdusty\b|\bmuddy\b|\bbird droppings?\b/i, desc: 'needs cleaning', sev: 'low' },
  { re: /\bcurb(?:ed)? rash\b|\bkerb(?:ed)? rash\b/i, desc: 'curb rash', sev: 'low' },
];

function splitClauses(text) {
  return text
    .split(/[.;!?]|,|\band also\b|\balso\b|\band\b|\bplus\b|\bbut\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
}

function extractIssues(text) {
  const issues = [];
  for (const clause of splitClauses(text)) {
    // skip location-only clauses
    if (/^(vehicle|stock|car)?\s*\d*\s*(is\s+)?(parked\s+)?(in|at)\s+row\b/i.test(clause) && !CONDITION_PATTERNS.some((c) => c.re.test(clause))) continue;
    const cond = CONDITION_PATTERNS.find((c) => c.re.test(clause));
    let area = null;
    for (const a of AREA_PATTERNS) {
      const m = a.re.exec(clause);
      if (m) {
        area = a.build(m).replace(/\s+/g, ' ').trim();
        break;
      }
    }
    if (!cond) {
      if (area && /\b(check|look at|inspect|verify)\b/i.test(clause) && !/\bsend\b/i.test(clause)) {
        issues.push({ area, description: 'needs check', severity: 'low' });
      }
      continue;
    }
    if (!area) {
      if (/\blow\b/.test(cond.desc) && /fuel|tank/i.test(clause)) area = 'fuel';
      else area = 'body panel';
    }
    let { desc, sev } = cond;
    if (area === 'fuel' && desc === 'low pressure') desc = 'low fuel';
    if (/battery/.test(area) && desc === 'low pressure') desc = 'low charge';
    if (/(windshield|glass)/.test(area) && desc === 'cracked') sev = 'high';
    if (/brake/.test(area) && sev === 'medium') sev = 'high';
    if (/\b(urgent|asap|immediately|dangerous|unsafe)\b/i.test(clause)) sev = 'high';
    // avoid duplicates for the same area
    if (!issues.some((i) => i.area === area && i.description === desc)) issues.push({ area, description: desc, severity: sev });
  }
  return issues;
}

function extractLevel(text, kind) {
  const word = kind === 'fuel' ? '(?:fuel|tank|petrol|diesel)' : '(?:charge|battery|soc|state of charge)';
  const pct = new RegExp(`${word}[^.,;]*?(\\d{1,3})\\s*(?:%|percent|per cent)`, 'i').exec(text)
    || new RegExp(`(\\d{1,3})\\s*(?:%|percent|per cent)\\s*(?:of\\s+)?${word}`, 'i').exec(text);
  if (pct) return Math.min(100, Number(pct[1]));
  if (kind === 'fuel') {
    if (/\b(?:quarter|1\/4)\s+(?:tank|fuel)/i.test(text)) return 25;
    if (/\bhalf\s+(?:a\s+)?(?:tank|fuel)/i.test(text)) return 50;
    if (/\bfull\s+(?:tank|fuel)|\btank is full/i.test(text)) return 100;
    if (/\b(?:on\s+)?reserve\b|\bempty\b/i.test(text) && /\b(fuel|tank)\b/i.test(text)) return 8;
  }
  return null;
}

function extractAction(text, issues) {
  const t = text.toLowerCase();
  if (/\b(mark(ed)? (it )?(as )?sold|has been sold|is sold)\b/.test(t)) return { action: 'mark_sold', inferred: false };
  if (/\b(put (it |this )?on hold|hold (it|this|the car)|keep (it )?on hold)\b/.test(t)) return { action: 'hold', inferred: false };
  if (/\b(send|move|take|push)\b[^.]*\b(service|workshop|repair|bay)\b|\bneeds? (a |an )?(service|repair|fix)\b|\bbook (it )?(for|into) service\b/.test(t)) return { action: 'service_required', inferred: false };
  if (/\b(send|move|take|flag|schedule)\b[^.]*\binspect(ion)?\b|\bneeds? (an? )?inspection\b|\bfor inspection\b|\binspect (it|this)\b/.test(t)) return { action: 'inspection_required', inferred: false };
  if (!issues.length && /\b(front ?line ready|ready for sale|good to go|all good|looks good|no (issues|damage)|clean)\b/.test(t)) return { action: 'mark_available', inferred: false };
  if (issues.length) return { action: 'inspection_required', inferred: true };
  return { action: 'location_update', inferred: true };
}

/** Main entry: transcript -> observation object (same shape the LLM returns). */
export function extractObservation(transcript, ctx = {}) {
  const text = normalise(transcript);
  const vid = extractVehicleId(text, ctx.knownVehicleIds);
  const loc = extractLocation(text);
  const issues = extractIssues(text);
  const fuelLevel = extractLevel(text, 'fuel');
  const batteryLevel = extractLevel(text, 'battery');

  if (batteryLevel !== null && batteryLevel < 25 && !issues.some((i) => /battery|charge/.test(i.area))) {
    issues.push({ area: 'battery', description: `charge at ${batteryLevel}%`, severity: 'medium' });
  }
  if (fuelLevel !== null && fuelLevel < 15 && !issues.some((i) => i.area === 'fuel')) {
    issues.push({ area: 'fuel', description: `low fuel (${fuelLevel}%)`, severity: 'low' });
  }

  let { action, inferred } = extractAction(text, issues);
  if (action === 'location_update' && !loc) action = 'none';

  const rank = { low: 1, medium: 2, high: 3 };
  const maxSev = issues.reduce((m, i) => Math.max(m, rank[i.severity]), 0);
  let priority = ['low', 'low', 'medium', 'high'][maxSev];
  if (/\b(urgent|asap|immediately|right away|safety)\b/i.test(text)) priority = maxSev >= 3 ? 'urgent' : 'high';

  const notes = [];
  if (loc?.partial) notes.push(`Row ${loc.row} heard without a position.`);
  if (vid?.inferred) notes.push(`Vehicle number ${vid.value} was inferred from the sentence.`);

  let confidence = 0.5;
  if (vid) confidence += vid.inferred ? 0.12 : 0.22;
  if (loc && !loc.partial) confidence += 0.1;
  if (issues.length) confidence += 0.08;
  if (!inferred) confidence += 0.06;

  return {
    vehicleId: vid?.value ?? null,
    location: loc && !loc.partial ? { row: loc.row, position: loc.position } : null,
    issues,
    action,
    priority,
    fuelLevel,
    batteryLevel,
    notes: notes.join(' '),
    confidence: Math.min(0.97, Number(confidence.toFixed(2))),
  };
}

/* ---------------- narrative helpers (demo mode) ---------------- */

export function agingSummary(facts) {
  const top = facts.reasons?.[0];
  const second = facts.reasons?.[1];
  const lead = `#${facts.vehicleId} has been in stock ${facts.daysInInventory} days against ${facts.expectedDaysToSell} expected for comparable ${facts.segment}.`;
  const why = top ? ` The biggest drag is ${top.title.charAt(0).toLowerCase()}${top.title.slice(1)}${second ? `, followed by ${second.title.charAt(0).toLowerCase()}${second.title.slice(1)}` : ''}.` : '';
  const first = facts.recommendations?.[0] ? ` Start with: ${facts.recommendations[0].title.toLowerCase()}.` : '';
  return `${lead}${why}${first}`;
}

export function storeInsight(stores) {
  if (!stores?.length) return '';
  const score = (s) => s.lotAccuracy + s.inspectionCompletion + s.photoCompleteness - s.avgDaysToSell - s.serviceDelayRate * 1.5;
  const sorted = [...stores].sort((a, b) => score(a) - score(b));
  const worst = sorted[0];
  const peers = stores.filter((s) => s.code !== worst.code);
  const avg = (k) => Math.round(peers.reduce((sum, s) => sum + s[k], 0) / peers.length);
  const gaps = [
    { k: 'inspectionCompletion', label: 'inspection completion is lower', fmt: (v) => `${v}%`, gap: avg('inspectionCompletion') - worst.inspectionCompletion },
    { k: 'photoCompleteness', label: 'listings have fewer complete photo sets', fmt: (v) => `${v}%`, gap: avg('photoCompleteness') - worst.photoCompleteness },
    { k: 'lotAccuracy', label: 'lot accuracy is lower', fmt: (v) => `${v}%`, gap: avg('lotAccuracy') - worst.lotAccuracy },
    { k: 'serviceDelayRate', label: 'more service jobs run late', fmt: (v) => `${v}%`, gap: (worst.serviceDelayRate - avg('serviceDelayRate')) * 1.2 },
  ]
    .filter((g) => g.gap > 0)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 2);
  const reasonText = gaps
    .map((g) => `${g.label} (${g.fmt(worst[g.k])} vs ${g.fmt(avg(g.k))} at peers)`)
    .join(' and ');
  const dayGap = worst.avgDaysToSell - avg('avgDaysToSell');
  return `${worst.label} (${worst.name}) is underperforming primarily because ${reasonText || 'its operating metrics trail its peers'}. Its vehicles take ${worst.avgDaysToSell} days to sell on average, ${dayGap} days longer than the other stores.`;
}
