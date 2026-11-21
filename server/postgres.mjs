// Worker statements are application-owned SQL. Only their values are supplied at runtime.
const inert = /--[^\r\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"/g;
const tokens = new RegExp(inert.source + /|\?\d*|[a-z_][a-z_0-9]*|\s+|./.source, "gis");
const aggregates = {
  json_group_array: ["jsonb_agg", "[]"],
  json_group_object: ["jsonb_object_agg", "{}"],
};

function compile(source) {
  const pieces = source.match(tokens) ?? [];
  let parameterCount = 0;
  let insertIdParameter = false;
  let changesParameter = false;
  let previousWord = "";
  let aggregate = null;
  const parentheses = [];

  let text = pieces.map((part) => {
    if (/^\s|^--|^\/\*/.test(part)) return part;
    const word = part.toLowerCase();
    const previous = previousWord;
    previousWord = word;

    if (/^\?\d*$/.test(part)) {
      const number = part === "?" ? parameterCount + 1 : Number(part.slice(1));
      if (!Number.isSafeInteger(number) || number < 1) throw new TypeError("Invalid SQL parameter index");
      parameterCount = Math.max(parameterCount, number);
      return "$" + number;
    }
    if (previous === "as" && /^[a-z][a-zA-Z0-9_]*[A-Z][a-zA-Z0-9_]*$/.test(part)) {
      return '"' + part + '"';
    }
    if (Object.hasOwn(aggregates, word)) {
      aggregate = aggregates[word];
      return "CAST(COALESCE(" + aggregate[0];
    }
    if (part === "(") {
      parentheses.push(aggregate);
      aggregate = null;
    } else if (part === ")") {
      const closed = parentheses.pop();
      if (closed) return "), '" + closed[1] + "'::jsonb) AS text)";
    }
    if (word === "current_timestamp") return "app.utc_timestamp()";
    if (word === "group_concat") return "string_agg";
    if (word === "json_object") return "jsonb_build_object";
    return part;
  }).join("");

  // These are the SQLite expressions used by the Worker queries. Keep the
  // conversions explicit so SQLite and PostgreSQL retain the same result types.
  for (const [expression, replacement] of expressionRewrites) {
    text = replaceSql(text, expression, replacement);
  }
  text = replaceSql(text, /\blast_insert_rowid\(\)/gi, () => {
    insertIdParameter = true;
    return "CAST($" + (parameterCount + 1) + " AS bigint)";
  });
  text = replaceSql(text, /\bchanges\(\)/gi, () => {
    changesParameter = true;
    return "CAST($" + (parameterCount + Number(insertIdParameter) + 1) + " AS integer)";
  });

  return { text, parameterCount, insertIdParameter, changesParameter };
}

const expressionRewrites = [
  [/\bCASE WHEN (\$\d+) THEN\b/gi, "CASE WHEN CAST($1 AS integer) <> 0 THEN"],
  [/\bIS (\$\d+)/gi, "IS NOT DISTINCT FROM $1"],
  [/\bunixepoch\(\)/gi, "CAST(FLOOR(EXTRACT(EPOCH FROM statement_timestamp())) AS bigint)"],
  [/\bstrftime\('%Y-%m-%dT%H:%M:%fZ',\s*([\w.]+)\)/gi,
    "to_char(CAST($1 AS timestamp), 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')"],
  [/\bid IN \(SELECT value FROM json_each\(/gi, "id IN (SELECT CAST(value AS bigint) FROM json_each("],
  [/\bjson_each\((\$\d+)\)\s+AS slot\b/gi, "jsonb_each_text(CAST(CAST($1 AS text) AS jsonb)) AS slot"],
  [/\bjson_each\((\$\d+)\)/gi, "jsonb_array_elements_text(CAST(CAST($1 AS text) AS jsonb))"],
  [/\b([\w.]*\bvalue)\s*->>\s*'\$\.([a-zA-Z]+)'/g, jsonField],
  [/\bjson_extract\((slot\.value),\s*'\$\.([a-zA-Z]+)'\)/g, jsonField],
];

function replaceSql(text, expression, replacement) {
  const quoted = text.matchAll(inert);
  let next = quoted.next().value;
  return text.replace(expression, (match, ...args) => {
    const offset = args.at(-2);
    while (next && next.index + next[0].length <= offset) next = quoted.next().value;
    if (next && offset >= next.index) return match;

    const captures = args.slice(0, -2);
    return typeof replacement === "function"
      ? replacement(...captures)
      : replacement.replace(/\$(\d+)/g, (_, index) => captures[Number(index) - 1]);
  });
}

function jsonField(field, key) {
  const value = "(CAST(" + field + " AS jsonb) ->> '" + key + "')";
  return key === "itemId" || key === "id" ? "CAST(" + value + " AS bigint)" : value;
}

function normalizeRows(rows) {
  const integers = (rows.columns ?? []).filter(({ type }) => type === 20);
  return Array.from(rows, (row) => {
    for (const { name } of integers) {
      const value = row[name];
      if (typeof value === "string" && Number.isSafeInteger(Number(value))) {
        row[name] = Number(value);
      }
    }
    return row;
  });
}

const mutations = new Set(["INSERT", "UPDATE", "DELETE"]);
const retryableTransactionErrors = new Set(["40001", "40P01"]);

export function createPostgresDatabase(client) {
  const statements = new WeakMap();

  async function execute(sql, { query, values }, context) {
    const parameters = [...values];
    if (query.insertIdParameter) parameters.push(context.lastInsertId);
    if (query.changesParameter) parameters.push(context.changes);
    const rows = await sql.unsafe(query.text, parameters, { simple: false });
    const results = normalizeRows(rows);
    const changes = mutations.has(rows.command) ? rows.count : 0;
    if (mutations.has(rows.command)) context.changes = changes;
    if (rows.command === "INSERT" && results[0]?.id != null && changes === 1) {
      context.lastInsertId = results[0].id;
    }
    return {
      success: true,
      results,
      meta: { changes, last_row_id: context.lastInsertId ?? 0 },
    };
  }

  async function transaction(operations, snapshot) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        // D1 serializes batches. Match that guarantee when a save reads a
        // garment while a deletion checks its saved-look memberships.
        return await client.begin(snapshot ? "isolation level serializable" : "", async (sql) => {
          await sql.unsafe("SET LOCAL search_path TO app, pg_catalog");
          const context = { lastInsertId: null, changes: 0 };
          const results = [];
          for (const operation of operations) results.push(await execute(sql, operation, context));
          return results;
        });
      } catch (error) {
        if (attempt >= 2 || !retryableTransactionErrors.has(error.code)) throw error;
      }
    }
  }

  function bound(query, values) {
    const operation = { query, values };
    async function all() {
      checkBindings(operation);
      return (await transaction([operation], false))[0];
    }

    const statement = {
      bind(...parameters) {
        return bound(query, parameters);
      },
      all,
      run: all,
      async first(column) {
        const { results } = await all();
        const row = results[0] ?? null;
        if (!row || column === undefined) return row;
        if (!Object.hasOwn(row, column)) throw new TypeError("SQL result is missing column " + column);
        return row[column];
      },
    };
    statements.set(statement, operation);
    return statement;
  }

  return {
    prepare(text) {
      return bound(compile(text), []);
    },
    async batch(batch) {
      const operations = batch.map((statement) => {
        const operation = statements.get(statement);
        if (!operation) throw new TypeError("Batch statements must come from the same database");
        checkBindings(operation);
        return operation;
      });
      return operations.length ? transaction(operations, true) : [];
    },
  };
}

function checkBindings({ query, values }) {
  if (query.parameterCount !== values.length) throw new TypeError("Incorrect number of SQL arguments");
}
