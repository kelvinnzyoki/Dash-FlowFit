import { useState, useEffect, useRef, useCallback } from "react";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const PLATFORMS = {
  twitter:   { label: "X / Twitter", icon: "𝕏", limit: 280,  color: "#1a1a1a", tag: "#FitnessApp #FlowFit" },
  linkedin:  { label: "LinkedIn",    icon: "in", limit: 3000, color: "#0077b5", tag: "#FitnessIndustry #SaaS #FlowFit" },
  instagram: { label: "Instagram",   icon: "◈", limit: 2200, color: "#e1306c", tag: "#FlowFit #FitnessMotivation #WorkoutApp" },
};

const TONES   = ["Motivational", "Educational", "Promotional", "Storytelling", "Question / Poll"];
const TOPICS  = [
  "AI workout generation", "Personalized fitness plans", "Progress tracking",
  "Free trial offer", "Gym vs. home workouts", "Workout consistency tips",
  "User success story", "Feature spotlight", "Fitness myth busting",
];
const INTERVALS = [
  { label: "Every 30 min",  ms: 30 * 60 * 1000 },
  { label: "Every 1 hour",  ms: 60 * 60 * 1000 },
  { label: "Every 3 hours", ms: 3  * 60 * 60 * 1000 },
  { label: "Every 6 hours", ms: 6  * 60 * 60 * 1000 },
  { label: "Every 12 hours",ms: 12 * 60 * 60 * 1000 },
  { label: "Every 24 hours",ms: 24 * 60 * 60 * 1000 },
];

const STATUS_COLORS = {
  queued: { bg: "rgba(251,191,36,0.12)",  border: "#f59e0b", dot: "#f59e0b" },
  ready:  { bg: "rgba(52,211,153,0.12)",  border: "#10b981", dot: "#10b981" },
  posted: { bg: "rgba(139,92,246,0.12)",  border: "#8b5cf6", dot: "#8b5cf6" },
  failed: { bg: "rgba(248,113,113,0.12)", border: "#ef4444", dot: "#ef4444" },
};

const STORAGE_KEY = "flowfit-scheduler-posts";

// ─── UTILS ───────────────────────────────────────────────────────────────────
function uid()       { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function fmtTime(iso){ if (!iso) return "—"; const d = new Date(iso); return d.toLocaleString("en-US",{ month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" }); }
function charPct(t, l){ return Math.min(100, Math.round((t.length / l) * 100)); }

// ─── GEMINI API ──────────────────────────────────────────────────────────────
async function generatePost(apiKey, platform, tone, topic, extraContext = "") {
  const platformInfo = PLATFORMS[platform];
  const systemPrompt = `You are a world-class SaaS growth marketer specializing in fitness technology. You write social media posts for FlowFit — an AI-powered fitness SaaS platform that generates personalized workout plans, tracks progress, and adapts to each user's goals. The platform offers a free trial. Write posts that are genuine, punchy, and drive conversions. Avoid clichés. Sound human. Use platform-specific best practices. Return ONLY the post text — no preamble, no quotes, no labels, no markdown backticks.`;
  const userPrompt = `Write a ${tone.toLowerCase()} ${platformInfo.label} post about: "${topic}". Max length: ${platformInfo.limit} characters. End with these hashtags on a new line: ${platformInfo.tag}${extraContext ? `. Extra context: ${extraContext}` : ""}. Return ONLY the post text.`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: 1000, temperature: 0.9 },
      }),
    }
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${response.status}`);
  }
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
export default function App() {
  // API key — from env var (Vercel) OR user input fallback
  const envKey = import.meta.env.VITE_GEMINI_API_KEY || "";
  const [apiKey,   setApiKey]   = useState(envKey);
  const [keyLocked, setKeyLocked] = useState(!!envKey);

  const [posts,       setPosts]       = useState(() => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; } });
  const [activeTab,   setActiveTab]   = useState("generator");
  const [generating,  setGenerating]  = useState(false);
  const [copied,      setCopied]      = useState(null);
  const [genError,    setGenError]    = useState("");
  const [preview,     setPreview]     = useState("");

  // Scheduler
  const [schedulerRunning, setSchedulerRunning] = useState(false);
  const [intervalIdx,      setIntervalIdx]      = useState(1);
  const [nextTick,         setNextTick]         = useState(null);
  const schedulerRef = useRef(null);
  const tickRef      = useRef(null);

  // Generator form
  const [platform,   setPlatform]   = useState("twitter");
  const [tone,       setTone]       = useState(TONES[0]);
  const [topic,      setTopic]      = useState(TOPICS[0]);
  const [extraCtx,   setExtraCtx]   = useState("");
  const [batchCount, setBatchCount] = useState(3);

  // Persist posts
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(posts)); }, [posts]);
  useEffect(() => () => { clearInterval(schedulerRef.current); clearInterval(tickRef.current); }, []);

  // ── GENERATE ────────────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (!apiKey) { setGenError("Enter your Anthropic API key first."); return; }
    setGenerating(true); setGenError(""); setPreview("");
    const newPosts = [];
    try {
      for (let i = 0; i < batchCount; i++) {
        const t = i === 0 ? topic : TOPICS[Math.floor(Math.random() * TOPICS.length)];
        const text = await generatePost(apiKey, platform, tone, t, extraCtx);
        newPosts.push({ id: uid(), platform, tone, topic: t, text, status: "queued", scheduledAt: null, postedAt: null, createdAt: new Date().toISOString() });
      }
      setPosts(prev => [...newPosts, ...prev]);
      setActiveTab("queue");
    } catch (e) { setGenError(e.message); }
    setGenerating(false);
  };

  const handlePreview = async () => {
    if (!apiKey) { setGenError("Enter your Anthropic API key first."); return; }
    setGenerating(true); setGenError("");
    try { setPreview(await generatePost(apiKey, platform, tone, topic, extraCtx)); }
    catch (e) { setGenError(e.message); }
    setGenerating(false);
  };

  // ── COPY & MARK POSTED ──────────────────────────────────────────────────────
  const handleCopy = (id, text) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setPosts(prev => prev.map(p => p.id === id ? { ...p, status: "posted", postedAt: new Date().toISOString() } : p));
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const handleDelete = (id) => setPosts(prev => prev.filter(p => p.id !== id));
  const handleClearPosted = () => setPosts(prev => prev.filter(p => p.status !== "posted"));

  // ── SCHEDULER ────────────────────────────────────────────────────────────────
  const markNextQueued = useCallback(() => {
    setPosts(prev => {
      const queued = prev.filter(p => p.status === "queued");
      if (!queued.length) return prev;
      return prev.map(p => p.id === queued[0].id ? { ...p, status: "ready", scheduledAt: new Date().toISOString() } : p);
    });
  }, []);

  const startScheduler = () => {
    if (schedulerRef.current) return;
    const ms = INTERVALS[intervalIdx].ms;
    const fire = () => { markNextQueued(); setNextTick(new Date(Date.now() + ms).toISOString()); };
    fire();
    schedulerRef.current = setInterval(fire, ms);
    tickRef.current = setInterval(() => setNextTick(t => t), 1000);
    setSchedulerRunning(true);
  };

  const stopScheduler = () => {
    clearInterval(schedulerRef.current); clearInterval(tickRef.current);
    schedulerRef.current = null; tickRef.current = null;
    setSchedulerRunning(false); setNextTick(null);
  };

  function countdown(iso) {
    if (!iso) return "";
    const diff = Math.max(0, new Date(iso) - Date.now());
    return `${Math.floor(diff / 60000)}m ${Math.floor((diff % 60000) / 1000)}s`;
  }

  // ── STATS ────────────────────────────────────────────────────────────────────
  const stats = {
    total:  posts.length,
    queued: posts.filter(p => p.status === "queued").length,
    ready:  posts.filter(p => p.status === "ready").length,
    posted: posts.filter(p => p.status === "posted").length,
    byPlatform: Object.keys(PLATFORMS).map(pl => ({ pl, count: posts.filter(p => p.platform === pl).length })),
  };

  // ─── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div style={S.root}>
      <div style={S.bgMesh} />

      {/* HEADER */}
      <header style={S.header}>
        <div style={S.logo}>
          <span style={S.logoIcon}>⚡</span>
          <span style={S.logoText}>FlowFit</span>
          <span style={S.logoSub}>Social Command</span>
        </div>
        <nav style={S.nav}>
          {["generator","queue","analytics"].map(tab => (
            <button key={tab} style={{ ...S.navBtn, ...(activeTab === tab ? S.navBtnActive : {}) }}
              onClick={() => setActiveTab(tab)}>
              {tab === "generator" ? "✦ Generate" : tab === "queue" ? `Queue (${posts.length})` : "Analytics"}
            </button>
          ))}
        </nav>
      </header>

      <main style={S.main}>

        {/* ── API KEY BANNER (only when no env var) ── */}
        {!keyLocked && (
          <div style={S.keyBanner}>
            <span style={S.keyLabel}>🔑 Gemini API Key</span>
            <input type="password" placeholder="AIza..." value={apiKey}
              onChange={e => setApiKey(e.target.value)} style={S.keyInput} />
            <button style={S.keyBtn} onClick={() => { if (apiKey.startsWith("AIza")) setKeyLocked(true); }}>
              Save
            </button>
            <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" style={S.keyLink}>
              Get key →
            </a>
          </div>
        )}
        {keyLocked && !envKey && (
          <div style={S.keyActive}>
            <span>🔑 API key set</span>
            <button style={S.keyReset} onClick={() => setKeyLocked(false)}>Change</button>
          </div>
        )}

        {/* ── GENERATOR TAB ── */}
        {activeTab === "generator" && (
          <div style={S.panel}>
            <h2 style={S.sectionTitle}>AI Post Generator</h2>
            <p style={S.sectionSub}>Generate FlowFit marketing posts for any platform instantly.</p>
            <div style={S.grid2}>
              <div style={S.card}>
                <label style={S.label}>Platform</label>
                <div style={S.pillRow}>
                  {Object.entries(PLATFORMS).map(([key, val]) => (
                    <button key={key} style={{ ...S.pill, ...(platform === key ? S.pillActive : {}) }}
                      onClick={() => setPlatform(key)}>
                      {val.icon} {val.label}
                    </button>
                  ))}
                </div>

                <label style={S.label}>Tone</label>
                <div style={S.pillRow}>
                  {TONES.map(t => (
                    <button key={t} style={{ ...S.pill, ...(tone === t ? S.pillActive : {}) }}
                      onClick={() => setTone(t)}>{t}</button>
                  ))}
                </div>

                <label style={S.label}>Topic</label>
                <select style={S.select} value={topic} onChange={e => setTopic(e.target.value)}>
                  {TOPICS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>

                <label style={S.label}>Extra context (optional)</label>
                <textarea style={S.textarea} rows={2} value={extraCtx}
                  placeholder="e.g. mention our 14-day free trial ends this week…"
                  onChange={e => setExtraCtx(e.target.value)} />

                <label style={S.label}>Batch size: <strong style={{ color:"#f59e0b" }}>{batchCount}</strong> posts</label>
                <input type="range" min={1} max={10} value={batchCount}
                  onChange={e => setBatchCount(Number(e.target.value))} style={{ width:"100%", marginBottom:4 }} />

                {genError && <p style={S.error}>{genError}</p>}

                <div style={S.btnRow}>
                  <button style={S.btnGhost} onClick={handlePreview} disabled={generating}>
                    {generating ? "…" : "Preview 1"}
                  </button>
                  <button style={S.btnPrimary} onClick={handleGenerate} disabled={generating}>
                    {generating
                      ? <span style={{ display:"inline-block", animation:"spin 1s linear infinite" }}>⟳</span>
                      : `Generate ${batchCount} →`}
                  </button>
                </div>
              </div>

              <div style={S.card}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16 }}>
                  <span style={{ fontSize:20 }}>{PLATFORMS[platform].icon}</span>
                  <span style={S.label}>{PLATFORMS[platform].label} Preview</span>
                  <span style={{ marginLeft:"auto", fontSize:11, color:"#9ca3af" }}>
                    {preview.length}/{PLATFORMS[platform].limit}
                  </span>
                </div>
                {preview ? (
                  <>
                    <div style={S.previewBox}>{preview}</div>
                    <div style={S.charBar}>
                      <div style={{ ...S.charFill, width:`${charPct(preview, PLATFORMS[platform].limit)}%`,
                        background: charPct(preview, PLATFORMS[platform].limit) > 90 ? "#ef4444" : "#10b981" }} />
                    </div>
                    <button style={{ ...S.btnGhost, marginTop:12, width:"100%" }}
                      onClick={() => navigator.clipboard.writeText(preview)}>Copy Preview</button>
                  </>
                ) : (
                  <div style={S.emptyPreview}>
                    <span style={{ fontSize:32 }}>✦</span>
                    <p>Click "Preview 1" to see a sample post.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── QUEUE TAB ── */}
        {activeTab === "queue" && (
          <div style={S.panel}>
            <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", flexWrap:"wrap", gap:16, marginBottom:24 }}>
              <div>
                <h2 style={S.sectionTitle}>Post Queue</h2>
                <p style={S.sectionSub}>Auto-mark posts ready at intervals. Copy to post on any platform free.</p>
              </div>
              <div style={S.schedulerBox}>
                <select style={{ ...S.select, minWidth:160, marginBottom:8 }} value={intervalIdx}
                  onChange={e => setIntervalIdx(Number(e.target.value))} disabled={schedulerRunning}>
                  {INTERVALS.map((iv, i) => <option key={i} value={i}>{iv.label}</option>)}
                </select>
                {!schedulerRunning
                  ? <button style={S.btnGreen} onClick={startScheduler} disabled={!stats.queued}>▶ Start Scheduler</button>
                  : <button style={S.btnRed}   onClick={stopScheduler}>■ Stop</button>}
                {schedulerRunning && nextTick && (
                  <p style={S.countdown}>Next in {countdown(nextTick)}</p>
                )}
                {stats.posted > 0 && (
                  <button style={{ ...S.btnGhost, fontSize:11, marginTop:4 }} onClick={handleClearPosted}>
                    Clear {stats.posted} posted
                  </button>
                )}
              </div>
            </div>

            {posts.length === 0 ? (
              <div style={S.emptyState}>
                <span style={{ fontSize:40 }}>⚡</span>
                <p>No posts yet. Go to Generator to create some.</p>
                <button style={S.btnPrimary} onClick={() => setActiveTab("generator")}>Generate Posts →</button>
              </div>
            ) : (
              <div style={S.postList}>
                {posts.map(post => {
                  const pl = PLATFORMS[post.platform];
                  const sc = STATUS_COLORS[post.status] || STATUS_COLORS.queued;
                  return (
                    <div key={post.id} style={{ ...S.postCard, background: sc.bg, borderColor: sc.border }}>
                      <div style={S.postCardTop}>
                        <span style={{ ...S.statusDot, background: sc.dot }} />
                        <span style={S.postPlatform}>{pl.icon} {pl.label}</span>
                        <span style={S.postTone}>{post.tone}</span>
                        <span style={{ ...S.postStatus, color: sc.dot }}>{post.status}</span>
                        <span style={S.postTime}>{fmtTime(post.scheduledAt || post.createdAt)}</span>
                        <button style={S.deleteBtn} onClick={() => handleDelete(post.id)}>✕</button>
                      </div>
                      <p style={S.postText}>{post.text}</p>
                      <div style={S.charBar}>
                        <div style={{ ...S.charFill, width:`${charPct(post.text, pl.limit)}%`,
                          background: charPct(post.text, pl.limit) > 90 ? "#ef4444" : "#10b981" }} />
                      </div>
                      <div style={S.postCardBottom}>
                        <span style={{ fontSize:11, color:"#6b7280" }}>{post.text.length}/{pl.limit} · {post.topic}</span>
                        <button style={{ ...S.btnCopy, ...(copied === post.id ? S.btnCopied : {}) }}
                          onClick={() => handleCopy(post.id, post.text)}>
                          {copied === post.id ? "✓ Copied!" : "Copy & Post"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── ANALYTICS TAB ── */}
        {activeTab === "analytics" && (
          <div style={S.panel}>
            <h2 style={S.sectionTitle}>Analytics</h2>
            <p style={S.sectionSub}>Your FlowFit content pipeline at a glance.</p>
            <div style={S.statsGrid}>
              {[
                { label:"Total Posts", val: stats.total,  color:"#f59e0b" },
                { label:"In Queue",    val: stats.queued, color:"#fbbf24" },
                { label:"Ready",       val: stats.ready,  color:"#10b981" },
                { label:"Posted",      val: stats.posted, color:"#8b5cf6" },
              ].map(s => (
                <div key={s.label} style={{ ...S.statCard, borderColor: s.color }}>
                  <span style={{ ...S.statVal, color: s.color }}>{s.val}</span>
                  <span style={S.statLabel}>{s.label}</span>
                </div>
              ))}
            </div>

            <div style={S.card}>
              <h3 style={{ ...S.label, marginBottom:16 }}>By Platform</h3>
              {stats.byPlatform.map(({ pl, count }) => {
                const pct = stats.total ? Math.round((count / stats.total) * 100) : 0;
                return (
                  <div key={pl} style={{ marginBottom:12 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                      <span style={{ fontSize:13, color:"#d1d5db" }}>{PLATFORMS[pl].icon} {PLATFORMS[pl].label}</span>
                      <span style={{ fontSize:13, color:"#9ca3af" }}>{count} posts · {pct}%</span>
                    </div>
                    <div style={S.charBar}>
                      <div style={{ ...S.charFill, width:`${pct}%`, background: PLATFORMS[pl].color }} />
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ ...S.card, marginTop:16 }}>
              <h3 style={{ ...S.label, marginBottom:12 }}>Free Posting Options</h3>
              {[
                ["𝕏  X/Twitter",  "Paste at x.com — free. 280 chars max."],
                ["in  LinkedIn",  "Paste at linkedin.com/feed — free personal/company page."],
                ["◈  Instagram",  "Paste in Instagram app. Add image for better reach."],
                ["⚡  Buffer",    "buffer.com free tier: 3 channels, 10 queued posts."],
                ["∞  Later.com",  "later.com free: 30 posts/mo per platform, drag-drop calendar."],
              ].map(([title, desc]) => (
                <div key={title} style={S.guideRow}>
                  <span style={S.guideTitle}>{title}</span>
                  <span style={S.guideDesc}>{desc}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────
const S = {
  root: { minHeight:"100vh", background:"#0a0a0f", color:"#e5e7eb", fontFamily:"'DM Mono','Fira Code','Courier New',monospace", position:"relative", overflowX:"hidden" },
  bgMesh: { position:"fixed", inset:0, zIndex:0, background:"radial-gradient(ellipse 80% 60% at 10% 0%,rgba(245,158,11,0.08) 0%,transparent 60%),radial-gradient(ellipse 60% 50% at 90% 100%,rgba(139,92,246,0.07) 0%,transparent 60%)", pointerEvents:"none" },
  header: { position:"sticky", top:0, zIndex:100, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 28px", background:"rgba(10,10,15,0.85)", borderBottom:"1px solid rgba(245,158,11,0.15)", backdropFilter:"blur(12px)" },
  logo: { display:"flex", alignItems:"center", gap:8 },
  logoIcon: { fontSize:22 },
  logoText: { fontSize:18, fontWeight:700, letterSpacing:"-0.5px", color:"#f59e0b" },
  logoSub: { fontSize:11, color:"#6b7280", letterSpacing:"0.08em", textTransform:"uppercase", marginLeft:4 },
  nav: { display:"flex", gap:4 },
  navBtn: { background:"transparent", border:"1px solid rgba(255,255,255,0.07)", color:"#6b7280", padding:"7px 16px", borderRadius:6, cursor:"pointer", fontSize:12, letterSpacing:"0.04em", textTransform:"uppercase" },
  navBtnActive: { background:"rgba(245,158,11,0.12)", borderColor:"#f59e0b", color:"#f59e0b" },
  main: { position:"relative", zIndex:1, maxWidth:1100, margin:"0 auto", padding:"24px 20px 80px" },
  keyBanner: { display:"flex", alignItems:"center", gap:10, background:"rgba(245,158,11,0.08)", border:"1px solid rgba(245,158,11,0.25)", borderRadius:10, padding:"12px 16px", marginBottom:20, flexWrap:"wrap" },
  keyLabel: { fontSize:12, color:"#f59e0b", whiteSpace:"nowrap" },
  keyInput: { flex:1, minWidth:200, background:"rgba(0,0,0,0.4)", border:"1px solid rgba(255,255,255,0.1)", color:"#e5e7eb", padding:"7px 12px", borderRadius:7, fontSize:13, outline:"none", fontFamily:"inherit" },
  keyBtn: { background:"#f59e0b", color:"#0a0a0f", border:"none", padding:"7px 16px", borderRadius:7, fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit" },
  keyLink: { fontSize:12, color:"#6b7280", textDecoration:"none" },
  keyActive: { display:"flex", alignItems:"center", gap:10, fontSize:12, color:"#10b981", marginBottom:16 },
  keyReset: { background:"transparent", border:"1px solid rgba(255,255,255,0.1)", color:"#6b7280", padding:"3px 10px", borderRadius:5, fontSize:11, cursor:"pointer", fontFamily:"inherit" },
  panel: {},
  sectionTitle: { fontSize:22, fontWeight:700, color:"#f9fafb", margin:"0 0 4px", letterSpacing:"-0.5px" },
  sectionSub: { fontSize:13, color:"#6b7280", margin:"0 0 24px" },
  grid2: { display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 },
  card: { background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:12, padding:20 },
  label: { display:"block", fontSize:11, color:"#9ca3af", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:8, marginTop:16 },
  pillRow: { display:"flex", flexWrap:"wrap", gap:6, marginBottom:4 },
  pill: { padding:"5px 12px", borderRadius:20, fontSize:12, background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", color:"#9ca3af", cursor:"pointer" },
  pillActive: { background:"rgba(245,158,11,0.15)", borderColor:"#f59e0b", color:"#f59e0b" },
  select: { width:"100%", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", color:"#e5e7eb", padding:"8px 12px", borderRadius:8, fontSize:13, outline:"none", cursor:"pointer" },
  textarea: { width:"100%", background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.08)", color:"#e5e7eb", padding:"10px 12px", borderRadius:8, fontSize:13, resize:"vertical", outline:"none", fontFamily:"inherit", boxSizing:"border-box" },
  btnRow: { display:"flex", gap:10, marginTop:20 },
  btnPrimary: { flex:1, background:"#f59e0b", color:"#0a0a0f", border:"none", padding:"10px 20px", borderRadius:8, fontSize:13, fontWeight:700, cursor:"pointer" },
  btnGhost: { background:"transparent", border:"1px solid rgba(255,255,255,0.12)", color:"#d1d5db", padding:"10px 16px", borderRadius:8, fontSize:13, cursor:"pointer", fontFamily:"inherit" },
  btnGreen: { background:"#065f46", border:"1px solid #10b981", color:"#10b981", padding:"8px 16px", borderRadius:8, fontSize:12, cursor:"pointer", fontFamily:"inherit" },
  btnRed: { background:"#7f1d1d", border:"1px solid #ef4444", color:"#ef4444", padding:"8px 16px", borderRadius:8, fontSize:12, cursor:"pointer", fontFamily:"inherit" },
  error: { color:"#ef4444", fontSize:12, marginTop:8 },
  previewBox: { background:"rgba(0,0,0,0.3)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:8, padding:14, fontSize:13, lineHeight:1.6, whiteSpace:"pre-wrap", color:"#d1d5db", minHeight:80 },
  emptyPreview: { display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:160, color:"#4b5563", gap:8, textAlign:"center", fontSize:13 },
  charBar: { height:3, background:"rgba(255,255,255,0.06)", borderRadius:2, marginTop:8, overflow:"hidden" },
  charFill: { height:"100%", borderRadius:2, transition:"width 0.3s" },
  schedulerBox: { display:"flex", flexDirection:"column", alignItems:"flex-end", gap:6, minWidth:180 },
  countdown: { fontSize:11, color:"#10b981", margin:0, letterSpacing:"0.04em" },
  emptyState: { display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:280, color:"#4b5563", gap:12, textAlign:"center" },
  postList: { display:"flex", flexDirection:"column", gap:12 },
  postCard: { border:"1px solid", borderRadius:12, padding:"14px 16px" },
  postCardTop: { display:"flex", alignItems:"center", gap:8, marginBottom:10, flexWrap:"wrap" },
  statusDot: { width:7, height:7, borderRadius:"50%", flexShrink:0 },
  postPlatform: { fontSize:12, color:"#d1d5db", fontWeight:600 },
  postTone: { fontSize:11, color:"#6b7280", background:"rgba(255,255,255,0.05)", padding:"2px 8px", borderRadius:10 },
  postStatus: { fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.08em" },
  postTime: { fontSize:11, color:"#6b7280", marginLeft:"auto" },
  deleteBtn: { background:"transparent", border:"none", color:"#4b5563", cursor:"pointer", fontSize:14, padding:"0 2px" },
  postText: { fontSize:13, lineHeight:1.65, color:"#d1d5db", margin:"0 0 8px", whiteSpace:"pre-wrap" },
  postCardBottom: { display:"flex", alignItems:"center", justifyContent:"space-between", marginTop:8 },
  btnCopy: { background:"rgba(245,158,11,0.1)", border:"1px solid rgba(245,158,11,0.3)", color:"#f59e0b", padding:"6px 14px", borderRadius:6, fontSize:12, cursor:"pointer", fontFamily:"inherit" },
  btnCopied: { background:"rgba(16,185,129,0.15)", borderColor:"#10b981", color:"#10b981" },
  statsGrid: { display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:16 },
  statCard: { border:"1px solid", borderRadius:12, padding:"20px 16px", display:"flex", flexDirection:"column", alignItems:"center", gap:6, background:"rgba(255,255,255,0.02)" },
  statVal: { fontSize:36, fontWeight:700, lineHeight:1 },
  statLabel: { fontSize:11, color:"#6b7280", textTransform:"uppercase", letterSpacing:"0.08em" },
  guideRow: { display:"flex", gap:12, padding:"10px 0", borderBottom:"1px solid rgba(255,255,255,0.05)" },
  guideTitle: { fontSize:12, color:"#f59e0b", minWidth:110, flexShrink:0, fontWeight:600 },
  guideDesc: { fontSize:12, color:"#6b7280", lineHeight:1.5 },
};
