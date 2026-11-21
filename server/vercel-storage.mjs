import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { createPostgresDatabase } from "./postgres.mjs";
import { createSupabaseBucket } from "./supabase-bucket.mjs";

let storage;

export function vercelStorage() {
  if (storage) return storage;
  const { DATABASE_URL, SUPABASE_DB_CA, SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_STORAGE_BUCKET } = process.env;
  if (!DATABASE_URL || !SUPABASE_URL || !SUPABASE_SECRET_KEY || !SUPABASE_STORAGE_BUCKET) {
    throw new Error("Supabase development storage is not configured");
  }
  const client = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
  const sql = postgres(DATABASE_URL, {
    max: 1,
    prepare: false,
    ssl: { rejectUnauthorized: true, ...(SUPABASE_DB_CA ? { ca: SUPABASE_DB_CA } : {}) },
    connect_timeout: 10,
    idle_timeout: 20,
  });
  storage = {
    DB: createPostgresDatabase(sql),
    BUCKET: createSupabaseBucket(client, SUPABASE_STORAGE_BUCKET),
  };
  return storage;
}
