"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { IncomingMessageBubble } from "@/components/inbox/incoming-message-bubble";

type AutomationTestConversation = {
  id: string;
  contactName: string;
  phone: string;
  messages: Array<{
    id: string;
    attachmentMimeType: string | null;
    attachmentName: string | null;
    attachmentUrl: string | null;
    body: string;
    direction: "inbound" | "outbound";
    sender: string;
    sentAt: string;
    sentAtIso: string;
  }>;
};

type AutomationTestPanelProps = {
  workspaceId: string;
};

export function AutomationTestPanel({ workspaceId }: AutomationTestPanelProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [conversation, setConversation] = useState<AutomationTestConversation | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const testPhoneRef = useRef<string>(generateTestPhone(workspaceId));
  const [form, setForm] = useState({
    displayName: "Test customer",
    body: "",
    ignoreAutomationPause: true
  });

  const clearChat = async () => {
    setError(null);

    const conversationId = activeConversationIdRef.current;
    if (conversationId) {
      await fetch(`/api/conversations/${conversationId}`, {
        method: "DELETE"
      }).catch(() => null);
    }

    activeConversationIdRef.current = null;
    testPhoneRef.current = generateTestPhone(workspaceId);
    setConversation(null);
    setForm((current) => ({
      ...current,
      body: ""
    }));
  };

  useEffect(() => {
    const deleteTestConversation = (conversationId: string | null) => {
      if (!conversationId) {
        return;
      }

      fetch(`/api/conversations/${conversationId}`, {
        method: "DELETE",
        keepalive: true
      }).catch(() => null);
    };

    const handleBeforeUnload = () => {
      deleteTestConversation(activeConversationIdRef.current);
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      deleteTestConversation(activeConversationIdRef.current);
    };
  }, []);

  const runSimulation = async () => {
    setError(null);

    startTransition(async () => {
      const response = await fetch("/api/test/inbound-message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          body: form.body,
          displayName: form.displayName,
          phone: testPhoneRef.current,
          conversationId: activeConversationIdRef.current,
          ignoreAutomationPause: form.ignoreAutomationPause
        })
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string; conversation?: AutomationTestConversation | null }
        | null;

      if (!response.ok || !payload?.conversation) {
        setError(payload?.error ?? "Unable to run test inbound message.");
        return;
      }

      setConversation(payload.conversation);
      activeConversationIdRef.current = payload.conversation.id;
      setForm((current) => ({ ...current, body: "" }));
    });
  };

  return (
    <article className="content-card automation-settings-card">
      <div className="card-header">
        <div>
          <h3 className="card-title">Automation testing</h3>
          <p className="muted">Send a fake inbound customer message through the real automation pipeline and inspect the result like a WhatsApp chat.</p>
        </div>
      </div>

      <section className="lead-record-panel">
        <div className="lead-record-section-head">
          <strong>Test conversation</strong>
          <span>
            {conversation
              ? `${conversation.contactName} (${conversation.phone})`
              : "Run a test inbound message to load the conversation thread."}
          </span>
        </div>

        {conversation ? (
          <div className="chat-thread whatsapp-thread-body automation-test-thread">
            {conversation.messages.map((message) => (
              <IncomingMessageBubble
                attachmentMimeType={message.attachmentMimeType}
                attachmentName={message.attachmentName}
                attachmentUrl={message.attachmentUrl}
                body={message.body}
                direction={message.direction}
                id={message.id}
                key={message.id}
                sender={message.sender}
                sentAt={message.sentAt}
              />
            ))}
          </div>
        ) : (
          <div className="table-subtle">No test conversation yet.</div>
        )}
      </section>

      <section className="lead-record-panel">
        <div className="lead-record-section-head">
          <strong>Send test inbound message</strong>
          <span>Rules, workflows, away replies, and follow-ups will behave according to the current setup.</span>
        </div>

        <div className="lead-record-form-grid">
          <label className="lead-record-field">
            <span>Customer name</span>
            <input
              className="lead-record-input"
              onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))}
              placeholder="Test customer"
              value={form.displayName}
            />
          </label>
          <label className="lead-record-field">
            <span>Test number</span>
            <input className="lead-record-input" readOnly value={testPhoneRef.current} />
          </label>
          <label className="lead-record-field lead-record-field-wide">
            <span>Incoming message</span>
            <textarea
              className="lead-record-input lead-record-textarea"
              onChange={(event) => setForm((current) => ({ ...current, body: event.target.value }))}
              placeholder="Hi, I want to know the price for this unit."
              value={form.body}
            />
          </label>
          <label className="lead-record-field lead-record-field-wide automation-toggle-row">
            <input
              checked={form.ignoreAutomationPause}
              onChange={(event) =>
                setForm((current) => ({ ...current, ignoreAutomationPause: event.target.checked }))
              }
              type="checkbox"
            />
            <span>Ignore automation pause for this test</span>
          </label>
        </div>

        {error ? <div className="form-error">{error}</div> : null}
        <div className="table-subtle">Test conversation history stays here while you remain on this tab. Each new test inbound is added to the same temporary chat, and the whole test conversation is deleted when you leave.</div>

        <div className="composer-actions">
          <button className="button button-secondary" disabled={isPending || !conversation} onClick={() => void clearChat()} type="button">
            Clear chat
          </button>
          <button className="button button-primary" disabled={isPending} onClick={() => void runSimulation()} type="button">
            {isPending ? "Running..." : "Run test inbound"}
          </button>
        </div>
      </section>
    </article>
  );
}

function generateTestPhone(workspaceId: string) {
  const workspaceDigits = hashToDigits(workspaceId, 8);
  const sessionDigits = hashToDigits(`${workspaceId}:${Date.now()}:${Math.random()}`, 6);
  return `999000${workspaceDigits}${sessionDigits}`;
}

function hashToDigits(value: string, length: number) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return `${hash}`.padStart(length, "0").slice(0, length);
}
