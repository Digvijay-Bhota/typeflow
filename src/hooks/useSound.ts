/**
 * useSound — Web Audio API-based key sound system
 *
 * Generates sounds programmatically using the Web Audio API.
 * NO external audio files required for the base product.
 *
 * Sound types:
 * - keypress: soft click on each correct key
 * - error: brief low tone on incorrect key
 * - complete: success chime on test completion
 */
"use client";

import { useCallback, useRef } from "react";

export type SoundType = "keypress" | "error" | "complete";

interface UseSoundOptions {
  enabled: boolean;
  volume: number; // 0–1
}

export function useSound({ enabled, volume }: UseSoundOptions) {
  const audioCtxRef = useRef<AudioContext | null>(null);

  const getAudioCtx = useCallback((): AudioContext | null => {
    if (typeof window === "undefined") return null;

    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      try {
        audioCtxRef.current = new AudioContext();
      } catch {
        return null;
      }
    }

    // Resume if suspended (browser autoplay policy)
    if (audioCtxRef.current.state === "suspended") {
      void audioCtxRef.current.resume();
    }

    return audioCtxRef.current;
  }, []);

  const playKeypress = useCallback(() => {
    if (!enabled) return;
    const ctx = getAudioCtx();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = "sine";
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.02);

    gain.gain.setValueAtTime(volume * 0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.04);
  }, [enabled, volume, getAudioCtx]);

  const playError = useCallback(() => {
    if (!enabled) return;
    const ctx = getAudioCtx();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(180, ctx.currentTime);

    gain.gain.setValueAtTime(volume * 0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.08);
  }, [enabled, volume, getAudioCtx]);

  const playComplete = useCallback(() => {
    if (!enabled) return;
    const ctx = getAudioCtx();
    if (!ctx) return;

    // Play a 3-note ascending chime: C5 → E5 → G5
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      const start = ctx.currentTime + i * 0.12;
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(volume * 0.2, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);

      osc.start(start);
      osc.stop(start + 0.3);
    });
  }, [enabled, volume, getAudioCtx]);

  const play = useCallback(
    (type: SoundType) => {
      switch (type) {
        case "keypress":
          playKeypress();
          break;
        case "error":
          playError();
          break;
        case "complete":
          playComplete();
          break;
      }
    },
    [playKeypress, playError, playComplete]
  );

  return { play };
}
