// Daily GPS Report Page
// Displays hours spent in each plant and outside per vehicle per date.

import React, { useEffect, useState } from 'react';
import { Table } from '@/components/Table'; // Assuming a generic Table component exists
import { DatePicker } from '@/components/DatePicker'; // Assuming a DatePicker component

interface ReportRow {
  vehicleNumber: string;
  date: string; // display format e.g., 01-Oct-2026
  saltPlantStay: string; // HH:mm
  teaPlantStay: string;
  dasnaPlantStay: string;
  outsideTotal: string;
}

const DailyReportPage: React.FC = () => {
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [vehicleNumber, setVehicleNumber] = useState<string>('');
  const [data, setData] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const fetchReport = async () => {
    if (!from || !to) return;
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ from, to });
      if (vehicleNumber) query.append('vehicleNumber', vehicleNumber);
      const res = await fetch(`/api/gps/daily-report?${query.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load report');
      setData(json.rows || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, [from, to, vehicleNumber]);

  // Default to last 7 days on first render
  useEffect(() => {
    const today = new Date();
    const prior = new Date();
    prior.setDate(today.getDate() - 6);
    const fmt = (d: Date) => d.toISOString().split('T')[0];
    setFrom(fmt(prior));
    setTo(fmt(today));
  }, []);

  const columns = [
    { header: 'Date', accessor: 'date' },
    { header: 'Vehicle', accessor: 'vehicleNumber' },
    { header: 'Salt Plant', accessor: 'saltPlantStay' },
    { header: 'Tea Plant', accessor: 'teaPlantStay' },
    { header: 'Dasna Plant', accessor: 'dasnaPlantStay' },
    { header: 'Outside', accessor: 'outsideTotal' },
  ];

  return (
    <div style={{ padding: '1rem' }}>
      <h2>Daily GPS Report</h2>
      <div style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
        <label>
          From:{' '}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To:{' '}
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label>
          Vehicle (optional):{' '}
          <input type="text" placeholder="Vehicle number" value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} />
        </label>
      </div>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      {loading ? (
        <div>Loading...</div>
      ) : (
        <Table columns={columns} data={data} />
      )}
    </div>
  );
};

export default DailyReportPage;

