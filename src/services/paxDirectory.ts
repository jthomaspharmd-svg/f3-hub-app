const CACHE_KEY = "f3PaxDirectoryCache";
const CACHE_TS_KEY = "f3PaxDirectoryCacheTs";
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export type PaxDirectory = {
  updatedAt?: string;
  paxByAo: Record<string, string[]>;
  bandNameByF3Name: Record<string, string>;
  cached?: boolean;
};

const readCache = (): PaxDirectory | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PaxDirectory;
  } catch {
    return null;
  }
};

const readCacheTs = (): number | null => {
  const raw = localStorage.getItem(CACHE_TS_KEY);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

const writeCache = (data: PaxDirectory) => {
  localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  localStorage.setItem(CACHE_TS_KEY, String(Date.now()));
};

export const getPaxDirectory = async (opts?: {
  force?: boolean;
}): Promise<PaxDirectory | null> => {
  const force = !!opts?.force;
  const cached = readCache();
  const cachedTs = readCacheTs();
  const isFresh =
    cached && cachedTs && Date.now() - cachedTs < CACHE_TTL_MS;

  if (!force && isFresh) return cached;

  const url = force
    ? "/.netlify/functions/pax-directory?refresh=1"
    : "/.netlify/functions/pax-directory";

  try {
    const res = await fetch(url);
    if (res.ok) {
      const data = (await res.json()) as PaxDirectory;
      if (data?.paxByAo) {
        writeCache(data);
        return data;
      }
    }
  } catch {
    // ignore and fall through to local/dev fallback
  }

  if (import.meta.env.DEV) {
    const localUrl = force
      ? "/local/pax-directory?refresh=1"
      : "/local/pax-directory";
    const localRes = await fetch(localUrl);
    if (localRes.ok) {
      const data = (await localRes.json()) as PaxDirectory;
      if (data?.paxByAo) {
        writeCache(data);
        return data;
      }
    }
  }

  return cached;
};

export const clearPaxDirectoryCache = () => {
  localStorage.removeItem(CACHE_KEY);
  localStorage.removeItem(CACHE_TS_KEY);
};
