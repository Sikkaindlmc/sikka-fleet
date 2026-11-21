'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import {
  LoaderCircle,
  Maximize2,
  Minimize2,
  Minus,
  Send,
  X,
} from 'lucide-react';
import { ApiError, apiRequest } from '../lib/api';
import { useAuth } from '../lib/authContext';

interface SikkaAiResult {
  tool: string;
  data: Record<string, unknown>;
}

interface SikkaAiReply {
  answer: string;
  results: SikkaAiResult[];
  suggestions?: string[];
  syncNotice?: string | null;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  results?: SikkaAiResult[];
  suggestions?: string[];
  syncNotice?: string | null;
}

const QUICK_QUESTIONS = [
  'Vehicles in Salt Plant',
  'Show GPS sync status',
  'How many vehicles are moving or stopped?',
  'Sync GPS now',
];

function formatIstTimestamp(value: unknown): string {
  if (typeof value !== 'string' && !(value instanceof Date)) return 'record not available';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'record not available';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

function renderAnswerText(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : part
  );
}

export default function SikkaAiPanel() {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState('');
  const quickQuestions = user?.role === 'Driver'
    ? ['Show my location and plant status.']
    : QUICK_QUESTIONS;
  const assistantRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node &&
          !assistantRef.current?.contains(event.target) &&
          !popupRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  const sendQuestion = async (text: string) => {
    const submittedQuestion = text.trim();
    if (!submittedQuestion || isSending) return;

    setQuestion('');
    setError('');
    setMessages((current) => [...current, { role: 'user', text: submittedQuestion }]);
    setIsSending(true);
    try {
      const reply = await apiRequest<SikkaAiReply>('sikka-ai/query', {
        method: 'POST',
        body: JSON.stringify({ question: submittedQuestion }),
        timeoutMs: 120000,
      });
      setMessages((current) => [...current, {
        role: 'assistant',
        text: reply.answer,
        results: reply.results,
        suggestions: reply.suggestions,
        syncNotice: reply.syncNotice,
      }]);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.status === 404
            ? 'The Sikka AI endpoint is not available on this server yet. Restart the local backend or deploy the updated backend.'
            : requestError.data?.error || requestError.message
          : requestError instanceof Error
            ? requestError.message
            : 'Sikka AI could not complete the request.'
      );
    } finally {
      setIsSending(false);
    }
  };

  const submitQuestion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendQuestion(question);
  };

  return (
    <div ref={assistantRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setIsOpen((open) => !open);
          setIsMinimized(false);
        }}
        aria-label={isOpen ? 'Close SIKKA AI assistant' : 'Open SIKKA AI assistant'}
        aria-expanded={isOpen}
        aria-controls="sikka-ai-chat"
        className="inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-indigo-200 bg-indigo-50 shadow-sm transition hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-300"
      >
        <Image src="/sikka-ai-icon.png" alt="" width={32} height={32} className="h-8 w-8 object-contain" />
      </button>

      {isOpen && typeof document !== 'undefined' && createPortal(
        <section
          ref={popupRef}
          id="sikka-ai-chat"
          role="dialog"
          aria-label="SIKKA AI assistant"
          className={`fixed z-[100] flex flex-col overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-2xl ${
            isMaximized
              ? 'inset-2 h-[calc(100dvh-1rem)] w-auto sm:inset-6 sm:h-[calc(100dvh-3rem)] sm:max-w-4xl sm:mx-auto'
              : isMinimized
                ? 'right-3 top-[4.75rem] h-auto w-[min(440px,calc(100vw-1.5rem))] sm:right-6'
                : 'bottom-3 right-3 top-[4.75rem] w-[min(440px,calc(100vw-1.5rem))] sm:bottom-6 sm:right-6'
          }`}
        >
          <div className="flex shrink-0 items-center gap-3 border-b border-indigo-100 bg-gradient-to-r from-indigo-50 to-white px-4 py-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-indigo-50">
              <Image src="/sikka-ai-icon.png" alt="" width={40} height={40} className="h-10 w-10 object-contain" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-extrabold text-slate-900">SIKKA AI</h2>
              <p className="truncate text-[11px] text-slate-500">Internal fleet intelligence</p>
            </div>
            <button
              type="button"
              onClick={() => setIsMinimized((minimized) => !minimized)}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              aria-label={isMinimized ? 'Restore SIKKA AI' : 'Minimize SIKKA AI'}
            >
              <Minus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                setIsMaximized((maximized) => !maximized);
                setIsMinimized(false);
              }}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              aria-label={isMaximized ? 'Restore SIKKA AI size' : 'Maximize SIKKA AI'}
            >
              {isMaximized
                ? <Minimize2 className="h-4 w-4" />
                : <Maximize2 className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded-lg p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-700"
              aria-label="Close SIKKA AI"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {!isMinimized && (
            <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1" aria-live="polite">
                {messages.map((message, index) => (
                  <div
                    key={`${message.role}-${index}`}
                    className={`rounded-xl px-3 py-2.5 text-sm ${
                      message.role === 'user'
                        ? 'ml-8 bg-slate-100 text-slate-800'
                        : 'mr-4 border border-indigo-100 bg-indigo-50/60 text-slate-800'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{renderAnswerText(message.text)}</p>
                    {message.syncNotice && (
                      <p className="mt-2 text-xs font-medium text-amber-800">{message.syncNotice}</p>
                    )}
                    {message.results?.map((result, resultIndex) => {
                      const locationRecord = result.data.location &&
                        typeof result.data.location === 'object' &&
                        'vehicleNumber' in result.data.location
                        ? result.data.location as Record<string, unknown>
                        : 'vehicleNumber' in result.data
                          ? result.data
                          : null;
                      const records = Array.isArray(result.data.vehicles)
                        ? result.data.vehicles as Array<Record<string, unknown>>
                        : locationRecord
                          ? [locationRecord]
                          : 'vehicleNumber' in result.data
                            ? [result.data]
                            : [];
                      const isLocationResult = result.tool === 'get_vehicle_location';
                      const isVehicleResult = isLocationResult || result.tool === 'get_vehicle_details';
                      const syncResults = result.tool === 'sync_gps_now'
                        ? result.data
                        : result.data.syncResults;
                      const providerEntries = syncResults && typeof syncResults === 'object'
                        ? Object.entries(syncResults as Record<string, Record<string, unknown>>)
                            .filter(([key]) => /wheels|fleetx/i.test(key))
                        : [];
                      return (
                        <div key={`${result.tool}-${resultIndex}`}>
                          {!isVehicleResult && records.slice(0, 30).map((record, recordIndex) => (
                            <div
                              key={`${String(record.vehicleNumber || recordIndex)}`}
                              className="mt-2 rounded-lg border border-indigo-100 bg-white px-3 py-2 text-xs text-slate-700"
                            >
                              <p className="font-bold text-slate-900">{String(record.vehicleNumber || 'Vehicle')}</p>
                              <p>{String(record.plantName || record.plantStatus || 'Plant/location record not available')}</p>
                              <p>Source: {String(record.dataSource || record.provider || 'record not available')}</p>
                              <p>Last GPS update: {formatIstTimestamp(record.gpsTimestamp)}</p>
                            </div>
                          ))}
                          {Boolean((isLocationResult && locationRecord?.gpsTimestamp) || providerEntries.length > 0) && (
                            <details className="mt-2 text-xs">
                              <summary className="cursor-pointer font-semibold text-indigo-800">More details</summary>
                              {isLocationResult && Boolean(locationRecord?.gpsTimestamp) && locationRecord && (
                                <div className="mt-2 space-y-1 rounded-lg bg-white p-2 text-slate-700">
                                  <p>Source: {String(locationRecord.dataSource || locationRecord.provider || 'record not available')}</p>
                                  <p>Speed: {String(locationRecord.speed ?? 'record not available')}</p>
                                  <p>Ignition: {String(locationRecord.ignition ?? 'record not available')}</p>
                                  <p>Coordinates: {String(locationRecord.latitude ?? 'record not available')}, {String(locationRecord.longitude ?? 'record not available')}</p>
                                  <p>Plant stay: {String(locationRecord.stayHours ?? 'record not available')}</p>
                                  <p>Outside hours: {String(locationRecord.outsideHours ?? 'record not available')}</p>
                                </div>
                              )}
                              {providerEntries.length > 0 && (
                                <div className="mt-2 space-y-2">
                                  {providerEntries.map(([provider, details]) => (
                                    <div key={provider} className="rounded-lg bg-white p-2 text-slate-700">
                                      <p className="font-semibold">{/wheel/i.test(provider) ? 'WheelsEye' : 'FleetX'}: {String(details.status || 'FAILED')}</p>
                                      <p>{String(details.receivedCount || 0)} received, {String(details.matchedCount || 0)} matched, {String(details.savedCount || 0)} saved, {String(details.failedCount || 0)} failed</p>
                                      {typeof details.errorCode === 'string' && <p>Error: {details.errorCode}</p>}
                                      {typeof details.failureReasons === 'object' && details.failureReasons !== null && (
                                        <p>Failure reasons: {Object.entries(details.failureReasons as Record<string, number>).map(([code, count]) => `${code} (${count})`).join(', ') || 'none'}</p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </details>
                          )}
                        </div>
                      );
                    })}
                    {message.suggestions && message.suggestions.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {message.suggestions.map((suggestion) => (
                          <button
                            key={suggestion}
                            type="button"
                            onClick={() => void sendQuestion(suggestion)}
                            disabled={isSending}
                            className="rounded-full border border-indigo-200 bg-white px-3 py-1.5 text-[11px] font-medium text-indigo-800 transition hover:bg-indigo-50 disabled:opacity-50"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {isSending && (
                  <div className="mr-4 flex items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50/60 px-3 py-2.5 text-xs text-slate-600">
                    <LoaderCircle className="h-4 w-4 animate-spin text-indigo-600" />
                    Checking Sikka Fleet records…
                  </div>
                )}
                {messages.length === 0 && (
                  <div className="flex flex-wrap gap-2">
                    {quickQuestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => void sendQuestion(suggestion)}
                        disabled={isSending}
                        className="rounded-full border border-slate-200 px-3 py-1.5 text-[11px] font-medium text-slate-600 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-800"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {error && (
                <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
                  {error}
                </p>
              )}

              <form onSubmit={submitQuestion} className="flex shrink-0 items-end gap-2">
                <label htmlFor="sikka-ai-question" className="sr-only">Ask SIKKA AI</label>
                <textarea
                  id="sikka-ai-question"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  maxLength={1000}
                  rows={2}
                  placeholder="Ask about vehicles, GPS, plants, or reports..."
                  className="min-h-11 flex-1 resize-y rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                />
                <button
                  type="submit"
                  disabled={!question.trim() || isSending}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Send question"
                >
                  {isSending
                    ? <LoaderCircle className="h-4 w-4 animate-spin" />
                    : <Send className="h-4 w-4" />}
                </button>
              </form>
              <p className="shrink-0 text-[10px] text-slate-400">
                Uses Sikka Fleet records only. No future-location predictions.
              </p>
            </div>
          )}
        </section>,
        document.body
      )}
    </div>
  );
}
