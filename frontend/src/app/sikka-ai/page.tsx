'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Sparkles,
  Bot,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Clock,
  MapPin,
  Truck,
  UserCheck,
  Building2,
  AlertTriangle,
  History,
  FileCheck2,
  Wrench,
  Search,
  ChevronRight,
  Info,
  Calendar,
  Phone,
  Zap,
  Activity,
  Layers,
  ArrowUpRight,
  CreditCard,
  HelpCircle,
  Trash2,
} from 'lucide-react';
import AppLayout from '../../components/AppLayout';
import Modal from '../../components/Modal';
import { apiRequest } from '../../lib/api';
import { useAuth } from '../../lib/authContext';

interface AiStatusData {
  status: string;
  autoSyncIntervalMinutes: number;
  activeVehicles: number;
  activeDrivers: number;
  activePlants: number;
  pendingApprovals: number;
  lastSync: string | null;
  nextSync: string | null;
  latestSyncSummary: {
    syncId: string;
    status: string;
    vehiclesSuccess: number;
    vehiclesFailed: number;
    driversSuccess: number;
    driversFailed: number;
    failuresCount: number;
    repairsCount: number;
    completedAt: string;
  } | null;
  serverTime: string;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  text?: string;
  type?: string;
  timestamp: string;
  data?: any;
  approvalRequest?: any;
  previewData?: any;
  previewSubmitted?: boolean;
  previewSubmittedId?: string;
  previewCancelled?: boolean;
  syncResult?: any;
  failures?: any[];
  vehicles?: any[];
  drivers?: any[];
  category?: string;
  rule?: string;
  vehicleNumber?: string;
  driverName?: string;
  driverMobile?: string;
  mobile?: string;
  dlNumber?: string;
  plantName?: string;
  plantIn?: string;
  plantOut?: string;
  plantStatus?: string;
  inTime?: string;
  outTime?: string;
  stayDuration?: string;
  outsideDuration?: string;
  lastKnownLocation?: string;
  lastKnownTime?: string;
  gpsStatus?: string;
  dateDisplay?: string;
  isToday?: boolean;
  timelineRows?: any[];
  missingIntervals?: any[];
  dayRows?: any[];
  outsideVehicles?: any[];
  insideVehicles?: any[];
  requestedTime?: string;
  requestedDate?: string;
  options?: any[];
  promptTitle?: string;
}

interface ApprovalRequestItem {
  _id: string;
  requestId: string;
  requestedByName: string;
  requestedByUsername?: string;
  actionType: string;
  actionTitle: string;
  actionDescription: string;
  reason: string;
  affectedRecordType: string;
  affectedRecordId?: string;
  affectedRecordLabel: string;
  currentValue: any;
  requestedNewValue: any;
  aiVerificationResult: string;
  aiRiskLevel: string;
  status: string;
  approvedByName?: string;
  approvedAt?: string;
  rejectedByName?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  executionResult?: string;
  createdAt: string;
}

interface AuditLogItem {
  _id: string;
  actionId: string;
  timestamp: string;
  user: string;
  userRole: string;
  actionType: string;
  vehicle: string;
  driver: string;
  plant: string;
  oldValue: any;
  newValue: any;
  reason: string;
  aiVerification: string;
  approvalRequired: boolean;
  approvedBy: string;
  approvalDateTime?: string;
  result: string;
  errorDetails?: string;
}

interface SyncLogItem {
  _id: string;
  syncId: string;
  syncType: string;
  initiatedBy: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: string;
  vehiclesTotal: number;
  vehiclesSuccess: number;
  vehiclesFailed: number;
  driversTotal: number;
  driversSuccess: number;
  driversFailed: number;
  failures: Array<{
    entityType: string;
    identifier: string;
    lastGpsTime?: string;
    result: string;
    status: string;
    reason: string;
    errorDetails?: string;
  }>;
  repairsPerformed: Array<{
    issue: string;
    repairAction: string;
    recheckResult: string;
    success: boolean;
    timestamp: string;
  }>;
}

export interface AiHistoryItem {
  _id: string;
  userId: string;
  userName: string;
  username: string;
  userRole: string;
  question: string;
  answer: string;
  relevantVehicle?: string;
  relevantDriver?: string;
  relevantPlant?: string;
  questionDate: string;
  questionTime: string;
  createdAt: string;
  expiresAt: string;
  remainingTime: string;
  remainingMinutes: number;
}

const QUICK_COMMANDS = [
  { label: '📍 Aaj UP14GT0300 kahan hai?', query: 'Aaj UP14GT0300 kahan hai?' },
  { label: '📅 29 Sep ko UP14GT0300 kahan tha?', query: '29 September ko UP14GT0300 kahan tha?' },
  { label: '⏱ 29 Sep 11:30 AM location', query: '29 September ko 11:30 AM par UP14GT0300 ki location kya thi?' },
  { label: '👤 Kal 3 PM Rajesh driver kahan tha?', query: 'Kal 3 PM par Rajesh driver kahan tha?' },
  { label: '⏳ UP14GT0300 Tea Plant stay hours', query: 'UP14GT0300 Tea Plant mein kitne hours raha?' },
  { label: '📈 25 Sep se 30 Sep movement', query: '25 September se 30 September tak vehicle ka movement batao' },
  { label: '🏭 Aaj Tea Plant available vehicles', query: 'Kaun-kaun se vehicles aaj Tea Plant mein available the?' },
  { label: '👥 29 Sep 2 PM Vehicle + Driver location', query: 'Vehicle aur driver ki location 29 September ko 2 PM par batao' },
  { label: '🔄 UP14GT0300 ka GPS sync karo', query: 'UP14GT0300 ka GPS sync karo' },
  { label: '🛡 Test Plant Radius Protection', query: 'Tea Plant radius 500 meter se 1000 meter kar do' },
  { label: '🚫 Test Delete Protection', query: 'UP14GT0300 ka old GPS record delete karo' },
];

export default function SikkaAiPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'Admin';

  const [activeTab, setActiveTab] = useState<'chat' | 'history' | 'sync' | 'repair' | 'approvals' | 'audit'>('chat');
  const [statusData, setStatusData] = useState<AiStatusData | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);

  // Non-admin users can access chat and 24h history tabs only
  useEffect(() => {
    if (!isAdmin && activeTab !== 'chat' && activeTab !== 'history') {
      setActiveTab('chat');
    }
  }, [isAdmin, activeTab]);

  // 24-Hour Q&A History State
  const [historyList, setHistoryList] = useState<AiHistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [historyUserFilter, setHistoryUserFilter] = useState('');
  const [deletingHistoryId, setDeletingHistoryId] = useState<string | null>(null);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isSendingQuery, setIsSendingQuery] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Sync state
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncLogs, setSyncLogs] = useState<SyncLogItem[]>([]);
  const [timeRemaining, setTimeRemaining] = useState<string>('30:00');

  // Repair state
  const [isRepairing, setIsRepairing] = useState(false);
  const [repairResult, setRepairResult] = useState<any>(null);

  // Approvals state
  const [approvals, setApprovals] = useState<ApprovalRequestItem[]>([]);
  const [selectedApproval, setSelectedApproval] = useState<ApprovalRequestItem | null>(null);
  const [decisionModalOpen, setDecisionModalOpen] = useState(false);
  const [decisionType, setDecisionType] = useState<'Approve' | 'Reject'>('Approve');
  const [rejectionReason, setRejectionReason] = useState('');
  const [isProcessingDecision, setIsProcessingDecision] = useState(false);
  const [submittingPreviewId, setSubmittingPreviewId] = useState<string | null>(null);

  // Audit state
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditActionFilter, setAuditActionFilter] = useState('ALL');

  // Load status
  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiRequest<AiStatusData>('/sikka-ai/status');
      setStatusData(data);
    } catch (e) {
      console.error('[Fetch AI Status Error]:', e);
    } finally {
      setIsLoadingStatus(false);
    }
  }, []);

  // Load sync logs
  const fetchSyncLogs = useCallback(async () => {
    try {
      const data = await apiRequest<SyncLogItem[]>('/sikka-ai/sync-logs?limit=15');
      setSyncLogs(data);
    } catch (e) {
      console.error('[Fetch Sync Logs Error]:', e);
    }
  }, []);

  // Load approvals
  const fetchApprovals = useCallback(async () => {
    try {
      const data = await apiRequest<ApprovalRequestItem[]>('/sikka-ai/approvals');
      setApprovals(data);
    } catch (e) {
      console.error('[Fetch Approvals Error]:', e);
    }
  }, []);

  // Load audit logs
  const fetchAuditLogs = useCallback(async () => {
    try {
      const queryParams = new URLSearchParams();
      if (auditActionFilter !== 'ALL') queryParams.append('actionType', auditActionFilter);
      if (auditSearch.trim()) queryParams.append('search', auditSearch.trim());
      const data = await apiRequest<{ logs: AuditLogItem[] }>(`/sikka-ai/audit-logs?${queryParams.toString()}`);
      setAuditLogs(data.logs);
    } catch (e) {
      console.error('[Fetch Audit Logs Error]:', e);
    }
  }, [auditActionFilter, auditSearch]);

  // Load 24-hour Q&A history
  const fetchHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      const queryParams = new URLSearchParams();
      if (historySearch.trim()) queryParams.append('search', historySearch.trim());
      if (isAdmin && historyUserFilter.trim()) queryParams.append('userId', historyUserFilter.trim());
      const queryStr = queryParams.toString() ? `?${queryParams.toString()}` : '';
      const data = await apiRequest<{ totalCount: number; history: AiHistoryItem[] }>(`/sikka-ai/history${queryStr}`);
      setHistoryList(data.history || []);
    } catch (e) {
      console.error('[Fetch History Error]:', e);
    } finally {
      setIsLoadingHistory(false);
    }
  }, [historySearch, historyUserFilter, isAdmin]);

  const handleDeleteHistoryItem = async (id: string) => {
    if (!confirm('Are you sure you want to permanently delete this Q&A history record?')) return;
    setDeletingHistoryId(id);
    try {
      await apiRequest(`/sikka-ai/history/${id}`, { method: 'DELETE' });
      setHistoryList((prev) => prev.filter((item) => item._id !== id));
    } catch (err: any) {
      alert(`Failed to delete history record: ${err.message || 'Server error'}`);
    } finally {
      setDeletingHistoryId(null);
    }
  };

  useEffect(() => {
    fetchStatus();
    // Default welcome message in chat and populate recent 24h history for continuity
    const initChat = async () => {
      try {
        const histData = await apiRequest<{ totalCount: number; history: AiHistoryItem[] }>('/sikka-ai/history');
        if (histData.history && histData.history.length > 0) {
          const chronological = [...histData.history].reverse();
          const restored: ChatMessage[] = [
            {
              id: 'msg-welcome',
              sender: 'ai',
              text: `👋 Welcome to **Sikka AI** Fleet Intelligence! Previous inquiries from the last 24 hours have been restored.`,
              type: 'WELCOME',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            },
          ];
          chronological.forEach((h) => {
            restored.push({
              id: `h-q-${h._id}`,
              sender: 'user',
              text: h.question,
              timestamp: h.questionTime || 'Earlier',
            });
            restored.push({
              id: `h-a-${h._id}`,
              sender: 'ai',
              text: h.answer,
              vehicleNumber: h.relevantVehicle,
              driverName: h.relevantDriver,
              plantName: h.relevantPlant,
              timestamp: h.questionTime || 'Earlier',
            });
          });
          setMessages(restored);
          return;
        }
      } catch (err) {
        // Fallback to welcome message if history retrieval fails
      }
      setMessages([
        {
          id: 'msg-welcome',
          sender: 'ai',
          text: `👋 Welcome to **Sikka AI** Fleet Intelligence! I automatically monitor and sync vehicle GPS & driver locations every 30 minutes, evaluate plant entry/stay hours, detect & safe-repair telemetry errors, and protect your configuration from unauthorized changes.`,
          type: 'WELCOME',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    };
    initChat();
  }, [fetchStatus]);

  useEffect(() => {
    if (activeTab === 'history') fetchHistory();
    if (activeTab === 'sync') fetchSyncLogs();
    if (activeTab === 'approvals') fetchApprovals();
    if (activeTab === 'audit') fetchAuditLogs();
  }, [activeTab, fetchHistory, fetchSyncLogs, fetchApprovals, fetchAuditLogs]);

  // Countdown timer calculation to next 30-min sync
  useEffect(() => {
    const updateCountdown = () => {
      if (!statusData?.nextSync) {
        setTimeRemaining('30:00');
        return;
      }
      const now = Date.now();
      const target = new Date(statusData.nextSync).getTime();
      const diffMs = target - now;
      if (diffMs <= 0) {
        setTimeRemaining('00:00');
        fetchStatus();
      } else {
        const totalSec = Math.floor(diffMs / 1000);
        const mins = Math.floor(totalSec / 60);
        const secs = totalSec % 60;
        setTimeRemaining(`${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [statusData, fetchStatus]);

  // Auto scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSendingQuery]);

  // Send query
  const handleSendQuery = async (queryToUse?: string) => {
    const q = (queryToUse || inputText).trim();
    if (!q || isSendingQuery) return;

    const userMsg: ChatMessage = {
      id: `usr-${Date.now()}`,
      sender: 'user',
      text: q,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputText('');
    setIsSendingQuery(true);

    try {
      const response = await apiRequest<any>('/sikka-ai/query', {
        method: 'POST',
        body: JSON.stringify({ query: q }),
      });

      const aiMsg: ChatMessage = {
        id: `ai-${Date.now()}`,
        sender: 'ai',
        text: response.reply,
        type: response.type,
        data: response.data,
        approvalRequest: response.approvalRequest,
        previewData: response.previewData,
        syncResult: response.syncResult,
        failures: response.failures,
        vehicles: response.vehicles,
        drivers: response.drivers,
        category: response.category,
        rule: response.rule,
        vehicleNumber: response.vehicleNumber,
        driverName: response.driverName,
        driverMobile: response.driverMobile,
        mobile: response.mobile,
        dlNumber: response.dlNumber,
        plantName: response.plantName,
        plantIn: response.plantIn,
        plantOut: response.plantOut,
        plantStatus: response.plantStatus,
        inTime: response.inTime,
        outTime: response.outTime,
        stayDuration: response.stayDuration,
        outsideDuration: response.outsideDuration,
        lastKnownLocation: response.lastKnownLocation,
        lastKnownTime: response.lastKnownTime,
        gpsStatus: response.gpsStatus,
        dateDisplay: response.dateDisplay,
        isToday: response.isToday,
        timelineRows: response.timelineRows,
        missingIntervals: response.missingIntervals,
        dayRows: response.dayRows,
        outsideVehicles: response.outsideVehicles,
        insideVehicles: response.insideVehicles,
        requestedTime: response.requestedTime,
        requestedDate: response.requestedDate,
        options: response.options,
        promptTitle: response.promptTitle,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, aiMsg]);
      fetchStatus();
      fetchHistory();
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          sender: 'ai',
          text: `⚠️ Error executing query: ${err.message || 'Server request failed.'}`,
          type: 'ERROR',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setIsSendingQuery(false);
    }
  };

  // Manual GPS Sync
  const handleTriggerManualSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const res = await apiRequest<any>('/sikka-ai/sync', {
        method: 'POST',
        body: JSON.stringify({ syncType: 'Manual User Sync' }),
      });

      // Append to chat as well
      setMessages((prev) => [
        ...prev,
        {
          id: `sync-${Date.now()}`,
          sender: 'ai',
          text: res.message,
          type: 'GPS_SYNC_RESULT',
          syncResult: res.result,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);

      fetchStatus();
      if (activeTab === 'sync') fetchSyncLogs();
    } catch (err: any) {
      alert(`Sync failed: ${err.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // Safe Error Verification & Repair
  const handleTriggerRepair = async () => {
    if (isRepairing) return;
    setIsRepairing(true);
    try {
      const res = await apiRequest<any>('/sikka-ai/repair', { method: 'POST' });
      setRepairResult(res.result);
      fetchStatus();
      if (activeTab === 'sync') fetchSyncLogs();
    } catch (err: any) {
      alert(`Auto-repair error: ${err.message}`);
    } finally {
      setIsRepairing(false);
    }
  };

  // Admin Decision on Approval
  const handleDecideApproval = async () => {
    if (!selectedApproval || isProcessingDecision) return;
    setIsProcessingDecision(true);
    try {
      await apiRequest<any>(`/sikka-ai/approvals/${selectedApproval.requestId}/decide`, {
        method: 'POST',
        body: JSON.stringify({
          decision: decisionType,
          rejectionReason: decisionType === 'Reject' ? rejectionReason : undefined,
        }),
      });

      setDecisionModalOpen(false);
      setSelectedApproval(null);
      setRejectionReason('');
      fetchApprovals();
      fetchStatus();

      // Notify in chat
      setMessages((prev) => [
        ...prev,
        {
          id: `apr-${Date.now()}`,
          sender: 'ai',
          text: `🛡 Admin Approval Request **${selectedApproval.requestId}** has been **${decisionType}d** by ${user?.fullName || 'Admin'}.`,
          type: 'APPROVAL_PROCESSED',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } catch (err: any) {
      alert(`Failed to process decision: ${err.message}`);
    } finally {
      setIsProcessingDecision(false);
    }
  };

  // Submit Action Preview Card to Admin Authorization Center
  const handleSubmitPreviewToAdmin = async (msgId: string, previewData: any) => {
    if (!previewData || submittingPreviewId) return;
    setSubmittingPreviewId(msgId);
    try {
      const res = await apiRequest<{ success: boolean; requestId: string; approvalRequest: any; message: string }>(
        '/sikka-ai/submit-approval-request',
        {
          method: 'POST',
          body: JSON.stringify({ previewData }),
        }
      );

      // Update message status in active chat
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? {
                ...m,
                previewSubmitted: true,
                previewSubmittedId: res.requestId,
                approvalRequest: res.approvalRequest,
              }
            : m
        )
      );

      fetchStatus();
      if (isAdmin) {
        fetchApprovals();
      }
    } catch (err: any) {
      alert(`Failed to submit approval request: ${err.message || 'Server error'}`);
    } finally {
      setSubmittingPreviewId(null);
    }
  };

  // Cancel Action Preview Card
  const handleCancelPreview = (msgId: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, previewCancelled: true } : m))
    );
  };

  return (
    <AppLayout pageTitle="Sikka AI Intelligence" requiredPage="Sikka AI">
      <div className="space-y-6 pb-12">
        {/* Top Header Card */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 border border-emerald-500/30 p-6 sm:p-8 text-white shadow-2xl">
          <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
          <div className="relative z-10 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-bold tracking-wide uppercase mb-3">
                <Sparkles className="w-3.5 h-3.5 animate-spin" style={{ animationDuration: '4s' }} />
                <span>Autonomous Fleet Intelligence</span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              </div>
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white flex items-center gap-3">
                Sikka AI
                <span className="text-xs px-2.5 py-0.5 rounded-lg font-bold bg-emerald-500 text-slate-950">
                  v2.0
                </span>
              </h1>
              <p className="text-sm text-slate-300 max-w-2xl mt-1.5 leading-relaxed">
                Automated 30-minute GPS & driver location synchronization, stay hours analytics, safe error auto-repair, and strict Administrator authorization guardrails.
              </p>
            </div>

            {/* Quick Actions & Countdown */}
            <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
              {/* Countdown Badge */}
              <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-slate-900/80 border border-slate-700/80 shadow-inner">
                <Clock className="w-4 h-4 text-emerald-400 animate-pulse" />
                <div className="text-left">
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Next Auto-Sync
                  </span>
                  <span className="block text-sm font-black font-mono text-emerald-300">
                    {timeRemaining}
                  </span>
                </div>
              </div>

              {/* Sync Button */}
              <button
                type="button"
                onClick={handleTriggerManualSync}
                disabled={isSyncing}
                className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black tracking-wide shadow-lg shadow-emerald-500/20 transition cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{isSyncing ? 'Syncing...' : 'Sync All GPS'}</span>
              </button>

              {/* Error Repair Button - Admin Only */}
              {isAdmin && (
                <button
                  type="button"
                  onClick={handleTriggerRepair}
                  disabled={isRepairing}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold transition cursor-pointer disabled:opacity-50"
                >
                  <Wrench className={`w-4 h-4 text-amber-400 ${isRepairing ? 'animate-spin' : ''}`} />
                  <span>{isRepairing ? 'Repairing...' : 'Run Auto-Repair'}</span>
                </button>
              )}
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t border-slate-800/80">
            <div className="px-4 py-2.5 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center gap-3">
              <Truck className="w-5 h-5 text-emerald-400" />
              <div>
                <span className="text-[11px] font-semibold text-slate-400 block">Active Vehicles</span>
                <span className="text-base font-extrabold text-white">{statusData?.activeVehicles ?? '—'}</span>
              </div>
            </div>

            <div className="px-4 py-2.5 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center gap-3">
              <UserCheck className="w-5 h-5 text-teal-400" />
              <div>
                <span className="text-[11px] font-semibold text-slate-400 block">Active Drivers</span>
                <span className="text-base font-extrabold text-white">{statusData?.activeDrivers ?? '—'}</span>
              </div>
            </div>

            <div className="px-4 py-2.5 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center gap-3">
              <Building2 className="w-5 h-5 text-indigo-400" />
              <div>
                <span className="text-[11px] font-semibold text-slate-400 block">Operating Plants</span>
                <span className="text-base font-extrabold text-white">{statusData?.activePlants ?? '—'}</span>
              </div>
            </div>

            {isAdmin ? (
              <div className="px-4 py-2.5 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center gap-3">
                <ShieldAlert
                  className={`w-5 h-5 ${
                    (statusData?.pendingApprovals || 0) > 0 ? 'text-amber-400 animate-pulse' : 'text-slate-400'
                  }`}
                />
                <div>
                  <span className="text-[11px] font-semibold text-slate-400 block">Pending Approvals</span>
                  <span className="text-base font-extrabold text-white">
                    {statusData?.pendingApprovals ?? 0}
                  </span>
                </div>
              </div>
            ) : (
              <div className="px-4 py-2.5 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center gap-3">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <div>
                  <span className="text-[11px] font-semibold text-slate-400 block">AI Guardrails</span>
                  <span className="text-base font-extrabold text-emerald-400">Strictly Enforced</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Navigation Tabs */}
        {isAdmin ? (
          <div className="flex items-center gap-2 border-b border-slate-200 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setActiveTab('chat')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl transition cursor-pointer shrink-0 ${
                activeTab === 'chat'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Bot className="w-4 h-4" />
              <span>AI Assistant & Chat</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl transition cursor-pointer shrink-0 ${
                activeTab === 'history'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Clock className="w-4 h-4" />
              <span>24h Q&A History</span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                  activeTab === 'history'
                    ? 'bg-white text-emerald-800'
                    : 'bg-emerald-100 text-emerald-800'
                }`}
              >
                24h Auto-Purge
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('sync')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl transition cursor-pointer shrink-0 ${
                activeTab === 'sync'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Activity className="w-4 h-4" />
              <span>30-Min Auto-Sync Monitor</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('repair')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl transition cursor-pointer shrink-0 ${
                activeTab === 'repair'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Wrench className="w-4 h-4" />
              <span>Error Diagnostics & Auto-Repair</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('approvals')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl transition cursor-pointer shrink-0 ${
                activeTab === 'approvals'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Admin Approvals</span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                  activeTab === 'approvals'
                    ? 'bg-amber-400 text-slate-950'
                    : (statusData?.pendingApprovals || 0) > 0
                    ? 'bg-amber-500 text-slate-950 animate-pulse'
                    : 'bg-slate-200 text-slate-700'
                }`}
              >
                {statusData?.pendingApprovals ?? approvals.filter((a) => a.status === 'Pending').length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('audit')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl transition cursor-pointer shrink-0 ${
                activeTab === 'audit'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <History className="w-4 h-4" />
              <span>Audit Trail</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('chat')}
                className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl transition cursor-pointer ${
                  activeTab === 'chat'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Bot className="w-4 h-4" />
                <span>AI Assistant & Chat</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('history')}
                className={`flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-xl transition cursor-pointer ${
                  activeTab === 'history'
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Clock className="w-4 h-4" />
                <span>24h Q&A History</span>
              </button>
            </div>
            <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-3 py-1 rounded-full border border-slate-200 self-start sm:self-auto">
              Role: Standard User (Private Q&A • 24h Auto-Expiry)
            </span>
          </div>
        )}

        {/* TAB 1: AI ASSISTANT & CHAT */}
        {activeTab === 'chat' && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
            {/* Main Chat Stream */}
            <div className="lg:col-span-3 flex flex-col bg-white rounded-3xl border border-slate-200/80 shadow-xl overflow-hidden h-[750px]">
              {/* Chat Header */}
              <div className="px-6 py-4 bg-slate-950 text-white border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-slate-950 font-black shadow-md">
                    <Sparkles className="w-5 h-5 text-slate-950" />
                  </div>
                  <div>
                    <h2 className="text-sm font-extrabold tracking-tight">Sikka AI Interactive Assistant</h2>
                    <p className="text-[11px] text-emerald-400 font-medium">
                      Natural Language Fleet Analytics & GPS Control
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Online & Ready</span>
                </div>
              </div>

              {/* Message List */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 bg-slate-50/50">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className={`max-w-[90%] sm:max-w-[80%] rounded-2xl p-4 text-xs sm:text-sm leading-relaxed ${
                        msg.sender === 'user'
                          ? 'bg-slate-900 text-white rounded-tr-xs shadow-md'
                          : 'bg-white text-slate-800 border border-slate-200/90 shadow-md rounded-tl-xs'
                      }`}
                    >
                      {/* Sender Tag */}
                      <div className="flex items-center justify-between gap-4 mb-1.5 pb-1 border-b border-slate-100 text-[11px]">
                        <span className={`font-bold flex items-center gap-1.5 ${msg.sender === 'user' ? 'text-emerald-300' : 'text-emerald-700'}`}>
                          {msg.sender === 'user' ? (
                            <>👤 You</>
                          ) : (
                            <>
                              <Sparkles className="w-3.5 h-3.5 text-emerald-600" /> Sikka AI
                            </>
                          )}
                        </span>
                        <span className="text-[10px] text-slate-400">{msg.timestamp}</span>
                      </div>

                      {/* Main Message Text */}
                      {msg.text && (
                        <div className="whitespace-pre-line font-medium mb-3">
                          {msg.text}
                        </div>
                      )}

                      {/* WIDGET: Sensitive Action Preview Card & Security Gatekeeping */}
                      {msg.type === 'SENSITIVE_ACTION_PREVIEW' && msg.previewData && (
                        <div className="mt-3 p-4 rounded-2xl bg-amber-50/90 border border-amber-200 text-amber-950 space-y-3.5 shadow-xs">
                          {/* Header with Risk Badge */}
                          <div className="flex items-center justify-between pb-2 border-b border-amber-200/80">
                            <div className="flex items-center gap-2">
                              <ShieldAlert className="w-4 h-4 text-amber-600" />
                              <span className="font-extrabold text-xs text-amber-950">Security Gatekeeping: Action Preview</span>
                            </div>
                            <span
                              className={`text-[10px] font-black px-2.5 py-0.5 rounded-md uppercase tracking-wider ${
                                msg.previewData.aiRiskLevel?.toUpperCase() === 'CRITICAL'
                                  ? 'bg-rose-100 text-rose-800 border border-rose-200'
                                  : 'bg-amber-100 text-amber-900 border border-amber-300'
                              }`}
                            >
                              RISK: {msg.previewData.aiRiskLevel?.toUpperCase()}
                            </span>
                          </div>

                          {/* Action Title & Description */}
                          <div>
                            <h4 className="text-xs sm:text-sm font-extrabold text-slate-900">
                              {msg.previewData.actionTitle}
                            </h4>
                            <p className="text-[11px] text-slate-600 mt-0.5">
                              {msg.previewData.actionDescription}
                            </p>
                          </div>

                          {/* Metadata Grid */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                            <div className="p-2.5 rounded-xl bg-white border border-amber-200/70">
                              <span className="text-[10px] text-slate-500 font-semibold block">Target / Affected Record</span>
                              <span className="font-bold text-slate-900 block mt-0.5">{msg.previewData.affectedRecordLabel}</span>
                              <span className="text-[10px] text-slate-400 block">{msg.previewData.affectedRecordType}</span>
                            </div>

                            <div className="p-2.5 rounded-xl bg-white border border-amber-200/70">
                              <span className="text-[10px] text-slate-500 font-semibold block">Proposed Value</span>
                              <span className="font-mono font-bold text-emerald-700 block mt-0.5 break-all">
                                {typeof msg.previewData.requestedNewValue === 'object'
                                  ? JSON.stringify(msg.previewData.requestedNewValue)
                                  : String(msg.previewData.requestedNewValue)}
                              </span>
                            </div>
                          </div>

                          {/* AI Verification Result Notice */}
                          <div className="p-2.5 rounded-xl bg-amber-100/70 border border-amber-200 text-xs text-amber-900 space-y-1">
                            <div className="flex items-center gap-1.5 font-bold text-amber-950 text-[11px]">
                              <Info className="w-3.5 h-3.5 text-amber-700" />
                              <span>Risk Analysis & AI Verification Result</span>
                            </div>
                            <p className="text-[11px] text-amber-900 leading-relaxed">
                              {msg.previewData.aiVerificationResult}
                            </p>
                          </div>

                          {/* State Feedback & Buttons */}
                          {msg.previewSubmitted ? (
                            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 space-y-2">
                              <div className="flex items-center justify-between text-xs font-bold">
                                <span className="flex items-center gap-1.5 text-emerald-800">
                                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                  <span>Action Request Submitted to Admin Authorization Center</span>
                                </span>
                                <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 border border-amber-200 text-[10px] uppercase font-black">
                                  PENDING APPROVAL
                                </span>
                              </div>
                              <p className="text-[11px] text-emerald-700 font-mono">
                                Ticket Request ID: <strong>{msg.previewSubmittedId}</strong>
                              </p>
                              {isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => setActiveTab('approvals')}
                                  className="flex items-center gap-1 text-xs font-bold text-emerald-700 hover:text-emerald-900 underline cursor-pointer mt-1"
                                >
                                  <span>Open Admin Approvals Center to Review & Execute</span>
                                  <ChevronRight className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          ) : msg.previewCancelled ? (
                            <div className="p-2.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-600 text-xs flex items-center gap-2">
                              <XCircle className="w-4 h-4 text-slate-500" />
                              <span>Action cancelled by user. No administrative request was submitted.</span>
                            </div>
                          ) : (
                            <div className="space-y-2 pt-1 border-t border-amber-200/80">
                              <p className="text-[11px] text-amber-900/90 font-medium">
                                🛡 <strong>Security Gatekeeper:</strong> No changes have been made to the database. To prevent false or automated modifications, click below to review and route this request to the Admin Authorization Queue.
                              </p>
                              <div className="flex flex-col sm:flex-row items-center justify-end gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() => handleCancelPreview(msg.id)}
                                  disabled={submittingPreviewId === msg.id}
                                  className="w-full sm:w-auto px-4 py-2 rounded-xl bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold border border-slate-300 transition cursor-pointer"
                                >
                                  Cancel Action
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSubmitPreviewToAdmin(msg.id, msg.previewData)}
                                  disabled={submittingPreviewId === msg.id}
                                  className="w-full sm:w-auto px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-600/20 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                  {submittingPreviewId === msg.id ? (
                                    <>
                                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                      <span>Submitting to Queue...</span>
                                    </>
                                  ) : (
                                    <>
                                      <ShieldCheck className="w-3.5 h-3.5" />
                                      <span>Submit to Admin Authorization Center</span>
                                    </>
                                  )}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* WIDGET: Sensitive Action Blocked / Admin Approval */}
                      {msg.type === 'SENSITIVE_ACTION_BLOCKED' && msg.approvalRequest && (
                        <div className="mt-3 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 space-y-3">
                          <div className="flex items-center gap-2 font-bold text-amber-900 text-xs">
                            <ShieldAlert className="w-4 h-4 text-amber-600" />
                            <span>Admin Approval Request Created: {msg.approvalRequest.requestId}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-[11px]">
                            <div className="p-2 rounded-lg bg-white/80 border border-amber-200/60">
                              <span className="text-slate-500 font-semibold block">Requested Action</span>
                              <span className="font-bold text-slate-900">{msg.approvalRequest.actionTitle}</span>
                            </div>
                            <div className="p-2 rounded-lg bg-white/80 border border-amber-200/60">
                              <span className="text-slate-500 font-semibold block">Affected Record</span>
                              <span className="font-bold text-slate-900">{msg.approvalRequest.affectedRecordLabel}</span>
                            </div>
                          </div>
                          <div className="p-2.5 rounded-lg bg-amber-100/70 text-[11px] text-amber-900">
                            <strong>AI Verification Result:</strong> {msg.approvalRequest.aiVerificationResult}
                          </div>
                          {isAdmin ? (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedApproval(msg.approvalRequest);
                                setActiveTab('approvals');
                              }}
                              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs transition cursor-pointer"
                            >
                              <span>Review & Decide in Approvals Center</span>
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <p className="text-[10px] text-slate-500 italic">
                              * Only System Administrators have authorization to approve or execute this request.
                            </p>
                          )}
                        </div>
                      )}

                      {/* WIDGET: Live Vehicle Location */}
                      {msg.type === 'LIVE_VEHICLE_LOCATION' && msg.data && (
                        <div className="mt-3 p-4 rounded-xl bg-slate-900 text-white space-y-3 shadow-inner">
                          <div className="flex items-center justify-between">
                            <span className="text-base font-extrabold text-emerald-400">
                              {msg.data.vehicleNumber}
                            </span>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                msg.data.isLive
                                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                                  : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                              }`}
                            >
                              {msg.data.gpsStatus}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <span className="text-[10px] text-slate-400 block font-semibold">Available Driver Name</span>
                              <span className="font-extrabold text-emerald-300">{msg.data.driverName}</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-400 block font-semibold">Driver DL Number</span>
                              <span className="font-mono font-bold text-amber-300">{msg.data.driverDlNumber}</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-400 block font-semibold">Driver Mobile</span>
                              <span className="font-bold text-slate-200">{msg.data.driverMobile}</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-400 block">GPS Capture Time</span>
                              <span className="font-bold text-slate-200">{msg.data.gpsTimeOnly}</span>
                            </div>
                            <div className="col-span-2">
                              <span className="text-[10px] text-slate-400 block">Readable Location</span>
                              <span className="font-semibold text-emerald-300">{msg.data.currentLocation}</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-400 block">Current Plant Proximity</span>
                              <span className="font-bold text-slate-200">{msg.data.plant}</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-400 block">Latitude & Longitude</span>
                              <span className="font-mono text-slate-300">{msg.data.latitude}, {msg.data.longitude}</span>
                            </div>
                          </div>

                          {!msg.data.isLive && (
                            <div className="p-2 rounded-lg bg-rose-950/50 border border-rose-800/60 text-[11px] text-rose-300">
                              ⚠️ {msg.data.liveStatusText}
                            </div>
                          )}
                        </div>
                      )}

                      {/* WIDGET: Driver Location & Profile (DL, Mobile, Assigned Vehicle) */}
                      {msg.type === 'DRIVER_LOCATION' && msg.data && (
                        <div className="mt-3 p-4 rounded-xl bg-slate-900 text-white space-y-3 shadow-inner">
                          <div className="flex items-center justify-between">
                            <span className="text-base font-extrabold text-teal-300 flex items-center gap-2">
                              <UserCheck className="w-5 h-5 text-teal-400" />
                              {msg.data.driverName}
                            </span>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                msg.data.locationStatus === 'Location Deducted'
                                  ? 'bg-teal-500/20 text-teal-400 border border-teal-500/40'
                                  : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                              }`}
                            >
                              {msg.data.locationStatus}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="p-2.5 rounded-xl bg-slate-800/80 border border-slate-700/60">
                              <span className="text-[10px] text-slate-400 block font-semibold">DL Number</span>
                              <span className="font-mono font-black text-amber-300 text-xs flex items-center gap-1.5 mt-0.5">
                                <CreditCard className="w-3.5 h-3.5 text-amber-400" />
                                {msg.data.dlNumber}
                              </span>
                            </div>

                            <div className="p-2.5 rounded-xl bg-slate-800/80 border border-slate-700/60">
                              <span className="text-[10px] text-slate-400 block font-semibold">Mobile Number</span>
                              <span className="font-bold text-emerald-300 text-xs flex items-center gap-1.5 mt-0.5">
                                <Phone className="w-3.5 h-3.5 text-emerald-400" />
                                {msg.data.mobile || msg.data.mobileNumber}
                              </span>
                            </div>

                            <div className="col-span-2 p-2.5 rounded-xl bg-slate-800/80 border border-slate-700/60">
                              <span className="text-[10px] text-slate-400 block font-semibold">Available / Assigned Vehicle</span>
                              <span className="font-black text-white text-sm flex items-center gap-1.5 mt-0.5">
                                <Truck className="w-4 h-4 text-emerald-400" />
                                {msg.data.vehicle}
                              </span>
                            </div>

                            <div className="col-span-2">
                              <span className="text-[10px] text-slate-400 block">Latest Location</span>
                              <span className="font-semibold text-teal-300">{msg.data.latestLocation}</span>
                            </div>

                            <div>
                              <span className="text-[10px] text-slate-400 block">Captured Timestamp</span>
                              <span className="font-bold text-slate-200">{msg.data.locationDateTime}</span>
                            </div>

                            <div>
                              <span className="text-[10px] text-slate-400 block">Plant Proximity</span>
                              <span className="font-bold text-slate-200">{msg.data.currentPlant}</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* WIDGET: Vehicle Driver Assignment Details */}
                      {msg.type === 'VEHICLE_DRIVER_DETAILS' && msg.data && (
                        <div className="mt-3 p-4 rounded-2xl bg-slate-900 text-white space-y-3 shadow-inner border border-emerald-500/30">
                          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                            <div>
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                                Vehicle Driver Details
                              </span>
                              <span className="text-base font-black text-emerald-400">
                                {msg.data.vehicleNumber}
                              </span>
                            </div>
                            <span className="text-xs px-2.5 py-1 rounded-lg bg-teal-500/20 text-teal-300 font-bold border border-teal-500/30">
                              {msg.data.driverStatus}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                            <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700/70 space-y-1.5">
                              <span className="text-[10px] text-slate-400 block font-semibold">Available Driver Name</span>
                              <span className="font-extrabold text-white text-sm flex items-center gap-1.5">
                                <UserCheck className="w-4 h-4 text-teal-400" />
                                {msg.data.driverName}
                              </span>
                            </div>

                            <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700/70 space-y-1">
                              <div>
                                <span className="text-[10px] text-slate-400 block font-semibold">DL Number</span>
                                <span className="font-mono font-bold text-amber-300 flex items-center gap-1">
                                  <CreditCard className="w-3.5 h-3.5 text-amber-400" />
                                  {msg.data.dlNumber}
                                </span>
                              </div>
                              <div className="pt-1">
                                <span className="text-[10px] text-slate-400 block font-semibold">Mobile Number</span>
                                <span className="font-bold text-emerald-300 flex items-center gap-1">
                                  <Phone className="w-3.5 h-3.5 text-emerald-400" />
                                  {msg.data.mobileNumber}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                            <div>
                              <span className="text-[10px] text-slate-400 block">Vehicle Location</span>
                              <span className="font-semibold text-slate-300 text-[11px]">{msg.data.vehicleLocation}</span>
                            </div>
                            <div>
                              <span className="text-[10px] text-slate-400 block">Driver Location</span>
                              <span className="font-semibold text-teal-300 text-[11px]">{msg.data.driverLocation}</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* WIDGET: Available Drivers Table */}
                      {msg.type === 'AVAILABLE_DRIVERS' && msg.drivers && (
                        <div className="mt-3 space-y-2">
                          <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-xs">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-slate-900 text-white font-bold">
                                <tr>
                                  <th className="p-2.5">Driver Name</th>
                                  <th className="p-2.5">DL Number</th>
                                  <th className="p-2.5">Mobile</th>
                                  <th className="p-2.5">Available / Assigned Vehicle</th>
                                  <th className="p-2.5">Plant</th>
                                  <th className="p-2.5">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 bg-white">
                                {msg.drivers.map((d: any, idx: number) => (
                                  <tr key={idx} className="hover:bg-slate-50 transition">
                                    <td className="p-2.5 font-bold text-slate-900">{d.driverName}</td>
                                    <td className="p-2.5 font-mono text-slate-700 font-semibold">{d.dlNumber}</td>
                                    <td className="p-2.5 text-slate-700 font-medium">{d.mobileNumber}</td>
                                    <td className="p-2.5 font-bold">
                                      {d.hasAssignedVehicle ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                                          <Truck className="w-3 h-3" />
                                          {d.assignedVehicle}
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 text-amber-800">
                                          {d.assignedVehicle}
                                        </span>
                                      )}
                                    </td>
                                    <td className="p-2.5 text-slate-600">{d.plant}</td>
                                    <td className="p-2.5">
                                      <span
                                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                          d.locationStatus === 'Location Deducted'
                                            ? 'bg-teal-100 text-teal-800'
                                            : 'bg-rose-100 text-rose-800'
                                        }`}
                                      >
                                        {d.locationStatus}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* WIDGET: Combined Vehicle + Driver */}
                      {msg.type === 'COMBINED_VEHICLE_DRIVER' && msg.data && (
                        <div className="mt-3 p-4 rounded-2xl bg-slate-950 text-white space-y-3 border border-emerald-500/30">
                          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                            <div>
                              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                                Vehicle & Driver Telemetry
                              </span>
                              <span className="text-sm font-black text-emerald-400">
                                {msg.data.summary.vehicleNumber} • {msg.data.summary.driverName}
                              </span>
                            </div>
                            <span className="text-xs px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 font-bold">
                              {msg.data.summary.status}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                            {/* Vehicle Box */}
                            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5">
                              <div className="flex items-center gap-2 font-bold text-emerald-400 text-xs">
                                <Truck className="w-3.5 h-3.5" />
                                <span>Vehicle Telemetry</span>
                              </div>
                              <p className="text-[11px] text-slate-300">
                                <strong>Location:</strong> {msg.data.summary.vehicleGpsLocation}
                              </p>
                              <p className="text-[11px] text-slate-400">
                                <strong>Time:</strong> {msg.data.summary.vehicleGpsTime}
                              </p>
                            </div>

                            {/* Driver Box */}
                            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5">
                              <div className="flex items-center gap-2 font-bold text-teal-400 text-xs">
                                <UserCheck className="w-3.5 h-3.5" />
                                <span>Driver Device</span>
                              </div>
                              <p className="text-[11px] text-amber-300 font-mono">
                                <strong>DL:</strong> {msg.data.summary.driverDlNumber}
                              </p>
                              <p className="text-[11px] text-emerald-300">
                                <strong>Mobile:</strong> {msg.data.summary.driverMobile}
                              </p>
                              <p className="text-[11px] text-slate-300">
                                <strong>Location:</strong> {msg.data.summary.driverLocation}
                              </p>
                              <p className="text-[11px] text-slate-400">
                                <strong>Time:</strong> {msg.data.summary.driverLocationTime}
                              </p>
                            </div>
                          </div>

                          <div className="text-[11px] text-slate-400 flex items-center justify-between pt-1">
                            <span>Operating Plant: <strong className="text-white">{msg.data.summary.plant}</strong></span>
                            <span>Matched by Sikka AI Policy</span>
                          </div>
                        </div>
                      )}

                      {/* WIDGET: Vehicle Stay Hours */}
                      {msg.type === 'VEHICLE_STAY_HOURS' && msg.data && (
                        <div className="mt-3 p-4 rounded-xl bg-slate-900 text-white space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="font-black text-emerald-400 text-base">{msg.data.vehicleNumber}</span>
                            <span className="text-xs px-2.5 py-1 rounded-full font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              {msg.data.status}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-3 text-xs">
                            <div className="p-2.5 rounded-lg bg-slate-800">
                              <span className="text-[10px] text-slate-400 block font-semibold">Plant Name</span>
                              <span className="font-extrabold text-white text-sm">{msg.data.plantName}</span>
                            </div>

                            <div className="p-2.5 rounded-lg bg-emerald-950 border border-emerald-700/50">
                              <span className="text-[10px] text-emerald-400 block font-semibold">Stay Duration</span>
                              <span className="font-black text-emerald-300 text-sm">{msg.data.stayDuration}</span>
                            </div>

                            <div className="p-2 rounded-lg bg-slate-800/70">
                              <span className="text-[10px] text-slate-400 block">Plant IN Time</span>
                              <span className="font-bold text-slate-200">{msg.data.inTime}</span>
                            </div>

                            <div className="p-2 rounded-lg bg-slate-800/70">
                              <span className="text-[10px] text-slate-400 block">Plant OUT Time</span>
                              <span className="font-bold text-slate-200">{msg.data.outTime}</span>
                            </div>
                          </div>

                          {/* Multiple Plant Visits Breakdown */}
                          {msg.data.visits && msg.data.visits.length > 0 && (
                            <div className="pt-2">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">
                                Plant Visits Breakdown
                              </span>
                              <div className="overflow-x-auto rounded-lg border border-slate-800">
                                <table className="w-full text-left text-xs">
                                  <thead className="bg-slate-800 text-slate-300 font-bold">
                                    <tr>
                                      <th className="p-2">Plant</th>
                                      <th className="p-2">IN</th>
                                      <th className="p-2">OUT</th>
                                      <th className="p-2">Stay</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-800/80 bg-slate-900/60">
                                    {msg.data.visits.map((v: any, vIdx: number) => (
                                      <tr key={vIdx} className="hover:bg-slate-800/40">
                                        <td className="p-2 font-semibold text-emerald-300">{v.plant}</td>
                                        <td className="p-2 text-slate-300">{v.inTime}</td>
                                        <td className="p-2 text-slate-300">{v.outTime}</td>
                                        <td className="p-2 font-bold text-white">{v.stayDuration}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}

                          <div className="text-[11px] text-slate-400 pt-1">
                            📍 Latest Location: <strong className="text-slate-200">{msg.data.latestLocation}</strong>
                          </div>
                        </div>
                      )}

                      {/* WIDGET: Historical Vehicle Time Location (Section 4) */}
                      {msg.type === 'HISTORICAL_VEHICLE_TIME' && msg.data && (
                        <div className="mt-3 p-4 rounded-2xl bg-slate-900 text-white space-y-3 shadow-inner border border-emerald-500/30">
                          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                            <div>
                              <span className="text-base font-extrabold text-emerald-400 flex items-center gap-2">
                                <Truck className="w-5 h-5 text-emerald-400" />
                                📍 Historical Location – {msg.data.vehicleNumber}
                              </span>
                              <span className="block text-[11px] text-slate-400 mt-0.5">
                                Requested: <strong>{msg.data.requestedDate}</strong> at <strong>{msg.data.requestedTime}</strong>
                              </span>
                            </div>
                            <span
                              className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                                msg.data.recordType === 'Exact Record'
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                  : msg.data.recordType === 'Nearest Available Record' || msg.data.recordType === 'Nearest Record'
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                  : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                              }`}
                            >
                              {msg.data.recordType}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-2.5 text-xs">
                            <div className="p-2.5 rounded-xl bg-slate-800/80 border border-slate-700/60">
                              <span className="text-[10px] text-slate-400 block font-semibold">Actual GPS Date</span>
                              <span className="font-bold text-white text-xs mt-0.5 block">
                                {msg.data.actualGpsDate || msg.data.requestedDate}
                              </span>
                            </div>

                            <div className="p-2.5 rounded-xl bg-slate-800/80 border border-slate-700/60">
                              <span className="text-[10px] text-slate-400 block font-semibold">Actual GPS Time</span>
                              <span className="font-mono font-bold text-emerald-300 text-sm mt-0.5 block">
                                {msg.data.actualGpsTime || msg.data.gpsRecordedTime}
                              </span>
                            </div>

                            <div className="p-2.5 rounded-xl bg-slate-800/80 border border-slate-700/60">
                              <span className="text-[10px] text-slate-400 block font-semibold">Driver Name</span>
                              <span className="font-bold text-teal-300 text-xs mt-0.5 flex items-center gap-1">
                                <UserCheck className="w-3.5 h-3.5" />
                                {msg.data.driverName || 'Not Assigned'}
                              </span>
                            </div>

                            <div className="p-2.5 rounded-xl bg-slate-800/80 border border-slate-700/60">
                              <span className="text-[10px] text-slate-400 block font-semibold">Driver Mobile</span>
                              <span className="font-bold text-emerald-300 text-xs mt-0.5 flex items-center gap-1">
                                <Phone className="w-3.5 h-3.5" />
                                {msg.data.driverMobile || 'N/A'}
                              </span>
                            </div>

                            <div className="col-span-2 p-2.5 rounded-xl bg-slate-800/80 border border-slate-700/60">
                              <span className="text-[10px] text-slate-400 block font-semibold">Location</span>
                              <span className="font-semibold text-slate-200 text-xs mt-0.5 block">
                                {msg.data.location || msg.data.currentLocation}
                              </span>
                            </div>

                            <div className="p-2 rounded-lg bg-slate-800/50">
                              <span className="text-[10px] text-slate-400 block">Latitude & Longitude</span>
                              <span className="font-mono text-slate-300 text-[11px] block mt-0.5">
                                {msg.data.latitude}, {msg.data.longitude}
                              </span>
                            </div>

                            <div className="p-2 rounded-lg bg-slate-800/50">
                              <span className="text-[10px] text-slate-400 block">Plant / Status</span>
                              <span className="font-semibold text-slate-200 text-xs block mt-0.5">
                                {msg.data.plant} ({msg.data.plantStatus})
                              </span>
                            </div>

                            <div className="col-span-2 p-2 rounded-lg bg-slate-800/40 border border-slate-700/40 flex items-center justify-between text-[11px]">
                              <span className="text-slate-400">GPS Source:</span>
                              <span className="font-medium text-emerald-400">{msg.data.gpsSource || 'Vehicle Telematics Unit / GPS'}</span>
                            </div>
                          </div>

                          {(msg.data.notice || msg.data.note) && (
                            <div className="p-2.5 rounded-xl bg-amber-950/40 border border-amber-700/50 text-[11px] text-amber-200">
                              ℹ️ {msg.data.notice || msg.data.note}
                            </div>
                          )}
                        </div>
                      )}

                      {/* WIDGET: Historical No Record */}
                      {msg.type === 'HISTORICAL_NO_RECORD' && (
                        <div className="mt-3 p-4 rounded-2xl bg-amber-950/40 border border-amber-600/50 text-amber-200 space-y-2">
                          <div className="flex items-center gap-2 font-black text-amber-300 text-xs">
                            <AlertTriangle className="w-4 h-4 text-amber-400" />
                            <span>No Historical GPS Record Available</span>
                          </div>
                          <p className="text-xs text-amber-100 font-medium whitespace-pre-line">
                            {msg.text || `No GPS record available for the requested date/time.`}
                          </p>
                          <p className="text-[10px] text-amber-300/80 font-mono">
                            Mandatory Rule: Sikka AI reports only actual verified GPS records and never displays live or fabricated data as an alternative.
                          </p>
                        </div>
                      )}

                      {/* WIDGET: Historical Driver Time Location */}
                      {msg.type === 'HISTORICAL_DRIVER_TIME' && msg.data && (
                        <div className="mt-3 p-4 rounded-2xl bg-slate-900 text-white space-y-3 shadow-inner border border-teal-500/20">
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="text-base font-extrabold text-teal-300 flex items-center gap-1.5">
                                <UserCheck className="w-4 h-4 text-teal-400" />
                                {msg.data.driverName}
                              </span>
                              <span className="block text-[11px] text-slate-400">
                                Requested: {msg.data.requestedDate} {msg.data.requestedTime && `at ${msg.data.requestedTime}`}
                              </span>
                            </div>
                            <span
                              className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                                msg.data.recordType === 'Exact Record'
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                  : msg.data.recordType === 'Nearest Record'
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                  : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                              }`}
                            >
                              {msg.data.recordType}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-2.5 text-xs">
                            <div className="p-2.5 rounded-xl bg-slate-800/80 border border-slate-700/60">
                              <span className="text-[10px] text-slate-400 block font-semibold">Actual GPS Record Time</span>
                              <span className="font-mono font-bold text-teal-300 text-sm mt-0.5 block">
                                {msg.data.actualGpsRecordTime}
                              </span>
                            </div>

                            <div className="p-2.5 rounded-xl bg-slate-800/80 border border-slate-700/60">
                              <span className="text-[10px] text-slate-400 block font-semibold">Driver Mobile</span>
                              <span className="font-bold text-emerald-300 text-xs mt-0.5 block">
                                {msg.data.mobile}
                              </span>
                            </div>

                            <div className="col-span-2 p-2.5 rounded-xl bg-slate-800/80 border border-slate-700/60">
                              <span className="text-[10px] text-slate-400 block font-semibold">Location / Address</span>
                              <span className="font-semibold text-slate-200 text-xs mt-0.5 block">
                                {msg.data.location}
                              </span>
                            </div>

                            <div className="p-2 rounded-lg bg-slate-800/50">
                              <span className="text-[10px] text-slate-400 block">Vehicle</span>
                              <span className="font-semibold text-slate-300">{msg.data.vehicle}</span>
                            </div>

                            <div className="p-2 rounded-lg bg-slate-800/50">
                              <span className="text-[10px] text-slate-400 block">Plant / Status</span>
                              <span className="font-semibold text-slate-300">{msg.data.plant} ({msg.data.status})</span>
                            </div>
                          </div>

                          {msg.data.note && (
                            <div className="p-2.5 rounded-xl bg-amber-950/40 border border-amber-700/50 text-[11px] text-amber-200">
                              ℹ️ {msg.data.note}
                            </div>
                          )}
                        </div>
                      )}

                      {/* WIDGET: Historical Combined Vehicle + Driver */}
                      {msg.type === 'HISTORICAL_COMBINED_VEHICLE_DRIVER' && msg.data && (
                        <div className="mt-3 p-4 rounded-2xl bg-slate-950 text-white space-y-3 border border-emerald-500/30">
                          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                            <div>
                              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                                Combined Historical Location
                              </span>
                              <span className="text-sm font-black text-emerald-400">
                                {msg.data.requestedDate} • {msg.data.requestedTime}
                              </span>
                            </div>
                            {msg.data.differentLocations ? (
                              <span className="text-xs px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">
                                Separate Locations
                              </span>
                            ) : (
                              <span className="text-xs px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold">
                                Same Location
                              </span>
                            )}
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                            {/* Vehicle Box */}
                            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="font-black text-emerald-400 text-xs flex items-center gap-1.5">
                                  <Truck className="w-3.5 h-3.5" />
                                  {msg.data.vehicle.vehicleNumber}
                                </span>
                                <span className="text-[10px] font-mono text-slate-400">{msg.data.vehicle.recordType}</span>
                              </div>
                              <p className="text-[11px] text-slate-300">
                                <strong>Location:</strong> {msg.data.vehicle.location}
                              </p>
                              <p className="text-[11px] text-slate-400">
                                <strong>GPS Time:</strong> {msg.data.vehicle.gpsTime}
                              </p>
                              <p className="text-[11px] text-slate-400">
                                <strong>Plant:</strong> {msg.data.vehicle.plant} ({msg.data.vehicle.plantStatus})
                              </p>
                            </div>

                            {/* Driver Box */}
                            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="font-black text-teal-300 text-xs flex items-center gap-1.5">
                                  <UserCheck className="w-3.5 h-3.5" />
                                  {msg.data.driver.driverName}
                                </span>
                                <span className="text-[10px] font-mono text-slate-400">{msg.data.driver.recordType}</span>
                              </div>
                              <p className="text-[11px] text-emerald-300">
                                <strong>Mobile:</strong> {msg.data.driver.mobile}
                              </p>
                              <p className="text-[11px] text-slate-300">
                                <strong>Location:</strong> {msg.data.driver.location}
                              </p>
                              <p className="text-[11px] text-slate-400">
                                <strong>GPS Time:</strong> {msg.data.driver.gpsTime}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* WIDGET: Historical Day Summary */}
                      {msg.type === 'HISTORICAL_DAY_SUMMARY' && msg.data && (
                        <div className="mt-3 p-4 rounded-2xl bg-slate-900 text-white space-y-3 border border-emerald-500/30">
                          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                            <div>
                              <span className="text-base font-extrabold text-emerald-400">
                                {msg.data.vehicleNumber}
                              </span>
                              <span className="block text-xs font-semibold text-slate-300">
                                Date: {msg.data.date}
                              </span>
                            </div>
                            <span className="text-xs px-2.5 py-1 rounded-lg bg-teal-500/20 text-teal-300 font-bold border border-teal-500/30">
                              {msg.data.plantStatus}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="p-2.5 rounded-xl bg-slate-800">
                              <span className="text-[10px] text-slate-400 block font-semibold">Location</span>
                              <span className="font-semibold text-white mt-0.5 block">{msg.data.location}</span>
                            </div>

                            <div className="p-2.5 rounded-xl bg-slate-800">
                              <span className="text-[10px] text-slate-400 block font-semibold">Plant Proximity</span>
                              <span className="font-semibold text-emerald-300 mt-0.5 block">{msg.data.plant}</span>
                            </div>

                            <div className="p-2 rounded-lg bg-slate-800/70">
                              <span className="text-[10px] text-slate-400 block">Entry Time</span>
                              <span className="font-bold text-slate-200">{msg.data.entryTime}</span>
                            </div>

                            <div className="p-2 rounded-lg bg-slate-800/70">
                              <span className="text-[10px] text-slate-400 block">Exit Time</span>
                              <span className="font-bold text-slate-200">{msg.data.exitTime}</span>
                            </div>

                            <div className="col-span-2 p-2.5 rounded-xl bg-emerald-950/60 border border-emerald-700/40 flex items-center justify-between">
                              <span className="text-xs text-emerald-300 font-semibold">Total Stay Duration:</span>
                              <span className="text-sm font-black text-emerald-200">{msg.data.totalStayHours}</span>
                            </div>
                          </div>

                          <div className="text-[11px] text-slate-400 flex items-center justify-between pt-1 border-t border-slate-800">
                            <span>Actual GPS: <strong className="text-slate-200">{msg.data.gpsDateTime}</strong></span>
                            <span className="font-mono text-slate-400">{msg.data.latitude}, {msg.data.longitude}</span>
                          </div>
                        </div>
                      )}

                      {/* WIDGET: Historical Date Range Movement */}
                      {msg.type === 'HISTORICAL_DATE_RANGE' && msg.data && (
                        <div className="mt-3 space-y-3">
                          <div className="p-3 rounded-xl bg-slate-900 text-white flex items-center justify-between">
                            <div>
                              <span className="font-black text-emerald-400 text-sm">{msg.data.vehicleNumber}</span>
                              <span className="block text-[11px] text-slate-400">
                                Movement: {msg.data.fromDate} to {msg.data.toDate}
                              </span>
                            </div>
                            <span className="text-xs font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                              {msg.data.totalRecords} GPS records
                            </span>
                          </div>

                          <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-xs">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-slate-900 text-white font-bold">
                                <tr>
                                  <th className="p-2.5">Date</th>
                                  <th className="p-2.5">Plant</th>
                                  <th className="p-2.5">IN Time</th>
                                  <th className="p-2.5">OUT Time</th>
                                  <th className="p-2.5">Stay Hours</th>
                                  <th className="p-2.5">Outside Plant</th>
                                  <th className="p-2.5">GPS Records</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 bg-white">
                                {msg.data.movements?.map((m: any, mIdx: number) => (
                                  <tr key={mIdx} className="hover:bg-slate-50 transition">
                                    <td className="p-2.5 font-bold text-slate-900">{m.date}</td>
                                    <td className="p-2.5 font-semibold text-emerald-700">{m.plant}</td>
                                    <td className="p-2.5 text-slate-600">{m.inTime}</td>
                                    <td className="p-2.5 text-slate-600">{m.outTime}</td>
                                    <td className="p-2.5 font-bold text-slate-900">{m.stayHours}</td>
                                    <td className="p-2.5 text-slate-600">{m.outsidePlantDuration}</td>
                                    <td className="p-2.5 font-mono text-slate-500">{m.gpsRecordsCount}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* WIDGET: 4-Option Fallback for Ambiguous / Underspecified Questions (Requirement 2 & 3) */}
                      {msg.type === 'AMBIGUOUS_OPTIONS_FALLBACK' && msg.options && (
                        <div className="mt-3 p-4 sm:p-5 rounded-2xl bg-slate-900 border border-amber-500/30 text-white space-y-4 shadow-xl">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 text-amber-400 font-bold text-xs uppercase tracking-wider">
                              <HelpCircle className="w-4 h-4 text-amber-400" />
                              <span>Clarification Needed</span>
                            </div>
                            <p className="text-sm font-bold text-white">
                              I’m not fully sure what you want to know. Please select one option:
                            </p>
                            {msg.promptTitle && (
                              <span className="text-xs text-slate-400 block font-medium">
                                {msg.promptTitle}
                              </span>
                            )}
                          </div>

                          {/* Exactly 4 Relevant Option Cards dynamically generated */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {msg.options.map((opt: any, idx: number) => (
                              <button
                                key={opt.id || idx}
                                type="button"
                                onClick={() => handleSendQuery(opt.query)}
                                disabled={isSendingQuery}
                                className="p-3.5 rounded-xl bg-slate-800/90 hover:bg-emerald-950/70 border border-slate-700/80 hover:border-emerald-500/60 text-left transition-all duration-200 group flex items-start gap-3 shadow-xs hover:shadow-md cursor-pointer disabled:opacity-50"
                              >
                                <div className="p-2 rounded-lg bg-slate-700/60 group-hover:bg-emerald-500/20 text-emerald-400 transition shrink-0 mt-0.5">
                                  {opt.icon === 'Truck' && <Truck className="w-4 h-4" />}
                                  {opt.icon === 'MapPin' && <MapPin className="w-4 h-4" />}
                                  {opt.icon === 'Building2' && <Building2 className="w-4 h-4" />}
                                  {opt.icon === 'UserCheck' && <UserCheck className="w-4 h-4" />}
                                  {opt.icon === 'Clock' && <Clock className="w-4 h-4" />}
                                  {!['Truck', 'MapPin', 'Building2', 'UserCheck', 'Clock'].includes(opt.icon) && (
                                    <Sparkles className="w-4 h-4" />
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <span className="font-extrabold text-white group-hover:text-emerald-300 text-xs block transition">
                                    {opt.title}
                                  </span>
                                  <span className="text-[11px] text-slate-400 group-hover:text-slate-300 block mt-0.5 line-clamp-2">
                                    {opt.description}
                                  </span>
                                </div>
                                <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-emerald-400 group-hover:translate-x-0.5 transition shrink-0 mt-1" />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* WIDGET: Complete Vehicle Day History & 30-Minute Movement Timeline (Requirements 1, 2, 4, 5, 6) */}
                      {msg.type === 'VEHICLE_COMPLETE_HISTORY' && (msg.data || msg.timelineRows) && (
                        <div className="mt-3 p-4 sm:p-5 rounded-2xl bg-slate-950 text-white space-y-4 border border-emerald-500/30 shadow-2xl">
                          {/* Header info */}
                          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
                            <div className="flex items-center gap-2.5">
                              <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                                <Truck className="w-5 h-5 text-emerald-400" />
                              </div>
                              <div>
                                <span className="text-base sm:text-lg font-black text-white tracking-tight">
                                  {msg.vehicleNumber || msg.data?.vehicleNumber}
                                </span>
                                <span className="block text-xs font-semibold text-emerald-400">
                                  {msg.dateDisplay || msg.data?.date}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span
                                className={`text-xs px-3 py-1 rounded-full font-black border ${
                                  (msg.plantStatus || msg.data?.plantStatus)?.includes('Inside')
                                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                    : 'bg-slate-800 text-slate-300 border-slate-700'
                                }`}
                              >
                                {msg.plantStatus || msg.data?.plantStatus}
                              </span>
                            </div>
                          </div>

                          {/* Present Day Callout if applicable */}
                          {msg.isToday && (
                            <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-600/40 text-xs text-emerald-200 space-y-1">
                              <div className="font-black text-emerald-300 flex items-center gap-1.5">
                                <Zap className="w-4 h-4 text-emerald-400" />
                                <span>Present-Day Intelligence ({msg.dateDisplay || msg.data?.date})</span>
                              </div>
                              <p className="text-[11px] text-emerald-100">
                                <strong>{msg.vehicleNumber || msg.data?.vehicleNumber}</strong> is currently{' '}
                                <strong>{msg.plantStatus || msg.data?.plantStatus} {msg.plantName || msg.data?.plantName}</strong>. Last GPS recorded at{' '}
                                <strong>{msg.lastKnownTime || msg.data?.lastKnownTime}</strong>. Driver:{' '}
                                <strong>{msg.driverName || msg.data?.driverName}</strong>.
                              </p>
                            </div>
                          )}

                          {/* Metric Pill Grid */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                            <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                              <span className="text-[10px] text-slate-400 block font-semibold">Driver</span>
                              <span className="font-extrabold text-white text-xs truncate block mt-0.5">
                                {msg.driverName || msg.data?.driverName}
                              </span>
                              <span className="text-[10px] text-emerald-400 font-mono block">
                                {msg.driverMobile || msg.data?.driverMobile}
                              </span>
                            </div>

                            <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                              <span className="text-[10px] text-slate-400 block font-semibold">Plant (IN / OUT)</span>
                              <span className="font-extrabold text-teal-300 text-xs truncate block mt-0.5">
                                {msg.plantName || msg.data?.plantName}
                              </span>
                              <span className="text-[10px] text-slate-300 font-mono block">
                                IN: {msg.plantIn || msg.data?.plantIn} • OUT: {msg.plantOut || msg.data?.plantOut}
                              </span>
                            </div>

                            <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                              <span className="text-[10px] text-slate-400 block font-semibold">Stay Duration</span>
                              <span className="font-black text-emerald-300 text-xs block mt-0.5">
                                {msg.stayDuration || msg.data?.stayDuration}
                              </span>
                              <span className="text-[10px] text-slate-400 block">Inside Plant</span>
                            </div>

                            <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                              <span className="text-[10px] text-slate-400 block font-semibold">Outside Duration</span>
                              <span className="font-black text-amber-300 text-xs block mt-0.5">
                                {msg.outsideDuration || msg.data?.outsideDuration || 'N/A'}
                              </span>
                              <span className="text-[10px] text-slate-400 block">Outside Plant</span>
                            </div>
                          </div>

                          {/* 4-Column 30-Minute Timeline Table (Requirement 2) */}
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs text-slate-400 font-semibold px-1">
                              <span className="flex items-center gap-1.5 text-white">
                                <Clock className="w-3.5 h-3.5 text-emerald-400" />
                                30-Minute Plant Inside / Outside Movement Timeline
                              </span>
                              <span className="text-[11px] text-slate-400 font-mono">
                                {(msg.timelineRows || msg.data?.timelineRows)?.length || 0} intervals
                              </span>
                            </div>

                            <div className="overflow-x-auto rounded-xl border border-slate-800 max-h-80 overflow-y-auto">
                              <table className="w-full text-left text-xs">
                                <thead className="bg-slate-900/90 backdrop-blur sticky top-0 text-slate-300 font-bold border-b border-slate-800 z-10">
                                  <tr>
                                    <th className="p-2.5 w-24">Time</th>
                                    <th className="p-2.5 w-24">Status</th>
                                    <th className="p-2.5 w-32">Plant</th>
                                    <th className="p-2.5">Location</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/80 bg-slate-950/60 font-medium">
                                  {(msg.timelineRows || msg.data?.timelineRows)?.map((r: any, idx: number) => (
                                    <tr
                                      key={idx}
                                      className={
                                        r.status === 'Missing'
                                          ? 'bg-rose-950/20 hover:bg-rose-950/30'
                                          : r.status === 'Inside'
                                          ? 'bg-emerald-950/10 hover:bg-emerald-950/20'
                                          : 'hover:bg-slate-900/40'
                                      }
                                    >
                                      <td className="p-2.5 font-mono text-slate-300 font-bold whitespace-nowrap">
                                        {r.time}
                                      </td>
                                      <td className="p-2.5 whitespace-nowrap">
                                        <span
                                          className={`px-2 py-0.5 rounded text-[10px] font-black ${
                                            r.status === 'Inside'
                                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                              : r.status === 'Outside'
                                              ? 'bg-slate-800 text-slate-300 border border-slate-700'
                                              : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                          }`}
                                        >
                                          {r.status}
                                        </span>
                                      </td>
                                      <td className="p-2.5 text-slate-300 whitespace-nowrap font-medium">
                                        {r.plant}
                                      </td>
                                      <td
                                        className={`p-2.5 ${
                                          r.status === 'Missing'
                                            ? 'text-rose-400 font-semibold italic'
                                            : 'text-slate-200'
                                        }`}
                                      >
                                        {r.location}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>

                          {/* Rule 6 Missing Data Audit Notice */}
                          {Boolean((msg.missingIntervals?.length || 0) > 0 || (msg.data?.missingIntervals?.length || 0) > 0) && (
                            <div className="p-2.5 rounded-xl bg-rose-950/30 border border-rose-800/40 text-[11px] text-rose-300 flex items-start gap-2">
                              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                              <span>
                                <strong>Rule 6 Verified Protection:</strong> Intervals marked{' '}
                                <em>Location Not Available — GPS data not received</em> denote actual missing telematics packets in the database. Sikka AI never creates or estimates false coordinates.
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* WIDGET: Complete Historical Driving Intelligence (Requirement 3, 7) */}
                      {msg.type === 'DRIVER_COMPLETE_HISTORY' && (msg.data || msg.timelineRows) && (
                        <div className="mt-3 p-4 sm:p-5 rounded-2xl bg-slate-950 text-white space-y-4 border border-teal-500/30 shadow-2xl">
                          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
                            <div className="flex items-center gap-2.5">
                              <div className="p-2 rounded-xl bg-teal-500/10 border border-teal-500/30">
                                <UserCheck className="w-5 h-5 text-teal-400" />
                              </div>
                              <div>
                                <span className="text-base sm:text-lg font-black text-white">
                                  {msg.driverName || msg.data?.driverName}
                                </span>
                                <span className="block text-xs font-semibold text-teal-400">
                                  DL: {msg.dlNumber || msg.data?.dlNumber} • Date: {msg.dateDisplay || msg.data?.date}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs px-3 py-1 rounded-full font-black bg-teal-500/20 text-teal-300 border border-teal-500/40 flex items-center gap-1.5">
                                <Truck className="w-3.5 h-3.5" />
                                {msg.vehicleNumber || msg.data?.vehicleNumber}
                              </span>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                            <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                              <span className="text-[10px] text-slate-400 block font-semibold">Mobile</span>
                              <span className="font-extrabold text-white text-xs block mt-0.5">
                                {msg.mobile || msg.data?.mobile}
                              </span>
                            </div>

                            <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                              <span className="text-[10px] text-slate-400 block font-semibold">Plant Visited</span>
                              <span className="font-extrabold text-teal-300 text-xs block mt-0.5 truncate">
                                {msg.plantName || msg.data?.plantName}
                              </span>
                              <span className="text-[10px] text-slate-400 block font-mono">
                                IN: {msg.inTime || msg.data?.inTime} • OUT: {msg.outTime || msg.data?.outTime}
                              </span>
                            </div>

                            <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                              <span className="text-[10px] text-slate-400 block font-semibold">Total Inside Plant</span>
                              <span className="font-black text-emerald-300 text-xs block mt-0.5">
                                {msg.stayDuration || msg.data?.stayDuration}
                              </span>
                            </div>

                            <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
                              <span className="text-[10px] text-slate-400 block font-semibold">Total Outside Plant</span>
                              <span className="font-black text-amber-300 text-xs block mt-0.5">
                                {msg.outsideDuration || msg.data?.outsideDuration}
                              </span>
                            </div>
                          </div>

                          {/* 4-Column Timeline */}
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs text-slate-400 font-semibold px-1">
                              <span className="flex items-center gap-1.5 text-white">
                                <Clock className="w-3.5 h-3.5 text-teal-400" />
                                30-Minute Driving & Plant Timeline
                              </span>
                              <span className="text-[11px] text-slate-400 font-mono">
                                {(msg.timelineRows || msg.data?.timelineRows)?.length || 0} intervals
                              </span>
                            </div>

                            {((msg.timelineRows || msg.data?.timelineRows)?.length || 0) === 0 ? (
                              <div className="p-4 text-center rounded-xl border border-slate-800 bg-slate-900/50 text-slate-400 text-xs italic">
                                No GPS movement or plant visits recorded for Driver {msg.driverName || msg.data?.driverName} on this date.
                              </div>
                            ) : (
                              <div className="overflow-x-auto rounded-xl border border-slate-800 max-h-80 overflow-y-auto">
                                <table className="w-full text-left text-xs">
                                  <thead className="bg-slate-900/90 backdrop-blur sticky top-0 text-slate-300 font-bold border-b border-slate-800 z-10">
                                    <tr>
                                      <th className="p-2.5 w-24">Time</th>
                                      <th className="p-2.5 w-24">Status</th>
                                      <th className="p-2.5 w-32">Plant</th>
                                      <th className="p-2.5">Location</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-800/80 bg-slate-950/60 font-medium">
                                    {(msg.timelineRows || msg.data?.timelineRows)?.map((r: any, idx: number) => (
                                      <tr
                                        key={idx}
                                        className={
                                          r.status === 'Missing'
                                            ? 'bg-rose-950/20 hover:bg-rose-950/30'
                                            : r.status === 'Inside'
                                            ? 'bg-teal-950/15 hover:bg-teal-950/25'
                                            : 'hover:bg-slate-900/40'
                                        }
                                      >
                                        <td className="p-2.5 font-mono text-slate-300 font-bold whitespace-nowrap">
                                          {r.time}
                                        </td>
                                        <td className="p-2.5 whitespace-nowrap">
                                          <span
                                            className={`px-2 py-0.5 rounded text-[10px] font-black ${
                                              r.status === 'Inside'
                                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                                : r.status === 'Outside'
                                                ? 'bg-slate-800 text-slate-300 border border-slate-700'
                                                : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                            }`}
                                          >
                                            {r.status}
                                          </span>
                                        </td>
                                        <td className="p-2.5 text-slate-300 whitespace-nowrap font-medium">
                                          {r.plant}
                                        </td>
                                        <td
                                          className={`p-2.5 ${
                                            r.status === 'Missing'
                                              ? 'text-rose-400 font-semibold italic'
                                              : 'text-slate-200'
                                          }`}
                                        >
                                          {r.location}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>

                          {Boolean((msg.missingIntervals?.length || 0) > 0 || (msg.data?.missingIntervals?.length || 0) > 0) && (
                            <div className="p-2.5 rounded-xl bg-rose-950/30 border border-rose-800/40 text-[11px] text-rose-300 flex items-start gap-2">
                              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                              <span>
                                <strong>Rule 6 Verified Protection:</strong> Missing driver GPS intervals are clearly flagged as <em>Location Not Available — GPS data not received</em>.
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* WIDGET: Driver 7-Day Driving History (Requirement 3, 7) */}
                      {msg.type === 'DRIVER_7_DAY_HISTORY' && (
                        <div className="mt-3 p-4 sm:p-5 rounded-2xl bg-slate-950 text-white space-y-4 border border-teal-500/30 shadow-2xl">
                          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
                            <div>
                              <span className="text-base font-black text-white flex items-center gap-2">
                                <Calendar className="w-5 h-5 text-teal-400" />
                                7-Day Driving Intelligence: {msg.driverName}
                              </span>
                              <span className="text-xs text-slate-400 block mt-0.5">
                                DL: {msg.dlNumber} • Mobile: {msg.mobile} • Vehicle: {msg.vehicleNumber}
                              </span>
                            </div>
                            <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-teal-500/20 text-teal-300 border border-teal-500/30">
                              Past 7 Days
                            </span>
                          </div>

                          <div className="overflow-x-auto rounded-xl border border-slate-800">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-slate-900 text-slate-300 font-bold border-b border-slate-800">
                                <tr>
                                  <th className="p-2.5">Date</th>
                                  <th className="p-2.5">Plant Visited</th>
                                  <th className="p-2.5">IN Time</th>
                                  <th className="p-2.5">OUT Time</th>
                                  <th className="p-2.5">Stay Duration</th>
                                  <th className="p-2.5">Telemetry Records</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-800/80 bg-slate-950/60 font-medium">
                                {msg.dayRows?.map((r: any, idx: number) => (
                                  <tr key={idx} className="hover:bg-slate-900/40">
                                    <td className="p-2.5 font-bold text-white whitespace-nowrap">{r.date}</td>
                                    <td className="p-2.5 font-semibold text-teal-300">{r.plant}</td>
                                    <td className="p-2.5 text-slate-300 font-mono">{r.inTime}</td>
                                    <td className="p-2.5 text-slate-300 font-mono">{r.outTime}</td>
                                    <td className="p-2.5 font-black text-emerald-300">{r.stayDuration}</td>
                                    <td className="p-2.5 font-mono text-slate-400">{r.recordsCount} points</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* WIDGET: Vehicles Outside Plant at Historical Time (Requirement 7) */}
                      {msg.type === 'PLANT_VEHICLES_AT_TIME' && (
                        <div className="mt-3 p-4 sm:p-5 rounded-2xl bg-slate-950 text-white space-y-3 border border-amber-500/30 shadow-2xl">
                          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                            <div>
                              <span className="text-base font-black text-amber-300 flex items-center gap-2">
                                <Building2 className="w-5 h-5 text-amber-400" />
                                Vehicles Outside {msg.plantName}
                              </span>
                              <span className="block text-xs text-slate-400">
                                Timestamp: <strong>{msg.requestedTime}</strong> on <strong>{msg.requestedDate}</strong>
                              </span>
                            </div>
                            <span className="text-xs px-2.5 py-1 rounded-full font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              {msg.outsideVehicles?.length || 0} Outside
                            </span>
                          </div>

                          <div className="overflow-x-auto rounded-xl border border-slate-800">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-slate-900 text-slate-300 font-bold border-b border-slate-800">
                                <tr>
                                  <th className="p-2.5">Vehicle Number</th>
                                  <th className="p-2.5">Driver Name</th>
                                  <th className="p-2.5">Status</th>
                                  <th className="p-2.5">Distance</th>
                                  <th className="p-2.5">Location</th>
                                  <th className="p-2.5">GPS Time</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-800/80 bg-slate-950/60 font-medium">
                                {msg.outsideVehicles?.map((v: any, idx: number) => (
                                  <tr key={idx} className="hover:bg-slate-900/40">
                                    <td className="p-2.5 font-bold text-emerald-400">{v.vehicleNumber}</td>
                                    <td className="p-2.5 text-slate-200">{v.driverName}</td>
                                    <td className="p-2.5">
                                      <span className="px-2 py-0.5 rounded text-[10px] font-black bg-slate-800 text-slate-300 border border-slate-700">
                                        Outside
                                      </span>
                                    </td>
                                    <td className="p-2.5 font-mono text-amber-300">{v.distanceKm} km</td>
                                    <td className="p-2.5 text-slate-300">{v.location}</td>
                                    <td className="p-2.5 font-mono text-slate-400">{v.actualGpsTime}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* WIDGET: Vehicles Currently Inside Plant (Requirement 7) */}
                      {msg.type === 'VEHICLES_INSIDE_PLANT' && (
                        <div className="mt-3 p-4 sm:p-5 rounded-2xl bg-slate-950 text-white space-y-3 border border-emerald-500/30 shadow-2xl">
                          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                            <div>
                              <span className="text-base font-black text-emerald-400 flex items-center gap-2">
                                <Building2 className="w-5 h-5 text-emerald-400" />
                                Vehicles Inside {msg.plantName}
                              </span>
                              <span className="block text-xs text-slate-400">
                                Verified Live Geofence Telematics
                              </span>
                            </div>
                            <span className="text-xs px-2.5 py-1 rounded-full font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              {msg.vehicles?.length || 0} Currently Inside
                            </span>
                          </div>

                          <div className="overflow-x-auto rounded-xl border border-slate-800">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-slate-900 text-slate-300 font-bold border-b border-slate-800">
                                <tr>
                                  <th className="p-2.5">Vehicle Number</th>
                                  <th className="p-2.5">Driver Name</th>
                                  <th className="p-2.5">Mobile</th>
                                  <th className="p-2.5">IN Time</th>
                                  <th className="p-2.5">Stay Duration</th>
                                  <th className="p-2.5">Location</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-800/80 bg-slate-950/60 font-medium">
                                {msg.vehicles?.map((v: any, idx: number) => (
                                  <tr key={idx} className="hover:bg-slate-900/40">
                                    <td className="p-2.5 font-bold text-emerald-400">{v.vehicleNumber}</td>
                                    <td className="p-2.5 text-slate-200">{v.driverName}</td>
                                    <td className="p-2.5 font-mono text-slate-400">{v.driverMobile}</td>
                                    <td className="p-2.5 font-mono text-teal-300">{v.inTime}</td>
                                    <td className="p-2.5 font-bold text-emerald-300">{v.stayDuration}</td>
                                    <td className="p-2.5 text-slate-300">{v.location}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* WIDGET: Plant Availability List */}
                      {msg.type === 'PLANT_AVAILABILITY' && msg.vehicles && (
                        <div className="mt-3 space-y-2">
                          <div className="overflow-x-auto rounded-xl border border-slate-200">
                            <table className="w-full text-left text-xs">
                              <thead className="bg-slate-100 text-slate-700 font-bold">
                                <tr>
                                  <th className="p-2.5">Vehicle</th>
                                  <th className="p-2.5">Driver</th>
                                  <th className="p-2.5">Status</th>
                                  <th className="p-2.5">IN Time</th>
                                  <th className="p-2.5">Stay</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {msg.vehicles.map((v: any, idx: number) => (
                                  <tr key={idx} className="hover:bg-slate-50">
                                    <td className="p-2.5 font-bold text-emerald-700">{v.vehicleNumber}</td>
                                    <td className="p-2.5 text-slate-800">{v.driverName}</td>
                                    <td className="p-2.5">
                                      <span
                                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                                          v.status.includes('Inside')
                                            ? 'bg-emerald-100 text-emerald-800'
                                            : 'bg-slate-100 text-slate-700'
                                        }`}
                                      >
                                        {v.status}
                                      </span>
                                    </td>
                                    <td className="p-2.5 text-slate-600">{v.inTime}</td>
                                    <td className="p-2.5 font-semibold text-slate-900">{v.stayDuration}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* WIDGET: GPS Sync Result */}
                      {msg.type === 'GPS_SYNC_RESULT' && msg.syncResult && (
                        <div className="mt-3 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 space-y-2 text-xs">
                          <div className="flex items-center justify-between font-bold">
                            <span>Status: {msg.syncResult.status}</span>
                            <span className="text-[11px] text-emerald-700">{msg.syncResult.durationMs}ms</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-[11px]">
                            <div className="p-2 rounded bg-white border border-emerald-100">
                              <span>Vehicles Synced: </span>
                              <strong className="text-emerald-700">{msg.syncResult.vehiclesSuccess}</strong>
                            </div>
                            <div className="p-2 rounded bg-white border border-emerald-100">
                              <span>Drivers Synced: </span>
                              <strong className="text-teal-700">{msg.syncResult.driversSuccess}</strong>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* WIDGET: Sync Errors List */}
                      {msg.type === 'GPS_SYNC_ERRORS' && msg.failures && (
                        <div className="mt-3 space-y-2">
                          {msg.failures.length === 0 ? (
                            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-2">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                              <span>Zero synchronization errors recorded. Telematics stream is 100% healthy.</span>
                            </div>
                          ) : (
                            msg.failures.map((f: any, idx: number) => (
                              <div
                                key={idx}
                                className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-950 text-xs space-y-1"
                              >
                                <div className="flex items-center justify-between font-bold">
                                  <span>{f.entityType}: {f.identifier}</span>
                                  <span className="text-[10px] px-2 py-0.5 rounded bg-rose-200 text-rose-800">
                                    {f.status}
                                  </span>
                                </div>
                                <p className="text-[11px] text-rose-800">
                                  <strong>Reason:</strong> {f.reason}
                                </p>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                {isSendingQuery && (
                  <div className="flex items-center gap-2.5 text-xs text-slate-500 italic p-3 bg-white rounded-2xl border border-slate-200 w-fit">
                    <Sparkles className="w-4 h-4 text-emerald-500 animate-spin" />
                    <span>Sikka AI is analyzing database records & telemetry...</span>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Chat Input Bar */}
              <div className="p-4 bg-white border-t border-slate-200">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSendQuery();
                  }}
                  className="flex items-center gap-3"
                >
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Ask about vehicle GPS, driver location, stay hours, or sync command..."
                    className="flex-1 px-4 py-3 rounded-2xl bg-slate-100 hover:bg-slate-100/80 focus:bg-white text-xs sm:text-sm text-slate-900 border border-transparent focus:border-emerald-500 outline-none transition"
                  />
                  <button
                    type="submit"
                    disabled={isSendingQuery || !inputText.trim()}
                    className="p-3 sm:px-5 sm:py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs sm:text-sm flex items-center gap-2 shadow-md shadow-emerald-600/25 transition cursor-pointer disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                    <span className="hidden sm:inline">Ask AI</span>
                  </button>
                </form>
              </div>
            </div>

            {/* Quick Commands & Guardrails Sidebar */}
            <div className="space-y-6">
              {/* Quick Command Chips */}
              <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-lg space-y-3">
                <div className="flex items-center gap-2 font-black text-xs text-slate-900 uppercase tracking-wider">
                  <Zap className="w-4 h-4 text-amber-500" />
                  <span>Quick Commands</span>
                </div>
                <div className="flex flex-col gap-2">
                  {QUICK_COMMANDS.map((cmd, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSendQuery(cmd.query)}
                      className="text-left px-3 py-2.5 rounded-xl bg-slate-50 hover:bg-emerald-50 border border-slate-200/70 hover:border-emerald-300 text-xs font-semibold text-slate-700 hover:text-emerald-950 transition flex items-center justify-between group cursor-pointer"
                    >
                      <span>{cmd.label}</span>
                      <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-emerald-600 transition" />
                    </button>
                  ))}
                </div>
              </div>

              {/* Safety & Policy Principles Card */}
              <div className="bg-gradient-to-br from-slate-900 to-slate-950 text-white rounded-3xl p-5 border border-slate-800 shadow-xl space-y-3">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-emerald-400">
                  <ShieldCheck className="w-4 h-4" />
                  <span>AI Safety Policy</span>
                </div>
                <div className="space-y-2 text-xs text-slate-300 leading-relaxed">
                  <div className="p-2.5 rounded-xl bg-slate-800/60 border border-slate-700/60">
                    <strong className="text-white block">Read First, Verify First</strong>
                    Sikka AI analyzes real database coordinates and never fabricates or hallucinates locations.
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-800/60 border border-slate-700/60">
                    <strong className="text-white block">No Admin Approval = No Delete</strong>
                    Deletions or sensitive plant modifications are strictly blocked without Admin approval.
                  </div>
                  <div className="p-2.5 rounded-xl bg-slate-800/60 border border-slate-700/60">
                    <strong className="text-white block">Driver Session Restrictions</strong>
                    Driver accounts are strictly prohibited from viewing or accessing Sikka AI.
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB: 24-HOUR Q&A HISTORY (User Privacy & Admin Full Visibility) */}
        {activeTab === 'history' && (
          <div className="space-y-6">
            {/* Header / Security Policy Card */}
            <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xl space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600">
                      <Clock className="w-5 h-5" />
                    </div>
                    <h2 className="text-lg font-black text-slate-900">
                      Sikka AI – 24-Hour Question & Answer History
                    </h2>
                  </div>
                  <p className="text-xs text-slate-500">
                    {isAdmin
                      ? 'Administrator Audit Stream — Complete visibility over all users’ inquiries and AI responses across the fleet. Records automatically expire and permanently delete after 24 hours.'
                      : 'Private Inquiries Vault — You can view only your personal AI questions and answers. Each record remains active for exactly 24 hours, then automatically and permanently deletes.'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold border border-slate-200 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    {historyList.length} Active Records
                  </span>
                  <button
                    type="button"
                    onClick={() => fetchHistory()}
                    disabled={isLoadingHistory}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingHistory ? 'animate-spin' : ''}`} />
                    <span>Refresh</span>
                  </button>
                </div>
              </div>

              {/* Privacy & Expiration Banner */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-slate-900 to-slate-950 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4 border border-slate-800">
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 shrink-0 mt-0.5">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-wider text-emerald-400">
                      {isAdmin ? 'Fleet-Wide Authorization Active' : 'User Privacy Enforced (Isolated Scope)'}
                    </h4>
                    <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">
                      {isAdmin
                        ? 'Admin can review all users’ questions, answers, and remaining auto-delete countdowns. Non-admin users are strictly blocked at the database level from accessing other users’ history.'
                        : 'Your questions and AI answers are isolated to your account. No other standard user can see your activity. Every record automatically purges 24 hours from its submission timestamp.'}
                    </p>
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-2 self-start sm:self-center px-3 py-1.5 rounded-xl bg-emerald-950/60 border border-emerald-500/30 text-emerald-300 text-xs font-bold">
                  <Clock className="w-3.5 h-3.5" />
                  <span>24h Per-Message TTL</span>
                </div>
              </div>

              {/* Filters & Search Bar */}
              <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
                <div className="relative flex-1 w-full">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    placeholder="Search by question, answer, vehicle number, driver, plant, or username..."
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-medium text-slate-800 placeholder-slate-400 outline-none focus:border-emerald-500 focus:bg-white transition"
                  />
                  {historySearch && (
                    <button
                      type="button"
                      onClick={() => setHistorySearch('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 hover:text-slate-600"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {isAdmin && (
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <input
                      type="text"
                      value={historyUserFilter}
                      onChange={(e) => setHistoryUserFilter(e.target.value)}
                      placeholder="Filter by User ID / Username..."
                      className="w-full sm:w-56 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-medium text-slate-800 placeholder-slate-400 outline-none focus:border-emerald-500 focus:bg-white transition"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* History Records List */}
            {isLoadingHistory ? (
              <div className="p-12 text-center bg-white rounded-3xl border border-slate-200 shadow-md">
                <RefreshCw className="w-6 h-6 animate-spin text-emerald-500 mx-auto mb-2" />
                <p className="text-xs font-bold text-slate-500">Loading 24-hour Q&A history...</p>
              </div>
            ) : historyList.length === 0 ? (
              <div className="p-12 text-center bg-white rounded-3xl border border-slate-200 shadow-md space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                  <Bot className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-extrabold text-slate-800">No Active AI Records Found</h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  {historySearch
                    ? 'No interactions match your search filter within the active 24-hour retention window.'
                    : 'There are no AI question & answer records within the last 24 hours. Ask any question in the AI Assistant tab to see it here!'}
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('chat')}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition inline-flex items-center gap-1.5"
                >
                  <Bot className="w-3.5 h-3.5" />
                  <span>Go to AI Assistant & Chat</span>
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {historyList.map((item) => {
                  const isExpiringSoon = item.remainingMinutes < 120;
                  return (
                    <div
                      key={item._id}
                      className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-md hover:shadow-lg transition space-y-3.5"
                    >
                      {/* Top Meta Bar */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 border-b border-slate-100">
                        {/* User identity & Role */}
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-slate-900 text-emerald-400 font-black text-xs flex items-center justify-center uppercase">
                            {item.userName ? item.userName[0] : 'U'}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-black text-slate-900">{item.userName}</span>
                              <span className="text-[11px] font-medium text-slate-500">@{item.username}</span>
                              <span
                                className={`px-2 py-0.2 rounded text-[9px] font-black uppercase ${
                                  item.userRole === 'Admin'
                                    ? 'bg-purple-100 text-purple-800'
                                    : 'bg-slate-100 text-slate-700'
                                }`}
                              >
                                {item.userRole}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3 h-3 text-slate-400" />
                                {item.questionDate}
                              </span>
                              <span>•</span>
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3 text-slate-400" />
                                {item.questionTime}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Expiration Countdown & Action */}
                        <div className="flex items-center gap-2 self-start sm:self-center">
                          <div
                            className={`px-3 py-1 rounded-xl text-xs font-bold border flex items-center gap-1.5 ${
                              isExpiringSoon
                                ? 'bg-amber-50 text-amber-800 border-amber-300'
                                : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            }`}
                          >
                            <Clock className={`w-3.5 h-3.5 ${isExpiringSoon ? 'animate-pulse text-amber-600' : 'text-emerald-600'}`} />
                            <span>{item.remainingTime}</span>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleDeleteHistoryItem(item._id)}
                            disabled={deletingHistoryId === item._id}
                            title="Delete this record permanently"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer disabled:opacity-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Associated Entities Badges (Vehicle / Driver / Plant) */}
                      {(item.relevantVehicle || item.relevantDriver || item.relevantPlant) && (
                        <div className="flex flex-wrap items-center gap-2">
                          {item.relevantVehicle && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-bold">
                              <Truck className="w-3.5 h-3.5 text-emerald-600" />
                              Vehicle: <strong className="font-mono">{item.relevantVehicle}</strong>
                            </span>
                          )}
                          {item.relevantDriver && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-teal-50 border border-teal-200 text-teal-800 text-[11px] font-bold">
                              <UserCheck className="w-3.5 h-3.5 text-teal-600" />
                              Driver: <strong>{item.relevantDriver}</strong>
                            </span>
                          )}
                          {item.relevantPlant && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-800 text-[11px] font-bold">
                              <Building2 className="w-3.5 h-3.5 text-indigo-600" />
                              Plant: <strong>{item.relevantPlant}</strong>
                            </span>
                          )}
                        </div>
                      )}

                      {/* Question Bubble */}
                      <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-1">
                        <div className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-slate-500">
                          <span>User Question</span>
                        </div>
                        <p className="text-xs sm:text-sm font-semibold text-slate-800 leading-relaxed whitespace-pre-wrap">
                          {item.question}
                        </p>
                      </div>

                      {/* AI Answer Bubble */}
                      <div className="p-4 rounded-xl bg-slate-950 text-white border border-slate-800 space-y-1.5 shadow-inner">
                        <div className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-emerald-400">
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Sikka AI Answer</span>
                        </div>
                        <div className="text-xs sm:text-sm text-slate-200 leading-relaxed whitespace-pre-wrap font-sans">
                          {item.answer}
                        </div>
                      </div>

                      {/* Expiration Footnote */}
                      <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1">
                        <span>
                          Stored at: {item.questionDate} {item.questionTime}
                        </span>
                        <span className="font-mono text-emerald-600">
                          Auto-Deletes at: {new Date(item.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({new Date(item.expiresAt).toLocaleDateString()})
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: 30-MIN AUTO-SYNC MONITOR */}
        {activeTab === 'sync' && (
          <div className="space-y-6">
            <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xl space-y-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                  <h2 className="text-lg font-black text-slate-900">30-Minute Automated GPS & Driver Sync Engine</h2>
                  <p className="text-xs text-slate-500 mt-1">
                    Continuously synchronizes active fleet vehicle positions and driver telemetry every 30 minutes.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleTriggerManualSync}
                  disabled={isSyncing}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md transition cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                  <span>Trigger Immediate Sync</span>
                </button>
              </div>

              {/* Sync Logs Table */}
              <div className="overflow-x-auto rounded-2xl border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900 text-white font-bold">
                    <tr>
                      <th className="p-3.5">Sync ID</th>
                      <th className="p-3.5">Type</th>
                      <th className="p-3.5">Triggered By</th>
                      <th className="p-3.5">Vehicles</th>
                      <th className="p-3.5">Drivers</th>
                      <th className="p-3.5">Duration</th>
                      <th className="p-3.5">Status</th>
                      <th className="p-3.5">Failures</th>
                      <th className="p-3.5">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {syncLogs.map((log) => (
                      <tr key={log._id} className="hover:bg-slate-50 transition">
                        <td className="p-3.5 font-mono font-bold text-slate-900">{log.syncId}</td>
                        <td className="p-3.5 font-semibold text-slate-700">{log.syncType}</td>
                        <td className="p-3.5 text-slate-600">{log.initiatedBy}</td>
                        <td className="p-3.5 font-semibold text-emerald-700">
                          {log.vehiclesSuccess} / {log.vehiclesTotal}
                        </td>
                        <td className="p-3.5 font-semibold text-teal-700">
                          {log.driversSuccess} / {log.driversTotal}
                        </td>
                        <td className="p-3.5 font-mono text-slate-500">{log.durationMs}ms</td>
                        <td className="p-3.5">
                          <span
                            className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                              log.status === 'Success'
                                ? 'bg-emerald-100 text-emerald-800'
                                : log.status === 'Partial Failure'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {log.status}
                          </span>
                        </td>
                        <td className="p-3.5">
                          {log.failures?.length > 0 ? (
                            <span className="text-rose-600 font-bold">{log.failures.length} errors</span>
                          ) : (
                            <span className="text-emerald-600 font-semibold">0 errors</span>
                          )}
                        </td>
                        <td className="p-3.5 text-slate-500">
                          {new Date(log.startedAt).toLocaleString('en-IN', {
                            timeZone: 'Asia/Kolkata',
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: ERROR DIAGNOSTICS & AUTO-REPAIR */}
        {activeTab === 'repair' && (
          <div className="space-y-6">
            <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xl space-y-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                  <h2 className="text-lg font-black text-slate-900">Sikka AI Safe Error Verification & Repair</h2>
                  <p className="text-xs text-slate-500 mt-1">
                    Detects GPS API connectivity faults, heals missing vehicle current statuses, resets deadlocks, and verifies system integrity without touching business code or permissions.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleTriggerRepair}
                  disabled={isRepairing}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black shadow-md transition cursor-pointer disabled:opacity-50"
                >
                  <Wrench className={`w-4 h-4 ${isRepairing ? 'animate-spin' : ''}`} />
                  <span>{isRepairing ? 'Running Diagnostics...' : 'Run Auto-Repair Now'}</span>
                </button>
              </div>

              {repairResult && (
                <div className="p-5 rounded-2xl bg-slate-900 text-white space-y-4">
                  <div className="flex items-center gap-2 text-sm font-bold text-emerald-400">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    <span>Auto-Repair Execution Report ({new Date(repairResult.timestamp).toLocaleTimeString()})</span>
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Repairs Applied</h3>
                    {repairResult.repairsPerformed?.length === 0 ? (
                      <p className="text-xs text-slate-300 italic">No errors needed repairing. All systems coherent.</p>
                    ) : (
                      repairResult.repairsPerformed.map((r: any, idx: number) => (
                        <div key={idx} className="p-3 rounded-xl bg-slate-800 border border-slate-700 text-xs space-y-1">
                          <p className="font-bold text-amber-300">Issue: {r.issue}</p>
                          <p className="text-slate-300">Action: {r.repairAction}</p>
                          <p className="text-emerald-400 font-semibold">Verification: {r.recheckResult}</p>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="space-y-2 pt-2 border-t border-slate-800">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">System Health Checks</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      {repairResult.systemChecks?.map((c: any, idx: number) => (
                        <div key={idx} className="p-2.5 rounded-lg bg-slate-800/70 border border-slate-700/50">
                          <span className="font-bold text-slate-300">{c.check}: </span>
                          <span className="text-emerald-300">{c.result}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: ADMIN APPROVALS CENTER */}
        {activeTab === 'approvals' && (
          <div className="space-y-6">
            <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xl space-y-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                  <h2 className="text-lg font-black text-slate-900">Admin Authorization Center</h2>
                  <p className="text-xs text-slate-500 mt-1">
                    Sensitive operations (Plant configuration modifications, radius adjustments, record deletions) are held pending Administrator approval.
                  </p>
                </div>
                <div className="text-xs px-3 py-1.5 rounded-xl bg-slate-100 text-slate-700 font-bold">
                  Rule: No Admin Approval = No Sensitive Action
                </div>
              </div>

              {approvals.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <ShieldCheck className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
                  <p className="font-bold text-slate-800">No Pending Approval Requests</p>
                  <p className="text-xs mt-1">All sensitive operations are clear and verified.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {approvals.map((req) => (
                    <div
                      key={req._id}
                      className="p-5 rounded-2xl border border-slate-200 bg-white hover:border-slate-300 transition space-y-4 shadow-xs"
                    >
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="px-3 py-1 rounded-md bg-slate-950 text-white font-mono text-xs font-bold tracking-tight">
                            {req.requestId}
                          </span>
                          <h3 className="font-extrabold text-sm text-slate-900 tracking-tight">{req.actionTitle}</h3>
                        </div>

                        <div className="flex items-center gap-2">
                          <span
                            className={`text-[10px] font-black px-2.5 py-0.5 rounded-md uppercase tracking-wider ${
                              req.aiRiskLevel?.toUpperCase() === 'CRITICAL'
                                ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                : req.aiRiskLevel?.toUpperCase() === 'HIGH'
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : 'bg-blue-50 text-blue-700 border border-blue-200'
                            }`}
                          >
                            RISK: {req.aiRiskLevel?.toUpperCase()}
                          </span>
                          <span
                            className={`text-[10px] font-black px-2.5 py-0.5 rounded-md uppercase tracking-wider ${
                              req.status === 'Approved' || req.status === 'Executed'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : req.status === 'Rejected'
                                ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                : 'bg-amber-50 text-amber-700 border border-amber-200'
                            }`}
                          >
                            {req.status?.toUpperCase()}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                        <div className="p-3.5 rounded-xl bg-slate-50/70 border border-slate-200/80 space-y-0.5">
                          <span className="text-[10px] text-slate-400 block font-semibold">Requested By</span>
                          <span className="font-bold text-slate-900 block">{req.requestedByName}</span>
                          <span className="text-[10px] text-slate-400 block">
                            {new Date(req.createdAt).toLocaleString()}
                          </span>
                        </div>

                        <div className="p-3.5 rounded-xl bg-slate-50/70 border border-slate-200/80 space-y-0.5">
                          <span className="text-[10px] text-slate-400 block font-semibold">Affected Record</span>
                          <span className="font-bold text-slate-900 block">{req.affectedRecordLabel || req.affectedRecordId || '—'}</span>
                          <span className="text-[10px] text-slate-400 block">{req.affectedRecordType}</span>
                        </div>

                        <div className="p-3.5 rounded-xl bg-slate-50/70 border border-slate-200/80 space-y-0.5">
                          <span className="text-[10px] text-slate-400 block font-semibold">Requested Value</span>
                          <span className="font-mono font-bold text-emerald-700 block break-all text-xs">
                            {typeof req.requestedNewValue === 'object'
                              ? JSON.stringify(req.requestedNewValue)
                              : String(req.requestedNewValue || '—')}
                          </span>
                        </div>
                      </div>

                      <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200/80 text-xs text-amber-950">
                        <strong className="text-amber-900 font-bold">AI Verification Result:</strong> {req.aiVerificationResult}
                      </div>

                      {req.status === 'Pending' && isAdmin && (
                        <div className="flex items-center justify-end gap-3 pt-2">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedApproval(req);
                              setDecisionType('Reject');
                              setDecisionModalOpen(true);
                            }}
                            className="px-5 py-2.5 rounded-xl bg-white hover:bg-rose-50 text-rose-600 hover:text-rose-700 text-xs font-bold border border-rose-200 transition cursor-pointer shadow-2xs"
                          >
                            Reject Request
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedApproval(req);
                              setDecisionType('Approve');
                              setDecisionModalOpen(true);
                            }}
                            className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-600/20 transition cursor-pointer"
                          >
                            Approve & Execute Action
                          </button>
                        </div>
                      )}

                      {req.status !== 'Pending' && (
                        <div className="text-[11px] text-slate-600 pt-2 border-t border-slate-100 flex items-center justify-between">
                          <span>
                            Decided by: <strong>{req.approvedByName || req.rejectedByName || 'Administrator'}</strong>
                            {req.approvedAt || req.rejectedAt
                              ? ` on ${new Date(req.approvedAt || req.rejectedAt || '').toLocaleString()}`
                              : ''}
                          </span>
                          <span className="font-semibold text-slate-700">
                            {req.executionResult || req.rejectionReason || `Status: ${req.status}`}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 5: AUDIT TRAIL */}
        {activeTab === 'audit' && (
          <div className="space-y-6">
            <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xl space-y-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                  <h2 className="text-lg font-black text-slate-900">Sikka AI Complete Audit Trail</h2>
                  <p className="text-xs text-slate-500 mt-1">
                    Immutable activity log capturing sync executions, queries, auto-repairs, blocked sensitive actions, and Administrator decisions.
                  </p>
                </div>

                {/* Filters */}
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <div className="relative flex-1 sm:w-60">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      value={auditSearch}
                      onChange={(e) => setAuditSearch(e.target.value)}
                      placeholder="Search action or user..."
                      className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-100 text-xs text-slate-800 border-none outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  <select
                    value={auditActionFilter}
                    onChange={(e) => setAuditActionFilter(e.target.value)}
                    className="px-3 py-2 rounded-xl bg-slate-100 text-xs font-bold text-slate-700 border-none outline-none"
                  >
                    <option value="ALL">All Actions</option>
                    <option value="GPS_SYNC">GPS Sync</option>
                    <option value="AUTO_REPAIR">Auto Repair</option>
                    <option value="SENSITIVE_BLOCKED">Sensitive Blocked</option>
                    <option value="APPROVAL_PROCESSED">Approval Processed</option>
                  </select>
                </div>
              </div>

              {/* Audit Table */}
              <div className="overflow-x-auto rounded-2xl border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-900 text-white font-bold">
                    <tr>
                      <th className="p-3.5">Action ID</th>
                      <th className="p-3.5">Timestamp</th>
                      <th className="p-3.5">User</th>
                      <th className="p-3.5">Action Type</th>
                      <th className="p-3.5">Entity</th>
                      <th className="p-3.5">Reason / Details</th>
                      <th className="p-3.5">Verification</th>
                      <th className="p-3.5">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {auditLogs.map((log) => (
                      <tr key={log._id} className="hover:bg-slate-50 transition">
                        <td className="p-3.5 font-mono font-bold text-slate-900">{log.actionId}</td>
                        <td className="p-3.5 text-slate-500">
                          {new Date(log.timestamp).toLocaleString('en-IN', {
                            timeZone: 'Asia/Kolkata',
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="p-3.5 font-semibold text-slate-800">{log.user}</td>
                        <td className="p-3.5">
                          <span className="px-2 py-0.5 rounded bg-slate-100 font-bold text-slate-700 text-[10px]">
                            {log.actionType}
                          </span>
                        </td>
                        <td className="p-3.5 text-slate-700">
                          {log.vehicle !== '—' ? log.vehicle : log.plant !== '—' ? log.plant : log.driver !== '—' ? log.driver : 'System'}
                        </td>
                        <td className="p-3.5 text-slate-600 max-w-xs truncate" title={log.reason}>
                          {log.reason || '—'}
                        </td>
                        <td className="p-3.5 text-slate-500 max-w-xs truncate" title={log.aiVerification}>
                          {log.aiVerification}
                        </td>
                        <td className="p-3.5">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              log.result === 'Success'
                                ? 'bg-emerald-100 text-emerald-800'
                                : log.result === 'Blocked'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {log.result}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* DECISION MODAL FOR ADMIN */}
        <Modal
          isOpen={decisionModalOpen}
          onClose={() => setDecisionModalOpen(false)}
          title={`Confirm ${decisionType}: ${selectedApproval?.requestId}`}
        >
          <div className="space-y-4">
            <p className="text-sm text-slate-700 leading-relaxed">
              Are you sure you want to <strong>{decisionType.toLowerCase()}</strong> the following sensitive request?
            </p>

            <div className="p-3.5 rounded-xl bg-slate-100 text-xs space-y-1.5">
              <p><strong>Action:</strong> {selectedApproval?.actionTitle}</p>
              <p><strong>Requested By:</strong> {selectedApproval?.requestedByName}</p>
              <p><strong>Affected Record:</strong> {selectedApproval?.affectedRecordLabel}</p>
              <p><strong>Current Value:</strong> {JSON.stringify(selectedApproval?.currentValue)}</p>
              <p><strong>New Requested Value:</strong> {JSON.stringify(selectedApproval?.requestedNewValue)}</p>
            </div>

            {decisionType === 'Reject' && (
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Rejection Reason (Required)
                </label>
                <textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="Explain why this request is being rejected..."
                  className="w-full p-2.5 rounded-xl border border-slate-300 text-xs outline-none focus:border-rose-500"
                  rows={3}
                />
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-3">
              <button
                type="button"
                onClick={() => setDecisionModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-200 text-slate-700 text-xs font-bold transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDecideApproval}
                disabled={isProcessingDecision || (decisionType === 'Reject' && !rejectionReason.trim())}
                className={`px-5 py-2 rounded-xl text-white text-xs font-bold transition cursor-pointer disabled:opacity-50 ${
                  decisionType === 'Approve' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-rose-600 hover:bg-rose-500'
                }`}
              >
                {isProcessingDecision ? 'Processing...' : `Confirm ${decisionType}`}
              </button>
            </div>
          </div>
        </Modal>
      </div>
    </AppLayout>
  );
}
