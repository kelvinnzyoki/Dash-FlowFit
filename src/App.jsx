import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./index.css";

// ── Config ────────────────────────────────────────────────────────────────────
const API_BASE =
  (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "") ||
  "https://poster.cctamcc.site";

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

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
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
  } catch {
    throw new Error(
      "Cannot reach the backend (" + API_BASE + "). " +
      "Check VITE_API_BASE_URL, backend CORS (APP_ORIGIN), and POSTER_SERVICE_USER_ID."
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

// ── Notice hook ───────────────────────────────────────────────────────────────
function useNotice() {
  const [notice, setNoticeState] = useState(null);
  const timerRef = useRef(null);

  const setNotice = useCallback((text, type = "error") => {
    clearTimeout(timerRef.current);
    setNoticeState({ text, type });
    timerRef.current = setTimeout(() => setNoticeState(null), 7000);
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
  const [variants, setVariants]                     = useState(DEFAULT_VARIANTS);
  const [selectedProviders, setSelectedProviders]   = useState(["FACEBOOK", "INSTAGRAM", "LINKEDIN", "X"]);
  const [scheduledAt, setScheduledAt]               = useState(() => toDatetimeLocalValue());

  // Media state — stored as real Array so length check is always reliable
  const [selectedFiles, setSelectedFiles]           = useState([]); // File[] — picked but not yet uploaded
  const [uploadedUrls, setUploadedUrls]             = useState([]); // string[] — confirmed Cloudinary URLs
  const fileInputRef                                = useRef(null);

  const [posts, setPosts]                           = useState([]);
  const [providerStatus, setProviderStatus]         = useState({});
  const [statusFilter, setStatusFilter]             = useState("");

  const [loading, setLoading]       = useState(false);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading]   = useState(false);

  // ── Provider status ────────────────────────────────────────────────────────
  const loadProviderStatus = useCallback(async () => {
    try {
      const data = await apiCall("/api/social/providers");
      setProviderStatus(data.providers || {});
    } catch { /* non-fatal */ }
  }, []);

  // ── Posts ──────────────────────────────────────────────────────────────────
  const loadPosts = useCallback(async (filter) => {
    setLoading(true);
    try {
      const q = filter !== undefined ? filter : statusFilter;
      const data = await apiCall("/api/social/posts" + (q ? "?status=" + q : ""));
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

  // ── Providers toggle ───────────────────────────────────────────────────────
  function toggleProvider(id) {
    setSelectedProviders((cur) =>
      cur.includes(id) ? cur.filter((p) => p !== id) : [...cur, id]
    );
  }

  // ── File selection ─────────────────────────────────────────────────────────
  function onFilesChange(e) {
    // Convert FileList → plain Array immediately so it's never stale
    const arr = Array.from(e.target.files || []);
    setSelectedFiles(arr);
    // Reset uploaded URLs when a new set of files is picked
    setUploadedUrls([]);
  }

  function removeSelectedFile(index) {
    setSelectedFiles((cur) => cur.filter((_, i) => i !== index));
  }

  // ── Upload to Cloudinary via backend ──────────────────────────────────────
  async function uploadMedia() {
    if (!selectedFiles.length) {
      setNotice("Pick at least one image or video first.", "error");
      return;
    }

    const totalMB = selectedFiles.reduce((s, f) => s + f.size, 0) / (1024 * 1024);
    if (totalMB > 4) {
      setNotice(
        "Total file size is " + totalMB.toFixed(1) + " MB. Keep it under 4 MB (Vercel limit). " +
        "Compress images or upload one at a time.",
        "error"
      );
      return;
    }

    const form = new FormData();
    selectedFiles.forEach((f) => form.append("media", f));

    setUploading(true);
    try {
      const data = await apiCall("/api/social/media", { method: "POST", body: form });
      const urls = data.urls || [];
      setUploadedUrls(urls);
      setNotice(urls.length + " file(s) uploaded to Cloudinary.", "success");
    } catch (err) {
      setNotice(err.message, "error");
    } finally {
      setUploading(false);
    }
  }

  function clearMedia() {
    setSelectedFiles([]);
    setUploadedUrls([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  // ── Generate posts ─────────────────────────────────────────────────────────
  async function generatePosts() {
    if (!campaignBrief.trim()) {
      setNotice("Write a campaign brief first.", "error");
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
      setNotice("Posts generated — review and edit below.", "success");
    } catch (err) {
      setNotice(err.message, "error");
    } finally {
      setGenerating(false);
    }
  }

  // ── Schedule posts ─────────────────────────────────────────────────────────
  async function schedulePosts(event) {
    event.preventDefault();

    if (!selectedProviders.length) {
      setNotice("Select at least one platform.", "error");
      return;
    }
    if (selectedProviders.includes("INSTAGRAM") && !uploadedUrls.length) {
      setNotice("Instagram requires at least one uploaded media URL.", "error");
      return;
    }
    if (new Date(scheduledAt) < new Date(Date.now() - 60_000)) {
      setNotice("Schedule time must be now or in the future.", "error");
      return;
    }
    if (selectedFiles.length && !uploadedUrls.length) {
      setNotice("You have files selected but not uploaded yet. Click 'Upload to Cloudinary' first.", "error");
      return;
    }

    setLoading(true);
    let ok = 0;
    const errors = [];

    for (const provider of selectedProviders) {
      const text = (variants[provider] || "").trim();
      if (!text) { errors.push(provider + " post text is empty."); continue; }

      try {
        await apiCall("/api/social/posts", {
          method: "POST",
          body: JSON.stringify({
            text,
            providers: [provider],
            scheduledAt: new Date(scheduledAt).toISOString(),
            mediaUrls: uploadedUrls,
          }),
        });
        ok++;
      } catch (err) {
        errors.push(provider + ": " + err.message);
      }
    }

    setLoading(false);

    if (ok > 0) {
      setNotice(
        ok + " post(s) scheduled." + (errors.length ? " Errors: " + errors.join("; ") : ""),
        errors.length ? "error" : "success"
      );
      clearMedia();
      setScheduledAt(toDatetimeLocalValue());
      await loadPosts("");
    } else {
      setNotice(errors.join(" | "), "error");
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

  function applyFilter(value) {
    setStatusFilter(value);
    loadPosts(value);
  }

  const connectedCount = useMemo(
    () => Object.values(providerStatus).filter(Boolean).length,
    [providerStatus]
  );

  const totalSelectedMB = useMemo(
    () => selectedFiles.reduce((s, f) => s + f.size, 0) / (1024 * 1024),
    [selectedFiles]
  );

  const needsMedia = selectedProviders.includes("INSTAGRAM");

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <main className="page-shell">

      {/* Hero */}
      <section className="hero-card">
        <p className="eyebrow">FlowFit Marketing</p>
        <h1>Social Poster</h1>
        <p className="hero-copy">
          Generate AI posts per platform, upload media, schedule campaigns,
          and let the backend cron publish them automatically.
        </p>
        <p className="api-base-badge">API → {API_BASE}</p>
      </section>

      {/* Notice */}
      {notice && (
        <div className={"notice notice--" + notice.type} role="status">
          <span>{notice.text}</span>
          <button className="notice-close" onClick={clearNotice}>✕</button>
        </div>
      )}

      {/* Provider connection status */}
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

        <p className="sub-label" style={{ marginTop: 14 }}>Generate for platforms:</p>
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

      {/* Media upload — standalone section, before the schedule form */}
      <section className="panel media-panel">
        <h2>
          Media Upload
          {needsMedia && <span className="required-tag">Required for Instagram</span>}
        </h2>
        <p className="hint" style={{ marginBottom: 14 }}>
          Upload images or videos to Cloudinary first. The URLs are then attached to all scheduled posts.
          Max total size: 4 MB (Vercel limit).
        </p>

        {/* File picker */}
        <div className="file-picker-row">
          <label className="file-picker-label" htmlFor="media-input">
            {selectedFiles.length
              ? selectedFiles.length + " file(s) selected — " + totalSelectedMB.toFixed(2) + " MB"
              : "Click to pick images or videos"}
          </label>
          <input
            id="media-input"
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            className="file-input-hidden"
            onChange={onFilesChange}
          />
        </div>

        {/* Selected file list */}
        {selectedFiles.length > 0 && (
          <ul className="file-list">
            {selectedFiles.map((f, i) => (
              <li key={i} className="file-item">
                <span className="file-name">{f.name}</span>
                <span className="file-size">{formatBytes(f.size)}</span>
                <button
                  type="button"
                  className="file-remove"
                  onClick={() => removeSelectedFile(i)}
                  aria-label={"Remove " + f.name}
                >✕</button>
              </li>
            ))}
          </ul>
        )}

        {totalSelectedMB > 4 && (
          <p className="warn-text">⚠ Total exceeds 4 MB — upload will fail. Remove some files.</p>
        )}

        <div className="button-row" style={{ marginTop: 14 }}>
          {selectedFiles.length > 0 && (
            <button type="button" className="secondary-button" onClick={clearMedia}>
              Clear
            </button>
          )}
          <button
            type="button"
            className="primary-button"
            onClick={uploadMedia}
            disabled={uploading || !selectedFiles.length || totalSelectedMB > 4}
          >
            {uploading ? "Uploading…" : "Upload to Cloudinary"}
          </button>
        </div>

        {/* Uploaded URLs */}
        {uploadedUrls.length > 0 && (
          <div className="media-preview">
            <strong>✓ Uploaded — {uploadedUrls.length} URL(s) ready</strong>
            {uploadedUrls.map((url) => (
              <a href={url} target="_blank" rel="noreferrer" key={url}>{url}</a>
            ))}
          </div>
        )}
      </section>

      {/* Edit & Schedule */}
      <form className="panel form-stack" onSubmit={schedulePosts}>
        <h2>Edit &amp; Schedule</h2>

        {PROVIDERS.filter((p) => selectedProviders.includes(p.id)).map((p) => (
          <div key={p.id} className="variant-block">
            <div className="variant-label">
              <span>{p.label}</span>
              {providerStatus[p.id] === false && (
                <span className="not-connected-tag">not connected</span>
              )}
            </div>
            <textarea
              rows="5"
              maxLength={p.limit}
              value={variants[p.id] || ""}
              onChange={(e) => setVariants((cur) => ({ ...cur, [p.id]: e.target.value }))}
              placeholder={"Write your " + p.label + " post here…"}
            />
            <span className={"hint char-count" + ((variants[p.id] || "").length >= p.limit ? " over" : "")}>
              {(variants[p.id] || "").length} / {p.limit}
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

        {uploadedUrls.length > 0 && (
          <p className="hint" style={{ color: "#15803d" }}>
            ✓ {uploadedUrls.length} media URL(s) will be attached to all posts.
          </p>
        )}

        {needsMedia && !uploadedUrls.length && (
          <p className="warn-text">⚠ Instagram is selected but no media uploaded yet.</p>
        )}

        <div className="button-row">
          <button
            type="button"
            className="secondary-button"
            onClick={() => { setVariants(DEFAULT_VARIANTS); setNotice("Variants reset.", "success"); }}
          >
            Reset Posts
          </button>
          <button
            type="submit"
            className="primary-button"
            disabled={loading || !selectedProviders.length}
          >
            {loading ? "Scheduling…" : "Schedule Posts"}
          </button>
        </div>
      </form>

      {/* Scheduled posts list */}
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
          <p className="empty">No posts found{statusFilter ? " for " + statusFilter : ""}.</p>
        ) : (
          <div className="post-list">
            {posts.map((post) => {
              const style = STATUS_STYLES[post.status] || STATUS_STYLES.DRAFT;
              return (
                <article className="post-card" key={post.id}>
                  <div className="post-top">
                    <span className="status-badge" style={{
                      background: style.bg, color: style.color,
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

                  {post.lastError && <p className="error-text">⚠ {post.lastError}</p>}

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
