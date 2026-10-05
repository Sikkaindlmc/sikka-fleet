'use client';

import React, { useState, useEffect } from 'react';
import { Radio, Sparkles, Navigation, ShieldCheck } from 'lucide-react';

interface LoginAnimationProps {
  onComplete: () => void;
  isComplete: boolean;
}

export default function LoginAnimation({ onComplete, isComplete }: LoginAnimationProps) {
  // Phase 0: 0-1s (Logo entrance)
  // Phase 1: 1-2s (Brand typography & telematics rings)
  // Phase 2: 2-3s (Smooth morph & transition to form)
  // Phase 3: >3s (Completed)
  const [phase, setPhase] = useState<number>(0);

  useEffect(() => {
    if (isComplete) {
      setPhase(3);
      return;
    }

    const t1 = setTimeout(() => setPhase(1), 1000);
    const t2 = setTimeout(() => setPhase(2), 2000);
    const t3 = setTimeout(() => {
      setPhase(3);
      onComplete();
    }, 3000);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [isComplete, onComplete]);

  if (isComplete || phase >= 3) {
    return null;
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950 text-white select-none transition-opacity duration-700 ${
        phase === 2 ? 'opacity-90' : 'opacity-100'
      }`}
    >
      {/* Background ambient radar glow */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none overflow-hidden">
        {/* Radar concentric rings */}
        <div
          className={`absolute w-72 h-72 rounded-full border border-emerald-500/20 transition-all duration-1000 ${
            phase >= 1 ? 'scale-150 opacity-40' : 'scale-50 opacity-10'
          }`}
        />
        <div
          className={`absolute w-96 h-96 rounded-full border border-teal-500/15 transition-all duration-1000 delay-150 ${
            phase >= 1 ? 'scale-125 opacity-30' : 'scale-75 opacity-5'
          }`}
        />
        <div className="absolute w-[500px] h-[500px] rounded-full bg-emerald-500/5 blur-3xl" />
      </div>

      {/* Main Animated Stage */}
      <div className="relative z-10 flex flex-col items-center text-center px-4 max-w-md w-full">
        {/* Sikka Fleet Emblem (Phase 0: 0-1s) */}
        <div
          className={`relative transition-all duration-700 ease-out transform ${
            phase === 0
              ? 'scale-75 opacity-0 translate-y-4'
              : phase === 1
              ? 'scale-105 opacity-100 translate-y-0'
              : 'scale-95 opacity-90 -translate-y-6'
          }`}
        >
          {/* Glowing Aura */}
          <div className="absolute -inset-2 bg-gradient-to-tr from-emerald-500 to-teal-400 rounded-3xl blur-xl opacity-60 animate-pulse" />

          {/* Logo Card */}
          <div className="relative w-24 h-24 rounded-3xl bg-white p-3.5 shadow-2xl flex items-center justify-center border-2 border-emerald-400/50">
            <img
              src="/logo.png"
              alt="Sikka Fleet"
              className="w-full h-full object-contain drop-shadow-md"
            />
          </div>
        </div>

        {/* Brand Typography (Phase 1: 1-2s) */}
        <div
          className={`mt-6 transition-all duration-700 ease-out transform ${
            phase >= 1
              ? 'opacity-100 translate-y-0 scale-100'
              : 'opacity-0 translate-y-4 scale-95'
          }`}
        >
          <div className="flex items-center justify-center gap-2 mb-2">
            <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
            <span className="text-[11px] font-extrabold tracking-widest text-emerald-400 uppercase">
              SIKKA LMC • FLEET TELEMATICS
            </span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight leading-tight">
            Sikka Fleet
          </h1>
          <p className="text-xs text-slate-400 mt-1.5 font-medium tracking-wide">
            Enterprise GPS & Automated Geofence System
          </p>
        </div>

        {/* Phase 2 (2-3s): Smooth Transition Indicator */}
        <div
          className={`mt-8 w-48 transition-all duration-500 ${
            phase >= 2 ? 'opacity-100 scale-100' : 'opacity-0 scale-90'
          }`}
        >
          {/* Sleek loading bar filling across 1 second */}
          <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-emerald-400 to-teal-300 rounded-full animate-[progress_1s_ease-in-out_forwards]" />
          </div>
          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mt-2">
            Initializing Session...
          </span>
        </div>
      </div>

      {/* Skip button for power users */}
      <button
        type="button"
        onClick={() => {
          setPhase(3);
          onComplete();
        }}
        className="absolute bottom-6 right-6 px-3.5 py-1.5 rounded-full bg-slate-900/80 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 text-xs font-semibold transition cursor-pointer backdrop-blur-xs"
      >
        Skip Intro &rarr;
      </button>
    </div>
  );
}
