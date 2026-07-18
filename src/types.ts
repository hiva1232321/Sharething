export interface SharedFile {
  id: string;          // Unique ID of the file
  driveId: string;     // Google Drive file ID
  name: string;        // Original name of the file
  size: number;        // Size in bytes
  mimeType: string;    // MIME type (e.g., image/png, application/pdf)
}

export interface ShareSession {
  code: string;        // Exactly 6-character unique code
  files: SharedFile[]; // List of files in this share
  createdAt: number;   // Timestamp (ms)
  expiresAt: number;   // Timestamp (ms)
  isExpired: boolean;  // Expiration flag
}

export interface AdminStatus {
  connected: boolean;
  email: string | null;
  folderId: string | null;
}

export interface UploadProgress {
  fileName: string;
  progress: number;
  status: 'idle' | 'uploading' | 'completed' | 'failed';
}
