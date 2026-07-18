import { useState, useEffect } from "react";
import { googleSignIn, logout } from "../lib/firebase";
import { AdminStatus } from "../types";
import { ShieldCheck, LogIn, LogOut, CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";

interface AdminPanelProps {
  onStatusChange?: (status: AdminStatus) => void;
}

export default function AdminPanel({ onStatusChange }: AdminPanelProps) {
  const [adminStatus, setAdminStatus] = useState<AdminStatus>({
    connected: false,
    email: null,
    folderId: null,
  });
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  // Fetch admin status from backend
  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/admin/status");
      if (res.ok) {
        const data = await res.json() as AdminStatus;
        setAdminStatus(data);
        if (onStatusChange) {
          onStatusChange(data);
        }
      }
    } catch (err) {
      console.error("Failed to fetch admin status", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const result = await googleSignIn();
      if (result) {
        // Send token and email to Express backend
        const res = await fetch("/api/admin/connect", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            accessToken: result.accessToken,
            email: result.user.email,
          }),
        });

        if (res.ok) {
          await fetchStatus();
        } else {
          const err = await res.json();
          alert(`Failed to link Google Drive: ${err.error || "Unknown error"}`);
        }
      }
    } catch (err: any) {
      console.error("Connect failed", err);
      alert(`Sign in failed: ${err.message || "Unknown error"}`);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm("Disconnect Google Drive? Users will not be able to upload until linked again.")) {
      return;
    }
    try {
      await fetch("/api/admin/disconnect", { method: "POST" });
      await logout();
      await fetchStatus();
    } catch (err) {
      console.error("Disconnect failed", err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
        Checking storage connection...
      </div>
    );
  }

  return (
    <div className="p-4 bg-white/70 border border-slate-200 rounded-2xl shadow-sm backdrop-blur-md max-w-sm">
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-xl ${adminStatus.connected ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>
          <ShieldCheck className="w-5 h-5" />
        </div>
        
        <div className="flex-1 space-y-1">
          <h3 className="text-sm font-semibold text-slate-800">
            {adminStatus.connected ? "Storage Linked Successfully" : "Storage Setup Required"}
          </h3>
          <p className="text-xs text-slate-500 leading-normal">
            {adminStatus.connected
              ? `Ephemeral files will store in owner's Google Drive (${adminStatus.email}).`
              : "As the app creator, please link your Google Drive to enable guest file sharing."}
          </p>
          
          {adminStatus.connected && (
            <div className="flex items-center gap-1.5 pt-1.5 text-[11px] font-medium text-emerald-600">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Dedicated application folder created</span>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-slate-100 flex justify-end">
        {adminStatus.connected ? (
          <button
            onClick={handleDisconnect}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
          >
            <LogOut className="w-3.5 h-3.5" />
            Disconnect Drive
          </button>
        ) : (
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-all shadow-sm disabled:opacity-50"
          >
            {connecting ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                <LogIn className="w-3.5 h-3.5" />
                Link Google Drive
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
