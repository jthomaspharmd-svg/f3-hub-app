import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { JWT } from "google-auth-library";

const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
let cached = null;

const DEFAULT_SHEET_ID = "1y-u2voNBG6aQeqrO4ec0zma1N_1LHdasHRm6kjOxrk4";
const DEFAULT_LOCAL_SA_PATH = ".secrets/google-sheets-service-account.json";

const normalizeHeader = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/_/g, "");

const normalizeString = (value) => String(value || "").trim();

const isActiveValue = (value) => {
  const v = normalizeString(value).toLowerCase();
  return v === "true" || v === "yes" || v === "y" || v === "1";
};

const isAllowedRelationship = (value) => {
  const v = normalizeString(value).toLowerCase();
  return v === "home" || v === "regular";
};

const mapAoNameToId = (value) => {
  const v = normalizeString(value);
  const low = v.toLowerCase();
  if (low === "colosseum") return "colosseum";
  if (low === "compass at lost creek") return "compass";
  if (low === "gator bay") return "gatorbay";
  if (low === "jurassic park") return "jurassicpark";
  if (low === "phoenix rising") return "phoenixrising";
  if (low === "the hill") return "thehill";
  if (low === "the shadows") return "theshadows";
  return null;
};

const readServiceAccount = async () => {
  if (process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON);
  }

  const envPath = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH;
  const relPath = envPath || DEFAULT_LOCAL_SA_PATH;
  const cwd = process.cwd();
  const fullPath = path.isAbsolute(relPath)
    ? relPath
    : path.join(cwd, relPath);

  try {
    const raw = await fs.readFile(fullPath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Service account JSON not found. Set GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON or GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH. Tried: ${fullPath}`
    );
  }
};

const getAccessToken = async (serviceAccount) => {
  const client = new JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const { access_token } = await client.authorize();
  if (!access_token) throw new Error("Failed to obtain access token.");
  return access_token;
};

const fetchSheetValues = async (sheetId, tabName, token) => {
  const encoded = encodeURIComponent(tabName);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encoded}?majorDimension=ROWS`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Sheets API error: ${res.status} ${text}`);
  }

  const json = await res.json();
  return json.values || [];
};

const parsePaxTab = (rows) => {
  if (!rows.length) return {};
  const headers = rows[0].map(normalizeHeader);
  const idxId = headers.indexOf("paxid");
  const idxNickname = headers.indexOf("f3nickname");
  const idxBand = headers.indexOf("banddisplayname");

  const byId = {};
  for (const row of rows.slice(1)) {
    const id = normalizeString(row[idxId]);
    if (!id) continue;
    const f3Name = normalizeString(row[idxNickname]);
    if (!f3Name) continue;
    const bandName = normalizeString(row[idxBand]) || f3Name;
    byId[id] = { f3Name, bandName };
  }
  return byId;
};

const parsePaxAoTab = (rows, paxById) => {
  if (!rows.length) return { paxByAo: {}, bandNameByF3Name: {} };
  const headers = rows[0].map(normalizeHeader);
  const idxId = headers.indexOf("paxid");
  const idxHomeAo = headers.indexOf("homeao");
  const idxRelationship = headers.indexOf("relationship");
  const idxActive = headers.indexOf("active");

  const paxByAo = {};
  const bandNameByF3Name = {};

  for (const row of rows.slice(1)) {
    const paxId = normalizeString(row[idxId]);
    if (!paxId) continue;
    if (!isActiveValue(row[idxActive])) continue;
    if (!isAllowedRelationship(row[idxRelationship])) continue;

    const aoId = mapAoNameToId(row[idxHomeAo]);
    if (!aoId) continue;

    const pax = paxById[paxId];
    if (!pax) continue;

    if (!paxByAo[aoId]) paxByAo[aoId] = [];
    if (!paxByAo[aoId].includes(pax.f3Name)) {
      paxByAo[aoId].push(pax.f3Name);
    }

    if (!bandNameByF3Name[pax.f3Name]) {
      bandNameByF3Name[pax.f3Name] = pax.bandName;
    }
  }

  Object.values(paxByAo).forEach((list) => list.sort());

  return { paxByAo, bandNameByF3Name };
};

const loadPaxDirectory = async () => {
  const sheetId = process.env.PAX_SHEET_ID || DEFAULT_SHEET_ID;
  const serviceAccount = await readServiceAccount();
  const token = await getAccessToken(serviceAccount);

  const paxRows = await fetchSheetValues(sheetId, "PAX", token);
  const paxById = parsePaxTab(paxRows);
  const paxAoRows = await fetchSheetValues(sheetId, "PAX_AO", token);
  const { paxByAo, bandNameByF3Name } = parsePaxAoTab(paxAoRows, paxById);

  return {
    sheetId,
    updatedAt: new Date().toISOString(),
    paxByAo,
    bandNameByF3Name,
  };
};

export const handler = async (event) => {
  try {
    const forceRefresh =
      event?.queryStringParameters?.refresh === "1" ||
      event?.queryStringParameters?.force === "1";

    if (
      !forceRefresh &&
      cached &&
      Date.now() - cached.fetchedAt < CACHE_TTL_MS
    ) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...cached.data, cached: true }),
      };
    }

    const data = await loadPaxDirectory();
    cached = { data, fetchedAt: Date.now() };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, cached: false }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to load PAX directory",
        message: err?.message || String(err),
      }),
    };
  }
};
