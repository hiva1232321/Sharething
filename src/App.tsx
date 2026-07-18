import React, { useState, useEffect, useRef, DragEvent, ChangeEvent } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Upload,
  FileText,
  FileCode,
  Download,
  Trash2,
  Clock,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  AlertCircle,
  QrCode,
  File,
  ShieldAlert,
  HardDrive,
  CheckCircle,
  Lock,
  ArrowRight,
  Info
} from "lucide-react";
import { ShareSession, AdminStatus, SharedFile } from "./types";
import AdminPanel from "./components/AdminPanel";

export default function App() {
  // State variables
  const [adminStatus, setAdminStatus] = useState<AdminStatus>({
    connected: false,
    email: null,
    folderId: null,
  });
  const [isAdminOpen, setIsAdminOpen] = useState(false);

  // Drag & drop
  const [isDragActive, setIsDragActive] = useState(false);
  const [filesToUpload, setFilesToUpload] = useState<File[]>([]);
  const [pastedText, setPastedText] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Active Share created by current user
  const [createdSession, setCreatedSession] = useState<ShareSession | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [showQrCode, setShowQrCode] = useState(false);

  // Share Page state (when loaded via URL code)
  const [sharedSession, setSharedSession] = useState<ShareSession | null>(null);
  const [sharedSessionLoading, setSharedSessionLoading] = useState(false);
  const [sharedSessionError, setSharedSessionError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Extract shared code from path e.g. /a7jK9p
  const pathname = window.location.pathname;
  const sharedCode = pathname.length === 7 && pathname.startsWith("/") ? pathname.substring(1) : null;

  // Retrieve active session details if accessed via direct share link
  useEffect(() => {
    if (sharedCode) {
      loadSharedSession(sharedCode);
    }
  }, [sharedCode]);

  // Auto-fetch admin status on load
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch("/api/admin/status");
        if (res.ok) {
          const data = await res.json() as AdminStatus;
          setAdminStatus(data);
        }
      } catch (err) {
        console.error("Failed to fetch admin status", err);
      }
    };
    fetchStatus();
  }, []);

  // Update countdown timer for shared session
  useEffect(() => {
    const session = sharedSession || createdSession;
    if (!session) return;

    const interval = setInterval(() => {
      const remaining = session.expiresAt - Date.now();
      if (remaining <= 0) {
        setTimeLeft("00:00");
        clearInterval(interval);
        if (sharedSession) {
          setSharedSessionError("This share link has expired and files have been securely destroyed.");
        }
      } else {
        const minutes = Math.floor(remaining / 1000 / 60);
        const seconds = Math.floor((remaining / 1000) % 60);
        setTimeLeft(
          `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
        );
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [sharedSession, createdSession]);

  const loadSharedSession = async (code: string) => {
    setSharedSessionLoading(true);
    setSharedSessionError(null);
    try {
      const res = await fetch(`/api/share/${code}`);
      if (res.ok) {
        const data = await res.json() as ShareSession;
        setSharedSession(data);
      } else {
        const err = await res.json();
        setSharedSessionError(err.error || "Share link not found or expired.");
      }
    } catch (err) {
      setSharedSessionError("An error occurred while loading this share link.");
    } finally {
      setSharedSessionLoading(false);
    }
  };

  // Drag handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActive(true);
    } else if (e.type === "dragleave") {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFiles = Array.from(e.dataTransfer.files);
      setFilesToUpload((prev) => [...prev, ...droppedFiles]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFiles = Array.from(e.target.files);
      setFilesToUpload((prev) => [...prev, ...selectedFiles]);
    }
  };

  const removeFileFromQueue = (index: number) => {
    setFilesToUpload((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (!adminStatus.connected) {
      setUploadError("Google Drive must be connected by the owner before sharing files.");
      return;
    }

    if (filesToUpload.length === 0 && !pastedText.trim()) {
      setUploadError("Please select files or enter some text to share.");
      return;
    }

    setUploading(true);
    setUploadError(null);

    try {
      // 1. Get Resumable Upload URLs from Backend
      const fileMetadata = filesToUpload.map(f => ({ 
        name: f.name, 
        size: f.size, 
        mimeType: f.type || "application/octet-stream" 
      }));
      
      const initRes = await fetch("/api/upload/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: fileMetadata,
          text: pastedText.trim() ? pastedText : undefined
        })
      });
      
      if (!initRes.ok) {
        const err = await initRes.json();
        throw new Error(err.error || "Failed to initialize upload");
      }
      
      const sessionData = await initRes.json();
      const uploadedDriveIds: string[] = [];
      
      // If there's text, the backend uploaded it directly and returned its ID
      if (sessionData.textDriveId) {
        uploadedDriveIds.push(sessionData.textDriveId);
      }

      // 2. Direct PUT to Google Drive for each file
      for (let i = 0; i < filesToUpload.length; i++) {
        const file = filesToUpload[i];
        const uploadUrl = sessionData.uploadUrls[i];
        
        if (!uploadUrl) continue;
        
        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file
        });
        
        if (!putRes.ok) {
          throw new Error(`Failed to upload ${file.name}`);
        }
        
        const putResData = await putRes.json();
        uploadedDriveIds.push(putResData.id);
      }
      
      // 3. Finalize Share Session
      const finRes = await fetch("/api/upload/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          code: sessionData.code,
          uploadedDriveIds 
        })
      });
      
      if (!finRes.ok) {
        throw new Error("Failed to finalize share link");
      }
      
      const finalSession = await finRes.json() as ShareSession;
      setCreatedSession(finalSession);
      setFilesToUpload([]);
      setPastedText("");
    } catch (err: any) {
      setUploadError(err.message || "Network error occurred. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const handleCopyLink = (code: string) => {
    const fullUrl = `${window.location.origin}/${code}`;
    navigator.clipboard.writeText(fullUrl);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleManualDestruct = async (code: string) => {
    if (
      !window.confirm(
        "Are you sure you want to permanently delete these files now? This action is immediate and cannot be undone."
      )
    ) {
      return;
    }

    try {
      const res = await fetch(`/api/share/${code}/destruct`, {
        method: "POST",
      });

      if (res.ok) {
        if (sharedSession) {
          setSharedSession(null);
          setSharedSessionError("Link was manually self-destructed by user request.");
        }
        if (createdSession) {
          setCreatedSession(null);
        }
      } else {
        alert("Failed to self-destruct share session.");
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Check file type helper
  const isImage = (mimeType: string) => mimeType.startsWith("image/");
  const isPdf = (mimeType: string) => mimeType === "application/pdf";
  const isText = (mimeType: string) => mimeType.startsWith("text/") || mimeType === "application/json";

  return (
    <div id="app-container" className="min-h-screen bg-[#F8F7F3] text-slate-800 flex flex-col font-sans transition-all">
      {/* Header */}
      <header id="app-header" className="max-w-7xl w-full mx-auto px-6 py-6 flex justify-between items-center border-b border-slate-200/50">
        <a href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
          <div className="w-9 h-9 bg-slate-900 rounded-xl flex items-center justify-center shadow-sm">
            <div className="w-3.5 h-3.5 bg-[#F8F7F3] rounded-full"></div>
          </div>
          <div>
            <span className="text-lg font-bold tracking-tight text-slate-900 block">ShareThing</span>
            <span className="text-[10px] font-medium tracking-wider text-slate-400 uppercase -mt-1 block">Ephemeral Sharing</span>
          </div>
        </a>

        <div className="flex items-center gap-4">
          {/* Admin / Setup status pill */}
          <button
            onClick={() => setIsAdminOpen(!isAdminOpen)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${adminStatus.connected
                ? "bg-emerald-50 border-emerald-200/60 text-emerald-700"
                : "bg-amber-50 border-amber-200/60 text-amber-700"
              }`}
          >
            <span className={`w-2 h-2 rounded-full ${adminStatus.connected ? "bg-emerald-500" : "bg-amber-500 animate-pulse"}`}></span>
            <span>{adminStatus.connected ? "Storage Connected" : "Storage Offline"}</span>
          </button>
        </div>
      </header>

      {/* Admin Panel slide down */}
      <AnimatePresence>
        {isAdminOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-slate-200 bg-slate-50/50"
          >
            <div className="max-w-7xl mx-auto px-6 py-4 flex justify-end">
              <AdminPanel onStatusChange={(status) => setAdminStatus(status)} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Container */}
      <main id="app-main" className="flex-1 max-w-7xl w-full mx-auto px-6 py-12 flex flex-col justify-center">
        {sharedCode ? (
          /* ==================================== */
          /*            SHARE VIEW PAGE           */
          /* ==================================== */
          <div className="max-w-4xl mx-auto w-full">
            {sharedSessionLoading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4 text-slate-500">
                <RefreshCw className="w-8 h-8 animate-spin text-slate-400" />
                <p className="text-sm font-medium">Securing and fetching ephemeral files...</p>
              </div>
            ) : sharedSessionError ? (
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center py-16 px-6 bg-white border border-slate-200 rounded-[32px] shadow-lg max-w-md mx-auto space-y-6"
              >
                <div className="w-16 h-16 bg-rose-50 border border-rose-100 text-rose-500 rounded-full flex items-center justify-center mx-auto shadow-sm">
                  <ShieldAlert className="w-8 h-8" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-2xl font-bold text-slate-950 tracking-tight">Link Expired</h2>
                  <p className="text-slate-500 text-sm leading-relaxed">
                    {sharedSessionError}
                  </p>
                </div>
                <div className="pt-4">
                  <a
                    href="/"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm rounded-2xl shadow-sm transition-all"
                  >
                    Create New Share Link
                    <ArrowRight className="w-4 h-4" />
                  </a>
                </div>
              </motion.div>
            ) : sharedSession ? (
              <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
                {/* Left Side: File Previews / Info */}
                <div className="md:col-span-7 space-y-6">
                  <div className="bg-white rounded-[32px] border border-slate-200/80 shadow-sm p-6 md:p-8 space-y-6">
                    <div className="flex justify-between items-center pb-4 border-b border-slate-100">
                      <div>
                        <span className="text-[11px] font-bold tracking-widest text-slate-400 uppercase block">Shared Content</span>
                        <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                          {sharedSession.files.length} Ephemeral File{sharedSession.files.length > 1 ? "s" : ""}
                        </h2>
                      </div>
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 text-amber-700 border border-amber-100 rounded-full">
                        <Clock className="w-4 h-4" />
                        <span className="text-[11px] font-black tracking-wider uppercase">{timeLeft} LEFT</span>
                      </div>
                    </div>

                    <div className="space-y-4">
                      {sharedSession.files.map((file) => (
                        <div key={file.id} className="p-4 bg-slate-50 border border-slate-100 rounded-2xl flex flex-col gap-4">
                          <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-white rounded-xl border border-slate-200 flex flex-col items-center justify-center text-[10px] font-bold text-slate-400 uppercase shadow-xs">
                              {file.name.split(".").pop()?.substring(0, 4) || "FILE"}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-slate-800 truncate">{file.name}</p>
                              <p className="text-xs text-slate-400 mt-0.5">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                            </div>
                            <a
                              href={`/api/download/${sharedSession.code}/${file.id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="w-10 h-10 rounded-full bg-white hover:bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 transition-all shadow-xs"
                              title="Download File"
                            >
                              <Download className="w-4 h-4" />
                            </a>
                          </div>

                          {/* Content Preview if supported */}
                          {isImage(file.mimeType) && (
                            <div className="mt-2 rounded-xl overflow-hidden border border-slate-200 max-h-60 bg-white flex items-center justify-center">
                              <img
                                src={`/api/download/${sharedSession.code}/${file.id}`}
                                alt={file.name}
                                referrerPolicy="no-referrer"
                                className="object-contain max-h-60 w-full"
                              />
                            </div>
                          )}

                          {isPdf(file.mimeType) && (
                            <div className="mt-2 p-3 bg-white border border-slate-200 rounded-xl flex items-center gap-2 text-xs text-slate-500">
                              <Info className="w-4 h-4 text-slate-400" />
                              <span>PDF preview is ready. Click the download icon to view full document.</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Right Side: Quick Action & Self-Destruct */}
                <div className="md:col-span-5 space-y-6">
                  <div className="bg-slate-900 rounded-[32px] text-white p-8 space-y-6 shadow-xl">
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block">Actions</span>
                      <h3 className="text-xl font-bold tracking-tight text-white">Temporary Access Link</h3>
                    </div>

                    <div className="p-4 bg-white/10 rounded-2xl border border-white/10 flex items-center justify-between gap-4">
                      <code className="text-lg font-bold tracking-wider text-white truncate select-all">
                        {window.location.origin}/{sharedSession.code}
                      </code>
                      <button
                        onClick={() => handleCopyLink(sharedSession.code)}
                        className="px-4 py-2 bg-white text-slate-900 rounded-xl text-xs font-bold shadow-sm hover:bg-slate-100 transition-all flex items-center gap-1.5"
                      >
                        {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedCode ? "Copied" : "Copy"}
                      </button>
                    </div>

                    <p className="text-xs text-slate-400 leading-relaxed italic">
                      This link and all related documents will be permanently and irreversibly destroyed when the countdown expires.
                    </p>

                    <div className="pt-4 border-t border-white/10 flex flex-col gap-3">
                      <button
                        onClick={() => handleManualDestruct(sharedSession.code)}
                        className="w-full py-3.5 bg-rose-650 hover:bg-rose-700 text-white rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-md"
                      >
                        <Trash2 className="w-4 h-4" />
                        Self-Destruct Share Now
                      </button>

                      <a
                        href="/"
                        className="w-full py-3.5 bg-white/5 hover:bg-white/10 text-white rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 border border-white/10 transition-all text-center"
                      >
                        Upload My Own Files
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          /* ==================================== */
          /*         UPLOAD & LANDING PAGE        */
          /* ==================================== */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
            {/* Left Column: Heading & Info */}
            <div className="lg:col-span-5 space-y-6">
              <span className="px-3.5 py-1.5 bg-slate-100 text-slate-600 rounded-full border border-slate-200/60 text-xs font-semibold tracking-wider uppercase inline-block">
                Secure & Minimal
              </span>
              <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-slate-900 leading-[1.15]">
                Fast, secure, <br />
                <span className="font-serif italic text-slate-400 font-medium">ephemeral</span> file sharing.
              </h1>
              <p className="text-slate-500 text-base md:text-lg max-w-md leading-relaxed">
                Upload files or paste text anonymously. Get a temporary sharing link that completely self-destructs after exactly 60 minutes. No sign-up. No tracking.
              </p>

              <div className="pt-4 grid grid-cols-3 gap-4 border-t border-slate-200/60">
                <div className="space-y-1">
                  <span className="text-slate-900 font-bold text-lg block">60m</span>
                  <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider block">Life Span</span>
                </div>
                <div className="space-y-1">
                  <span className="text-slate-900 font-bold text-lg block">100%</span>
                  <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider block">Private</span>
                </div>
                <div className="space-y-1">
                  <span className="text-slate-900 font-bold text-lg block">Drive</span>
                  <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider block">Storage</span>
                </div>
              </div>
            </div>

            {/* Right Column: Upload Card */}
            <div className="lg:col-span-7">
              <AnimatePresence mode="wait">
                {!createdSession ? (
                  /* --- UPLOAD BOX --- */
                  <motion.div
                    key="upload-card"
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -15 }}
                    className="bg-white rounded-[32px] border border-slate-200 shadow-xl shadow-slate-200/40 p-6 md:p-8 space-y-6"
                  >
                    {!adminStatus.connected ? (
                      <div className="p-4 bg-amber-50 border border-amber-200/50 rounded-2xl flex items-start gap-3">
                        <ShieldAlert className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                        <div className="space-y-1">
                          <p className="text-xs font-bold text-amber-800">Storage Offline</p>
                          <p className="text-xs text-amber-700 leading-normal">
                            To enable anonymous file sharing, the administrator must configure the Google Service Account credentials in the backend environment variables.
                          </p>
                        </div>
                      </div>
                    ) : null}

                    {/* Drag and Drop Zone */}
                    <div
                      onDragEnter={handleDrag}
                      onDragOver={handleDrag}
                      onDragLeave={handleDrag}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className={`border-2 border-dashed rounded-2xl bg-[#FBFBFA]/50 p-8 flex flex-col items-center justify-center gap-4 cursor-pointer transition-all ${isDragActive
                          ? "border-slate-900 bg-slate-50/50"
                          : "border-slate-200 hover:border-slate-400"
                        }`}
                    >
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        multiple
                        className="hidden"
                      />
                      <div className="w-14 h-14 bg-white rounded-2xl shadow-sm border border-slate-100 flex items-center justify-center text-slate-400">
                        <Upload className="w-6 h-6" />
                      </div>
                      <div className="text-center">
                        <p className="font-semibold text-slate-900 text-sm">Drag & drop files here</p>
                        <p className="text-xs text-slate-400 mt-1">or click to browse from device</p>
                      </div>
                    </div>

                    {/* Text Area Input for Pasted Text */}
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block">Or Paste Raw Text Directly</label>
                      <textarea
                        value={pastedText}
                        onChange={(e) => setPastedText(e.target.value)}
                        placeholder="Write or paste your secure text notes, markdown, logs, or codes..."
                        rows={4}
                        className="w-full p-4 bg-[#FBFBFA]/50 border border-slate-200 rounded-2xl text-sm focus:outline-none focus:border-slate-400 transition-all font-mono resize-y"
                      />
                    </div>

                    {/* File Upload Queue List */}
                    {filesToUpload.length > 0 && (
                      <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block">Queue ({filesToUpload.length})</span>
                        <div className="space-y-2">
                          {filesToUpload.map((file, i) => (
                            <div key={i} className="p-3 bg-slate-50 border border-slate-100 rounded-xl flex items-center gap-3">
                              <File className="w-4 h-4 text-slate-400" />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-slate-800 truncate">{file.name}</p>
                                <p className="text-[10px] text-slate-400">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeFileFromQueue(i);
                                }}
                                className="text-slate-400 hover:text-rose-600 p-1"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {uploadError && (
                      <div className="p-3.5 bg-rose-50 border border-rose-100 rounded-xl flex items-center gap-2 text-rose-700 text-xs font-semibold">
                        <AlertCircle className="w-4 h-4 flex-shrink-0" />
                        <span>{uploadError}</span>
                      </div>
                    )}

                    {/* Share Button */}
                    <button
                      onClick={handleUpload}
                      disabled={uploading || (!filesToUpload.length && !pastedText.trim()) || !adminStatus.connected}
                      className="w-full py-4 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-40"
                    >
                      {uploading ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          Creating Ephemeral Share...
                        </>
                      ) : (
                        <>
                          <HardDrive className="w-4 h-4" />
                          Generate Temporary Link
                        </>
                      )}
                    </button>
                  </motion.div>
                ) : (
                  /* --- SUCCESS LINK CREATED --- */
                  <motion.div
                    key="success-card"
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -15 }}
                    className="bg-white rounded-[32px] border border-slate-200 shadow-xl shadow-slate-200/40 p-6 md:p-8 space-y-6"
                  >
                    <div className="flex items-center gap-4 pb-4 border-b border-slate-100">
                      <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center shadow-xs">
                        <CheckCircle className="w-6 h-6" />
                      </div>
                      <div>
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block">Link Generated</span>
                        <h3 className="text-lg font-bold text-slate-950 tracking-tight">Active Share is Live</h3>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <p className="text-sm text-slate-500 leading-normal">
                        Anyone with the temporary URL can browse and retrieve these files directly, without creating any account.
                      </p>

                      <div className="p-4 bg-slate-900 rounded-2xl text-white space-y-2">
                        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 block">Unique Share URL</span>
                        <div className="flex items-center justify-between gap-4">
                          <code className="text-base font-bold tracking-wider truncate">
                            {window.location.origin}/{createdSession.code}
                          </code>
                          <button
                            onClick={() => handleCopyLink(createdSession.code)}
                            className="px-4 py-2 bg-white text-slate-900 rounded-xl text-xs font-bold shadow-sm hover:bg-slate-100 transition-all flex items-center gap-1.5 flex-shrink-0"
                          >
                            {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                            {copiedCode ? "Copied" : "Copy"}
                          </button>
                        </div>
                      </div>

                      {/* QR Code toggle action */}
                      <div className="flex flex-col items-center gap-2 pt-2 border-t border-slate-100">
                        <button
                          onClick={() => setShowQrCode(!showQrCode)}
                          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-900 transition-all font-semibold"
                        >
                          <QrCode className="w-4 h-4" />
                          <span>{showQrCode ? "Hide QR Code" : "Show Share QR Code"}</span>
                        </button>

                        <AnimatePresence>
                          {showQrCode && (
                            <motion.div
                              initial={{ opacity: 0, scale: 0.9 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.9 }}
                              className="p-4 bg-white border border-slate-200 rounded-2xl mt-2 flex flex-col items-center justify-center shadow-xs"
                            >
                              <img
                                src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(
                                  `${window.location.origin}/${createdSession.code}`
                                )}`}
                                alt="QR Code"
                                className="w-32 h-32"
                              />
                              <p className="text-[10px] text-slate-400 font-semibold uppercase mt-2 tracking-wider">Scan to share instantly</p>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>

                    <div className="p-4 bg-amber-50/50 border border-amber-100 rounded-2xl flex items-start gap-3">
                      <Clock className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div className="space-y-0.5">
                        <p className="text-xs font-bold text-amber-800">Self-Destruction Active</p>
                        <p className="text-xs text-amber-700 leading-normal">
                          All uploaded files and shortcodes will automatically be wiped permanently in 60 minutes.
                        </p>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-slate-100 flex gap-3">
                      <button
                        onClick={() => handleManualDestruct(createdSession.code)}
                        className="flex-1 py-3 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-1.5"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Destruct Link Early
                      </button>

                      <button
                        onClick={() => setCreatedSession(null)}
                        className="flex-1 py-3 bg-slate-900 text-white hover:bg-slate-800 rounded-xl font-bold text-xs transition-all text-center"
                      >
                        Share More Files
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer id="app-footer" className="max-w-7xl w-full mx-auto px-6 py-8 border-t border-slate-200/50 mt-12 flex flex-col sm:flex-row justify-between items-center gap-4 text-slate-400 text-xs">
        <div className="flex gap-6 sm:gap-8 flex-wrap justify-center">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
            <span className="font-semibold uppercase tracking-widest text-[10px]">Zero Persistence</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
            <span className="font-semibold uppercase tracking-widest text-[10px]">Direct Streaming</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
            <span className="font-semibold uppercase tracking-widest text-[10px]">No Cookies</span>
          </div>
        </div>
        <div className="text-center sm:text-right flex flex-col gap-1">
          <p>
            Made by Shiva Matangulu. This is only made for my personal project or for researching my own interest.
          </p>
          <p>
            If any queries say mail to <a href="mailto:shivamatangulu41@gmail.com" className="text-slate-500 hover:text-slate-700 underline">shivamatangulu41@gmail.com</a>
          </p>
        </div>
      </footer>
    </div>
  );
}
