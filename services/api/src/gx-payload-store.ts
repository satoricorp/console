import { gunzipSync, gzipSync } from "node:zlib";
import type postgres from "postgres";
import type { PushBundle } from "./types";

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

type StoredPayloadRow = {
  encoding: string;
  payload: Buffer | Uint8Array;
};

export function createPayloadManifest(payload: PushBundle): PushBundle {
  return {
    ...payload,
    stack: payload.stack?.map((item) => ({
      ...item,
      patch: "",
    })),
    sessions: [],
    metadata: {
      ...payload.metadata,
      gx_payload_storage: "compressed_side_table",
      gx_payload_encoding: "gzip",
      gx_payload_manifest: "compact",
    },
  };
}

export function encodeFullPayload(payload: PushBundle): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(payload), "utf8"));
}

export function decodeFullPayload(row: StoredPayloadRow): PushBundle {
  if (row.encoding !== "gzip") {
    throw new Error(`Unsupported GX payload encoding: ${row.encoding}`);
  }
  return JSON.parse(gunzipSync(row.payload).toString("utf8")) as PushBundle;
}

export async function storeFullPayload(
  tx: SqlExecutor,
  eventId: string,
  payload: PushBundle,
): Promise<void> {
  await tx`
    INSERT INTO gx_pr_event_payloads (
      event_id,
      encoding,
      payload
    ) VALUES (
      ${eventId},
      'gzip',
      ${encodeFullPayload(payload)}
    )
    ON CONFLICT (event_id)
    DO UPDATE SET
      encoding = EXCLUDED.encoding,
      payload = EXCLUDED.payload
  `;
}

export async function loadFullPayload(
  db: SqlExecutor,
  eventId: string,
  fallbackPayload: PushBundle,
): Promise<PushBundle> {
  const rows = await db<StoredPayloadRow[]>`
    SELECT encoding, payload
    FROM gx_pr_event_payloads
    WHERE event_id = ${eventId}
    LIMIT 1
  `;

  const stored = rows[0];
  if (!stored) {
    return fallbackPayload;
  }

  return decodeFullPayload(stored);
}
