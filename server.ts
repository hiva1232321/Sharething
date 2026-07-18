import express from "express";
import path from "path";
import multer from "multer";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { JWT, OAuth2Client, AuthClient } from "google-auth-library";
import { ShareSession, SharedFile, AdminStatus } from "./src/types";

dotenv.config();

const app = express();
const PORT = 3000;

// Enable JSON parser and URL-encoded body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Multer configured in memory (files up to 100MB)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
});

// In-memory data store
const sessions = new Map<string, ShareSession>();

// Google Authentication
let authClient: AuthClient | null = null;
const sharedFolderId = process.env.SHARED_FOLDER_ID || "1Qx-e-2pj6OE8x8-cye2y2P6mDDaa9_qv";
let authEmail = "Personal Account (OAuth)";

// 1. Try OAuth2 Refresh Token (Best for personal @gmail.com accounts)
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN) {
  const oauth2Client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  authClient = oauth2Client;
  console.log(`[AUTH] Google OAuth2 initialized successfully.`);
} 
// 2. Try Service Account JSON
else if (process.env.GOOGLE_CREDENTIALS_JSON) {
  try {
    const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    authClient = new JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ["https://www.googleapis.com/auth/drive"],
    });
    authEmail = creds.client_email;
    console.log(`[AUTH] Google Service Account initialized for ${authEmail}`);
  } catch (e) {
    console.error("[AUTH] Failed to parse GOOGLE_CREDENTIALS_JSON. Make sure it is valid JSON.");
  }
}

if (!authClient) {
  console.warn(`[AUTH] No Google Drive credentials found in environment variables.`);
}

async function getAccessToken(): Promise<string> {
  if (!authClient) {
    throw new Error("Google Drive is not configured. Please check your environment variables.");
  }
  const tokenRes = await authClient.getAccessToken();
  if (!tokenRes.token) {
    throw new Error("Failed to retrieve Google Access Token.");
  }
  return tokenRes.token;
}

// Alphabet for 6-character shortcode
const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function generateCode(): string {
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
  }
  return result;
}

// Search or Create "ShareThing Temporary Uploads" Folder
async function getOrCreateFolder(accessToken: string): Promise<string> {
  try {
    const searchUrl = `https://www.googleapis.com/drive/v3/files?q=name='ShareThing Temporary Uploads' and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id)`;
    const searchRes = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    
    if (!searchRes.ok) {
      throw new Error(`Folder search failed: ${searchRes.statusText}`);
    }
    
    const searchData = (await searchRes.json()) as { files?: Array<{ id: string }> };
    if (searchData.files && searchData.files.length > 0) {
      return searchData.files[0].id;
    }

    // Create the folder
    const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "ShareThing Temporary Uploads",
        mimeType: "application/vnd.google-apps.folder",
      }),
    });

    if (!createRes.ok) {
      throw new Error(`Folder creation failed: ${createRes.statusText}`);
    }

    const folderData = (await createRes.json()) as { id: string };
    return folderData.id;
  } catch (error) {
    console.error("Error in getOrCreateFolder:", error);
    throw error;
  }
}

// Upload file buffer to Google Drive
async function uploadToDrive(
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  parentFolderId: string,
  accessToken: string
): Promise<string> {
  const metadata = {
    name: fileName,
    parents: [parentFolderId],
  };

  const boundary = "sharething_boundary_delimiter";
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": `multipart/related; boundary=${boundary}`,
  };

  const body = Buffer.concat([
    Buffer.from(
      delimiter +
        "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
        JSON.stringify(metadata) +
        delimiter
    ),
    Buffer.from(`Content-Type: ${mimeType}\r\n\r\n`),
    fileBuffer,
    Buffer.from(closeDelimiter),
  ]);

  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers,
    body,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Drive upload failed: ${res.statusText} (${res.status}) - ${errText}`);
  }

  const data = (await res.json()) as { id: string };
  return data.id;
}

// Delete file from Google Drive
async function deleteFromDrive(driveId: string, accessToken: string): Promise<boolean> {
  try {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${driveId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return res.ok;
  } catch (err) {
    console.error(`Failed to delete Drive file ${driveId}:`, err);
    return false;
  }
}

// Background cleanup worker (Runs every 10 seconds)
setInterval(async () => {
  const now = Date.now();
  for (const [code, session] of sessions.entries()) {
    if (session.expiresAt <= now && !session.isExpired) {
      session.isExpired = true;
      console.log(`[CLEANUP] Share link ${code} has expired. Deleting files...`);
      
      // Attempt to delete files in Google Drive if credentials exist
      try {
        const token = await getAccessToken();
        for (const file of session.files) {
          console.log(`[CLEANUP] Deleting file: ${file.name} (${file.driveId})`);
          await deleteFromDrive(file.driveId, token);
        }
      } catch (err: any) {
        console.warn(`[CLEANUP] Could not delete files in Google Drive: ${err.message}`);
      }

      // Delete from metadata map
      sessions.delete(code);
    }
  }
}, 10000);

// API Endpoints

// Get Admin and Google Drive connection status
app.get("/api/admin/status", (req, res) => {
  if (authClient) {
    res.json({
      connected: true,
      email: "shivamatangulu41@gmail.com",
      folderId: sharedFolderId,
    } as AdminStatus);
  } else {
    res.json({
      connected: false,
      email: null,
      folderId: null,
    } as AdminStatus);
  }
});

// Admin connecting/linking Google Drive (Mocked since Service Account is used)
app.post("/api/admin/connect", async (req, res) => {
  res.json({ success: true, folderId: sharedFolderId });
});

// Admin disconnecting Google Drive (Mocked since Service Account is used)
app.post("/api/admin/disconnect", (req, res) => {
  res.json({ success: true });
});

// Upload endpoint (anonymous or authenticated)
app.post("/api/upload", upload.array("files"), async (req, res) => {
  if (!authClient) {
    return res.status(503).json({
      error: "Google Drive is not configured by the Administrator. Please check environment variables.",
    });
  }

  const reqFiles = req.files as Express.Multer.File[] | undefined;
  const rawText = req.body.text as string | undefined;

  // We must have either uploaded files or raw text to share
  if ((!reqFiles || reqFiles.length === 0) && !rawText) {
    return res.status(400).json({ error: "Please upload at least one file or paste text." });
  }

  try {
    const uploadedFiles: SharedFile[] = [];
    const token = await getAccessToken();

    // 1. Handle actual files
    if (reqFiles && reqFiles.length > 0) {
      for (const file of reqFiles) {
        const driveId = await uploadToDrive(
          file.buffer,
          file.originalname,
          file.mimetype || "application/octet-stream",
          sharedFolderId,
          token
        );
        
        uploadedFiles.push({
          id: Math.random().toString(36).substring(2, 9),
          driveId,
          name: file.originalname,
          size: file.size,
          mimeType: file.mimetype || "application/octet-stream",
        });
      }
    }

    // 2. Handle pasted text (create as a .txt file)
    if (rawText && rawText.trim().length > 0) {
      const textBuffer = Buffer.from(rawText);
      const textFileName = `pasted-text-${Date.now().toString().slice(-4)}.txt`;
      const driveId = await uploadToDrive(
        textBuffer,
        textFileName,
        "text/plain",
        sharedFolderId,
        token
      );

      uploadedFiles.push({
        id: Math.random().toString(36).substring(2, 9),
        driveId,
        name: textFileName,
        size: textBuffer.length,
        mimeType: "text/plain",
      });
    }

    // Generate non-colliding unique 6-character code
    let code = generateCode();
    while (sessions.has(code)) {
      code = generateCode();
    }

    const duration = 60 * 60 * 1000; // 1 hour
    const createdAt = Date.now();
    const expiresAt = createdAt + duration;

    const newSession: ShareSession = {
      code,
      files: uploadedFiles,
      createdAt,
      expiresAt,
      isExpired: false,
    };

    sessions.set(code, newSession);
    console.log(`[UPLOAD] Share created: ${code} containing ${uploadedFiles.length} file(s).`);

    res.json(newSession);
  } catch (error: any) {
    console.error("Upload handler failed:", error);
    res.status(500).json({ error: `Upload failed: ${error.message}` });
  }
});

// Get session details by 6-char code
app.get("/api/share/:code", (req, res) => {
  const { code } = req.params;
  const session = sessions.get(code);

  if (!session) {
    return res.status(404).json({ error: "Share link not found or has expired." });
  }

  if (session.expiresAt <= Date.now() || session.isExpired) {
    sessions.delete(code);
    return res.status(410).json({ error: "Share link has expired." });
  }

  res.json(session);
});

// Download individual file
app.get("/api/download/:code/:fileId", async (req, res) => {
  const { code, fileId } = req.params;
  const session = sessions.get(code);

  if (!session) {
    return res.status(404).json({ error: "Share link not found or has expired." });
  }

  const file = session.files.find((f) => f.id === fileId);
  if (!file) {
    return res.status(404).json({ error: "File not found." });
  }

  if (!authClient) {
    return res.status(503).json({ error: "Google Drive is currently offline." });
  }

  try {
    console.log(`[DOWNLOAD] Fetching file from Google Drive: ${file.name} (${file.driveId})`);
    const token = await getAccessToken();
    const driveRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.driveId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!driveRes.ok) {
      throw new Error(`Drive download responded with status ${driveRes.status}`);
    }

    // Set correct headers
    res.setHeader("Content-Type", file.mimeType || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(file.name)}"`
    );

    // Stream the body directly
    if (driveRes.body) {
      const reader = driveRes.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    }
    res.end();
  } catch (error: any) {
    console.error("File download failed:", error);
    res.status(500).json({ error: `Download failed: ${error.message}` });
  }
});

// Delete sharing session early (Manual Destruct)
app.post("/api/share/:code/destruct", async (req, res) => {
  const { code } = req.params;
  const session = sessions.get(code);

  if (!session) {
    return res.status(404).json({ error: "Share link not found." });
  }

  try {
    const token = await getAccessToken();
    for (const file of session.files) {
      await deleteFromDrive(file.driveId, token);
    }
    sessions.delete(code);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: `Manual destruct failed: ${error.message}` });
  }
});

// Configure Vite middleware or Static files hosting
async function startServer() {
  const isProduction = process.env.NODE_ENV === "production" || process.env.RENDER === "true";
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[SERVER] ShareThing running on http://localhost:${PORT}`);
  });
}

startServer();
