import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs/promises";
import path from "path";
import { JWT } from "google-auth-library";

const SHEET_ID =
  process.env.PAX_SHEET_ID ||
  "1y-u2voNBG6aQeqrO4ec0zma1N_1LHdasHRm6kjOxrk4";
const SA_PATH =
  process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_PATH ||
  ".secrets/google-sheets-service-account.json";

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
  const relPath = SA_PATH;
  const fullPath = path.isAbsolute(relPath)
    ? relPath
    : path.join(process.cwd(), relPath);
  const raw = await fs.readFile(fullPath, "utf8");
  return JSON.parse(raw);
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
  const serviceAccount = await readServiceAccount();
  const token = await getAccessToken(serviceAccount);
  const paxRows = await fetchSheetValues(SHEET_ID, "PAX", token);
  const paxById = parsePaxTab(paxRows);
  const paxAoRows = await fetchSheetValues(SHEET_ID, "PAX_AO", token);
  const { paxByAo, bandNameByF3Name } = parsePaxAoTab(paxAoRows, paxById);
  return {
    sheetId: SHEET_ID,
    updatedAt: new Date().toISOString(),
    paxByAo,
    bandNameByF3Name,
  };
};

const localPaxDirectoryPlugin = () => ({
  name: "local-pax-directory",
  configureServer(server) {
    server.middlewares.use("/local/pax-directory", async (req, res) => {
      try {
        const data = await loadPaxDirectory();
        res.setHeader("Content-Type", "application/json");
        res.statusCode = 200;
        res.end(JSON.stringify({ ...data, cached: false }));
      } catch (err) {
        res.setHeader("Content-Type", "application/json");
        res.statusCode = 500;
        res.end(
          JSON.stringify({
            error: "Failed to load PAX directory (local)",
            message: err?.message || String(err),
          })
        );
      }
    });
  },
});

export default defineConfig({
  plugins: [react(), localPaxDirectoryPlugin()],
});
