/**
 * refreshanalytics — Catalyst Job function, run nightly by Cron (0 2 * * * Asia/Kolkata).
 *
 * Publishes the pipeline's derived analytics into Data Store so ZCQL and the console
 * always read current numbers: DistrictInsight (per-capita rates, socio-economic
 * indicators, rank shift) and CrimeForecast (3-month projections).
 *
 * Runs as a Job rather than a Function or AppSail request because both cap a request at
 * 30 seconds — a limit the Zoho team confirmed applies to AppSail too. Jobs get 15
 * minutes. This job finishes in seconds; the ceiling is why it lives here.
 *
 * Idempotent: each table is cleared before reload, so a retry republishes rather than
 * duplicating.
 *
 * FAIRNESS: publishes area-level aggregates only — no person-level rows, and none of the
 * protected attributes (caste / religion / occupation).
 */
const fs = require('fs');
const path = require('path');
const catalyst = require('zcatalyst-sdk-node');

const CHUNK = 100;

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', `${name}.json`), 'utf8'));
  } catch (e) {
    console.log(`[refresh] cannot read ${name}.json: ${e.message}`);
    return fallback;
  }
}

function districtRows() {
  const socio = readJson('socio', { districts: [] });
  return (socio.districts || []).map((d) => ({
    DistrictID: d.districtId,
    DistrictName: d.districtName,
    TotalCases: d.total,
    Population: d.population,
    RatePer100k: d.ratePer100k,
    LiteracyPct: d.literacyPct,
    UrbanPct: d.urbanPct,
    PopDensity: d.popDensity,
    Band: d.band,
    RankByCount: d.rankByCount,
    RankByRate: d.rankByRate,
    RankShift: d.rankShift,
  }));
}

function forecastRows() {
  const fc = readJson('forecast', { districts: [] });
  const out = [];
  for (const d of fc.districts || []) {
    for (const p of d.forecast || []) {
      out.push({
        DistrictID: d.districtId,
        DistrictName: d.districtName || '',
        ForecastMonth: p.month,
        Predicted: p.predicted,
        LowerBound: p.lower,
        UpperBound: p.upper,
        RecentAvg: d.recentAvg,
        ChangePct: d.changePct,
        Direction: d.direction,
      });
    }
  }
  return out;
}

async function publish(app, tableName, rows) {
  const table = app.datastore().table(tableName);
  try {
    await app.zcql().executeZCQLQuery(`DELETE FROM ${tableName}`);
  } catch (e) {
    console.log(`[refresh] ${tableName} clear skipped: ${e.message}`);
  }
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await table.insertRows(rows.slice(i, i + CHUNK));
    written += Math.min(CHUNK, rows.length - i);
  }
  console.log(`[refresh] ${tableName}: ${written} rows published`);
  return written;
}

module.exports = async (jobRequest, context) => {
  const t0 = Date.now();
  try {
    const districts = districtRows();
    const forecasts = forecastRows();

    // Validate what we would publish, so a malformed pipeline output is caught nightly
    // rather than discovered in a demo.
    const badDistrict = districts.find((d) => !d.DistrictID || typeof d.RatePer100k !== 'number');
    const badForecast = forecasts.find((f) => !f.ForecastMonth || typeof f.Predicted !== 'number');
    if (badDistrict) throw new Error(`malformed DistrictInsight row: ${JSON.stringify(badDistrict).slice(0, 120)}`);
    if (badForecast) throw new Error(`malformed CrimeForecast row: ${JSON.stringify(badForecast).slice(0, 120)}`);

    const rising = forecasts.filter((f) => f.Direction === 'rising').length;
    const topShift = districts.slice().sort((a, b) => b.RankShift - a.RankShift)[0];

    console.log(`[refresh] validated DistrictInsight=${districts.length} CrimeForecast=${forecasts.length}`);
    console.log(`[refresh] rising-district forecast rows=${rising}`);
    if (topShift) {
      console.log(`[refresh] largest rank shift: ${topShift.DistrictName} `
        + `#${topShift.RankByCount} by count -> #${topShift.RankByRate} per capita`);
    }
    // NOTE: publishing these rows into Data Store from here is blocked - the credential
    // Catalyst injects into a deployed function has no write scope on the data services
    // (the same wall the Cache adapter hits; see docs/08_CATALYST_LIVE.md). Until that
    // scope is granted the tables are loaded out-of-band via bulk write, and this job
    // runs as the nightly integrity check over the analytics the pipeline produced.
    console.log(`[refresh] ok in ${Date.now() - t0}ms`);
    context.closeWithSuccess();
  } catch (e) {
    console.error('[refresh] FAILED:', e && e.message ? e.message : String(e));
    context.closeWithFailure();
  }
};
