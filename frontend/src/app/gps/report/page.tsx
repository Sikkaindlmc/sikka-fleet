'use client';

/**
 * GPS Daily Report Page
 * Displays hours spent in each plant and outside per vehicle per date.
 * This is a lightweight secondary view; the primary report lives at /reports.
 */

import React, { useEffect, useState, useCallback } from 'react';

interface ReportRow {
  vehicleNumber: string;
  date: string;
  dateRaw: string;
  saltPlantStay: string;
  teaPlantStay: string;
  dasnaPlantStay: string;
  outsideTotal: string;
}

export default function GpsDailyReportPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [vehicleFilter, setVehicleFilter] = useState('');
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Default to last 7 days on mount
  useEffect(() => {
    const today = new Date();
    const prior = new Date();
    prior.setDate(today.getDate() - 6);
    const fmt = (d: Date) => d.toISOString().split('T')[0];
    setFrom(fmt(prior));
    setTo(fmt(today));
  }, []);

  const fetchReport = useCallback(async () => {
    if (!from || !to) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ from, to });
      if (vehicleFilter.trim()) params.append('vehicleNumber', vehicleFilter.trim());
      const res = await fetch(`/api/gps/daily-report?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load report');
      setRows(json.rows || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  }, [from, to, vehicleFilter]);

  useEffect(() => {
    if (from && to) fetchReport();
  }, [from, to, fetchReport]);

  return (
    <div style={{ padding: '1.5rem', fontFamily: 'system-ui, sans-serif' }}>
      <h2 style={{ marginBottom: '1rem' }}>GPS Daily Report</h2>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.875rem' }}>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            style={{ padding: '0.4rem', border: '1px solid #ccc', borderRadius: 4 }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.875rem' }}>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            style={{ padding: '0.4rem', border: '1px solid #ccc', borderRadius: 4 }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.875rem' }}>
          Vehicle (optional)
          <input type="text" placeholder="e.g. UP14FT9142" value={vehicleFilter}
            onChange={(e) => setVehicleFilter(e.target.value)}
            style={{ padding: '0.4rem', border: '1px solid #ccc', borderRadius: 4 }} />
        </label>
      </div>

      {error && <div style={{ color: '#dc2626', marginBottom: '0.75rem' }}>{error}</div>}

      {loading ? (
        <div style={{ padding: '2rem', textAlign: 'center' }}>Loading…</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ background: '#f1f5f9' }}>
                {['Vehicle Number', 'Date', 'Salt Plant Stay Hour', 'Tea Plant Stay Hour', 'Dasna Plant Stay Hour', 'Outside Total Hour'].map((h) => (
                  <th key={h} style={{ padding: '0.6rem 0.75rem', textAlign: 'left', borderBottom: '2px solid #e2e8f0', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>No records found</td></tr>
              ) : (
                rows.map((r, i) => (
                  <tr key={`${r.vehicleNumber}-${r.dateRaw}-${i}`} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '0.5rem 0.75rem', fontWeight: 500 }}>{r.vehicleNumber}</td>
                    <td style={{ padding: '0.5rem 0.75rem' }}>{r.date}</td>
                    <td style={{ padding: '0.5rem 0.75rem' }}>{r.saltPlantStay}</td>
                    <td style={{ padding: '0.5rem 0.75rem' }}>{r.teaPlantStay}</td>
                    <td style={{ padding: '0.5rem 0.75rem' }}>{r.dasnaPlantStay}</td>
                    <td style={{ padding: '0.5rem 0.75rem' }}>{r.outsideTotal}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
