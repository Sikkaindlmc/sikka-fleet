'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Bell,
  X,
  CheckCheck,
  Check,
  Clock,
  Truck,
  Factory,
  User,
  FileText,
  ChevronRight,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { useAuth } from '../lib/authContext';

export interface PlanNotificationItem {
  id: string;
  plantId?: string;
  plantName: string;
  vehicleId: string;
  vehicleNumber: string;
  planBy: string;
  location: string;
  latitude?: number;
  longitude?: number;
  planNote: string;
  createdAt: string;
  formattedDateTime: string;
  isRead: boolean;
}

export default function PlantPlanNotificationIcon() {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<PlanNotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedNotification, setSelectedNotification] = useState<PlanNotificationItem | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Fetch notifications from backend
  const fetchNotifications = useCallback(async (showLoading = false) => {
    if (!user) return;
    if (showLoading) setIsLoading(true);

    try {
      const data = await apiRequest<{
        success: boolean;
        count: number;
        unreadCount: number;
        notifications: PlanNotificationItem[];
      }>('/notifications?limit=50');

      if (data && data.success) {
        // Enforce 48-Hour auto-removal window from added date & time
        const cutoffTime = Date.now() - 48 * 60 * 60 * 1000;
        const validList = (data.notifications || []).filter(
          (item) => new Date(item.createdAt).getTime() >= cutoffTime
        );
        setNotifications(validList);
        setUnreadCount(data.unreadCount || 0);
      }
    } catch (err: any) {
      console.warn('[PlantPlanNotification fetch failed]:', err?.message || err);
    } finally {
      if (showLoading) setIsLoading(false);
    }
  }, [user]);

  // Initial fetch and automatic updates (every 12 seconds without requiring page refresh)
  useEffect(() => {
    if (!user) return;

    fetchNotifications(true);

    const interval = setInterval(() => {
      fetchNotifications(false);
    }, 12000);

    const handlePlanUpdated = () => {
      fetchNotifications(false);
    };

    window.addEventListener('plant-plan-updated', handlePlanUpdated);

    return () => {
      clearInterval(interval);
      window.removeEventListener('plant-plan-updated', handlePlanUpdated);
    };
  }, [user, fetchNotifications]);

  // Close panel on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        // Only close if not clicking the toggle button
        const toggleBtn = document.getElementById('plant-plan-notification-toggle');
        if (toggleBtn && toggleBtn.contains(e.target as Node)) return;
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Mark single notification as read
  const handleMarkAsRead = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      await apiRequest(`/notifications/${id}/read`, { method: 'POST' });
      setNotifications((prev) =>
        prev.map((item) => (item.id === id ? { ...item, isRead: true } : item))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
      if (selectedNotification && selectedNotification.id === id) {
        setSelectedNotification((prev) => (prev ? { ...prev, isRead: true } : null));
      }
    } catch (err) {
      console.error('[Mark As Read Error]:', err);
    }
  };

  // Mark all notifications as read
  const handleMarkAllAsRead = async () => {
    if (unreadCount === 0) return;
    try {
      await apiRequest('/notifications/read-all', { method: 'POST' });
      setNotifications((prev) => prev.map((item) => ({ ...item, isRead: true })));
      setUnreadCount(0);
      if (selectedNotification) {
        setSelectedNotification((prev) => (prev ? { ...prev, isRead: true } : null));
      }
    } catch (err) {
      console.error('[Mark All As Read Error]:', err);
    }
  };

  // Handle clicking on a notification item (view complete details & mark as read)
  const handleItemClick = (item: PlanNotificationItem) => {
    setSelectedNotification(item);
    if (!item.isRead) {
      handleMarkAsRead(item.id);
    }
  };

  if (!user) return null;

  return (
    <>
      {/* Floating Bottom-Right Notification Trigger Icon */}
      <div className="fixed bottom-5 right-5 sm:bottom-6 sm:right-6 z-50 select-none">
        <button
          id="plant-plan-notification-toggle"
          type="button"
          onClick={() => {
            setIsOpen((prev) => !prev);
            if (!isOpen) {
              fetchNotifications(false);
            }
          }}
          className={`relative group flex items-center justify-center w-13 h-13 sm:w-14 sm:h-14 rounded-2xl shadow-xl transition-all duration-300 cursor-pointer ${
            isOpen
              ? 'bg-slate-900 text-emerald-400 rotate-90 ring-4 ring-emerald-500/20 shadow-slate-900/40'
              : unreadCount > 0
              ? 'bg-gradient-to-tr from-emerald-600 via-emerald-500 to-teal-400 text-slate-950 hover:scale-105 shadow-emerald-500/30'
              : 'bg-slate-900 text-white hover:bg-slate-800 hover:scale-105 shadow-slate-900/30'
          }`}
          title="Plant Plan Notifications"
          aria-label="Plant Plan Notifications"
        >
          {/* Subtle Ambient Pulse Ring when unread messages exist */}
          {unreadCount > 0 && !isOpen && (
            <span className="absolute -inset-1 rounded-2xl bg-emerald-400/30 animate-ping opacity-75"></span>
          )}

          {isOpen ? (
            <X className="w-6 h-6 transition-transform -rotate-90" />
          ) : (
            <div className="relative">
              <Bell className={`w-6 h-6 ${unreadCount > 0 ? 'animate-wiggle' : ''}`} />
            </div>
          )}

          {/* Unread Notification Counter Badge */}
          {unreadCount > 0 && !isOpen && (
            <span className="absolute -top-1.5 -right-1.5 flex h-5.5 min-w-5.5 px-1.5 items-center justify-center rounded-full bg-rose-500 text-white text-[11px] font-extrabold shadow-md border-2 border-white tracking-tight animate-pulse">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* Slide-out / Popover Notification Panel */}
      {isOpen && (
        <div
          ref={panelRef}
          className="fixed bottom-21 right-5 sm:bottom-23 sm:right-6 z-50 w-[calc(100vw-2.5rem)] sm:w-[430px] max-h-[82vh] flex flex-col bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-slate-200/90 overflow-hidden animate-in fade-in slide-in-from-bottom-5 duration-200"
          style={{ boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.25)' }}
        >
          {/* Panel Header */}
          <div className="flex items-center justify-between px-5 py-4 bg-slate-900 text-white border-b border-slate-800 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-slate-950 font-bold shadow-xs">
                📢
              </div>
              <div>
                <h3 className="text-sm font-bold tracking-tight text-white flex items-center gap-2">
                  <span>Plant Plan Notifications</span>
                  {unreadCount > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-[10px] font-extrabold">
                      {unreadCount} New
                    </span>
                  )}
                </h3>
                <p className="text-[11px] text-slate-400">
                  Real-time vehicle plant dispatch notes
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllAsRead}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[11px] font-semibold transition cursor-pointer"
                  title="Mark all notifications as read"
                >
                  <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="hidden sm:inline">Mark all read</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                title="Close panel"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Panel Notifications List */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3 divide-y-0 max-h-[calc(82vh-120px)] bg-slate-50/60">
            {isLoading && notifications.length === 0 ? (
              <div className="py-12 text-center text-slate-400">
                <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-xs font-semibold">Loading plant notifications...</p>
              </div>
            ) : notifications.length === 0 ? (
              <div className="py-14 px-6 text-center">
                <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center text-2xl mx-auto mb-3 text-slate-400">
                  📋
                </div>
                <h4 className="text-sm font-bold text-slate-800 mb-1">
                  No Plan Notifications Yet
                </h4>
                <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
                  Whenever any user adds a Plan Note for a vehicle in a plant, it will automatically appear here in real-time.
                </p>
              </div>
            ) : (
              notifications.map((item) => (
                <div
                  key={item.id}
                  onClick={() => handleItemClick(item)}
                  className={`relative p-3.5 rounded-xl border transition-all duration-150 cursor-pointer group ${
                    !item.isRead
                      ? 'bg-white border-emerald-300 shadow-sm hover:border-emerald-400 hover:shadow-md ring-1 ring-emerald-500/10'
                      : 'bg-white/80 border-slate-200/80 hover:bg-white hover:border-slate-300 hover:shadow-xs'
                  }`}
                >
                  {/* Top Bar: Title Badge & Time */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-extrabold text-slate-900 flex items-center gap-1">
                        📢 <span className="text-emerald-700">New Plant Plan</span>
                      </span>
                      {!item.isRead && (
                        <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-emerald-200 animate-pulse" />
                      )}
                    </div>
                    <span className="text-[10px] font-medium text-slate-400 flex items-center gap-1 shrink-0">
                      <Clock className="w-3 h-3 text-slate-400" />
                      {item.formattedDateTime}
                    </span>
                  </div>

                  {/* Notification Details (Exact User Format) */}
                  <div className="space-y-1.5 text-xs text-slate-700">
                    {/* Plant Name & Vehicle Number */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <div className="flex items-center gap-1 font-semibold text-slate-900">
                        <Factory className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                        <span className="text-slate-500 font-normal">Plant:</span>
                        <span className="text-indigo-900 font-bold">{item.plantName}</span>
                      </div>
                      <div className="flex items-center gap-1 font-semibold text-slate-900">
                        <Truck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span className="text-slate-500 font-normal">Vehicle No.:</span>
                        <span className="font-mono font-bold text-slate-950 bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">
                          {item.vehicleNumber}
                        </span>
                      </div>
                    </div>

                    {/* Plan By */}
                    <div className="flex items-center gap-1.5 text-slate-600">
                      <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="text-slate-500">Plan By:</span>
                      <strong className="text-slate-800 font-semibold">{item.planBy}</strong>
                    </div>

                    {/* Date & Time */}
                    <div className="flex items-center gap-1.5 text-slate-600">
                      <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="text-slate-500">Date & Time:</span>
                      <strong className="font-mono text-slate-800 text-[11px]">
                        {item.formattedDateTime}
                      </strong>
                    </div>

                    {/* Plan Note Box */}
                    <div className="mt-2 pt-2 border-t border-slate-100">
                      <div className="text-[11px] font-semibold text-slate-500 mb-0.5 flex items-center gap-1">
                        <FileText className="w-3 h-3 text-emerald-600" />
                        <span>Plan Note:</span>
                      </div>
                      <div className="p-2 rounded-lg bg-emerald-50/70 border border-emerald-200/80 text-emerald-950 text-xs font-medium leading-relaxed break-words">
                        {item.planNote}
                      </div>
                    </div>
                  </div>

                  {/* Card Bottom Actions */}
                  <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                    <span className="text-indigo-600 font-semibold group-hover:underline flex items-center gap-0.5">
                      <span>View Full Details</span>
                      <ChevronRight className="w-3 h-3" />
                    </span>

                    {!item.isRead ? (
                      <button
                        type="button"
                        onClick={(e) => handleMarkAsRead(item.id, e)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-100 hover:bg-emerald-200 text-emerald-800 font-bold transition cursor-pointer"
                        title="Mark as Read"
                      >
                        <Check className="w-3 h-3" />
                        <span>Mark as read</span>
                      </button>
                    ) : (
                      <span className="text-slate-400 font-medium flex items-center gap-1">
                        <CheckCheck className="w-3 h-3 text-emerald-500" />
                        <span>Read</span>
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Panel Footer */}
          <div className="px-4 py-2.5 bg-white border-t border-slate-200 flex items-center justify-between text-xs text-slate-500 shrink-0">
            <span>
              Showing {notifications.length} {notifications.length === 1 ? 'note' : 'notes'}
            </span>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-slate-700 hover:text-slate-900 font-semibold cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Complete Notification Details Modal */}
      {selectedNotification && (
        <div className="fixed inset-0 z-60 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-6 py-4.5 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-emerald-500 flex items-center justify-center text-slate-950 font-black">
                  📢
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    New Plant Plan Details
                  </h3>
                  <p className="text-xs text-slate-400">
                    Vehicle Dispatch & Operational Plan
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedNotification(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3.5 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <div>
                  <span className="text-xs text-slate-500 block mb-0.5">Plant Name</span>
                  <strong className="text-indigo-900 font-bold text-sm flex items-center gap-1.5">
                    <Factory className="w-4 h-4 text-indigo-500" />
                    {selectedNotification.plantName}
                  </strong>
                </div>

                <div>
                  <span className="text-xs text-slate-500 block mb-0.5">Vehicle Number</span>
                  <strong className="text-slate-900 font-mono font-bold text-sm flex items-center gap-1.5">
                    <Truck className="w-4 h-4 text-emerald-600" />
                    {selectedNotification.vehicleNumber}
                  </strong>
                </div>

                <div>
                  <span className="text-xs text-slate-500 block mb-0.5">Plan By</span>
                  <strong className="text-slate-800 font-semibold text-sm flex items-center gap-1.5">
                    <User className="w-4 h-4 text-slate-400" />
                    {selectedNotification.planBy}
                  </strong>
                </div>

                <div>
                  <span className="text-xs text-slate-500 block mb-0.5">Date & Time</span>
                  <strong className="text-slate-800 font-mono font-semibold text-xs flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-slate-400" />
                    {selectedNotification.formattedDateTime}
                  </strong>
                </div>
              </div>

              <div>
                <span className="text-xs font-bold text-slate-700 block mb-1 flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-emerald-600" />
                  Plan Note
                </span>
                <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 font-medium text-sm leading-relaxed whitespace-pre-wrap">
                  {selectedNotification.planNote}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <span className="text-xs text-slate-400">
                Logged in Sikka Fleet Database
              </span>
              <button
                type="button"
                onClick={() => setSelectedNotification(null)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition cursor-pointer"
              >
                Close Details
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
