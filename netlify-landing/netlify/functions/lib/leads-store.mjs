import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectLambda, getStore } from "@netlify/blobs";

const STORE = "early-access";
const KEY = "leads";
const MAX_ENTRIES = 5000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE_PATH = path.resolve(
  __dirname,
  "../../../.data/early-access-leads.json",
);

function useFileStore() {
  return (
    process.env.EARLY_ACCESS_USE_FILE === "1" ||
    process.env.NETLIFY_DEV === "true" ||
    process.env.LEADS_USE_FILE === "1"
  );
}

function wireLambdaBlobs(event) {
  if (!event || useFileStore()) return;
  try {
    connectLambda(event);
  } catch (err) {
    console.warn("connectLambda failed", err);
  }
}

function getBlobStore() {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.NETLIFY_BLOB_READ_WRITE_TOKEN;
  if (siteID && token) {
    return getStore({ name: STORE, siteID, token });
  }
  return getStore({ name: STORE });
}

async function readLeadsFromFile() {
  try {
    const raw = await fs.readFile(FILE_PATH, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    throw err;
  }
}

async function writeLeadsToFile(leads) {
  await fs.mkdir(path.dirname(FILE_PATH), { recursive: true });
  await fs.writeFile(FILE_PATH, JSON.stringify(leads, null, 2), "utf8");
}

async function readLeadsFromBlobs() {
  const store = getBlobStore();
  const data = await store.get(KEY, { type: "json" });
  if (data == null) return [];
  return Array.isArray(data) ? data : [];
}

async function writeLeadsToBlobs(leads) {
  const store = getBlobStore();
  await store.setJSON(KEY, leads);
}

export async function readLeads(event) {
  wireLambdaBlobs(event);

  if (useFileStore()) {
    try {
      return await readLeadsFromFile();
    } catch (err) {
      console.error("readLeadsFromFile failed", err);
      return [];
    }
  }

  try {
    return await readLeadsFromBlobs();
  } catch (err) {
    console.error("Blobs read failed", err);
    throw err;
  }
}

export async function appendLead(entry, event) {
  wireLambdaBlobs(event);

  if (useFileStore()) {
    const leads = await readLeadsFromFile();
    leads.unshift(entry);
    if (leads.length > MAX_ENTRIES) leads.length = MAX_ENTRIES;
    await writeLeadsToFile(leads);
    return leads.length;
  }

  const leads = await readLeadsFromBlobs();
  leads.unshift(entry);
  if (leads.length > MAX_ENTRIES) leads.length = MAX_ENTRIES;
  await writeLeadsToBlobs(leads);
  return leads.length;
}
