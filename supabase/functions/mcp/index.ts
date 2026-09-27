import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { McpServer } from "npm:@modelcontextprotocol/sdk@1.28.0/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "npm:@modelcontextprotocol/sdk@1.28.0/server/webStandardStreamableHttp.js";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "npm:jose@5";
import {
  Pool,
  type PoolClient,
} from "https://deno.land/x/postgres@v0.17.0/mod.ts";
import { z } from "npm:zod@^3.25";
import { validateReadOnly, validateWrite } from "./validateSql.ts";
import { TASK_LIST_HTML, TASK_LIST_UI_URI } from "./taskListUi.ts";
import { corsHeaders } from "../_shared/cors.ts";

// --- Environment & Config ---

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_JWT_ISSUER =
  Deno.env.get("SB_JWT_ISSUER") ?? `${SUPABASE_URL}/auth/v1`;
const CRM_BASE_URL = (Deno.env.get("CRM_BASE_URL") ?? "").replace(/\/$/, "");

const JWKS = createRemoteJWKSet(
  new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
);

const connectionString =
  Deno.env.get("SUPABASE_DB_URL") ||
  "postgresql://postgres:postgres@db:5432/postgres";
const pool = new Pool(connectionString, 1);

// --- URL Helpers ---

function getBaseUrl(req: Request): string {
  const forwardedHost = req.headers.get("x-forwarded-host");
  if (forwardedHost) {
    // When behind a proxy (ngrok, production), always use HTTPS.
    // x-forwarded-proto may not survive the Supabase gateway chain.
    return `https://${forwardedHost}`;
  }
  const url = new URL(req.url);
  const host = url.host;
  // Supabase edge functions see http:// internally, but are served over HTTPS publicly
  const proto =
    host.includes("localhost") || host.includes("127.0.0.1") ? "http" : "https";
  return `${proto}://${host}`;
}

function getResourceMetadataUrl(req: Request): string {
  return `${getBaseUrl(req)}/functions/v1/mcp/oauth-protected-resource`;
}

// --- Auth ---

interface AuthInfo {
  token: string;
  userId: string;
  role?: string;
  clientId?: string;
  /**
   * The payload as returned by jwtVerify — signature, issuer and expiry already
   * checked. Every identity value handed to the database is derived from this
   * object and from nothing else, so an unverified decode can never become
   * request identity.
   */
  claims: JWTPayload;
}

async function validateToken(req: Request): Promise<AuthInfo | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return null;

  const [bearer, token] = authHeader.split(" ");
  if (bearer !== "Bearer" || !token) return null;

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: SUPABASE_JWT_ISSUER,
    });

    if (!payload.sub) return null;

    return {
      token,
      userId: payload.sub,
      role: payload.role as string | undefined,
      clientId: payload.client_id as string | undefined,
      claims: payload,
    };
  } catch {
    return null;
  }
}

// --- Request identity: what the database is told, and how it is held ---

/**
 * The role user SQL runs as. Never the pool's own login role: that account owns
 * the connection (and in a default local stack it is `postgres`), and owning
 * the connection must not make it the application's authority.
 */
const CALLER_ROLE = "authenticated";

/**
 * Every GUC this database reads to decide who the caller is.
 *
 * This list is not decorative — each entry is read by a live authorization
 * helper, and any entry left unpinned is an impersonation route:
 *
 *   request.jwt.claim.sub         nora_private.safe_auth_uid()  <- read FIRST,
 *                                 before request.jwt.claims, so pinning only
 *                                 the JSON claims leaves the singular GUC free
 *                                 and one allowed SELECT can forge the subject
 *   request.jwt.claim.role        nora_private.safe_auth_role()
 *   request.jwt.claim.session_id  nora_private.jwt_session_claim()  (W6-A
 *                                 owner-bound session binding)
 *   request.jwt.claim.iss         note-attachment trigger
 *   request.jwt.claims            the JSON fallback for all of the above
 *
 * A claim absent from the token is pinned to the empty string rather than left
 * alone, so an unpinned leftover on a pooled connection can never stand in for
 * a claim the caller does not actually have.
 */
function identityPins(claims: JWTPayload): [string, string][] {
  const text = (value: unknown): string =>
    typeof value === "string" ? value : value == null ? "" : String(value);

  return [
    ["request.jwt.claims", JSON.stringify(claims)],
    ["request.jwt.claim.sub", text(claims.sub)],
    ["request.jwt.claim.role", text(claims.role) || CALLER_ROLE],
    ["request.jwt.claim.iss", text(claims.iss)],
    ["request.jwt.claim.session_id", text(claims.session_id)],
  ];
}

/**
 * Runs `work` against the database as the authenticated caller, in one
 * transaction, and proves afterwards that the caller stayed who they said they
 * were.
 *
 * Order matters and is load-bearing:
 *
 *  1. `BEGIN [READ ONLY]` — read-only is set on the transaction itself, so it
 *     is Postgres, not this file, that refuses a write. That is what stops a
 *     SELECT which calls a mutating SECURITY DEFINER function: the function
 *     runs with its owner's privileges but still cannot write in a read-only
 *     transaction (SQLSTATE 25006).
 *  2. Pin every identity GUC transaction-locally, from the verified JWT.
 *  3. `SET LOCAL ROLE authenticated`, then assert it took. If the pool account
 *     cannot become `authenticated`, the request fails instead of silently
 *     running user SQL with the connection owner's privileges.
 *  4. Run the caller's work.
 *  5. Re-read the pinned GUCs and the effective role. If anything moved, the
 *     transaction is rolled back and the result is discarded — so even a form
 *     the AST validator failed to recognise cannot return impersonated rows.
 *  6. Read-only work always rolls back; only a mutation commits.
 *  7. `DISCARD ALL` before the connection goes back to the pool (size 1, so it
 *     is genuinely shared), resetting role, GUCs, plans and temp objects. The
 *     next caller starts from a clean session, whether this one succeeded,
 *     failed or was refused.
 */
async function withCallerIdentity<T>(
  authInfo: AuthInfo,
  options: { readOnly: boolean },
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const pins = identityPins(authInfo.claims);
  const client = await pool.connect();
  let inTransaction = false;

  try {
    await client.queryObject(options.readOnly ? "BEGIN READ ONLY" : "BEGIN");
    inTransaction = true;

    for (const [name, value] of pins) {
      // Parameterised: a claim value is never interpolated into SQL text.
      await client.queryObject({
        text: "SELECT set_config($1, $2, true)",
        args: [name, value],
      });
    }

    await client.queryObject(`SET LOCAL ROLE ${CALLER_ROLE}`);

    const before = await client.queryObject<{ current_user: string }>(
      "SELECT current_user",
    );
    if (before.rows[0]?.current_user !== CALLER_ROLE) {
      throw new Error(
        `Refusing to run: expected to execute as ${CALLER_ROLE}, got ${before.rows[0]?.current_user}`,
      );
    }

    const result = await work(client);

    // Post-condition: the identity the database would authorize by must still
    // be exactly the one taken from the verified JWT.
    const after = await client.queryObject<{
      effective_role: string;
      pinned: string[];
    }>({
      text: `SELECT current_user AS effective_role,
                    array(SELECT current_setting(n, true) FROM unnest($1::text[]) AS n) AS pinned`,
      args: [pins.map(([name]) => name)],
    });
    const effectiveRole = after.rows[0]?.effective_role;
    const observed = after.rows[0]?.pinned ?? [];
    const expected = pins.map(([, value]) => value);
    const drifted =
      effectiveRole !== CALLER_ROLE ||
      observed.length !== expected.length ||
      expected.some((value, index) => observed[index] !== value);

    if (drifted) {
      throw new Error(
        "Refusing the result: the query changed the request identity of its own session.",
      );
    }

    // A read never commits; there is nothing legitimate for it to persist.
    await client.queryObject(options.readOnly ? "ROLLBACK" : "COMMIT");
    inTransaction = false;

    return result;
  } catch (error) {
    if (inTransaction) {
      try {
        await client.queryObject("ROLLBACK");
      } catch {
        // The transaction is already gone; DISCARD ALL below still runs.
      }
      inTransaction = false;
    }
    throw error;
  } finally {
    // Outside any transaction by now. DISCARD ALL resets role, every SET,
    // prepared statements and temp objects, so nothing this request did can
    // reach the next caller on this pooled connection.
    //
    // Never throws from here: a `finally` that throws would replace the real
    // error with this one. If the reset fails the socket is closed first, so a
    // session that cannot be proven clean is never handed to the next caller;
    // the pool re-establishes the connection when it next hands this slot out.
    //
    // `end()` and `release()` are both needed and in this order. `end()` closes
    // the connection but does not give the slot back, and the pool holds a
    // single connection — ending without releasing would strand it and every
    // later request would wait forever.
    try {
      await client.queryObject("DISCARD ALL");
    } catch {
      console.error(
        "MCP: DISCARD ALL failed; dropping the connection instead of pooling it",
      );
      try {
        await client.end();
      } catch {
        // Already unusable; releasing below still frees the slot.
      }
    }
    try {
      client.release();
    } catch {
      // Nothing further to do.
    }
  }
}

// --- Database: get_schema ---

/**
 * W8 security closure: the schema is read as the caller, not as the pool's own
 * account. `information_schema.columns` already hides objects the current role
 * holds no privilege on, so switching to `authenticated` is what makes the
 * listing the caller's own. `pg_catalog` is world-readable and does no such
 * filtering, so the foreign-key query filters explicitly on
 * `has_table_privilege`.
 */
async function getSchemaData(authInfo: AuthInfo): Promise<string> {
  return await withCallerIdentity(
    authInfo,
    { readOnly: true },
    async (client) => {
      // Query 1: All columns from public schema
      const columnsResult = await client.queryObject<{
        table_name: string;
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
        table_type: string;
      }>(`
      SELECT
        c.table_name,
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default,
        t.table_type
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON c.table_name = t.table_name AND c.table_schema = t.table_schema
      WHERE c.table_schema = 'public'
      ORDER BY c.table_name, c.ordinal_position
    `);

      // Query 2: Foreign key relationships
      const fkResult = await client.queryObject<{
        source_table: string;
        source_column: string;
        target_table: string;
        target_column: string;
      }>(`
      SELECT
        src.relname AS source_table,
        src_att.attname AS source_column,
        tgt.relname AS target_table,
        tgt_att.attname AS target_column
      FROM pg_catalog.pg_constraint con
      JOIN pg_catalog.pg_class src ON con.conrelid = src.oid
      JOIN pg_catalog.pg_namespace nsp ON src.relnamespace = nsp.oid
      JOIN pg_catalog.pg_class tgt ON con.confrelid = tgt.oid
      JOIN pg_catalog.pg_attribute src_att
        ON src_att.attrelid = con.conrelid AND src_att.attnum = ANY(con.conkey)
      JOIN pg_catalog.pg_attribute tgt_att
        ON tgt_att.attrelid = con.confrelid AND tgt_att.attnum = ANY(con.confkey)
      WHERE con.contype = 'f' AND nsp.nspname = 'public'
        -- pg_catalog does not filter by privilege; restrict the listing to
        -- relations the caller may actually read.
        AND pg_catalog.has_table_privilege(src.oid, 'SELECT')
        AND pg_catalog.has_table_privilege(tgt.oid, 'SELECT')
      ORDER BY src.relname
    `);

      // Group columns by table
      const tables = new Map<
        string,
        {
          type: string;
          columns: {
            name: string;
            type: string;
            nullable: boolean;
            default: string | null;
          }[];
        }
      >();
      for (const row of columnsResult.rows) {
        if (!tables.has(row.table_name)) {
          tables.set(row.table_name, {
            type: row.table_type === "VIEW" ? "View" : "Table",
            columns: [],
          });
        }
        tables.get(row.table_name)!.columns.push({
          name: row.column_name,
          type: row.data_type,
          nullable: row.is_nullable === "YES",
          default: row.column_default,
        });
      }

      // Group foreign keys by source table
      const foreignKeys = new Map<
        string,
        { source_column: string; target_table: string; target_column: string }[]
      >();
      for (const row of fkResult.rows) {
        if (!foreignKeys.has(row.source_table)) {
          foreignKeys.set(row.source_table, []);
        }
        foreignKeys.get(row.source_table)!.push({
          source_column: row.source_column,
          target_table: row.target_table,
          target_column: row.target_column,
        });
      }

      // Format output
      const lines: string[] = [];
      for (const [tableName, table] of tables) {
        lines.push(`${table.type}: ${tableName}`);
        for (const col of table.columns) {
          const parts = [`  - ${col.name}: ${col.type}`];
          if (col.nullable) parts.push("(nullable)");
          if (col.default) parts.push(`default: ${col.default}`);
          lines.push(parts.join(" "));
        }
        const fks = foreignKeys.get(tableName);
        if (fks && fks.length > 0) {
          lines.push("  Foreign Keys:");
          for (const fk of fks) {
            lines.push(
              `    - ${fk.source_column} -> ${fk.target_table}.${fk.target_column}`,
            );
          }
        }
        lines.push("");
      }

      return lines.join("\n");
    },
  );
}

// --- Database: query with RLS ---

/**
 * Runs one caller-supplied statement.
 *
 * `readOnly` is not advisory: it selects a genuinely read-only database
 * transaction, so the `query` tool cannot write even through a SECURITY
 * DEFINER function that would otherwise be allowed to. The validator decides
 * what the statement may *say*; the transaction decides what it may *do*.
 */
async function executeQueryWithRLS(
  sql: string,
  authInfo: AuthInfo,
  validate: (sql: string) => string | null,
  options: { readOnly: boolean },
): Promise<
  { success: true; data: unknown[] } | { success: false; error: string }
> {
  const validationError = validate(sql);
  if (validationError) {
    return { success: false, error: validationError };
  }

  try {
    const rows = await withCallerIdentity(authInfo, options, async (client) => {
      const result = await client.queryObject(sql);
      // Convert BigInt values to numbers (Deno Postgres returns bigint for
      // PostgreSQL int8/count results, but JSON.stringify can't handle them)
      return JSON.parse(
        JSON.stringify(result.rows, (_key, value) =>
          typeof value === "bigint" ? Number(value) : value,
        ),
      ) as unknown[];
    });
    return { success: true, data: rows };
  } catch (error) {
    const message =
      error instanceof AggregateError
        ? error.errors.map((e) => e.message).join("; ")
        : error instanceof Error
          ? error.message
          : String(error);
    return { success: false, error: message };
  }
}

// --- MCP Server Factory ---

function createMcpServer(authInfo: AuthInfo): McpServer {
  const server = new McpServer({
    name: "atomic-crm",
    version: "1.0.0",
  });

  server.registerTool(
    "get_schema",
    {
      title: "Get Database Schema",
      description:
        "Retrieve the database schema for the user's Atomic CRM instance including all tables, views, columns, types, and foreign key relationships. Views (like contacts_summary, companies_summary) are read-only and provide pre-joined/aggregated data. Use them for search and list queries.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      const schema = await getSchemaData(authInfo);
      return { content: [{ type: "text" as const, text: schema }] };
    },
  );

  server.registerTool(
    "query",
    {
      title: "Query CRM Data",
      description: `Read data from the user's CRM instance using SQL SELECT queries.

IMPORTANT: Before using this tool, you MUST call the get_schema tool first to understand what tables and columns are available in the database.

Use this tool when the user asks about their CRM data such as:
- Contacts, companies, and deals
- Sales pipeline and forecasting data
- Customer interactions and notes
- Tasks and follow-ups
- Custom fields and metadata

Row Level Security (RLS) is enforced - queries automatically return only data the authenticated user has permission to access.

Use the *_summary views (contacts_summary, companies_summary) for queries that need aggregated data or search capabilities.

To filter by the current user, if the table has a sales_id column, add a WHERE sales_id = auth.uid() clause to your query.

This tool only supports SELECT queries. For INSERT, UPDATE, or DELETE operations, use the mutate tool.

Examples:
- "SELECT id, first_name, last_name, email_fts FROM contacts_summary WHERE email_fts LIKE '%@company.com%'"
- "SELECT name, stage, amount FROM deals WHERE created_at > NOW() - INTERVAL '30 days' ORDER BY amount DESC"
- "SELECT COUNT(*) as total_tasks, type FROM tasks WHERE done_date IS NULL GROUP BY type"
- "SELECT c.first_name, c.last_name, co.name as company_name FROM contacts c JOIN companies co ON c.company_id = co.id WHERE co.sector = 'Technology'"`,
      inputSchema: z.object({
        sql: z.string().describe("The SQL SELECT query to execute"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ sql }: { sql: string }) => {
      // eslint-disable-next-line no-console
      console.log(`[MCP query] user=${authInfo.userId} sql=${sql}`);
      const result = await executeQueryWithRLS(
        sql,
        authInfo,
        validateReadOnly,
        { readOnly: true },
      );
      if (result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result.data, null, 2),
            },
          ],
        };
      }
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
        isError: true,
      };
    },
  );

  server.registerTool(
    "mutate",
    {
      title: "Mutate CRM Data",
      description: `Create, update, or delete data in the user's CRM instance using SQL.

IMPORTANT: Before using this tool, you MUST call the get_schema tool first to understand what tables and columns are available in the database.

Use this tool for data modifications such as:
- Creating new contacts, companies, deals, tasks, or notes
- Updating existing records
- Deleting records

Row Level Security (RLS) is enforced - mutations only affect data the authenticated user has permission to modify.

IMPORTANT: Never specify sales_id in INSERT or UPDATE statements — it is automatically set to the authenticated user by a database trigger.

For read-only queries, use the query tool instead.

Examples:
- "INSERT INTO contacts (first_name, last_name, email) VALUES ('John', 'Doe', 'john@example.com')"
- "UPDATE deals SET stage = 'won-deal' WHERE id = 123"
- "DELETE FROM tasks WHERE id = 456"`,
      inputSchema: z.object({
        sql: z
          .string()
          .describe("The SQL INSERT, UPDATE, or DELETE statement to execute"),
      }),
      annotations: { destructiveHint: true },
    },
    async ({ sql }: { sql: string }) => {
      // eslint-disable-next-line no-console
      console.log(`[MCP mutate] user=${authInfo.userId} sql=${sql}`);
      const result = await executeQueryWithRLS(sql, authInfo, validateWrite, {
        readOnly: false,
      });
      if (result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result.data, null, 2),
            },
          ],
        };
      }
      return {
        content: [{ type: "text" as const, text: `Error: ${result.error}` }],
        isError: true,
      };
    },
  );

  // --- UI resource for the task-list MCP App ---

  // Inject the CRM base URL into the task-list guest HTML
  // so contact names can link back to the CRM
  const taskListHtml = TASK_LIST_HTML.replace(
    /__CRM_BASE_URL__/g,
    CRM_BASE_URL,
  );

  server.registerResource(
    "task-list-ui",
    TASK_LIST_UI_URI,
    {
      title: "Task List UI",
      description: "Interactive list of tasks with mark-as-done buttons.",
      mimeType: "text/html;profile=mcp-app",
    },
    async (uri: URL) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/html;profile=mcp-app",
          text: taskListHtml,
        },
      ],
    }),
  );

  const taskSchema = z.object({
    id: z
      .number()
      .int()
      .describe("Task id — required for the mark-as-done action"),
    text: z.string().nullable().optional().describe("Task description"),
    type: z
      .string()
      .nullable()
      .optional()
      .describe("Task category/type (rendered as a pill)"),
    due_date: z.string().nullable().optional().describe("ISO date string"),
    done_date: z
      .string()
      .nullable()
      .optional()
      .describe("ISO timestamp if already done; null or omitted for pending"),
    contact_name: z
      .string()
      .nullable()
      .optional()
      .describe("Full name of the linked contact, if any"),
    contact_id: z
      .number()
      .int()
      .nullable()
      .optional()
      .describe(
        "Id of the linked contact — used to render the contact name as a link to the CRM contact page",
      ),
  });
  type Task = z.infer<typeof taskSchema>;

  server.registerTool(
    "display_task_list",
    {
      title: "Display Task List",
      description: `Render an array of task rows as an interactive UI (MCP App) where the user can mark each task as done.

This tool is presentational: it does not query the database. Fetch the rows yourself via the query tool (joining contacts for contact_name when useful), then pass them here. Prefer this over replying with a bulleted list of tasks.

Each task should include at least: id (required, used for the mark-as-done action), text, type, due_date, done_date, and optionally contact_name + contact_id (the UI renders the name as a link to the CRM contact page when contact_id is provided).`,
      inputSchema: {
        tasks: z.array(taskSchema).describe("Array of task objects to render"),
      },
      annotations: { readOnlyHint: true },
      _meta: {
        ui: {
          resourceUri: TASK_LIST_UI_URI,
          visibility: ["model"],
        },
      },
    },
    ({ tasks }: { tasks: Task[] }) => {
      // eslint-disable-next-line no-console
      console.log(
        `[MCP display_task_list] user=${authInfo.userId} count=${tasks.length}`,
      );
      // content carries the display text (used by Claude's guest HTML);
      // structuredContent carries the typed data (used by ChatGPT's Apps SDK
      // convention). Supplying both keeps the guest host-agnostic.
      return {
        content: [{ type: "text" as const, text: JSON.stringify(tasks) }],
        structuredContent: { tasks },
      };
    },
  );

  server.registerTool(
    "complete_task",
    {
      title: "Mark Task Done",
      description:
        "Mark a single task as done by id. Used by the task-list UI when the user clicks a task's checkmark, and also callable directly by the model.",
      inputSchema: {
        id: z
          .number()
          .int()
          .positive()
          .describe("The id of the task to mark as done"),
      },
      annotations: { idempotentHint: true },
      _meta: {
        ui: {
          visibility: ["model", "app"],
        },
      },
    },
    async ({ id }: { id: number }) => {
      // RETURNING id lets us distinguish a successful update from an
      // RLS-blocked or non-existent row (executeQueryWithRLS would otherwise
      // report success on 0 rows affected).
      const sql = `UPDATE tasks SET done_date = NOW() WHERE id = ${id} RETURNING id`;
      // eslint-disable-next-line no-console
      console.log(`[MCP complete_task] user=${authInfo.userId} id=${id}`);
      const result = await executeQueryWithRLS(sql, authInfo, validateWrite, {
        readOnly: false,
      });
      if (!result.success) {
        return {
          content: [{ type: "text" as const, text: `Error: ${result.error}` }],
          isError: true,
        };
      }
      if (result.data.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: task ${id} not found or permission denied.`,
            },
          ],
          isError: true,
        };
      }
      return {
        content: [
          { type: "text" as const, text: `Task ${id} marked as done.` },
        ],
      };
    },
  );

  return server;
}

// --- OAuth Protected Resource Metadata ---

function handleProtectedResourceMetadata(req: Request): Response {
  const baseUrl = getBaseUrl(req);
  return new Response(
    JSON.stringify({
      resource: `${baseUrl}/functions/v1/mcp`,
      authorization_servers: [`${baseUrl}/auth/v1`],
      bearer_methods_supported: ["header"],
    }),
    {
      headers: { "Content-Type": "application/json" },
    },
  );
}

// --- MCP Request Handler ---

async function handleMcpRequest(req: Request): Promise<Response> {
  // Validate auth
  const authInfo = await validateToken(req);
  if (!authInfo) {
    const metadataUrl = getResourceMetadataUrl(req);
    return new Response("Unauthorized", {
      status: 401,
      headers: {
        "WWW-Authenticate": `Bearer resource_metadata="${metadataUrl}"`,
      },
    });
  }

  // Create stateless MCP server + transport for this request
  const server = createMcpServer(authInfo);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // Stateless
  });

  await server.connect(transport);

  // Clean up server + transport when the connection closes.
  // Do NOT close in a finally block — the SSE response body is a
  // ReadableStream that must remain open until the client consumes it.
  transport.onclose = () => {
    server.close().catch(() => {});
  };

  try {
    return await transport.handleRequest(req);
  } catch (error) {
    console.error("MCP request error:", error);
    await transport.close();
    await server.close();
    return new Response("Internal Server Error", { status: 500 });
  }
}

// --- CORS Helper ---

function withCorsHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// --- Route Dispatcher ---

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname;

  // GET /functions/v1/mcp/oauth-protected-resource → RFC 9728 metadata
  if (path.endsWith("/oauth-protected-resource") && req.method === "GET") {
    return withCorsHeaders(handleProtectedResourceMetadata(req));
  }

  // POST/GET/DELETE /functions/v1/mcp → MCP protocol handler
  if (path.endsWith("/mcp") || path.endsWith("/mcp/")) {
    return withCorsHeaders(await handleMcpRequest(req));
  }

  return withCorsHeaders(new Response("Not Found", { status: 404 }));
});
