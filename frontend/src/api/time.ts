import { apiFetch } from "./client";

export type PragueTimeSource = "internet" | "server" | "browser";

export type PragueTimeSnapshot = {
  timestamp: number;
  source: PragueTimeSource;
};

type WorldTimeApiResponse = {
  datetime?: string;
  utc_datetime?: string;
};

type TimeApiIoResponse = {
  dateTime?: string;
};

type ServerTimeResponse = {
  datetime?: string;
  now?: string;
  timestamp?: number | string;
};

function parseTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

async function fetchInternetTime(): Promise<PragueTimeSnapshot | null> {
  const attempts: Array<() => Promise<number | null>> = [
    async () => {
      const response = await fetch("https://worldtimeapi.org/api/timezone/Europe/Prague", { method: "GET" });
      if (!response.ok) return null;
      const data = (await response.json()) as WorldTimeApiResponse;
      return parseTimestamp(data.datetime ?? data.utc_datetime);
    },
    async () => {
      const response = await fetch("https://timeapi.io/api/Time/current/zone?timeZone=Europe/Prague", { method: "GET" });
      if (!response.ok) return null;
      const data = (await response.json()) as TimeApiIoResponse;
      return parseTimestamp(data.dateTime);
    },
  ];

  for (const attempt of attempts) {
    try {
      const timestamp = await attempt();
      if (timestamp !== null) return { timestamp, source: "internet" };
    } catch {
      // ignore and continue to the next provider
    }
  }

  return null;
}

async function fetchServerTime(): Promise<PragueTimeSnapshot | null> {
  try {
    const data = await apiFetch<ServerTimeResponse>("/api/v1/time", { method: "GET" });
    const timestamp = parseTimestamp(data.datetime ?? data.now ?? data.timestamp);
    if (timestamp !== null) return { timestamp, source: "server" };
  } catch {
    // optional endpoint on older deployments
  }
  return null;
}

export async function getPragueTimeSnapshot(): Promise<PragueTimeSnapshot> {
  const server = await fetchServerTime();
  if (server) return server;

  const internet = await fetchInternetTime();
  if (internet) return internet;

  return { timestamp: Date.now(), source: "browser" };
}
