import React, { useState, useEffect } from 'react';

/* --------------------------------------------------------
   Countdown Sound (3-second sport start bleeps)
-------------------------------------------------------- */
const countdownSound = new Audio('/Sounds/sport-start-bleeps.wav');
countdownSound.volume = 1;

/* --------------------------------------------------------
   Component Props
-------------------------------------------------------- */
interface Props {
  timerSeconds?: number;
  repeatCount: number;
  disabled: boolean;

  isActive: boolean;
  isRunning: boolean;
  remainingSeconds?: number;
  remainingRepeats?: number;

  onChange: (secondsPerRound: number | undefined, repeatCount: number) => void;
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;

  /** NEW: tells parent to close the timer panel */
  onClosePanel: () => void;
}

/* --------------------------------------------------------
   RoundTimerControl
-------------------------------------------------------- */
export const RoundTimerControl: React.FC<Props> = ({
  timerSeconds,
  repeatCount,
  disabled,

  isActive,
  isRunning,
  remainingSeconds,
  remainingRepeats,

  onChange,
  onStart,
  onStop,
  onReset,
  onClosePanel
}) => {
  const [minutes, setMinutes] = useState<number>(
    timerSeconds ? Math.floor(timerSeconds / 60) : 0
  );
  const [seconds, setSeconds] = useState<number>(
    timerSeconds ? timerSeconds % 60 : 0
  );
  const [localRepeats, setLocalRepeats] = useState(repeatCount);

  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  /* Sync props → local */
  useEffect(() => {
    setMinutes(timerSeconds ? Math.floor(timerSeconds / 60) : 0);
    setSeconds(timerSeconds ? timerSeconds % 60 : 0);
    setLocalRepeats(repeatCount);
  }, [timerSeconds, repeatCount]);

  /* Send local changes → parent */
  useEffect(() => {
    const total = minutes * 60 + seconds;
    onChange(total > 0 ? total : undefined, localRepeats);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minutes, seconds, localRepeats]);

  /* Volume & mute */
  useEffect(() => {
    countdownSound.volume = muted ? 0 : volume;
  }, [muted, volume]);

  const formatDisplay = (n: number) => (n < 10 ? `0${n}` : n);

  /* 3–2–1 countdown sound + vibration */
  useEffect(() => {
    if (!isActive || !isRunning || remainingSeconds == null) return;

    if (remainingSeconds === 3) {
      try {
        countdownSound.currentTime = 0;
        if (!muted) countdownSound.play().catch(() => {});
      } catch {}

      const canVibrate =
        typeof navigator !== 'undefined' &&
        'vibrate' in navigator &&
        typeof navigator.vibrate === 'function';

      if (canVibrate) navigator.vibrate([150, 100, 150]);
    }
  }, [isActive, isRunning, remainingSeconds, muted]);

  /* --------------------------------------------------------
     Save & Close handler
-------------------------------------------------------- */
  const handleSaveAndClose = () => {
    const total = minutes * 60 + seconds;
    onChange(total > 0 ? total : undefined, localRepeats);
    onClosePanel();
  };

  /* Cancel = clear timer + close */
  const handleCancel = () => {
    onChange(undefined, 1);
    onClosePanel();
  };

  /* --------------------------------------------------------
     Render
-------------------------------------------------------- */
  return (
    <div className="bg-slate-800/70 p-3 rounded-md border border-slate-600 mt-2 space-y-3">
      {/* Live Status */}
      {isActive && (
        <div className="text-center text-lg font-bold text-red-400">
          {isRunning ? (
            <>
              {formatDisplay(Math.floor((remainingSeconds ?? 0) / 60))}:
              {formatDisplay((remainingSeconds ?? 0) % 60)}
              {' — Rounds Left: '}
              {remainingRepeats}
            </>
          ) : (
            <span className="text-slate-400">(Paused)</span>
          )}
        </div>
      )}

      {/* Time Inputs */}
      <div className="flex gap-3 justify-center">
        <div className="flex flex-col items-center">
          <label className="text-xs text-slate-400">Minutes</label>
          <input
            type="number"
            className="w-16 text-center bg-slate-900 border border-slate-700 rounded text-white py-1"
            value={minutes}
            onChange={e => setMinutes(Math.max(0, Number(e.target.value)))}
            disabled={disabled}
          />
        </div>

        <div className="flex flex-col items-center">
          <label className="text-xs text-slate-400">Seconds</label>
          <input
            type="number"
            className="w-16 text-center bg-slate-900 border border-slate-700 rounded text-white py-1"
            value={seconds}
            onChange={e => {
              let s = Number(e.target.value);
              if (s < 0) s = 0;
              if (s > 59) s = 59;
              setSeconds(s);
            }}
            disabled={disabled}
          />
        </div>
      </div>

      {/* Presets */}
      <div className="flex justify-center gap-2">
        {[1, 3, 5, 10].map(m => (
          <button
            key={m}
            onClick={() => {
              setMinutes(m);
              setSeconds(0);
            }}
            className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded"
          >
            {m}m
          </button>
        ))}
      </div>

      {/* Rounds Count */}
      <div className="flex items-center justify-center gap-3">
        <span className="text-xs text-slate-400">Rounds:</span>
        <button
          onClick={() => setLocalRepeats(r => Math.max(1, r - 1))}
          className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm"
        >
          –
        </button>
        <span className="text-lg font-bold text-white w-6 text-center">
          {localRepeats}
        </span>
        <button
          onClick={() => setLocalRepeats(r => r + 1)}
          className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm"
        >
          +
        </button>
      </div>

      {/* Volume */}
      <div className="flex items-center justify-center gap-3 pt-2">
        <button
          type="button"
          onClick={() => setMuted(m => !m)}
          className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm"
        >
          {muted ? '🔇' : '🔊'}
        </button>

        <input
          type="range"
          min={0}
          max={100}
          value={volume * 100}
          onChange={e => setVolume(Number(e.target.value) / 100)}
          className="w-32"
        />

        <span className="text-xs text-slate-400">
          {Math.round(volume * 100)}%
        </span>
      </div>

      {/* BUTTON ROW 1: Start + Reset */}
      <div className="flex justify-center gap-3 pt-2">
        {!isRunning ? (
          <button
            onClick={() => {
              countdownSound.play().catch(() => {});
              countdownSound.pause();
              countdownSound.currentTime = 0;
              onStart();
            }}
            className="px-4 py-1 bg-red-600 hover:bg-red-700 text-white rounded font-bold"
          >
            Start
          </button>
        ) : (
          <button
            onClick={onStop}
            className="px-4 py-1 bg-yellow-500 hover:bg-yellow-600 text-slate-900 rounded font-bold"
          >
            Stop
          </button>
        )}

        <button
          onClick={onReset}
          className="px-4 py-1 bg-slate-600 hover:bg-slate-700 text-white rounded font-bold"
        >
          Reset
        </button>
      </div>

      {/* BUTTON ROW 2: Save & Close + Cancel */}
      <div className="flex justify-center gap-3 pt-2">
        <button
          onClick={handleSaveAndClose}
          className="px-4 py-1 bg-green-600 hover:bg-green-700 text-white rounded font-bold"
        >
          Save & Close
        </button>

        <button
          onClick={handleCancel}
          className="px-4 py-1 bg-slate-500 hover:bg-slate-600 text-white rounded font-bold"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};
