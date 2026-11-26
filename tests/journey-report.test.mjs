import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import postgres from "postgres";

const windowStart = "2011-05-10";
const windowEnd = "2011-05-11";
const day = Date.parse(windowStart + "T00:00:00Z") / 1000;
const expected = [
  ["first_own_look", 3, 2, 66.7, 180],
  ["resume_setup", 4, 2, 50, 17.5],
  ["resume_planner", 4, 1, 25, 20],
  ["resume_setup_or_planner", 4, 2, 50, 15],
  ["reopen_saved_look", 4, 2, 50, 37.5],
  ["log_wear", 4, 2, 50, 50],
  ["reopen_or_wear", 4, 3, 75, 35],
];

function report(dialect, from = windowStart, until = windowEnd) {
  return execFileSync(process.execPath, ["scripts/closet-journeys.mjs", dialect, from, until], { encoding: "utf8" });
}

// Shared, hand-timed fixture. Isolate the PostgreSQL fixture in a rolled-back transaction.
async function seed(run, firstId) {
  const user = i => firstId + i;
  const start = n => new Date((day + n) * 1000).toISOString();
  for (const [i, seconds] of [[1, 0], [2, 10], [3, 20], [4, -86400]]) {
    await run(`INSERT INTO users(id, auth_provider, auth_subject, created_at)
      VALUES (${user(i)}, 'test', 'journey-${user(i)}', '${start(seconds).replace("T", " ").slice(0, 19)}')`);
    await run(`INSERT INTO outfit_requests(id,user_id,occasion) VALUES (${user(i)},${user(i)},'Dinner')`);
    await run(`INSERT INTO generation_runs(id,user_id,request_id) VALUES (${user(i)},${user(i)},${user(i)})`);
    await run(`INSERT INTO outfit_options(id,user_id,run_id,position,title) VALUES (${user(i)},${user(i)},${user(i)},1,'Dinner')`);
  }
  for (const [i, owner, sample, fixture] of [[1,1,false,false],[2,2,false,false],[3,3,true,false],[4,3,false,true],[5,3,false,false]]) {
    const id = user(i);
    await run(`INSERT INTO private_files(file_id,user_id,state) VALUES ('journey-${id}',${user(owner)},'ready')`);
    await run(`INSERT INTO wardrobe_items(id,user_id,name,category,image_file_id,sample_slug,extraction_source,confirmed_at)
      VALUES (${id},${user(owner)},'Shirt','top','journey-${id}',${sample ? "'starter'" : "NULL"},${fixture ? "'fixture'" : "NULL"},'confirmed')`);
  }
  for (const [i, owner, garment, saved] of [[1,1,null,30],[2,1,1,120],[3,2,2,250],[4,3,3,75],[5,3,4,95],[6,1,1,360],[7,3,5,86401]]) {
    const id = firstId + 100 + i;
    await run(`INSERT INTO saved_looks(id,user_id,source_option_id,name,saved_at)
      VALUES (${id},${user(owner)},${user(owner)},'Dinner','${start(saved)}')`);
    if (garment) await run(`INSERT INTO saved_look_items(user_id,saved_look_id,slot,item_id,item_name)
      VALUES (${user(owner)},${id},'top',${user(garment)},'Shirt')`);
  }
  return async () => {
    await run(`DELETE FROM saved_looks WHERE id = ${firstId + 102}`); // The first achievement survives deletion.
    const observations = [
      [1,0,"open"], [1,4,"planner"], [1,50,"reopen"], // Signup visit.
      [1,4000,"open"], [1,4010,"setup"], [1,4011,"setup"], [1,4040,"reopen"], [1,4041,"reopen"], [1,4070,"wear"],
      [1,9000,"open"], [1,9020,"planner"], [1,9025,"setup"], [1,9035,"reopen"],
      [2,6000,"open"], [2,6030,"wear"], [2,6031,"wear"],
      [4,-40,"open"], [4,100,"planner"], // Crosses the reporting boundary.
      [4,8000,"open"], // Returning visit with no outcome.
      [4,86400,"open"], [4,86401,"wear"], // Exclusive end.
    ];
    for (const [owner, seconds, activity] of observations) {
      await run(`INSERT INTO journey_activity(user_id,observed_s,activity) VALUES (${user(owner)},${day + seconds},'${activity}')`);
    }
  };
}

function check(rows, expectedRows = expected) {
  assert.deepEqual(rows.map(row => [row.metric, ...["eligible", "reached", "share_pct", "median_seconds"]
    .map(key => row[key] == null ? null : Number(row[key]))]), expectedRows);
}

for (const backfill of [true, false]) {
  test(`D1 reports ${backfill ? "backfilled" : "new"} own looks and keeps the first achievement through deletion`, async t => {
    const db = new DatabaseSync(":memory:");
    t.after(() => db.close());
    const migrations = new URL("../drizzle/", import.meta.url);
    const files = readdirSync(migrations).filter(file => file.endsWith(".sql")).sort();
    const migrate = file => db.exec(readFileSync(new URL(file, migrations), "utf8"));
    files.filter(file => !backfill || file < "0119").forEach(migrate);
    const finish = await seed(sql => db.exec(sql), 1000);
    if (backfill) files.filter(file => file >= "0119").forEach(migrate);
    await finish();
    check(db.prepare(report("d1")).all());
    check(db.prepare(report("d1", "2011-06-01", "2011-06-02")).all(), expected.map(([metric]) => [metric,0,0,null,null]));
  });
}

test("Postgres records new snapshots and reports the same cohorts, medians and denominators as D1",
  { skip: !process.env.MBTI_POSTGRES_TEST_URL }, async t => {
    const db = postgres(process.env.MBTI_POSTGRES_TEST_URL, { max: 1, prepare: false });
    t.after(() => db.end());
    const rollback = new Error("roll back fixture");
    await assert.rejects(db.begin(async tx => {
      await tx.unsafe("SET LOCAL ROLE mbti_closet_runtime");
      await tx.unsafe("SET LOCAL search_path = app, pg_catalog");
      const finish = await seed(sql => tx.unsafe(sql), 8000000000000);
      await finish();
      await tx.unsafe("INSERT INTO journey_activity VALUES (8000000000001, $1, 'wear') ON CONFLICT DO NOTHING", [day + 4070]);
      await tx.unsafe("RESET ROLE"); // The operator reads aggregates with a database login.
      check(await tx.unsafe(report("postgres")));
      throw rollback;
    }), error => error === rollback);
  });
