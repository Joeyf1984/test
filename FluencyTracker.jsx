import { useState, useRef, useEffect, useCallback } from "react";

const PASSAGE_TITLE = "Skillet and Sonic the Hedgehog 🎸⚡";
const PASSAGE_TEXT  = "Skillet is a rock band known for a song that can bring energy to any movie. In Sonic the Hedgehog, their music helps the king of speed swing into action. The song is long and exciting, making you want to sing along. One special thing about Skillet's music is that it can bring people together. When you hear their song, you may want to swing your arms and sing along, just like Sonic!";
const DAYS = ["Mon","Tue","Wed","Thu","Fri"];

const fmt = (ms) => {
  if (!ms) return "—";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
};

const getStars = (ms) => {
  if (!ms) return 0;
  const s = ms / 1000;
  return s <= 20 ? 3 : s <= 35 ? 2 : 1;
};

const memStore = {};
async function storageGet(key) {
  try { if (window.storage) { const r = await window.storage.get(key); return r ? JSON.parse(r.value) : null; } } catch {}
  return memStore[key] ?? null;
}
async function storageSet(key, value) {
  const json = JSON.stringify(value);
  try { if (window.storage) { await window.storage.set(key, json); return; } } catch {}
  memStore[key] = value;
}

function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onloadend = () => res(reader.result);
    reader.onerror  = rej;
    reader.readAsDataURL(blob);
  });
}

export default function FluencyTracker() {
  const [screen,     setScreen]     = useState("name");
  const [nameInput,  setNameInput]  = useState("");
  const [name,       setName]       = useState("");
  const [day,        setDay]        = useState(0);
  const [phase,      setPhase]      = useState("idle");
  const [tick,       setTick]       = useState(3);
  const [elapsed,    setElapsed]    = useState(0);
  const [scores,     setScores]     = useState({});
  const [audioURLs,  setAudioURLs]  = useState({});
  const [playing,    setPlaying]    = useState(null);
  const [saved,      setSaved]      = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [micStatus,  setMicStatus]  = useState("idle");
  const [saving,     setSaving]     = useState(false);
  const [showProgress, setShowProgress] = useState(false);

  const intervalRef  = useRef(null);
  const startRef     = useRef(null);
  const tickRef      = useRef(null);
  const recorderRef  = useRef(null);
  const chunksRef    = useRef([]);
  const streamRef    = useRef(null);
  const audioElRef   = useRef(null);
  const lastBlobRef  = useRef(null);

  const loadAll = useCallback(async (n) => {
    setLoading(true);
    const sc = await storageGet(`fluency:scores:${n}`) || {};
    setScores(sc);
    const urls = {};
    for (let i = 0; i < 5; i++) {
      const b64 = await storageGet(`fluency:audio:${n}:day${i}`);
      if (b64) urls[i] = b64;
    }
    setAudioURLs(urls);
    setLoading(false);
  }, []);

  const persistScore = useCallback(async (n, sc) => {
    await storageSet(`fluency:scores:${n}`, sc);
  }, []);

  const persistAudio = useCallback(async (n, dayIdx, blob) => {
    try {
      const b64 = await blobToBase64(blob);
      if (b64.length < 4_000_000) {
        await storageSet(`fluency:audio:${n}:day${dayIdx}`, b64);
        setAudioURLs(prev => ({ ...prev, [dayIdx]: b64 }));
      }
    } catch (e) { console.warn("Audio save failed:", e); }
  }, []);

  useEffect(() => {
    if (phase !== "countdown") return;
    if (tick > 0) {
      tickRef.current = setTimeout(() => setTick(t => t - 1), 1000);
      return () => clearTimeout(tickRef.current);
    }
    beginRecording();
  }, [phase, tick]);

  useEffect(() => () => {
    clearInterval(intervalRef.current);
    clearTimeout(tickRef.current);
    stopStream();
  }, []);

  const stopStream = () => {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
  };

  const requestMic = async () => {
    if (!navigator.mediaDevices?.getUserMedia) { setMicStatus("unavailable"); return null; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;
      setMicStatus("granted");
      return stream;
    } catch (err) {
      setMicStatus(err.name === "NotAllowedError" ? "denied" : "unavailable");
      return null;
    }
  };

  const handleStart = async () => {
    clearInterval(intervalRef.current);
    clearTimeout(tickRef.current);
    stopStream();
    setElapsed(0); setTick(3); setSaved(false);
    lastBlobRef.current = null;
    await requestMic();
    setPhase("countdown");
  };

  const beginRecording = () => {
    startRef.current = Date.now();
    intervalRef.current = setInterval(() => setElapsed(Date.now() - startRef.current), 100);
    if (streamRef.current) {
      try {
        chunksRef.current = [];
        const mimeType = ["audio/webm;codecs=opus","audio/webm","audio/ogg","audio/mp4"].find(t => MediaRecorder.isTypeSupported(t)) || "";
        const mr = new MediaRecorder(streamRef.current, mimeType ? { mimeType } : {});
        mr.ondataavailable = e => { if (e.data?.size > 0) chunksRef.current.push(e.data); };
        mr.onstop = () => { lastBlobRef.current = new Blob(chunksRef.current, { type: mimeType || "audio/webm" }); stopStream(); };
        mr.start(250);
        recorderRef.current = mr;
      } catch(e) { console.warn("MediaRecorder error:", e); }
    }
    setPhase("recording");
  };

  const handleStop = async () => {
    clearInterval(intervalRef.current);
    const finalMs = Date.now() - startRef.current;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    else stopStream();
    setElapsed(finalMs);
    const newScores = { ...scores, [`day${day}`]: finalMs };
    setScores(newScores);
    setPhase("done");
    setSaving(true);
    await persistScore(name, newScores);
    setTimeout(async () => {
      if (lastBlobRef.current) await persistAudio(name, day, lastBlobRef.current);
      setSaving(false); setSaved(true);
    }, 600);
  };

  const handleReset = () => { clearInterval(intervalRef.current); clearTimeout(tickRef.current); stopStream(); setPhase("idle"); setElapsed(0); setTick(3); setSaved(false); };
  const handleGoToDay = (i) => { clearInterval(intervalRef.current); clearTimeout(tickRef.current); stopStream(); setDay(i); setPhase("idle"); setElapsed(0); setTick(3); setSaved(false); };
  const handleNameSubmit = async () => { const n = nameInput.trim(); if (!n) return; setName(n); await loadAll(n); setScreen("main"); };

  const handlePlay = (dayIdx) => {
    const url = audioURLs[dayIdx];
    if (!url) return;
    if (audioElRef.current) { audioElRef.current.pause(); audioElRef.current = null; }
    if (playing === dayIdx) { setPlaying(null); return; }
    const a = new Audio(url);
    a.onended = () => setPlaying(null);
    a.onerror = () => setPlaying(null);
    a.play().then(() => setPlaying(dayIdx)).catch(() => setPlaying(null));
    audioElRef.current = a;
  };

  const stopPlayback = () => { if (audioElRef.current) { audioElRef.current.pause(); audioElRef.current = null; } setPlaying(null); };

  const dayScore = scores[`day${day}`];
  const allTimes = DAYS.map((_, i) => scores[`day${i}`]).filter(Boolean);
  const best = allTimes.length ? Math.min(...allTimes) : null;
  const todayAudio = audioURLs[day];

  if (screen === "name") return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(160deg, #0d0d1a 0%, #111827 40%, #0a1628 100%)",
      fontFamily: "'Georgia', 'Times New Roman', serif",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      position: "relative", overflow: "hidden"
    }}>
      <div style={{
        position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none"
      }}>
        {[...Array(6)].map((_, i) => (
          <div key={i} style={{
            position: "absolute",
            borderRadius: "50%",
            border: `1px solid rgba(139, 92, 246, ${0.03 + i * 0.02})`,
            width: `${200 + i * 120}px`, height: `${200 + i * 120}px`,
            top: "50%", left: "50%",
            transform: "translate(-50%, -50%)",
            animation: `pulse-ring ${4 + i}s ease-in-out infinite alternate`
          }} />
        ))}
      </div>

      <div style={{
        background: "rgba(255,255,255,0.04)",
        backdropFilter: "blur(20px)",
        borderRadius: 24,
        padding: "52px 44px",
        maxWidth: 420, width: "100%",
        border: "1px solid rgba(139, 92, 246, 0.2)",
        textAlign: "center",
        boxShadow: "0 40px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08)",
        color: "#fff",
        position: "relative"
      }}>
        <div style={{
          width: 72, height: 72, borderRadius: "50%",
          background: "linear-gradient(135deg, #7c3aed, #a78bfa)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 32, margin: "0 auto 20px",
          boxShadow: "0 0 40px rgba(124, 58, 237, 0.5)"
        }}>🎙️</div>

        <h1 style={{
          fontSize: 28, fontWeight: 700, margin: "0 0 8px",
          background: "linear-gradient(135deg, #f8fafc, #a78bfa)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent"
        }}>Fluency Tracker</h1>
        <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 14, marginBottom: 36, lineHeight: 1.7, fontFamily: "sans-serif" }}>
          Read aloud every day. Record your voice<br />and beat your best time! 🌟
        </p>

        <input
          autoFocus
          value={nameInput}
          placeholder="What's your name?"
          onChange={e => setNameInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && nameInput.trim() && handleNameSubmit()}
          style={{
            width: "100%", padding: "15px 20px",
            borderRadius: 14,
            border: "2px solid rgba(139, 92, 246, 0.3)",
            background: "rgba(255,255,255,0.06)",
            color: "#fff", fontSize: 16,
            marginBottom: 16,
            boxSizing: "border-box", outline: "none",
            fontFamily: "sans-serif",
            transition: "border-color 0.2s"
          }}
        />
        <button
          disabled={!nameInput.trim()}
          onClick={handleNameSubmit}
          style={{
            width: "100%", padding: "15px 40px",
            borderRadius: 14, border: "none",
            background: nameInput.trim()
              ? "linear-gradient(135deg, #7c3aed, #a855f7)"
              : "rgba(255,255,255,0.08)",
            color: "#fff", fontSize: 16, fontWeight: 700,
            cursor: nameInput.trim() ? "pointer" : "not-allowed",
            fontFamily: "sans-serif",
            boxShadow: nameInput.trim() ? "0 8px 28px rgba(124, 58, 237, 0.45)" : "none",
            transition: "all 0.3s"
          }}
        >
          Let's Go! 🚀
        </button>
      </div>
      <style>{`
        @keyframes pulse-ring { from { transform: translate(-50%, -50%) scale(1); } to { transform: translate(-50%, -50%) scale(1.05); } }
        input::placeholder { color: rgba(255,255,255,0.25); }
        button:focus { outline: none; }
      `}</style>
    </div>
  );

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg, #0d0d1a, #111827)", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16, color: "#fff", fontFamily: "sans-serif" }}>
      <div style={{ fontSize: 40, animation: "spin 1.5s linear infinite" }}>🎙️</div>
      <p style={{ color: "rgba(255,255,255,0.4)" }}>Loading your scores...</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(160deg, #0d0d1a 0%, #111827 50%, #0a1628 100%)",
      fontFamily: "sans-serif",
      padding: "24px 16px 40px",
      color: "#fff",
      position: "relative"
    }}>
      <div style={{ maxWidth: 640, margin: "0 auto", width: "100%" }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 10,
            background: "rgba(139, 92, 246, 0.15)",
            border: "1px solid rgba(139, 92, 246, 0.3)",
            borderRadius: 50, padding: "8px 20px", marginBottom: 16
          }}>
            <span style={{ fontSize: 18 }}>🎙️</span>
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "1px", color: "#a78bfa" }}>FLUENCY TRACKER</span>
          </div>
          <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 14, margin: 0 }}>
            Hey <span style={{ color: "#a78bfa", fontWeight: 700 }}>{name}</span>! Read every day and watch your time improve 🌟
          </p>
        </div>

        {/* Week Bar */}
        <div style={{
          background: "rgba(255,255,255,0.04)",
          borderRadius: 20, padding: "18px 20px", marginBottom: 16,
          border: "1px solid rgba(255,255,255,0.07)"
        }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 14, margin: "0 0 14px" }}>This Week</p>
          <div style={{ display: "flex", gap: 8 }}>
            {DAYS.map((d, i) => {
              const t = scores[`day${i}`];
              const sel = day === i;
              const hasAudio = !!audioURLs[i];
              return (
                <button key={i} onClick={() => { handleGoToDay(i); stopPlayback(); }} style={{
                  flex: 1, borderRadius: 14, padding: "11px 4px",
                  border: `2px solid ${sel ? "rgba(139, 92, 246, 0.7)" : "rgba(255,255,255,0.06)"}`,
                  background: sel ? "rgba(139, 92, 246, 0.2)" : t ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.02)",
                  color: "#fff", cursor: "pointer", transition: "all 0.2s",
                  boxShadow: sel ? "0 0 20px rgba(139, 92, 246, 0.2)" : "none"
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: sel ? "#a78bfa" : "rgba(255,255,255,0.35)", marginBottom: 5 }}>{d}</div>
                  {t ? (
                    <>
                      <div style={{ fontSize: 12, fontWeight: 800 }}>{fmt(t)}</div>
                      <div style={{ fontSize: 10, marginTop: 2 }}>{"⭐".repeat(getStars(t))}{hasAudio ? " 🎧" : ""}</div>
                    </>
                  ) : (
                    <div style={{ fontSize: 18, opacity: 0.15 }}>–</div>
                  )}
                </button>
              );
            })}
          </div>
          {best && (
            <p style={{ margin: "12px 0 0", fontSize: 12, color: "rgba(255,255,255,0.3)", textAlign: "center" }}>
              🏆 Best: <span style={{ color: "#fbbf24", fontWeight: 700 }}>{fmt(best)}</span>
            </p>
          )}
        </div>

        {/* Passage */}
        <div style={{
          background: "rgba(255,255,255,0.04)",
          borderRadius: 20, padding: "20px 22px", marginBottom: 16,
          border: `1px solid ${phase === "recording" ? "rgba(139, 92, 246, 0.45)" : "rgba(255,255,255,0.07)"}`,
          transition: "border 0.3s",
          boxShadow: phase === "recording" ? "0 0 30px rgba(139, 92, 246, 0.1)" : "none"
        }}>
          <h2 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 700, color: "#a78bfa" }}>{PASSAGE_TITLE}</h2>
          <p style={{ fontSize: 16.5, lineHeight: 1.9, color: "rgba(255,255,255,0.85)", margin: 0, fontFamily: "Georgia, serif" }}>{PASSAGE_TEXT}</p>
        </div>

        {/* Mic warnings */}
        {micStatus === "denied" && (
          <div style={{ background: "rgba(251, 191, 36, 0.08)", border: "1px solid rgba(251, 191, 36, 0.3)", borderRadius: 14, padding: "12px 16px", marginBottom: 14, fontSize: 13, color: "rgba(251, 210, 80, 0.9)", lineHeight: 1.5 }}>
            ⚠️ <strong>Microphone blocked.</strong> Click the 🔒 in your address bar, allow microphone, then refresh.
          </div>
        )}
        {micStatus === "unavailable" && (
          <div style={{ background: "rgba(251, 191, 36, 0.08)", border: "1px solid rgba(251, 191, 36, 0.3)", borderRadius: 14, padding: "12px 16px", marginBottom: 14, fontSize: 13, color: "rgba(251, 210, 80, 0.9)", lineHeight: 1.5 }}>
            ⚠️ No microphone detected. Timer will still work — scores will be saved.
          </div>
        )}

        {/* Main Control Card */}
        <div style={{
          background: "rgba(255,255,255,0.04)",
          borderRadius: 20, padding: "28px 24px", marginBottom: 16,
          border: "1px solid rgba(255,255,255,0.07)",
          textAlign: "center"
        }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 20 }}>{DAYS[day]} — Day {day + 1}</p>

          {phase === "idle" && (
            <>
              {dayScore && (
                <>
                  <div style={{ fontSize: 52, fontWeight: 900, color: "#a78bfa", letterSpacing: "-2px", lineHeight: 1 }}>{fmt(dayScore)}</div>
                  <div style={{ fontSize: 24, margin: "8px 0" }}>{"⭐".repeat(getStars(dayScore))}</div>
                  {audioURLs[day] && (
                    <button onClick={() => handlePlay(day)} style={{
                      padding: "10px 22px", borderRadius: 50,
                      border: "1px solid rgba(255,255,255,0.15)",
                      background: "rgba(255,255,255,0.08)",
                      color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
                      margin: "8px auto 16px", display: "block"
                    }}>
                      {playing === day ? "⏸ Pause" : "▶️ Play my recording"}
                    </button>
                  )}
                  <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 13, margin: "0 0 20px" }}>Already recorded! Go again to improve.</p>
                </>
              )}
              {!dayScore && (
                <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 14, marginBottom: 24, lineHeight: 1.7 }}>
                  Press Start — your voice will be recorded.<br />Press Stop when you finish reading!
                </p>
              )}
              <button onClick={handleStart} style={{
                padding: "16px 44px", borderRadius: 14, border: "none",
                background: "linear-gradient(135deg, #7c3aed, #a855f7)",
                color: "#fff", fontSize: 17, fontWeight: 700, cursor: "pointer",
                boxShadow: "0 8px 28px rgba(124, 58, 237, 0.45)",
                transition: "transform 0.15s"
              }}>
                🎙️ {dayScore ? "Record Again" : "Start Recording"}
              </button>
            </>
          )}

          {phase === "countdown" && (
            <>
              <div style={{
                fontSize: 100, fontWeight: 900, lineHeight: 1,
                background: "linear-gradient(135deg, #a78bfa, #7c3aed)",
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                animation: "bounce 0.5s ease"
              }}>
                {tick === 0 ? "GO!" : tick}
              </div>
              <p style={{ color: "rgba(255,255,255,0.45)", marginTop: 12, fontSize: 15 }}>Get ready to read! 📖</p>
            </>
          )}

          {phase === "recording" && (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 14 }}>
                <div style={{
                  width: 10, height: 10, borderRadius: "50%",
                  background: "#a78bfa",
                  animation: "blink 1s ease-in-out infinite"
                }} />
                <span style={{ color: "#a78bfa", fontWeight: 800, fontSize: 12, letterSpacing: 2 }}>
                  {micStatus === "granted" ? "🎙️ RECORDING..." : "READING..."}
                </span>
              </div>
              <div style={{ fontSize: 60, fontWeight: 900, letterSpacing: -2, margin: "0 0 8px", fontVariantNumeric: "tabular-nums" }}>
                {fmt(elapsed)}
              </div>
              <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 13, margin: "0 0 24px" }}>
                Read the passage above — press Stop when done!
              </p>
              <button onClick={handleStop} style={{
                padding: "16px 40px", borderRadius: 14, border: "none",
                background: "linear-gradient(135deg, #dc2626, #ef4444)",
                color: "#fff", fontSize: 17, fontWeight: 700, cursor: "pointer",
                boxShadow: "0 6px 22px rgba(220, 38, 38, 0.4)"
              }}>
                ⏹ Stop &amp; Save
              </button>
            </>
          )}

          {phase === "done" && (
            <>
              <div style={{ fontSize: 44, marginBottom: 8 }}>🎉</div>
              <div style={{ fontSize: 56, fontWeight: 900, letterSpacing: -2, lineHeight: 1 }}>{fmt(elapsed)}</div>
              <div style={{ fontSize: 28, margin: "8px 0" }}>{"⭐".repeat(getStars(elapsed))}</div>
              <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 14, marginBottom: 10, lineHeight: 1.6 }}>
                {getStars(elapsed) === 3 ? "Superstar reading! You're on fire! 🚀" : getStars(elapsed) === 2 ? "Great job! Keep practising! 💪" : "Nice work! You'll get faster every day! 😊"}
              </p>
              {saving && <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 13, marginBottom: 12 }}>💾 Saving...</p>}
              {saved && !saving && <p style={{ color: "#34d399", fontSize: 13, fontWeight: 700, marginBottom: 12 }}>✅ Score {todayAudio ? "& recording" : ""} saved!</p>}
              {todayAudio && (
                <div style={{ marginBottom: 18 }}>
                  <button onClick={() => handlePlay(day)} style={{
                    padding: "10px 22px", borderRadius: 50,
                    border: "1px solid rgba(255,255,255,0.15)",
                    background: "rgba(255,255,255,0.08)",
                    color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer"
                  }}>
                    {playing === day ? "⏸ Pause" : "▶️ Play Back My Reading"}
                  </button>
                </div>
              )}
              <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                <button onClick={handleStart} style={{
                  padding: "14px 32px", borderRadius: 14, border: "none",
                  background: "linear-gradient(135deg, #7c3aed, #a855f7)",
                  color: "#fff", fontSize: 16, fontWeight: 700, cursor: "pointer",
                  boxShadow: "0 6px 20px rgba(124, 58, 237, 0.4)"
                }}>🔄 Try Again</button>
                <button onClick={handleReset} style={{
                  padding: "14px 28px", borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.15)",
                  background: "transparent",
                  color: "rgba(255,255,255,0.6)", fontSize: 15, fontWeight: 700, cursor: "pointer"
                }}>Done</button>
              </div>
            </>
          )}
        </div>

        {/* Recordings */}
        {DAYS.some((_, i) => audioURLs[i]) && (
          <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 20, padding: "18px 20px", marginBottom: 16, border: "1px solid rgba(255,255,255,0.07)" }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 14, margin: "0 0 14px" }}>🎧 All Recordings</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {DAYS.map((d, i) => {
                const url = audioURLs[i];
                const t = scores[`day${i}`];
                if (!url) return null;
                return (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    background: "rgba(255,255,255,0.04)", borderRadius: 12, padding: "11px 14px"
                  }}>
                    <div>
                      <span style={{ fontWeight: 700, marginRight: 8 }}>{d}</span>
                      <span style={{ color: "#a78bfa", fontWeight: 800 }}>{fmt(t)}</span>
                      <span style={{ marginLeft: 6, fontSize: 12 }}>{"⭐".repeat(getStars(t))}</span>
                    </div>
                    <button onClick={() => handlePlay(i)} style={{
                      padding: "7px 16px", borderRadius: 50,
                      border: "1px solid rgba(255,255,255,0.15)",
                      background: playing === i ? "rgba(139, 92, 246, 0.3)" : "rgba(255,255,255,0.08)",
                      color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer"
                    }}>
                      {playing === i ? "⏸ Pause" : "▶️ Play"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Progress */}
        {allTimes.length > 0 && (
          <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 20, padding: "18px 20px", marginBottom: 16, border: "1px solid rgba(255,255,255,0.07)" }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: "1.5px", textTransform: "uppercase", marginBottom: 14, margin: "0 0 16px" }}>📊 Progress</p>
            {DAYS.map((d, i) => {
              const t = scores[`day${i}`];
              if (!t) return null;
              const pct = best ? Math.round((best / t) * 100) : 100;
              return (
                <div key={i} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{d}</span>
                    <span style={{ fontSize: 13, color: "#a78bfa", fontWeight: 800 }}>{fmt(t)} {"⭐".repeat(getStars(t))}</span>
                  </div>
                  <div style={{ height: 7, borderRadius: 4, background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: 4,
                      width: `${pct}%`,
                      background: "linear-gradient(90deg, #7c3aed, #a855f7)",
                      transition: "width 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)"
                    }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Star Guide */}
        <div style={{
          background: "rgba(255,255,255,0.02)", borderRadius: 14, padding: "12px 16px",
          border: "1px solid rgba(255,255,255,0.05)", textAlign: "center", marginBottom: 20
        }}>
          <p style={{ margin: "0 0 6px", fontSize: 11, color: "rgba(255,255,255,0.25)", fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>Star Guide</p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" }}>
            {["⭐⭐⭐ Under 20s", "⭐⭐ Under 35s", "⭐ Any time"].map(s => (
              <span key={s} style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>{s}</span>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.1; } }
        @keyframes bounce { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } }
        button:focus { outline: none; }
        input::placeholder { color: rgba(255,255,255,0.25); }
        button:active { transform: scale(0.97); }
      `}</style>
    </div>
  );
}
