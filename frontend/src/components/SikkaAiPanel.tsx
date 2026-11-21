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

interface SikkaAiReply {
  answer: string;
  syncNotice?: string | null;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  syncNotice?: string | null;
}

const QUICK_QUESTIONS = [
  'Sync GPS now',
  'Where is a vehicle now?',
];

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
  const [iconLoadFailed, setIconLoadFailed] = useState(false);
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
        {iconLoadFailed ? (
          <span aria-hidden="true" className="text-xs font-black text-indigo-700">AI</span>
        ) : (
          <Image
            src="/sikka-ai-icon.png"
            alt=""
            width={32}
            height={32}
            unoptimized
            onError={() => setIconLoadFailed(true)}
            className="h-8 w-8 object-contain"
          />
        )}
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
              {iconLoadFailed ? (
                <span aria-hidden="true" className="text-xs font-black text-indigo-700">AI</span>
              ) : (
                <Image
                  src="/sikka-ai-icon.png"
                  alt=""
                  width={40}
                  height={40}
                  unoptimized
                  onError={() => setIconLoadFailed(true)}
                  className="h-10 w-10 object-contain"
                />
              )}
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
                  placeholder="Ask to sync GPS or show a registered vehicle's current location..."
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
                SIKKA AI can only sync GPS and show current vehicle locations.
              </p>
            </div>
          )}
        </section>,
        document.body
      )}
    </div>
  );
}
