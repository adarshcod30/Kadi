"""
entity_resolution.py — cluster Accused rows into resolved OffenderIdentity records.

Method (docs/02 §7.1): blocking on (soundex(first-token), soundex(last-token)) keeps
pairwise work small and precise; within a block rapidfuzz name similarity links pairs,
with a lower bar when a hard behavioural signal corroborates (same location cell or a
shared co-accused token). Union-find builds identities; a component-size cap prevents
the transitive-closure blow-ups that shared Indian first names would otherwise cause.
Every merge carries a confidence + reason for the "Why" UI.

FAIRNESS: only name + behavioural signals are used. No caste / religion / occupation.
"""
from __future__ import annotations

from collections import defaultdict

from rapidfuzz import fuzz

from common import assert_no_protected, normalize_name, soundex

ER_FEATURES = ["AccusedName", "CaseMasterID", "co_accused_tokens", "section", "geocell"]
STRUCT_THRESHOLD = 66          # link when first-name AND surname structurally agree
NAME_ONLY_THRESHOLD = 93       # link on overall name similarity alone
# "Distinctive" is a RELATIVE concept, not an absolute count, so the surname-rarity gate is
# expressed as a rate and scaled at compute() time to len(records). A fixed count silently
# erodes as the corpus grows: tuned as 20 against a ~37,094-accused corpus, at 54,176
# accused (the 60K-case corpus) it stopped protecting 97 of 238 planted cross-district
# surnames (41%) -- exactly the "serial offender working across districts is invisible"
# signal this gate exists to catch, quietly degrading as more data made the product richer.
SURNAME_RARE_BASELINE = 20
SURNAME_RARE_BASELINE_POPULATION = 37_094
SURNAME_RARE_RATE = SURNAME_RARE_BASELINE / SURNAME_RARE_BASELINE_POPULATION
MAX_IDENTITY_SIZE = 40         # safety cap against runaway merges


def _first_ok(a_tokens, b_tokens):
    fa, fb = a_tokens[0], b_tokens[0]
    return fa == fb or fa.startswith(fb) or fb.startswith(fa) or fuzz.ratio(fa, fb) >= 86


def _surname_same(la, lb):
    """Surnames agree only if identical, a near-identical spelling variant, or a prefix
    that is *almost* the whole word. Without the length guard, genuinely different
    surnames collapse ("Bhat" is a prefix of "Bhatkal" but is a different surname)."""
    if la == lb:
        return True
    short, long_ = (la, lb) if len(la) <= len(lb) else (lb, la)
    if long_.startswith(short) and len(short) >= 0.75 * len(long_):
        return True
    return fuzz.ratio(la, lb) >= 86


def _last_match(a_tokens, b_tokens, a_inits, b_inits):
    """Return ('exact'|'initial'|None) for how the surnames agree."""
    la = a_tokens[-1] if len(a_tokens) > 1 else ""
    lb = b_tokens[-1] if len(b_tokens) > 1 else ""
    if la and lb and _surname_same(la, lb):
        return "exact"
    # initial bridging: "Ravikumar G" (init 'g') vs "Ravikumar Gowda" (surname 'gowda')
    if (la and la[0] in b_inits) or (lb and lb[0] in a_inits):
        return "initial"
    return None


class UnionFind:
    def __init__(self):
        self.parent = {}
        self.size = defaultdict(lambda: 1)

    def find(self, x):
        self.parent.setdefault(x, x)
        root = x
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[x] != root:
            self.parent[x], x = root, self.parent[x]
        return root

    def comp_size(self, x):
        return self.size[self.find(x)]

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        if self.size[ra] < self.size[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        self.size[ra] += self.size[rb]


def _geocell(lat, lng, precision=2):
    try:
        return f"{round(float(lat), precision)},{round(float(lng), precision)}"
    except (TypeError, ValueError):
        return ""


def _name_sim(a_join, a_compact, b_join, b_compact):
    """Max of token-sorted ratio and de-spaced compact ratio (handles merged tokens
    like 'Ravikumar' vs 'Ravi Kumar')."""
    return max(fuzz.token_sort_ratio(a_join, b_join), fuzz.ratio(a_compact, b_compact))


def resolve(tables: dict):
    assert_no_protected(ER_FEATURES)

    accused = tables["Accused"]
    cases = tables["CaseMaster"].set_index("CaseMasterID")

    records = []
    case_to_recs = defaultdict(list)
    for row in accused.itertuples(index=False):
        compact, tokens, _ = normalize_name(row.AccusedName)
        if not compact:
            continue
        raw = [t for t in row.AccusedName.lower().replace(".", " ").split() if t.isalpha()]
        inits = {t[0] for t in raw if len(t) == 1}
        c = cases.loc[row.CaseMasterID] if row.CaseMasterID in cases.index else None
        rec = {
            "aid": row.AccusedMasterID,
            "case": row.CaseMasterID,
            "name": row.AccusedName,
            "toklist": tokens,
            "join": " ".join(tokens),
            "compact": compact,
            "tokens": set(tokens),
            "inits": inits,
            "surname": tokens[-1] if len(tokens) > 1 else "",
            "geo3": _geocell(c["latitude"], c["longitude"], 3) if c is not None else "",
            "co_tokens": set(),
            "co_surnames": set(),
        }
        records.append(rec)
        case_to_recs[row.CaseMasterID].append(rec)

    # surname frequency across the dataset — a rare surname is a distinctive identity signal.
    # The bar itself scales with how many accused records exist, so it holds the same
    # RELATIVE meaning ("shared by well under 0.1% of accused people") at any corpus size.
    surname_freq = defaultdict(int)
    for r in records:
        if r["surname"]:
            surname_freq[r["surname"]] += 1
    surname_rare = max(SURNAME_RARE_BASELINE, round(len(records) * SURNAME_RARE_RATE))

    # co-accused signals per accused (name tokens + surnames of the others in the case)
    for recs in case_to_recs.values():
        for r in recs:
            for o in recs:
                if o is not r:
                    r["co_tokens"] |= o["tokens"]
                    if o["surname"]:
                        r["co_surnames"].add(o["surname"])

    # Blocking: first-3-letters of the first token. Prefix variants ("ravi"/"ravikumar")
    # stay together; unrelated first names ("ramesh"/"raghavendra") split apart; buckets
    # stay small enough for pairwise comparison.
    blocks = defaultdict(list)
    for r in records:
        blocks[r["compact"][:3]].append(r)

    uf = UnionFind()
    pair_reason = {}
    for bucket in blocks.values():
        if len(bucket) < 2:
            continue
        for i in range(len(bucket)):
            ri = bucket[i]
            for j in range(i + 1, len(bucket)):
                rj = bucket[j]
                if uf.find(ri["aid"]) == uf.find(rj["aid"]):
                    continue
                if uf.comp_size(ri["aid"]) + uf.comp_size(rj["aid"]) > MAX_IDENTITY_SIZE:
                    continue
                if not _first_ok(ri["toklist"], rj["toklist"]):
                    continue
                last = _last_match(ri["toklist"], rj["toklist"], ri["inits"], rj["inits"])
                if last is None:
                    continue
                sim = _name_sim(ri["join"], ri["compact"], rj["join"], rj["compact"])
                # Distinctiveness: BOTH surnames must be rare for the name alone to be a
                # trustworthy identity signal. If either side carries a common surname the
                # pair needs corroboration — otherwise one rare surname drags a whole
                # crowd of common-named strangers into a single identity.
                sur_a, sur_b = ri["surname"], rj["surname"]
                distinctive = (bool(sur_a) and bool(sur_b)
                               and surname_freq[sur_a] <= surname_rare
                               and surname_freq[sur_b] <= surname_rare)
                # A distinctive shared co-accused is specific corroboration. A shared
                # location cell alone is NOT trusted for common surnames — dense metros
                # (Bengaluru) collide heavily and would chain unrelated same-name people.
                fine_cell = bool(ri["geo3"]) and ri["geo3"] == rj["geo3"]
                shared_dist_co = any(surname_freq.get(s, 999) <= surname_rare
                                     for s in (ri["co_surnames"] & rj["co_surnames"]))
                corroborated = shared_dist_co or (fine_cell and shared_dist_co)

                link = False
                if sim >= STRUCT_THRESHOLD:
                    if last == "exact" and (distinctive or corroborated):
                        link = True
                    # initial-only surname bridges are weak — require behavioural
                    # corroboration (a single matching initial is not enough on its own).
                    elif last == "initial" and corroborated:
                        link = True
                if not link and sim >= NAME_ONLY_THRESHOLD and (distinctive or corroborated):
                    link = True

                if link:
                    uf.union(ri["aid"], rj["aid"])
                    reason = [f"name~{sim}%"]
                    if distinctive:
                        reason.append("distinctive surname")
                    if shared_dist_co:
                        reason.append("shared co-accused")
                    if fine_cell:
                        reason.append("same location cell")
                    pair_reason[frozenset((ri["aid"], rj["aid"]))] = (sim, ", ".join(reason))

    # Assemble identities
    comp = defaultdict(list)
    for r in records:
        comp[uf.find(r["aid"])].append(r)

    identities, mapping = [], []
    unit_district = tables["Unit"].set_index("UnitID")["DistrictID"].to_dict()
    for k, (_, members) in enumerate(sorted(comp.items()), start=1):
        oid = f"OID{k:06d}"
        name_counts = defaultdict(int)
        for m in members:
            name_counts[m["name"]] += 1
        canonical = max(name_counts, key=lambda n: (name_counts[n], len(n)))
        case_ids = sorted({m["case"] for m in members})
        districts = sorted({unit_district.get(cases.loc[m["case"]]["PoliceStationID"], "")
                            for m in members if m["case"] in cases.index} - {""})
        if len(members) == 1:
            conf = 1.0
        else:
            sims = [s for key, (s, _) in pair_reason.items()
                    if any(m["aid"] in key for m in members)]
            conf = round((sum(sims) / len(sims) / 100.0) if sims else 0.78, 3)
        identities.append({
            "offenderIdentityId": oid,
            "canonicalName": canonical,
            "accusedIds": [m["aid"] for m in members],
            "caseIds": case_ids,
            "districts": districts,
            "resolvedFromCount": len(members),
            "distinctCases": len(case_ids),
            "nameVariants": sorted(set(name_counts)),
            "confidence": conf,
            "lowConfidence": conf < 0.85,
        })
        for m in members:
            reason = "single record"
            score = 100
            for key, (s, txt) in pair_reason.items():
                if m["aid"] in key:
                    reason, score = txt, s
                    break
            mapping.append({
                "offenderIdentityId": oid,
                "AccusedMasterID": m["aid"],
                "caseMasterId": m["case"],
                "accusedName": m["name"],
                "matchScore": score,
                "matchReason": reason,
            })

    return identities, mapping
