// events.js — the When tab's calendar of occasions, beyond festivals.
//
// The pipeline derives festival effects from real registration dates (occasions.json). But an
// SP planning deployment also cares about political visits, mass gatherings, sporting fixtures,
// examination days, bandhs and election phases -- and those dates are not in the corpus and
// cannot be derived from it. So this table is CURATED and, for the non-festival classes,
// deliberately illustrative: a prototype needs the shape of the effect (which occasions push
// crime up, which pull it down, and toward which crime type), not exact historical counts.
//
// Every figure here is labelled as indicative on the surface that shows it. The festival rows
// are backfilled with the pipeline's real numbers where they match, so the two are not
// presented as equally evidenced.
//
// intensity is a direction, read against an ordinary day:
//   surge    materially more crime than a normal day
//   raised   somewhat more
//   quiet    materially less (a bandh empties the streets; reported crime falls, though some
//            categories -- public order, property damage -- can rise, which the note says)

const CATEGORY = {
  festival: { label: 'Festival', hint: 'Religious and cultural festivals with public gatherings.' },
  civic: { label: 'Civic event', hint: 'Fairs, concerts, large public gatherings.' },
  political: { label: 'Political', hint: 'VIP visits, rallies, public meetings — heavy bandobast.' },
  sport: { label: 'Sport', hint: 'Match days at large venues; crowd and traffic pressure.' },
  academic: { label: 'Exam / result', hint: 'Board and competitive exam days; malpractice and impersonation.' },
  protest: { label: 'Bandh / protest', hint: 'Strikes and shutdowns; streets empty but public-order risk rises.' },
  election: { label: 'Election phase', hint: 'Model code period, polling and counting days.' },
};

// The curated occasions. vsNormalPct on non-festival rows is indicative; festival rows are
// overwritten with pipeline numbers when a name matches.
const OCCASIONS = [
  { key: 'dasara', label: 'Dasara', category: 'festival', intensity: 'raised', vsNormalPct: 15,
    topHead: 'Crimes Against Property', cadence: 'Sep–Oct, ~10 days',
    note: 'Crowds and travel lift theft and pickpocketing; women-safety deployment matters at gatherings.' },
  { key: 'deepavali', label: 'Deepavali', category: 'festival', intensity: 'raised', vsNormalPct: 15,
    topHead: 'Crimes Against Property', cadence: 'Oct–Nov, ~5 days',
    note: 'Cash movement and shopping crowds; burns and nuisance also rise but sit outside this dataset.' },
  { key: 'ganesh', label: 'Ganesh Chaturthi', category: 'festival', intensity: 'raised', vsNormalPct: 12,
    topHead: 'Crimes Against Property', cadence: 'Aug–Sep, immersion processions',
    note: 'Immersion processions concentrate crowds and traffic; public-order and communal-tension watch.' },
  { key: 'newyear', label: 'New Year’s Eve', category: 'civic', intensity: 'surge', vsNormalPct: 34,
    topHead: 'Crimes Against Body', cadence: '31 Dec night',
    note: 'Drink-driving, affray and molestation spike in nightlife districts — the single highest-risk night.' },
  { key: 'vip', label: 'VIP / political visit', category: 'political', intensity: 'raised', vsNormalPct: 8,
    topHead: 'Traffic / PAR', cadence: 'Irregular',
    note: 'Bandobast pulls officers off routine beats; petty crime can rise where cover thins.' },
  { key: 'rally', label: 'Rally / public meeting', category: 'political', intensity: 'raised', vsNormalPct: 10,
    topHead: 'Crimes Against Body', cadence: 'Irregular',
    note: 'Mass gatherings raise affray, pickpocketing and public-order incidents.' },
  { key: 'match', label: 'Stadium match day', category: 'sport', intensity: 'raised', vsNormalPct: 9,
    topHead: 'Crimes Against Property', cadence: 'IPL / ISL season',
    note: 'Crowd egress and traffic; ticket touting and vehicle crime around venues.' },
  { key: 'exam', label: 'Board / competitive exam', category: 'academic', intensity: 'raised', vsNormalPct: 6,
    topHead: 'Economic Offences', cadence: 'Mar–Jul exam windows',
    note: 'Impersonation and paper-leak complaints; cheating rings around centres.' },
  { key: 'bandh', label: 'Bandh / strike', category: 'protest', intensity: 'quiet', vsNormalPct: -22,
    topHead: 'Crimes Against Property', cadence: 'Called, irregular',
    note: 'Reported crime falls as streets empty, but public-order and property-damage risk rises — a fall in the total hides a rise in the type that matters that day.' },
  { key: 'poll', label: 'Polling / counting day', category: 'election', intensity: 'raised', vsNormalPct: 11,
    topHead: 'Crimes Against Body', cadence: 'Election phases',
    note: 'Model-code enforcement, cash seizures and clashes near booths; heavy pre-planned deployment.' },
];

const INTENSITY_RANK = { surge: 0, raised: 1, quiet: 2 };

// Fold the pipeline's real festival numbers over the curated rows where names match, so the
// evidenced rows carry evidenced figures and the note says which is which.
function build(pipelineOccasions) {
  const real = new Map(((pipelineOccasions && pipelineOccasions.occasions) || [])
    .map((o) => [String(o.occasion).toLowerCase(), o]));
  const rows = OCCASIONS.map((o) => {
    const hit = real.get(o.label.toLowerCase());
    return {
      ...o,
      categoryLabel: CATEGORY[o.category].label,
      evidenced: !!hit,
      vsNormalPct: hit ? hit.vsNormalPct : o.vsNormalPct,
      casesPerDay: hit ? hit.casesPerDay : null,
      topHead: hit ? hit.topHead : o.topHead,
    };
  }).sort((a, b) => (INTENSITY_RANK[a.intensity] - INTENSITY_RANK[b.intensity])
    || (b.vsNormalPct - a.vsNormalPct));
  return {
    categories: CATEGORY,
    occasions: rows,
    baselineCasesPerDay: (pipelineOccasions && pipelineOccasions.baselineCasesPerDay) || null,
    dayClasses: (pipelineOccasions && pipelineOccasions.classes) || [],
    method: 'Festival effects are measured from registration dates in the corpus. Civic, '
      + 'political, sporting, academic, protest and election effects are indicative directions '
      + 'for a prototype — the occasions and whether each pushes crime up or down, not exact '
      + 'historical counts. Marked accordingly on each row.',
  };
}

module.exports = { build, CATEGORY };
