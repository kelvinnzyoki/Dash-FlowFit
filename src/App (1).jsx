import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const PLATFORMS = {
  twitter: {
    label: "X / Twitter",
    icon: "𝕏",
    limit: 280,
    tag: "#FitnessApp #FlowFit",
    composeUrl: "https://x.com/intent/tweet?text=",
    accepts: "image/*,video/*",
  },
  linkedin: {
    label: "LinkedIn",
    icon: "in",
    limit: 3000,
    tag: "#FitnessIndustry #SaaS #FlowFit",
    composeUrl: "https://www.linkedin.com/feed/",
    accepts: "image/*,video/*",
  },
  instagram: {
    label: "Instagram",
    icon: "◈",
    limit: 2200,
    tag: "#FlowFit #FitnessMotivation #WorkoutApp",
    composeUrl: "https://www.instagram.com/",
    accepts: "image/*,video/*",
  },
  threads: {
    label: "Threads",
    icon: "@",
    limit: 500,
    tag: "#FlowFit #HomeWorkouts",
    composeUrl: "https://www.threads.net/",
    accepts: "image/*,video/*",
  },
};

const TONES = ["Motivational", "Educational", "Promotional", "Storytelling", "Question / Poll"];
const TOPICS = [
  "AI workout generation",
  "Personalized fitness plans",
  "Progress tracking",
  "Free trial offer",
  "Gym vs. home workouts",
  "Workout consistency tips",
  "User success story",
  "Feature spotlight",
  "Fitness myth busting",
];
const INTERVALS = [
  { label: "Every 30 min", ms: 30 * 60 * 1000 },
  { label: "Every 1 hour", ms: 60 * 60 * 1000 },
  { label: "Every 3 hours", ms: 3 * 60 * 60 * 1000 },
  { label: "Every 6 hours", ms: 6 * 60 * 60 * 1000 },
  { label: "Every 12 hours", ms: 12 * 60 * 60 * 1000 },
  { label: "Every 24 hours", ms: 24 * 60 * 60 * 1000 },
];

const STORAGE_KEY = "flowfit-social-poster-v2";
const CONNECTIONS_KEY = "flowfit-social-connections";
const MAX_MEDIA = 4;

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function fmtDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toLocalDatetimeValue(date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function charPct(text, limit) {
  return Math.min(100, Math.round(((text || "").length / limit) * 100));
}

async function generatePost(apiKey, platform, tone, topic, extraContext = "") {
  const platformInfo = PLATFORMS[platform];
  const userPrompt = `Write a ${tone.toLowerCase()} ${platformInfo.label} post about: "${topic}". Max length: ${platformInfo.limit} characters. End with these hashtags on a new line: ${platformInfo.tag}${extraContext ? `. Extra context: ${extraContext}` : ""}. Return ONLY the post text.`;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content:
            "You are a world-class SaaS growth marketer specializing in fitness technology. You write social media posts for FlowFit — an AI-powered fitness SaaS platform that generates personalized workout plans, tracks progress, and adapts to each user's goals. The platform offers a free trial. Write posts that are genuine, punchy, and drive conversions. Avoid clichés. Sound human. Use platform-specific best practices. Return ONLY the post text — no preamble, no quotes, no labels, no markdown backticks.",
        },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 1000,
      temperature: 0.9,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Groq API error ${response.status}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

function safePostsFromStorage() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeConnectionsFromStorage() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CONNECTIONS_KEY));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export default function App() {
  const envKey = import.meta.env.VITE_GROQ_API_KEY || "";
  const [apiKey, setApiKey] = useState(envKey);
  const [keyLocked, setKeyLocked] = useState(Boolean(envKey));
  const [posts, setPosts] = useState(safePostsFromStorage);
  const [connections, setConnections] = useState(safeConnectionsFromStorage);
  const [activeTab, setActiveTab] = useState("generator");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");
  const [preview, setPreview] = useState("");
  const [platform, setPlatform] = useState("twitter");
  const [tone, setTone] = useState(TONES[0]);
  const [topic, setTopic] = useState(TOPICS[0]);
  const [extraCtx, setExtraCtx] = useState("");
  const [batchCount, setBatchCount] = useState(3);
  const [intervalIdx, setIntervalIdx] = useState(1);
  const [schedulerRunning, setSchedulerRunning] = useState(false);
  const [nextTick, setNextTick] = useState(null);
  const [toast, setToast] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState({ text: "", scheduledAt: "" });
  const schedulerRef = useRef(null);

  useEffect(() => {
    const serializable = posts.map(({ mediaFiles, ...post }) => post);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
  }, [posts]);

  useEffect(() => {
    localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(connections));
  }, [connections]);

  useEffect(() => () => clearInterval(schedulerRef.current), []);

  const stats = useMemo(() => {
    const byStatus = posts.reduce((acc, post) => ({ ...acc, [post.status]: (acc[post.status] || 0) + 1 }), {});
    return {
      total: posts.length,
      queued: byStatus.queued || 0,
      scheduled: byStatus.scheduled || 0,
      ready: byStatus.ready || 0,
      posted: byStatus.posted || 0,
      failed: byStatus.failed || 0,
    };
  }, [posts]);

  function notify(message) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3000);
  }

  function buildPost(text, selectedPlatform = platform, selectedTopic = topic) {
    return {
      id: uid(),
      platform: selectedPlatform,
      tone,
      topic: selectedTopic,
      text,
      status: "queued",
      scheduledAt: null,
      postedAt: null,
      error: "",
      media: [],
      createdAt: new Date().toISOString(),
    };
  }

  async function handleGenerate() {
    if (!apiKey) {
      setGenError("Enter your Groq API key first.");
      return;
    }
    setGenerating(true);
    setGenError("");
    setPreview("");
    const newPosts = [];
    try {
      for (let i = 0; i < batchCount; i += 1) {
        const selectedTopic = i === 0 ? topic : TOPICS[Math.floor(Math.random() * TOPICS.length)];
        const text = await generatePost(apiKey, platform, tone, selectedTopic, extraCtx);
        newPosts.push(buildPost(text, platform, selectedTopic));
      }
      setPosts((prev) => [...newPosts, ...prev]);
      setActiveTab("queue");
      notify(`${newPosts.length} post${newPosts.length > 1 ? "s" : ""} added to queue.`);
    } catch (error) {
      setGenError(error.message);
    } finally {
      setGenerating(false);
    }
  }

  async function handlePreview() {
    if (!apiKey) {
      setGenError("Enter your Groq API key first.");
      return;
    }
    setGenerating(true);
    setGenError("");
    try {
      setPreview(await generatePost(apiKey, platform, tone, topic, extraCtx));
    } catch (error) {
      setGenError(error.message);
    } finally {
      setGenerating(false);
    }
  }

  function addPreviewToQueue() {
    if (!preview.trim()) return;
    setPosts((prev) => [buildPost(preview.trim()), ...prev]);
    setPreview("");
    setActiveTab("queue");
  }

  function handleMediaChange(postId, files) {
    const selected = Array.from(files || []).slice(0, MAX_MEDIA);
    const mediaFiles = selected.map((file) => ({ id: uid(), file, previewUrl: URL.createObjectURL(file) }));
    const media = selected.map((file) => ({ id: uid(), name: file.name, type: file.type, size: file.size }));
    setPosts((prev) => prev.map((post) => (post.id === postId ? { ...post, media, mediaFiles } : post)));
  }

  function removeMedia(postId, mediaId) {
    setPosts((prev) =>
      prev.map((post) =>
        post.id === postId
          ? {
              ...post,
              media: (post.media || []).filter((item) => item.id !== mediaId),
              mediaFiles: (post.mediaFiles || []).filter((item) => item.id !== mediaId),
            }
          : post,
      ),
    );
  }

  function openEditor(post) {
    setEditingId(post.id);
    setEditDraft({
      text: post.text,
      scheduledAt: post.scheduledAt ? toLocalDatetimeValue(post.scheduledAt) : toLocalDatetimeValue(Date.now() + INTERVALS[intervalIdx].ms),
    });
  }

  function saveEditor() {
    setPosts((prev) =>
      prev.map((post) =>
        post.id === editingId
          ? {
              ...post,
              text: editDraft.text.trim(),
              scheduledAt: editDraft.scheduledAt ? new Date(editDraft.scheduledAt).toISOString() : null,
              status: editDraft.scheduledAt ? "scheduled" : post.status,
              error: "",
            }
          : post,
      ),
    );
    setEditingId(null);
    notify("Post updated.");
  }

  function schedulePost(postId, offsetMs = INTERVALS[intervalIdx].ms) {
    setPosts((prev) =>
      prev.map((post) =>
        post.id === postId
          ? { ...post, status: "scheduled", scheduledAt: new Date(Date.now() + offsetMs).toISOString(), error: "" }
          : post,
      ),
    );
  }

  function deletePost(postId) {
    setPosts((prev) => prev.filter((post) => post.id !== postId));
  }

  async function copyPost(post) {
    await navigator.clipboard.writeText(post.text);
    notify("Post copied.");
  }

  function manualOpen(post) {
    const cfg = PLATFORMS[post.platform];
    copyPost(post);
    const url = post.platform === "twitter" ? `${cfg.composeUrl}${encodeURIComponent(post.text)}` : cfg.composeUrl;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function publishPost(post) {
    const connected = connections[post.platform];
    if (!connected) {
      manualOpen(post);
      setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, status: "ready" } : p)));
      return;
    }

    setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, status: "publishing", error: "" } : p)));
    try {
      const form = new FormData();
      form.append("platform", post.platform);
      form.append("text", post.text);
      form.append("postId", post.id);
      (post.mediaFiles || []).forEach((item) => form.append("media", item.file));

      const res = await fetch("/api/social/publish", { method: "POST", body: form });
      if (!res.ok) throw new Error((await res.text()) || `Publish failed with HTTP ${res.status}`);
      setPosts((prev) =>
        prev.map((p) =>
          p.id === post.id ? { ...p, status: "posted", postedAt: new Date().toISOString(), error: "" } : p,
        ),
      );
      notify(`Posted to ${PLATFORMS[post.platform].label}.`);
    } catch (error) {
      setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, status: "failed", error: error.message } : p)));
      notify("Posting failed. Backend OAuth endpoint is not connected yet.");
    }
  }

  const runDuePosts = useCallback(() => {
    const now = Date.now();
    const due = posts.filter(
      (post) => ["scheduled", "ready"].includes(post.status) && (!post.scheduledAt || new Date(post.scheduledAt).getTime() <= now),
    );
    if (due[0]) publishPost(due[0]);
  }, [posts, connections]);

  function startScheduler() {
    if (schedulerRef.current) return;
    const ms = INTERVALS[intervalIdx].ms;
    setNextTick(new Date(Date.now() + ms).toISOString());
    schedulerRef.current = setInterval(() => {
      setPosts((prev) => {
        const next = prev.find((post) => post.status === "queued");
        if (!next) return prev;
        return prev.map((post) =>
          post.id === next.id
            ? { ...post, status: "scheduled", scheduledAt: new Date().toISOString(), error: "" }
            : post,
        );
      });
      setNextTick(new Date(Date.now() + ms).toISOString());
    }, ms);
    setSchedulerRunning(true);
    notify("Browser scheduler started. Keep this tab open, or use a backend cron for production.");
  }

  function stopScheduler() {
    clearInterval(schedulerRef.current);
    schedulerRef.current = null;
    setSchedulerRunning(false);
    setNextTick(null);
  }

  useEffect(() => {
    const timer = setInterval(runDuePosts, 15000);
    return () => clearInterval(timer);
  }, [runDuePosts]);

  function toggleConnection(platformKey) {
    setConnections((prev) => ({ ...prev, [platformKey]: !prev[platformKey] }));
  }

  const filteredPosts = posts;
  const editingPost = posts.find((post) => post.id === editingId);

  return (
    <div className="app-shell">
      <div className="bg-mesh" />
      <header className="topbar">
        <div className="brand" aria-label="FlowFit Social Command">
          <span className="brand-icon">⚡</span>
          <span className="brand-title">FlowFit</span>
          <span className="brand-subtitle">Social Command</span>
        </div>
        <nav className="tabs" aria-label="Main navigation">
          {[
            ["generator", "✦ Generate"],
            ["queue", `Queue (${posts.length})`],
            ["connections", "Connections"],
            ["analytics", "Analytics"],
          ].map(([key, label]) => (
            <button key={key} className={`tab ${activeTab === key ? "active" : ""}`} onClick={() => setActiveTab(key)}>
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="container">
        {toast && <div className="toast">{toast}</div>}

        {!keyLocked && (
          <section className="api-banner">
            <label htmlFor="apiKey">🔑 Groq API Key</label>
            <input id="apiKey" type="password" placeholder="gsk_..." value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            <button className="button primary compact" onClick={() => apiKey.startsWith("gsk_") && setKeyLocked(true)}>
              Save
            </button>
            <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">Get key →</a>
          </section>
        )}

        {activeTab === "generator" && (
          <section className="panel">
            <div className="section-head">
              <div>
                <h1>AI Post Generator</h1>
                <p>Generate platform-specific FlowFit posts, then edit, attach media, schedule, and publish.</p>
              </div>
            </div>

            <div className="generator-grid">
              <div className="card form-card">
                <label>Platform</label>
                <div className="pill-grid">
                  {Object.entries(PLATFORMS).map(([key, val]) => (
                    <button key={key} className={`pill ${platform === key ? "active" : ""}`} onClick={() => setPlatform(key)}>
                      <span>{val.icon}</span> {val.label}
                    </button>
                  ))}
                </div>

                <label>Tone</label>
                <div className="pill-grid compact-pills">
                  {TONES.map((item) => (
                    <button key={item} className={`pill ${tone === item ? "active" : ""}`} onClick={() => setTone(item)}>
                      {item}
                    </button>
                  ))}
                </div>

                <label htmlFor="topic">Topic</label>
                <select id="topic" value={topic} onChange={(e) => setTopic(e.target.value)}>
                  {TOPICS.map((item) => <option key={item}>{item}</option>)}
                </select>

                <label htmlFor="extraCtx">Extra context</label>
                <textarea id="extraCtx" rows={3} value={extraCtx} placeholder="Example: mention the 14-day free trial and home-workout tracking." onChange={(e) => setExtraCtx(e.target.value)} />

                <label>Batch size: <strong>{batchCount}</strong></label>
                <input type="range" min="1" max="10" value={batchCount} onChange={(e) => setBatchCount(Number(e.target.value))} />

                {genError && <p className="error">{genError}</p>}

                <div className="button-row">
                  <button className="button ghost" onClick={handlePreview} disabled={generating}>{generating ? "Generating…" : "Preview 1"}</button>
                  <button className="button primary" onClick={handleGenerate} disabled={generating}>{generating ? "Generating…" : `Generate ${batchCount}`}</button>
                </div>
              </div>

              <div className="card preview-card">
                <div className="preview-meta">
                  <span className="platform-badge">{PLATFORMS[platform].icon} {PLATFORMS[platform].label}</span>
                  <span>{preview.length}/{PLATFORMS[platform].limit}</span>
                </div>
                {preview ? (
                  <>
                    <div className="post-preview">{preview}</div>
                    <div className="meter"><span style={{ width: `${charPct(preview, PLATFORMS[platform].limit)}%` }} /></div>
                    <div className="button-row stack-mobile">
                      <button className="button ghost" onClick={() => navigator.clipboard.writeText(preview)}>Copy</button>
                      <button className="button primary" onClick={addPreviewToQueue}>Add to Queue</button>
                    </div>
                  </>
                ) : (
                  <div className="empty-preview"><span>✦</span><p>Preview a post before adding it to your publishing queue.</p></div>
                )}
              </div>
            </div>
          </section>
        )}

        {activeTab === "queue" && (
          <section className="panel">
            <div className="queue-head">
              <div>
                <h1>Post Queue</h1>
                <p>Edit copy, attach image/video files, then publish manually or via your backend posting API.</p>
              </div>
              <div className="scheduler-card">
                <select value={intervalIdx} onChange={(e) => setIntervalIdx(Number(e.target.value))} disabled={schedulerRunning}>
                  {INTERVALS.map((item, index) => <option key={item.label} value={index}>{item.label}</option>)}
                </select>
                {schedulerRunning ? (
                  <button className="button danger" onClick={stopScheduler}>Stop Scheduler</button>
                ) : (
                  <button className="button success" onClick={startScheduler} disabled={!stats.queued}>Start Scheduler</button>
                )}
                {nextTick && <small>Next queue release: {fmtDateTime(nextTick)}</small>}
              </div>
            </div>

            {filteredPosts.length === 0 ? (
              <div className="empty-state">
                <span>⚡</span>
                <p>No posts yet. Generate your first batch.</p>
                <button className="button primary" onClick={() => setActiveTab("generator")}>Generate Posts</button>
              </div>
            ) : (
              <div className="post-list">
                {filteredPosts.map((post) => {
                  const cfg = PLATFORMS[post.platform];
                  const pct = charPct(post.text, cfg.limit);
                  return (
                    <article className={`post-card status-${post.status}`} key={post.id}>
                      <div className="post-topline">
                        <span className="status-dot" />
                        <strong>{cfg.icon} {cfg.label}</strong>
                        <span className="chip">{post.tone}</span>
                        <span className="chip status">{post.status}</span>
                        <span className="post-time">{fmtDateTime(post.scheduledAt || post.createdAt)}</span>
                      </div>

                      <p className="post-text">{post.text}</p>
                      <div className="meter"><span className={pct > 90 ? "warn" : ""} style={{ width: `${pct}%` }} /></div>
                      <small className="post-info">{post.text.length}/{cfg.limit} characters · {post.topic}</small>

                      {(post.media || []).length > 0 && (
                        <div className="media-grid">
                          {(post.mediaFiles || post.media || []).map((item, index) => (
                            <div className="media-item" key={item.id || index}>
                              {item.previewUrl && item.file?.type?.startsWith("image/") ? <img src={item.previewUrl} alt="Attached media preview" /> : <span>{item.name}</span>}
                              <button onClick={() => removeMedia(post.id, item.id)}>×</button>
                            </div>
                          ))}
                        </div>
                      )}

                      {post.error && <p className="error">{post.error}</p>}

                      <div className="post-actions">
                        <label className="file-button">
                          Attach media
                          <input type="file" accept={cfg.accepts} multiple onChange={(e) => handleMediaChange(post.id, e.target.files)} />
                        </label>
                        <button className="button ghost" onClick={() => openEditor(post)}>Edit</button>
                        <button className="button ghost" onClick={() => schedulePost(post.id)}>Schedule</button>
                        <button className="button ghost" onClick={() => copyPost(post)}>Copy</button>
                        <button className="button primary" onClick={() => publishPost(post)}>{connections[post.platform] ? "Publish" : "Open Platform"}</button>
                        <button className="icon-button" aria-label="Delete post" onClick={() => deletePost(post.id)}>×</button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {activeTab === "connections" && (
          <section className="panel">
            <div className="section-head">
              <div>
                <h1>Platform Connections</h1>
                <p>Use these switches after you add real OAuth endpoints on your server. Without them, the app falls back to copy/open publishing.</p>
              </div>
            </div>
            <div className="connection-grid">
              {Object.entries(PLATFORMS).map(([key, cfg]) => (
                <div className="card connection-card" key={key}>
                  <div><strong>{cfg.icon} {cfg.label}</strong><p>{connections[key] ? "Backend publishing enabled" : "Manual fallback mode"}</p></div>
                  <button className={`button ${connections[key] ? "success" : "ghost"}`} onClick={() => toggleConnection(key)}>
                    {connections[key] ? "Connected" : "Mark Connected"}
                  </button>
                </div>
              ))}
            </div>
            <div className="card endpoint-card">
              <h2>Backend contract expected by this frontend</h2>
              <pre>{`POST /api/social/publish
Content-Type: multipart/form-data
fields: platform, text, postId, media[]

The backend should: verify user auth → load OAuth token → upload media → publish post → return JSON.`}</pre>
            </div>
          </section>
        )}

        {activeTab === "analytics" && (
          <section className="panel">
            <h1>Analytics</h1>
            <p className="muted">Publishing pipeline health at a glance.</p>
            <div className="stats-grid">
              {[
                ["Total", stats.total],
                ["Queued", stats.queued],
                ["Scheduled", stats.scheduled],
                ["Ready", stats.ready],
                ["Posted", stats.posted],
                ["Failed", stats.failed],
              ].map(([label, value]) => (
                <div className="stat-card" key={label}><strong>{value}</strong><span>{label}</span></div>
              ))}
            </div>
          </section>
        )}
      </main>

      {editingPost && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal-head">
              <h2>Edit Post</h2>
              <button className="icon-button" onClick={() => setEditingId(null)}>×</button>
            </div>
            <label>Post copy</label>
            <textarea rows={9} value={editDraft.text} onChange={(e) => setEditDraft((prev) => ({ ...prev, text: e.target.value }))} />
            <div className="edit-meta">
              <span>{editDraft.text.length}/{PLATFORMS[editingPost.platform].limit}</span>
              <input type="datetime-local" value={editDraft.scheduledAt} onChange={(e) => setEditDraft((prev) => ({ ...prev, scheduledAt: e.target.value }))} />
            </div>
            <div className="button-row modal-actions">
              <button className="button ghost" onClick={() => setEditingId(null)}>Cancel</button>
              <button className="button primary" onClick={saveEditor} disabled={!editDraft.text.trim()}>Save Changes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
