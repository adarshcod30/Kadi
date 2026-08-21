"""occasions.py — how crime behaves on festivals and holidays versus ordinary days.

The brief asks for temporal pattern discovery. In India the interesting temporal structure is
not only hour-of-day and day-of-week: it is the calendar. Crowds at a festival move property
crime; a national holiday empties commercial districts and changes what is worth stealing.
An analysis that averages Deepavali into an ordinary Tuesday cannot see any of that.

Every day is classified, then each class is compared with the Normal baseline on rate and on
crime mix. Dates are the major pan-Karnataka observances -- approximate where a festival
follows the lunar calendar, which is stated in the output rather than hidden.
"""
from collections import defaultdict, Counter
import datetime as _dt

# Major observances 2023-2026. Lunar-calendar dates are approximate by a day or two; the
# analysis windows them, so a one-day drift does not change the finding.
FESTIVALS = {
    "Deepavali": ["2023-11-12", "2024-10-31", "2025-10-20", "2026-11-08"],
    "Dasara": ["2023-10-24", "2024-10-12", "2025-10-02", "2026-10-20"],
    "Ganesh Chaturthi": ["2023-09-19", "2024-09-07", "2025-08-27", "2026-09-14"],
    "Ugadi": ["2023-03-22", "2024-04-09", "2025-03-30", "2026-03-19"],
    "Sankranti": ["2023-01-15", "2024-01-15", "2025-01-14", "2026-01-15"],
    "Eid": ["2023-04-22", "2024-04-11", "2025-03-31", "2026-03-20"],
    "Christmas": ["2023-12-25", "2024-12-25", "2025-12-25", "2026-12-25"],
}
NATIONAL = {
    "Republic Day": ["2023-01-26", "2024-01-26", "2025-01-26", "2026-01-26"],
    "Independence Day": ["2023-08-15", "2024-08-15", "2025-08-15", "2026-08-15"],
    "Gandhi Jayanti": ["2023-10-02", "2024-10-02", "2025-10-02", "2026-10-02"],
    "Kannada Rajyotsava": ["2023-11-01", "2024-11-01", "2025-11-01", "2026-11-01"],
}
WINDOW = 1        # +/- a day, so eve-of-festival activity is included


def _classify():
    """date string -> (class, label). Festival window wins over national holiday."""
    out = {}
    for label, days in NATIONAL.items():
        for d in days:
            out[d] = ("National Holiday", label)
    for label, days in FESTIVALS.items():
        for d in days:
            base = _dt.date.fromisoformat(d)
            for off in range(-WINDOW, WINDOW + 1):
                out[(base + _dt.timedelta(days=off)).isoformat()] = ("Festival", label)
    return out


def compute(cases):
    """Return rate and crime-mix comparison across day classes."""
    cal = _classify()
    by_class = defaultdict(lambda: {"days": set(), "n": 0, "heads": Counter(), "hours": Counter()})
    per_label = defaultdict(lambda: {"days": set(), "n": 0, "heads": Counter()})

    for c in cases:
        d = str(c.get("crimeRegisteredDate") or "")[:10]
        if not d:
            continue
        cls, label = cal.get(d, (None, None))
        if cls is None:
            try:
                cls = "Weekend" if _dt.date.fromisoformat(d).weekday() >= 5 else "Normal"
            except ValueError:
                continue
            label = cls
        b = by_class[cls]
        b["days"].add(d); b["n"] += 1
        b["heads"][c.get("crimeHead") or "Other"] += 1
        if c.get("hour") is not None:
            b["hours"][int(c["hour"])] += 1
        if cls in ("Festival", "National Holiday"):
            p = per_label[label]
            p["days"].add(d); p["n"] += 1
            p["heads"][c.get("crimeHead") or "Other"] += 1

    def mix(counter, total):
        return [{"head": h, "pct": round(100.0 * n / total, 1)}
                for h, n in counter.most_common(6)] if total else []

    normal = by_class.get("Normal")
    base_rate = (normal["n"] / len(normal["days"])) if normal and normal["days"] else 0.0

    classes = []
    for cls, b in by_class.items():
        days = len(b["days"]) or 1
        rate = b["n"] / days
        classes.append({
            "dayClass": cls, "days": days, "cases": b["n"],
            "casesPerDay": round(rate, 1),
            "vsNormalPct": round((rate / base_rate - 1) * 100, 1) if base_rate else 0.0,
            "mix": mix(b["heads"], b["n"]),
            "peakHour": (b["hours"].most_common(1)[0][0] if b["hours"] else None),
        })
    order = {"Normal": 0, "Weekend": 1, "National Holiday": 2, "Festival": 3}
    classes.sort(key=lambda r: order.get(r["dayClass"], 9))

    occasions = []
    for label, p in per_label.items():
        days = len(p["days"]) or 1
        rate = p["n"] / days
        occasions.append({
            "occasion": label, "days": days, "cases": p["n"],
            "casesPerDay": round(rate, 1),
            "vsNormalPct": round((rate / base_rate - 1) * 100, 1) if base_rate else 0.0,
            "topHead": (p["heads"].most_common(1)[0][0] if p["heads"] else None),
        })
    occasions.sort(key=lambda r: -r["vsNormalPct"])

    return {
        "classes": classes,
        "occasions": occasions,
        "baselineCasesPerDay": round(base_rate, 1),
        "method": ("Days classified as Festival (+/-1 day), National Holiday, Weekend or "
                   "Normal. Lunar-calendar festival dates are approximate to within a day, "
                   "which the +/-1 day window absorbs. Rates are cases per day so classes "
                   "with different day counts stay comparable."),
    }
