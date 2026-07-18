import { useState, useEffect } from "react";
import { AdminStatus } from "../types";
import { ShieldCheck, CheckCircle2, RefreshCw } from "lucide-react";

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
            {adminStatus.connected ? "Storage Connected" : "Storage Setup Required"}
          </h3>
          <p className="text-xs text-slate-500 leading-normal">
            {adminStatus.connected
              ? `All ephemeral files are stored securely in Shiva Matangulu's private Google Drive repository.`
              : "Service Account credentials are missing. Please add environment variables on Render."}
          </p>
          
          {adminStatus.connected && (
            <div className="flex flex-col gap-1 pt-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-600">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Dedicated repository active</span>
              </div>
              <div className="text-[10px] text-slate-400 font-mono mt-1">
                Folder ID: {adminStatus.folderId ? `${adminStatus.folderId.slice(0, 12)}...` : "None"}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
