"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useConfirmation } from "@/components/confirmation-provider";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/toast-provider";
import type { QuickReplyRecord, QuickReplySummary } from "@/components/quick-reply-types";

type QuickReplyListProps = {
  categories: string[];
  quickReplies: QuickReplyRecord[];
  summary: QuickReplySummary;
};

export function QuickReplyList({ categories, quickReplies, summary }: QuickReplyListProps) {
  const router = useRouter();
  const { confirm } = useConfirmation();
  const { success, error: showError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [searchValue, setSearchValue] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const deleteRequestInFlight = useRef(false);

  const filteredReplies = useMemo(() => {
    const query = searchValue.trim().toLowerCase();

    return quickReplies.filter((item) => {
      if (selectedCategory !== "All" && item.category !== selectedCategory) {
        return false;
      }

      if (!query) {
        return true;
      }

      return [item.title, item.shortcut, item.category, item.body].join(" ").toLowerCase().includes(query);
    });
  }, [quickReplies, searchValue, selectedCategory]);

  const deleteReply = async (reply: QuickReplyRecord) => {
    if (deleteRequestInFlight.current) {
      return;
    }

    deleteRequestInFlight.current = true;
    const accepted = await confirm({
      title: `Delete “${reply.title}”?`,
      description: `This will remove ${reply.title} from the shared library.`,
      confirmLabel: "Delete reply",
      tone: "danger"
    });

    if (!accepted) {
      deleteRequestInFlight.current = false;
      return;
    }

    setDeletingId(reply.id);

    startTransition(async () => {
      try {
        const response = await fetch(`/api/quick-replies/${reply.id}`, {
          method: "DELETE"
        });
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;

        if (!response.ok) {
          showError("Quick reply not deleted", payload?.error ?? "Unable to delete quick reply.");
          return;
        }

        success("Quick reply deleted", `${reply.title} has been removed.`);
        router.refresh();
      } finally {
        deleteRequestInFlight.current = false;
        setDeletingId((current) => (current === reply.id ? null : current));
      }
    });
  };

  return (
    <section className="quick-replies-list-shell">
      <article className="content-card quick-replies-overview-band quick-reply-summary">
        <div className="quick-replies-overview-copy">
          <span className="quick-replies-overview-kicker">Quick reply library</span>
          <h2 className="card-title">Manage the team&apos;s saved replies from one clear list</h2>
          <p className="muted">
            Search, review, edit, and delete saved replies here. Open create or edit pages only when you need the full editor.
          </p>
        </div>
        <div className="quick-replies-overview-stats">
          <div className="quick-replies-overview-stat">
            <strong>{summary.total}</strong>
            <span>Saved replies</span>
          </div>
          <div className="quick-replies-overview-stat">
            <strong>{summary.categoriesInUse}</strong>
            <span>Categories in use</span>
          </div>
          <div className="quick-replies-overview-stat">
            <strong>{summary.withMedia}</strong>
            <span>With media</span>
          </div>
        </div>
      </article>

      <article className="content-card quick-replies-list-card quick-reply-library">
        <header className="quick-replies-list-card-head">
          <div>
            <h2 className="card-title">Reply library</h2>
            <p className="muted">This list is the saved quick-reply library. Use search and category filters to narrow it down.</p>
          </div>
          <a className="button button-secondary quick-replies-context-create" href="/quick-replies/new">
            Create New Quick Reply
          </a>
        </header>

        {quickReplies.length ? (
          <>
            <div className="quick-replies-library-tools quick-replies-list-tools quick-reply-toolbar">
              <div className="inbox-search-field quick-replies-search">
                <label className="visually-hidden" htmlFor="quick-replies-search">Search quick replies</label>
                <input
                  className="inbox-search-input"
                  id="quick-replies-search"
                  onChange={(event) => setSearchValue(event.target.value)}
                  placeholder="Search by title, shortcut, category, or reply content"
                  type="text"
                  value={searchValue}
                />
                {searchValue ? (
                  <button aria-label="Clear quick reply search" className="quick-replies-search-clear" onClick={() => setSearchValue("")} type="button">
                    Clear
                  </button>
                ) : null}
              </div>

              <div className="quick-replies-category-chips">
                {["All", ...categories].map((category) => (
                  <button
                    className={`inbox-search-tool${selectedCategory === category ? " active" : ""}`}
                    key={category}
                    onClick={() => setSelectedCategory(category)}
                    aria-pressed={selectedCategory === category}
                    type="button"
                  >
                    {category}
                  </button>
                ))}
              </div>
            </div>

            <div className="quick-replies-list-table-shell quick-reply-table-wrapper">
              <table className="quick-replies-list-table">
                <thead>
                  <tr>
                    <th scope="col">Title</th>
                    <th scope="col">Preview</th>
                    <th scope="col">Category</th>
                    <th scope="col">Shortcut</th>
                    <th scope="col">Created</th>
                    <th scope="col">Updated</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReplies.length ? (
                    filteredReplies.map((item) => {
                      const isDeleting = deletingId === item.id && isPending;

                      return (
                        <tr key={item.id}>
                          <td>
                            <div className="quick-replies-list-primary-cell">
                              <strong title={item.title}>{item.title}</strong>
                              {item.mediaAssetIds.length ? (
                                <span className="quick-replies-meta-badge">Media · {item.mediaAssetIds.length}</span>
                              ) : null}
                            </div>
                          </td>
                          <td><p className="quick-replies-list-preview" title={item.body}>{truncateReplyPreview(item.body) || "No reply content"}</p></td>
                          <td><span className="quick-replies-category-badge">{item.category || "—"}</span></td>
                          <td><code className="quick-replies-shortcut">{item.shortcut || "—"}</code></td>
                          <td><QuickReplyTimestamp value={item.createdAt} /></td>
                          <td><QuickReplyTimestamp value={item.updatedAt} /></td>
                          <td>
                            <div className="quick-replies-list-actions">
                              <a aria-label={`Edit ${item.title}`} className="button button-secondary" href={`/quick-replies/${item.id}/edit`}>
                                Edit
                              </a>
                              <Button aria-label={`Delete ${item.title}`} disabled={isPending} onClick={() => void deleteReply(item)} variant="danger">
                                {isDeleting ? "Deleting..." : "Delete"}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td className="quick-replies-list-empty-row" colSpan={7}>
                        No quick replies match the current filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="quick-replies-list-empty">
            <strong>No quick replies yet.</strong>
            <span>Create your first saved reply to start building the shared library.</span>
          </div>
        )}
      </article>
    </section>
  );
}

function truncateReplyPreview(value: string, maxLength = 120) {
  const normalized = value.trim().replace(/\s+/g, " ");

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function QuickReplyTimestamp({ value }: { value: string }) {
  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return <span className="quick-replies-timestamp">Not available</span>;
  }

  const date = new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeZone: "Asia/Kuala_Lumpur"
  }).format(new Date(timestamp));
  const time = new Intl.DateTimeFormat("en-MY", {
    timeStyle: "short",
    timeZone: "Asia/Kuala_Lumpur"
  }).format(new Date(timestamp));

  return <time className="quick-replies-timestamp" dateTime={value} title={new Date(timestamp).toISOString()}><span>{date}</span><span>{time}</span></time>;
}
