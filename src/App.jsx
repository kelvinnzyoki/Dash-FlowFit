import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./index.css";

// ── Config ────────────────────────────────────────────────────────────────────
const API_BASE =
  (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "") ||
  "https://poster.cctamcc.site";

// Optional static Bearer token (set VITE_API_TOKEN in Vercel env vars).
// On the backend, also set POSTER_SERVICE_USER_ID so the token is accepted
// without a full FlowFit login session.
const STATIC_TOKEN = import.meta.env.VITE_API_TOKEN || "";

// ── Constants ─────────────────────────────────────────────────────────────────
const PROVIDERS = [
  { id: "FACEBOOK",  label: "Facebook",  limit: 2800 },
  { id: "INSTAGRAM", label: "Instagram", limit: 2200 },
  { id: "LINKEDIN",  label: "LinkedIn",  limit: 3000 },
  { id: "X",         label: "X",         limit: 280  },
];

const DEFAULT_VARIANTS = {
  FACEBOOK:  "Train smarter at home with FlowFit. AI fitness, real results.",
  INSTAGRAM: "Train smarter at home with FlowFit. AI fitness, real results.\n#FlowFit #HomeWorkout #FitnessApp",
  LINKEDIN:  "FlowFit helps people train smarter at home with structured workouts, progress tracking, and AI-powered coaching.",
  X:         "Train smarter at home with FlowFit. AI fitness, real results.",
};

const STATUS_STYLES = {
  SCHEDULED:  { bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" },
  PUBLISHING: { bg: "#fefce8", color: "#854d0e", border: "#fde68a" },
  PUBLISHED:  { bg: "#f0fdf4", color: "#15803d", border: "#bbf7d0" },
  FAILED:     { bg: "#fef2f2", color: "#b91c1c", border: "#fecaca" },
  CANCELLED:  { bg: "#f8fafc", color: "#64748b", border: "#e2e8f0" },
  DRAFT:      { bg: "#faf5ff", color: "#7c3aed", border: "#e9d5ff" },
};

function toDatetimeLocalValue(date = new Date(Date.now() + 10 * 60 * 1000)) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

// ── API helper ────────────────────────────────────────────────────────────────
async function apiCall(path, options = {}) {
  const headers = {
    ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
    ...(STATIC_TOKEN ? { Authorization: "Bearer " + STATIC_TOKEN } : {}),
    ...(options.headers || {}),
  };

  let response;
  try {
    response = await fetch(API_BASE + path, {
      credentials: "include",
      ...options,
      headers,
    });
  } catch (networkErr) {
    // fetch() itself threw — server unreachable or CORS preflight blocked
    throw new Error(
      "Cannot reach the backend (" + API_BASE + "). " +
      "Check: (1) VITE_API_BASE_URL is correct, (2) backend CORS allows this origin with credentials, " +
      "(3) POSTER_SERVICE_USER_ID is set on the backend if you are not using FlowFit login cookies."
    );
  }

  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }

  if (!response.ok) {
    throw new Error(
      payload?.error || payload?.message || payload?.raw ||
      "Request failed with status " + response.status
    );
  }

  return payload;
}

// ── Notice hook (auto-dismiss after 6 s) ─────────────────────────────────────
function useNotice() {
  const [notice, setNoticeState] = useState(null); // { text, type: 'success'|'error' }
  const timerRef = useRef(null);

  const setNotice = useCallback((text, type = "error") => {
    clearTimeout(timerRef.current);
    setNoticeState({ text, type });
    timerRef.current = setTimeout(() => setNoticeState(null), 6000);
  }, []);

  const clearNotice = useCallback(() => {
    clearTimeout(timerRef.current);
    setNoticeState(null);
  }, []);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return { notice, setNotice, clearNotice };
}

// ── Main component ────────────────────────────────────────────────────────────
export default function App() {
  const { notice, setNotice, clearNotice } = useNotice();

  const [campaignBrief, setCampaignBrief] = useState(
    "Promote FlowFit home workouts, AI coaching, progress tracking, and real fitness results."
  );
  const [variants, setVariants]               = useState(DEFAULT_VARIANTS);
  const [selectedProviders, setSelectedProviders] = useState(["FACEBOOK", "INSTAGRAM", "LINKEDIN", "X"]);
  const [scheduledAt, setScheduledAt]         = useState(() => toDatetimeLocalValue());
  const [mediaFiles, setMediaFiles]           = useState([]);
  const [mediaUrls, setMediaUrls]             = useState([]);
  const [posts, setPosts]                     = useState([]);
  const [providerStatus, setProviderStatus]   = useState({});
  const [loading, setLoading]                 = useState(false);
  const [generating, setGenerating]           = useState(false);
  const [uploading, setUploading]             = useState(false);
  const [statusFilter, setStatusFilter]       = useState("");

  // ── Load provider connection status ────────────────────────────────────────
  const loadProviderStatus = useCallback(async () => {
    try {
      const data = await apiCall("/api/social/providers");
      setProviderStatus(data.providers || {});
    } catch {
      // Non-fatal — providers status is informational only
    }
  }, []);

  // ── Load posts ─────────────────────────────────────────────────────────────
  const loadPosts = useCallback(async (filter) => {
    setLoading(true);
    try {
      const query = (filter || statusFilter) ? "?status=" + (filter || statusFilter) : "";
      const data = await apiCall("/api/social/posts" + query);
      setPosts(data.posts || []);
    } catch (err) {
      setNotice(err.message, "error");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, setNotice]);

  useEffect(() => {
    loadProviderStatus();
    loadPosts("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Toggle platform selection ──────────────────────────────────────────────
  function toggleProvider(id) {
    setSelectedProviders((cur) =>
      cur.includes(id) ? cur.filter((p) => p !== id) : [...cur, id]
    );
  }

  // ── Generate via backend Groq ──────────────────────────────────────────────
  async function generatePosts() {
    if (!campaignBrief.trim()) {
      setNotice("Add a campaign brief first.", "error");
      return;
    }
    if (!selectedProviders.length) {
      setNotice("Select at least one platform.", "error");
      return;
    }

    setGenerating(true);
    try {
      const data = await apiCall("/api/social/generate", {
        method: "POST",
        body: JSON.stringify({ brief: campaignBrief, providers: selectedProviders }),
      });

      if (!data.variants || !Object.keys(data.variants).length) {
        throw new Error("Backend returned empty variants. Check GROQ_API_KEY in backend env.");
      }

      setVariants((cur) => ({ ...cur, ...data.variants }));
      setNotice("AI posts generated — review and edit each platform below.", "success");
    } catch (err) {
      setNotice(err.message, "error");
    } finally {
      setGenerating(false);
    }
  }

  // ── Upload media ───────────────────────────────────────────────────────────
  async function uploadSelectedMedia() {
    if (!mediaFiles.length) {
      setNotice("Select at least one file first.", "error");
      return;
    }

    const form = new FormData();
    Array.from(mediaFiles).forEach((f) => form.append("media", f));

    setUploading(true);
    try {
      const data = await apiCall("/api/social/media", { method: "POST", body: form });
      setMediaUrls(data.urls || []);
      setNotice("Media uploaded successfully.", "success");
    } catch (err) {
      setNotice(err.message, "error");
    } finally {
      setUploading(false);
    }
  }

  // ── Schedule posts ─────────────────────────────────────────────────────────
  async function schedulePosts(event) {
    event.preventDefault();

    if (!selectedProviders.length) {
      setNotice("Select at least one platform.", "error");
      return;
    }
    if (selectedProviders.includes("INSTAGRAM") && !mediaUrls.length) {
      setNotice("Instagram requires at least one uploaded media URL.", "error");
      return;
    }
    const scheduledISO = new Date(scheduledAt).toISOString();
    if (new Date(scheduledAt) < new Date(Date.now() - 60_000)) {
      setNotice("Schedule time must be now or in the future.", "error");
      return;
    }

    setLoading(true);
    let successCount = 0;
    const errors = [];

    try {
      for (const provider of selectedProviders) {
        const text = (variants[provider] || "").trim();
        if (!text) { errors.push(provider + " post text is empty."); continue; }

        try {
          await apiCall("/api/social/posts", {
            method: "POST",
            body: JSON.stringify({ text, providers: [provider], scheduledAt: scheduledISO, mediaUrls }),
          });
          successCount++;
        } catch (err) {
          errors.push(provider + ": " + err.message);
        }
      }

      if (successCount > 0) {
        setNotice(
          successCount + " post(s) scheduled." + (errors.length ? " Errors: " + errors.join("; ") : ""),
          errors.length ? "error" : "success"
        );
        setMediaFiles([]);
        setMediaUrls([]);
        setScheduledAt(toDatetimeLocalValue());
        await loadPosts("");
      } else {
        setNotice(errors.join(" | "), "error");
      }
    } finally {
      setLoading(false);
    }
  }

  // ── Cancel post ────────────────────────────────────────────────────────────
  async function cancelPost(id) {
    try {
      await apiCall("/api/social/posts/" + id + "/cancel", { method: "PATCH" });
      setNotice("Post cancelled.", "success");
      await loadPosts("");
    } catch (err) {
      setNotice(err.message, "error");
    }
  }

  // ── Status filter ──────────────────────────────────────────────────────────
  function applyFilter(value) {
    setStatusFilter(value);
    loadPosts(value);
  }

  // ── Connected provider count ───────────────────────────────────────────────
  const connectedCount = useMemo(
    () => Object.values(providerStatus).filter(Boolean).length,
    [providerStatus]
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <main className="page-shell">

      {/* Hero */}
      <section className="hero-card">
        <p className="eyebrow">FlowFit Marketing</p>
        <h1>Social Poster</h1>
        <p className="hero-copy">
          Generate platform-specific posts with AI, upload media, schedule campaigns,
          and let the backend cron publish due posts automatically.
        </p>
        <p className="api-base-badge">API → {API_BASE}</p>
      </section>

      {/* Notice */}
      {notice && (
        <div className={"notice notice--" + notice.type} role="status">
          <span>{notice.text}</span>
          <button className="notice-close" onClick={clearNotice} aria-label="Dismiss">✕</button>
        </div>
      )}

      {/* Provider status */}
      <section className="panel provider-panel">
        <div className="section-header">
          <h2>Platform Connections</h2>
          <button className="secondary-button sm" onClick={loadProviderStatus}>Refresh</button>
        </div>
        <div className="chips">
          {PROVIDERS.map((p) => {
            const live = providerStatus[p.id];
            return (
              <span key={p.id} className={"provider-badge " + (live ? "live" : "offline")}>
                <span className={"dot " + (live ? "dot--green" : "dot--red")} />
                {p.label}
              </span>
            );
          })}
        </div>
        {connectedCount === 0 && Object.keys(providerStatus).length > 0 && (
          <p className="hint">No platforms connected. Add credentials to backend env vars.</p>
        )}
      </section>

      {/* AI Generator */}
      <section className="panel">
        <h2>AI Campaign Generator</h2>
        <label>
          Campaign Brief
          <textarea
            rows="4"
            value={campaignBrief}
            onChange={(e) => setCampaignBrief(e.target.value)}
            placeholder="Describe what FlowFit should promote…"
          />
        </label>

        <p className="sub-label">Select platforms to generate for:</p>
        <div className="chips">
          {PROVIDERS.map((p) => (
            <button
              type="button"
              key={p.id}
              className={"chip " + (selectedProviders.includes(p.id) ? "selected" : "")}
              onClick={() => toggleProvider(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <button className="primary-button" onClick={generatePosts} disabled={generating}>
          {generating ? "Generating with Groq AI…" : "Generate Platform Posts"}
        </button>
      </section>

      {/* Edit & Schedule */}
      <form className="panel form-stack" onSubmit={schedulePosts}>
        <h2>Edit & Schedule</h2>

        {PROVIDERS.filter((p) => selectedProviders.includes(p.id)).map((p) => (
          <div key={p.id} className="variant-block">
            <label className="variant-label">
              {p.label}
              {providerStatus[p.id] === false && (
                <span className="not-connected-tag">not connected</span>
              )}
            </label>
            <textarea
              rows="5"
              maxLength={p.limit}
              value={variants[p.id] || ""}
              onChange={(e) =>
                setVariants((cur) => ({ ...cur, [p.id]: e.target.value }))
              }
              placeholder={"Write your " + p.label + " post here…"}
            />
            <span className={"hint char-count" + ((variants[p.id] || "").length >= p.limit ? " over" : "")}>
              {(variants[p.id] || "").length} / {p.limit} characters
            </span>
          </div>
        ))}

        <label>
          Schedule Time
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
          />
        </label>

        <div className="media-section">
          <label>
            Media (images / videos — optional except Instagram)
            <input
              type="file"
              accept="image/*,video/*"
              multiple
              onChange={(e) => setMediaFiles(e.target.files)}
            />
          </label>
          <button type="button" className="secondary-button" onClick={uploadSelectedMedia} disabled={uploading}>
            {uploading ? "Uploading…" : "Upload Media to Cloudinary"}
          </button>
        </div>

        {mediaUrls.length > 0 && (
          <div className="media-preview">
            <strong>Uploaded URLs</strong>
            {mediaUrls.map((url) => (
              <a href={url} target="_blank" rel="noreferrer" key={url}>{url}</a>
            ))}
          </div>
        )}

        <div className="button-row">
          <button
            type="button"
            className="secondary-button"
            onClick={() => { setVariants(DEFAULT_VARIANTS); setNotice("Variants reset to defaults.", "success"); }}
          >
            Reset Posts
          </button>
          <button type="submit" className="primary-button" disabled={loading || !selectedProviders.length}>
            {loading ? "Scheduling…" : "Schedule Selected Posts"}
          </button>
        </div>
      </form>

      {/* Scheduled Posts */}
      <section className="panel posts-panel">
        <div className="section-header">
          <h2>Scheduled Posts</h2>
          <div className="filter-row">
            <select
              className="filter-select"
              value={statusFilter}
              onChange={(e) => applyFilter(e.target.value)}
            >
              <option value="">All statuses</option>
              {["DRAFT","SCHEDULED","PUBLISHING","PUBLISHED","FAILED","CANCELLED"].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <button className="secondary-button sm" onClick={() => loadPosts("")} disabled={loading}>
              {loading ? "…" : "Reload"}
            </button>
          </div>
        </div>

        {posts.length === 0 ? (
          <p className="empty">No posts found{statusFilter ? " for status: " + statusFilter : ""}.</p>
        ) : (
          <div className="post-list">
            {posts.map((post) => {
              const style = STATUS_STYLES[post.status] || STATUS_STYLES.DRAFT;
              return (
                <article className="post-card" key={post.id}>
                  <div className="post-top">
                    <span className="status-badge" style={{
                      background: style.bg,
                      color: style.color,
                      border: "1px solid " + style.border,
                    }}>
                      {post.status}
                    </span>
                    <span className="post-time">{new Date(post.scheduledAt).toLocaleString()}</span>
                  </div>

                  <p className="post-text">{post.text}</p>

                  <div className="meta-row">
                    <span className="platform-tags">
                      {(Array.isArray(post.providers) ? post.providers : []).map((prov) => (
                        <span key={prov} className="platform-tag">{prov}</span>
                      ))}
                    </span>
                    {post.publishedAt && (
                      <span className="hint">Published {new Date(post.publishedAt).toLocaleString()}</span>
                    )}
                  </div>

                  {post.lastError && (
                    <p className="error-text">⚠ {post.lastError}</p>
                  )}

                  {["DRAFT","SCHEDULED","FAILED"].includes(post.status) && (
                    <button type="button" className="danger-button" onClick={() => cancelPost(post.id)}>
                      Cancel Post
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

    </main>
  );
}
