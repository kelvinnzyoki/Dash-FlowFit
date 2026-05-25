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

const DEFAULT_VARIANTS = {
  FACEBOOK: "Train smarter at home with FlowFit. AI fitness, real results.",
  INSTAGRAM: "Train smarter at home with FlowFit. AI fitness, real results. #FlowFit #HomeWorkout #FitnessApp",
  LINKEDIN: "FlowFit helps people train smarter at home with structured workouts, progress tracking, and AI-powered coaching.",
  X: "Train smarter at home with FlowFit. AI fitness, real results.",
};

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
  const [campaignBrief, setCampaignBrief] = useState(
    "Promote FlowFit home workouts, AI coaching, progress tracking, and real fitness results."
  );
  const [variants, setVariants] = useState(DEFAULT_VARIANTS);
  const [selectedProviders, setSelectedProviders] = useState(["FACEBOOK", "INSTAGRAM", "LINKEDIN", "X"]);
  const [scheduledAt, setScheduledAt] = useState(() => toDatetimeLocalValue());
  const [mediaFiles, setMediaFiles] = useState([]);
  const [mediaUrls, setMediaUrls] = useState([]);
  const [posts, setPosts] = useState([]);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);

  const apiBase = useMemo(() => API_BASE, []);

  async function api(path, options = {}) {
    const response = await fetch(`${apiBase}${path}`, {
      credentials: "include",
      ...options,
      headers: {
        ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...(options.headers || {}),
      },
    });

    return parseResponse(response);
  }

  async function loadPosts() {
    setLoading(true);
    try {
      const data = await api("/api/social/posts");
      setPosts(data.posts || []);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPosts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleProvider(provider) {
    setSelectedProviders((current) =>
      current.includes(provider)
        ? current.filter((item) => item !== provider)
        : [...current, provider]
    );
  }

  async function generatePosts() {
    if (!campaignBrief.trim()) {
      setNotice("Add a campaign brief first.");
      return;
    }

    setGenerating(true);
    try {
      const data = await api("/api/social/generate", {
        method: "POST",
        body: JSON.stringify({
          brief: campaignBrief,
          providers: selectedProviders,
        }),
      });

      setVariants((current) => ({
        ...current,
        ...(data.variants || {}),
      }));
      setNotice("AI post variants generated.");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setGenerating(false);
    }
  }

  async function uploadSelectedMedia() {
    if (!mediaFiles.length) {
      setNotice("Select at least one image or video first.");
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

  async function schedulePosts(event) {
    event.preventDefault();

    if (!selectedProviders.length) {
      setNotice("Select at least one platform.");
      return;
    }

    if (selectedProviders.includes("INSTAGRAM") && mediaUrls.length === 0) {
      setNotice("Instagram requires at least one uploaded media URL.");
      return;
    }

    setLoading(true);

    try {
      for (const provider of selectedProviders) {
        const text = variants[provider]?.trim();

        if (!text) {
          throw new Error(`${provider} post text is empty.`);
        }

        await api("/api/social/posts", {
          method: "POST",
          body: JSON.stringify({
            text,
            providers: [provider],
            scheduledAt: new Date(scheduledAt).toISOString(),
            mediaUrls,
          }),
        });
      }

      setNotice("Posts scheduled through backend. Cron will publish them when due.");
      await loadPosts();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setLoading(false);
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

  return (
    <main className="page-shell">
      <section className="hero-card">
        <p className="eyebrow">FlowFit Marketing</p>
        <h1>Social Poster Scheduler</h1>
        <p className="hero-copy">
          Generate platform-specific marketing posts, upload media, schedule campaigns, and let the protected backend cron publish due posts.
        </p>
        <button className="secondary-button" onClick={loadPosts} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </section>

      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}

      <section className="panel">
        <h2>AI Campaign Generator</h2>

        <label>
          Campaign Brief
          <textarea
            rows="5"
            value={campaignBrief}
            onChange={(event) => setCampaignBrief(event.target.value)}
            placeholder="Describe what FlowFit should promote..."
          />
        </label>

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

        <button className="primary-button" onClick={generatePosts} disabled={generating}>
          {generating ? "Generating..." : "Generate Platform Posts"}
        </button>
      </section>

      <form className="panel form-stack" onSubmit={schedulePosts}>
        <h2>Edit & Schedule</h2>

        {PROVIDERS.filter((provider) => selectedProviders.includes(provider.id)).map((provider) => (
          <label key={provider.id}>
            {provider.label} Post
            <textarea
              rows="5"
              maxLength={provider.id === "X" ? 280 : 2800}
              value={variants[provider.id] || ""}
              onChange={(event) =>
                setVariants((current) => ({
                  ...current,
                  [provider.id]: event.target.value,
                }))
              }
            />
            <span className="hint">
              {(variants[provider.id] || "").length}/{provider.id === "X" ? 280 : 2800} characters
            </span>
          </label>
        ))}

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
          <button type="button" className="secondary-button" onClick={uploadSelectedMedia} disabled={uploading}>
            {uploading ? "Uploading..." : "Upload Media"}
          </button>

          <button type="submit" className="primary-button" disabled={loading}>
            {loading ? "Scheduling..." : "Schedule Selected Posts"}
          </button>
        </div>

        {mediaUrls.length > 0 && (
          <div className="media-preview">
            <strong>Uploaded media</strong>
            {mediaUrls.map((url) => (
              <a href={url} target="_blank" rel="noreferrer" key={url}>
                {url}
              </a>
            ))}
          </div>
        )}
      </form>

      <section className="panel posts-panel">
        <div className="section-header">
          <h2>Scheduled Posts</h2>
          <button className="secondary-button" onClick={loadPosts} disabled={loading}>
            Reload
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
                  <button type="button" className="danger-button" onClick={() => cancelPost(post.id)}>
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
