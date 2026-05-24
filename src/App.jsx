import { useEffect, useMemo, useState } from "react";
import "./index.css";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ||
  "https://poster.cctamcc.site";

const PROVIDERS = [
  { id: "FACEBOOK", label: "Facebook" },
  { id: "INSTAGRAM", label: "Instagram" },
  { id: "LINKEDIN", label: "LinkedIn" },
  { id: "X", label: "X" },
];

function readStored(key, fallback = "") {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function toDatetimeLocalValue(date = new Date(Date.now() + 10 * 60 * 1000)) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

async function parseResponse(response) {
  const text = await response.text();
  let payload = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const message =
      payload?.error ||
      payload?.message ||
      payload?.raw ||
      `Request failed with ${response.status}`;

    throw new Error(message);
  }

  return payload;
}

export default function App() {
  const [apiBase, setApiBase] = useState(() => readStored("flowfit.apiBase", API_BASE));
  const [token, setToken] = useState(() => readStored("flowfit.jwt", ""));
  const [providerStatus, setProviderStatus] = useState({});
  const [posts, setPosts] = useState([]);
  const [selectedProviders, setSelectedProviders] = useState(["FACEBOOK"]);
  const [text, setText] = useState("Train smarter at home with FlowFit. AI fitness, real results.");
  const [scheduledAt, setScheduledAt] = useState(() => toDatetimeLocalValue());
  const [mediaFiles, setMediaFiles] = useState([]);
  const [mediaUrls, setMediaUrls] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [notice, setNotice] = useState("");

  const authHeaders = useMemo(() => {
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [token]);

  function persistSettings() {
    localStorage.setItem("flowfit.apiBase", apiBase.replace(/\/$/, ""));
    localStorage.setItem("flowfit.jwt", token.trim());
    setNotice("Settings saved locally on this browser.");
  }

  async function api(path, options = {}) {
    const response = await fetch(`${apiBase.replace(/\/$/, "")}${path}`, {
      ...options,
      headers: {
        ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...authHeaders,
        ...(options.headers || {}),
      },
    });

    return parseResponse(response);
  }

  async function loadProviders() {
    if (!token) {
      setNotice("Paste a valid FlowFit bearer JWT to load connected providers.");
      return;
    }

    try {
      const data = await api("/api/social/providers");
      setProviderStatus(data.providers || {});
    } catch (error) {
      setNotice(error.message);
    }
  }

  async function loadPosts() {
    if (!token) return;

    setLoadingPosts(true);
    try {
      const data = await api("/api/social/posts");
      setPosts(data.posts || []);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoadingPosts(false);
    }
  }

  useEffect(() => {
    if (token) {
      loadProviders();
      loadPosts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function uploadSelectedMedia() {
    if (!mediaFiles.length) {
      setNotice("Select at least one image/video first.");
      return;
    }

    const form = new FormData();
    Array.from(mediaFiles).forEach((file) => form.append("media", file));

    setUploading(true);
    try {
      const data = await api("/api/social/media", {
        method: "POST",
        body: form,
      });

      setMediaUrls(data.urls || []);
      setNotice("Media uploaded successfully.");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setUploading(false);
    }
  }

  async function schedulePost(event) {
    event.preventDefault();

    if (!token) {
      setNotice("Bearer JWT is required.");
      return;
    }

    if (!selectedProviders.length) {
      setNotice("Select at least one platform.");
      return;
    }

    if (selectedProviders.includes("INSTAGRAM") && mediaUrls.length === 0) {
      setNotice("Instagram publishing requires at least one uploaded image or video URL.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        text,
        providers: selectedProviders,
        scheduledAt: new Date(scheduledAt).toISOString(),
        mediaUrls,
      };

      await api("/api/social/posts", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setNotice("Post scheduled successfully.");
      setText("");
      setMediaFiles([]);
      setMediaUrls([]);
      setScheduledAt(toDatetimeLocalValue());
      await loadPosts();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function cancelPost(id) {
    try {
      await api(`/api/social/posts/${id}/cancel`, { method: "PATCH" });
      setNotice("Post cancelled.");
      await loadPosts();
    } catch (error) {
      setNotice(error.message);
    }
  }

  function toggleProvider(provider) {
    setSelectedProviders((current) =>
      current.includes(provider)
        ? current.filter((item) => item !== provider)
        : [...current, provider]
    );
  }

  return (
    <main className="page-shell">
      <section className="hero-card">
        <div>
          <p className="eyebrow">FlowFit Marketing</p>
          <h1>Social Poster Scheduler</h1>
          <p className="hero-copy">
            Create one campaign, upload media, choose platforms, schedule it, and let the protected backend cron publish due posts.
          </p>
        </div>

        <button className="secondary-button" onClick={() => { loadProviders(); loadPosts(); }}>
          Refresh
        </button>
      </section>

      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}

      <section className="grid">
        <aside className="panel">
          <h2>Connection Settings</h2>
          <label>
            Backend API URL
            <input
              value={apiBase}
              onChange={(event) => setApiBase(event.target.value)}
              placeholder="https://poster.cctamcc.site"
            />
          </label>

          <label>
            User Bearer JWT
            <textarea
              rows="5"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Paste FlowFit user JWT here"
            />
          </label>

          <button className="primary-button" onClick={persistSettings}>
            Save Settings
          </button>

          <div className="provider-list">
            <h3>Provider Config</h3>
            {PROVIDERS.map((provider) => (
              <div className="provider-row" key={provider.id}>
                <span>{provider.label}</span>
                <strong className={providerStatus?.[provider.id] ? "ok" : "bad"}>
                  {providerStatus?.[provider.id] ? "Ready" : "Not ready"}
                </strong>
              </div>
            ))}
          </div>
        </aside>

        <section className="panel">
          <h2>Create Scheduled Post</h2>

          <form onSubmit={schedulePost} className="form-stack">
            <label>
              Caption
              <textarea
                rows="7"
                value={text}
                maxLength={2800}
                onChange={(event) => setText(event.target.value)}
                placeholder="Write your marketing post..."
              />
              <span className="hint">{text.length}/2800 characters</span>
            </label>

            <div>
              <p className="label-title">Platforms</p>
              <div className="chips">
                {PROVIDERS.map((provider) => (
                  <button
                    type="button"
                    className={selectedProviders.includes(provider.id) ? "chip selected" : "chip"}
                    key={provider.id}
                    onClick={() => toggleProvider(provider.id)}
                  >
                    {provider.label}
                  </button>
                ))}
              </div>
            </div>

            <label>
              Schedule Time
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
              />
            </label>

            <label>
              Media
              <input
                type="file"
                accept="image/*,video/*"
                multiple
                onChange={(event) => setMediaFiles(event.target.files)}
              />
            </label>

            <div className="button-row">
              <button type="button" className="secondary-button" disabled={uploading} onClick={uploadSelectedMedia}>
                {uploading ? "Uploading..." : "Upload Media"}
              </button>

              <button type="submit" className="primary-button" disabled={saving}>
                {saving ? "Scheduling..." : "Schedule Post"}
              </button>
            </div>

            {mediaUrls.length > 0 && (
              <div className="media-preview">
                <p>Uploaded media URLs:</p>
                {mediaUrls.map((url) => (
                  <a href={url} target="_blank" rel="noreferrer" key={url}>
                    {url}
                  </a>
                ))}
              </div>
            )}
          </form>
        </section>
      </section>

      <section className="panel posts-panel">
        <div className="section-header">
          <h2>Scheduled Posts</h2>
          <button className="secondary-button" onClick={loadPosts} disabled={loadingPosts}>
            {loadingPosts ? "Loading..." : "Reload Posts"}
          </button>
        </div>

        {posts.length === 0 ? (
          <p className="empty">No posts found yet.</p>
        ) : (
          <div className="post-list">
            {posts.map((post) => (
              <article className="post-card" key={post.id}>
                <div className="post-top">
                  <strong>{post.status}</strong>
                  <span>{new Date(post.scheduledAt).toLocaleString()}</span>
                </div>

                <p>{post.text}</p>

                <div className="meta-row">
                  <span>{Array.isArray(post.providers) ? post.providers.join(", ") : ""}</span>
                  {post.lastError && <span className="error-text">{post.lastError}</span>}
                </div>

                {["DRAFT", "SCHEDULED", "FAILED"].includes(post.status) && (
                  <button className="danger-button" onClick={() => cancelPost(post.id)}>
                    Cancel
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
