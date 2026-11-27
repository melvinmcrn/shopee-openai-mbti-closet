// Print one aggregate-only SELECT for the operator's database client.
const [dialect, fromDate, untilDate] = process.argv.slice(2);
function utcDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const ms = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(ms) && new Date(ms).toISOString().startsWith(value) ? ms / 1000 : NaN;
}
const from = utcDay(fromDate);
const until = utcDay(untilDate);
if (process.argv.length !== 5 || !["d1", "postgres"].includes(dialect) || !(from < until)) {
  console.error("Usage: node scripts/closet-journeys.mjs d1|postgres FROM_DATE UNTIL_DATE (YYYY-MM-DD UTC, exclusive end)");
  process.exit(1);
}

const schema = dialect === "postgres" ? "app." : "";
const signup = dialect === "postgres"
  ? "CAST(FLOOR(EXTRACT(EPOCH FROM CAST(created_at AS timestamp))) AS bigint)"
  : "unixepoch(created_at)";
const idleSeconds = 1800;

console.log(`WITH metrics(ord, metric) AS (VALUES
  (1,'first_own_look'), (2,'resume_setup'), (3,'resume_planner'),
  (4,'resume_setup_or_planner'), (5,'reopen_saved_look'), (6,'log_wear'), (7,'reopen_or_wear')
), accounts AS (
  SELECT id, ${signup} AS signup_s, first_own_look_s FROM ${schema}users
), observations AS (
  SELECT user_id, observed_s, activity FROM ${schema}journey_activity
  WHERE observed_s >= ${from - idleSeconds} AND observed_s < ${until}
  UNION ALL
  SELECT id, signup_s, 'signup' FROM accounts
  WHERE signup_s >= ${from - idleSeconds} AND signup_s < ${until}
), gaps AS (
  SELECT *, observed_s - LAG(observed_s) OVER (
    PARTITION BY user_id ORDER BY observed_s, activity
  ) AS gap_s FROM observations
), numbered AS (
  SELECT *, SUM(CASE WHEN gap_s IS NULL OR gap_s >= ${idleSeconds} THEN 1 ELSE 0 END)
    OVER (PARTITION BY user_id ORDER BY observed_s, activity ROWS UNBOUNDED PRECEDING) AS visit
  FROM gaps
), visits AS (
  SELECT user_id, visit, MIN(observed_s) AS start_s,
    MIN(CASE WHEN activity = 'setup' THEN observed_s END) AS setup_s,
    MIN(CASE WHEN activity = 'planner' THEN observed_s END) AS planner_s,
    MIN(CASE WHEN activity IN ('setup', 'planner') THEN observed_s END) AS resume_s,
    MIN(CASE WHEN activity = 'reopen' THEN observed_s END) AS reopen_s,
    MIN(CASE WHEN activity = 'wear' THEN observed_s END) AS wear_s,
    MIN(CASE WHEN activity IN ('reopen', 'wear') THEN observed_s END) AS either_s
  FROM numbered GROUP BY user_id, visit
  HAVING MIN(observed_s) >= ${from} AND MAX(CASE WHEN activity = 'open' THEN 1 ELSE 0 END) = 1
    AND MAX(CASE WHEN activity = 'signup' THEN 1 ELSE 0 END) = 0
), samples AS (
  SELECT 'first_own_look' AS metric,
    CASE WHEN first_own_look_s >= signup_s AND first_own_look_s < ${until}
      THEN first_own_look_s - signup_s END AS seconds
  FROM accounts WHERE signup_s >= ${from} AND signup_s < ${until}
  UNION ALL
  SELECT metric, CASE metric
    WHEN 'resume_setup' THEN setup_s WHEN 'resume_planner' THEN planner_s
    WHEN 'resume_setup_or_planner' THEN resume_s
    WHEN 'reopen_saved_look' THEN reopen_s WHEN 'log_wear' THEN wear_s
    WHEN 'reopen_or_wear' THEN either_s END - start_s
  FROM visits CROSS JOIN metrics WHERE ord > 1
), ranked AS (
  SELECT metric, seconds, COUNT(seconds) OVER (PARTITION BY metric) AS successes,
    ROW_NUMBER() OVER (PARTITION BY metric ORDER BY CASE WHEN seconds IS NULL THEN 1 ELSE 0 END, seconds) AS pos
  FROM samples
)
SELECT m.metric, COUNT(r.metric) AS eligible, COUNT(r.seconds) AS reached,
  ROUND(100.0 * COUNT(r.seconds) / NULLIF(COUNT(r.metric), 0), 1) AS share_pct,
  AVG(CASE WHEN pos BETWEEN (successes + 1) / 2 AND (successes + 2) / 2 THEN seconds END) AS median_seconds
FROM metrics m LEFT JOIN ranked r ON m.metric = r.metric
GROUP BY m.ord, m.metric ORDER BY m.ord;`);
