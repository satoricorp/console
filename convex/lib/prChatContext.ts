/** Build PR-scoped context from a gx pr push bundle (Postgres / Convex payload). */

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pathsFromChange(change: unknown): string[] {
  const changeRecord = asRecord(change);
  if (!changeRecord) return [];
  const files = changeRecord.files;
  if (!Array.isArray(files)) return [];
  return files.filter((f): f is string => typeof f === "string");
}

export function extractChangedFiles(payload: unknown): string[] {
  const record = asRecord(payload);
  if (!record) return [];

  const paths: string[] = [];

  const pathsValue = record.paths ?? record.files ?? record.treePaths;
  if (Array.isArray(pathsValue)) {
    for (const entry of pathsValue) {
      if (typeof entry === "string") {
        paths.push(entry);
        continue;
      }
      const fileRecord = asRecord(entry);
      if (!fileRecord) continue;
      if (typeof fileRecord.path === "string") paths.push(fileRecord.path);
      else if (typeof fileRecord.filename === "string") {
        paths.push(fileRecord.filename);
      }
    }
  }

  paths.push(...pathsFromChange(record.change));

  const stack = record.stack;
  if (Array.isArray(stack)) {
    for (const entry of stack) {
      const stackRecord = asRecord(entry);
      paths.push(...pathsFromChange(stackRecord?.change));
    }
  }

  return [...new Set(paths)];
}

export function extractPrBody(payload: unknown): string | undefined {
  const record = asRecord(payload);
  if (!record) return undefined;

  const change = asRecord(record.change);
  if (change && typeof change.description === "string" && change.description.trim()) {
    return change.description.trim();
  }

  const stack = record.stack;
  if (Array.isArray(stack)) {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      const entry = asRecord(stack[index]);
      const stackChange = asRecord(entry?.change);
      if (
        stackChange &&
        typeof stackChange.description === "string" &&
        stackChange.description.trim()
      ) {
        return stackChange.description.trim();
      }
    }
  }

  return undefined;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}

function textFromJsonBody(body: string | undefined): string | undefined {
  if (!body?.trim()) return undefined;

  try {
    const parsed = JSON.parse(body) as unknown;
    const record = asRecord(parsed);
    if (!record) return truncate(body.trim(), 800);

    const messages = record.messages;
    if (Array.isArray(messages)) {
      const lines: string[] = [];
      for (const message of messages.slice(-6)) {
        const msg = asRecord(message);
        if (!msg) continue;
        const role = typeof msg.role === "string" ? msg.role : "message";
        const content = messageContent(msg.content);
        if (content) lines.push(`${role}: ${truncate(content, 400)}`);
      }
      if (lines.length > 0) return lines.join("\n");
    }

    if (typeof record.prompt === "string") return truncate(record.prompt, 800);
    if (typeof record.input === "string") return truncate(record.input, 800);
  } catch {
    // Fall through to raw body.
  }

  return truncate(body.trim(), 800);
}

function messageContent(content: unknown): string | undefined {
  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      const record = asRecord(part);
      if (record && typeof record.text === "string" && record.text.trim()) {
        parts.push(record.text.trim());
      }
    }
    if (parts.length > 0) return parts.join("\n");
  }
  return undefined;
}

function assistantTextFromResponses(responses: unknown): string | undefined {
  if (!Array.isArray(responses) || responses.length === 0) return undefined;

  for (let index = responses.length - 1; index >= 0; index -= 1) {
    const response = asRecord(responses[index]);
    if (!response) continue;
    const text = textFromJsonBody(
      typeof response.response_body === "string"
        ? response.response_body
        : undefined,
    );
    if (text) return text;
  }

  return undefined;
}

function requestMentionsFiles(
  requestRecord: Record<string, unknown>,
  filePaths: string[],
): boolean {
  if (filePaths.length === 0) return true;

  const body =
    typeof requestRecord.request_body === "string"
      ? requestRecord.request_body
      : "";
  if (!body) return false;

  for (const filePath of filePaths) {
    if (body.includes(filePath)) return true;
    const basename = filePath.split("/").pop();
    if (basename && body.includes(basename)) return true;
  }

  return false;
}

function buildSessionSummaryFromPayload(
  payload: unknown,
  options?: {
    maxLength?: number;
    filePaths?: string[];
  },
): string | undefined {
  const maxLength = options?.maxLength ?? 6000;
  const filePaths = options?.filePaths ?? [];
  const record = asRecord(payload);
  const sessions = record?.sessions;
  if (!Array.isArray(sessions) || sessions.length === 0) return undefined;

  const parts: string[] = [];

  for (const session of sessions) {
    const sessionRecord = asRecord(session);
    if (!sessionRecord) continue;

    const command =
      typeof sessionRecord.command === "string"
        ? sessionRecord.command
        : "session";
    const requests = Array.isArray(sessionRecord.requests)
      ? sessionRecord.requests
      : [];

    const matchingRequests = requests.filter((request) => {
      const requestRecord = asRecord(request);
      return (
        requestRecord && requestMentionsFiles(requestRecord, filePaths)
      );
    });
    const selectedRequests =
      filePaths.length > 0 ? matchingRequests : requests;

    if (filePaths.length > 0 && selectedRequests.length === 0) {
      continue;
    }

    parts.push(
      `### ${command} (${selectedRequests.length}/${requests.length} requests)`,
    );

    for (const request of selectedRequests.slice(-8)) {
      const requestRecord = asRecord(request);
      if (!requestRecord) continue;

      const model =
        (typeof requestRecord.model === "string" && requestRecord.model) ||
        (typeof requestRecord.provider === "string" &&
          requestRecord.provider) ||
        "model";

      const userText = textFromJsonBody(
        typeof requestRecord.request_body === "string"
          ? requestRecord.request_body
          : undefined,
      );
      const assistantText = assistantTextFromResponses(
        requestRecord.responses,
      );

      parts.push(`[${model}]`);
      if (userText) parts.push(userText);
      if (assistantText) parts.push(assistantText);
    }
  }

  const summary = parts.join("\n").trim();
  if (!summary) return undefined;
  return truncate(summary, maxLength);
}

export function buildSessionSummary(
  payload: unknown,
  maxLength = 6000,
): string | undefined {
  return buildSessionSummaryFromPayload(payload, { maxLength });
}

export function buildSessionSummaryForPins(
  payload: unknown,
  pinnedFiles: string[],
  maxLength = 4000,
): string | undefined {
  if (pinnedFiles.length === 0) return undefined;
  return buildSessionSummaryFromPayload(payload, {
    maxLength,
    filePaths: pinnedFiles,
  });
}

export type PrChatContext = {
  changedFiles: string[];
  prBody?: string;
  sessionSummary?: string;
};

export function buildPrChatContext(payload: unknown): PrChatContext {
  return {
    changedFiles: extractChangedFiles(payload),
    prBody: extractPrBody(payload),
    sessionSummary: buildSessionSummary(payload),
  };
}
