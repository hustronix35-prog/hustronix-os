import fs from "fs";
import path from "path";
import { google } from "googleapis";
import { config } from "../config.js";

export const lead_logger = {
  name: "lead_logger",
  description: "Logs lead information into a local database (leads.csv) and syncs with Google Sheets if configured.",
  parameters: {
    type: "object",
    properties: {
      companyName: { type: "string" },
      website: { type: "string" },
      founderName: { type: "string" },
      founderLinkedIn: { type: "string" },
      companyLinkedIn: { type: "string" },
      location: { type: "string" },
      stage: { type: "string" },
      email: { type: "string" },
      uxScore: { type: "number" },
      funnelNotes: { type: "string" },
      identifiedProblems: { type: "string" },
      status: { type: "string", enum: ["new", "audited", "drafted", "sent", "ignored"], default: "new" }
    },
    required: ["companyName", "website", "founderName", "status"]
  } as const,
  execute: async (data: any) => {
    const csvPath = path.join(process.cwd(), "leads.csv");
    const headers = "Timestamp,CompanyName,Website,FounderName,FounderLinkedIn,CompanyLinkedIn,Location,Stage,Emails,UI_UX_Score,Funnel_Notes,Identified_Problems,Status";
    const timestamp = new Date().toISOString();
    
    // --- Local CSV Logging ---
    if (!fs.existsSync(csvPath)) {
      fs.writeFileSync(csvPath, headers + "\n");
    }

    const row = [
      timestamp,
      `"${data.companyName}"`,
      data.website,
      `"${data.founderName}"`,
      data.founderLinkedIn || "N/A",
      data.companyLinkedIn || "N/A",
      `"${data.location || "N/A"}"`,
      data.stage || "N/A",
      data.email || "N/A",
      data.uxScore || "N/A",
      `"${data.funnelNotes || "N/A"}"`,
      `"${data.identifiedProblems || "N/A"}"`,
      data.status
    ].join(",");

    fs.appendFileSync(csvPath, row + "\n");
    let responseMessage = `✅ Lead logged locally to leads.csv`;

    // --- Google Sheets Sync ---
    if (config.googleSheets.enabled) {
      try {
        const auth = new google.auth.GoogleAuth({
          keyFile: config.googleSheets.serviceAccountPath,
          scopes: ["https://www.googleapis.com/auth/spreadsheets"],
        });

        const sheets = google.sheets({ version: "v4", auth });
        
        await sheets.spreadsheets.values.append({
          spreadsheetId: config.googleSheets.sheetId,
          range: "A:M",
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [[
              timestamp,
              data.companyName,
              data.website,
              data.founderName,
              data.founderLinkedIn || "N/A",
              data.companyLinkedIn || "N/A",
              data.location || "N/A",
              data.stage || "N/A",
              data.email || "N/A",
              data.uxScore || "N/A",
              data.funnelNotes || "N/A",
              data.identifiedProblems || "N/A",
              data.status
            ]]
          },
        });
        responseMessage += ` and synced to Google Sheets (ID: ${config.googleSheets.sheetId})`;
      } catch (err: any) {
        console.error("Google Sheets Sync Error:", err.message);
        responseMessage += ` (⚠️ Google Sheets Sync Failed: ${err.message})`;
      }
    } else {
      responseMessage += ` (Google Sheets sync disabled - missing credentials)`;
    }

    return responseMessage;
  }
};
