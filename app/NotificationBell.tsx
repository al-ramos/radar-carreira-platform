"use client";
import { useEffect, useState } from "react";

type Notification = {
  id: string;
  type: string;
  severity: "success" | "error" | "info";
  title: string;
  body: string;
  link: string | null;
  metadata: Record<string, unknown>;
  read: boolean;
  createdAt: string;
};

const ICON: Record<Notification["severity"], string> = { success: "✓", error: "!", info: "•" };

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days}d`;
}

/**
 * Sino de notificações no cabeçalho — histórico único de eventos
 * operacionais (hoje: importação concluída/falhou). Ver db/schema.ts
 * (tabela `notifications`) e lib/notifications.ts para o raciocínio de
 * por que não há segmentação por usuário: só a proprietária opera fontes
 * e importações, e a API já restringe a leitura a ela.
 */
export default function NotificationBell({ onOpenImportRun, onOpenTriageLog }: { onOpenImportRun?: (runId: string) => void; onOpenTriageLog?: (batchId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loaded, setLoaded] = useState(false);

  function applyLoad(data: { notifications: Notification[]; unread: number }) {
    setItems(data.notifications);
    setUnread(data.unread);
    setLoaded(true);
  }

  async function load() {
    const response = await fetch("/api/notifications");
    if (response.ok) applyLoad((await response.json()) as { notifications: Notification[]; unread: number });
  }

  useEffect(() => {
    fetch("/api/notifications")
      .then(async (r) => ({ ok: r.ok, data: await r.json() as { notifications: Notification[]; unread: number } }))
      .then(({ ok, data }) => { if (ok) applyLoad(data); });
    const interval = setInterval(() => void load(), 60_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleOutsideClick(event: MouseEvent) {
      if (!(event.target as Element).closest(".notification-bell-wrap")) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);

  async function markRead(id: string) {
    setItems((list) => list.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnread((n) => Math.max(0, n - 1));
    await fetch("/api/notifications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
  }

  async function markAllRead() {
    setItems((list) => list.map((n) => ({ ...n, read: true })));
    setUnread(0);
    await fetch("/api/notifications", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ all: true }) });
  }

  function openNotification(notification: Notification) {
    void markRead(notification.id);
    const runId = notification.type === "import" ? notification.metadata.runId : undefined;
    if (typeof runId === "string" && onOpenImportRun) onOpenImportRun(runId);
    const batchId = notification.type === "triage" ? notification.metadata.batchId : undefined;
    if (typeof batchId === "string" && onOpenTriageLog) onOpenTriageLog(batchId);
  }

  if (!loaded && !open) return null;

  return (
    <div className="notification-bell-wrap report-menu-wrap">
      <button
        type="button"
        className="icon-btn report-trigger notification-bell-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Notificações"
      >
        <span aria-hidden="true">🔔</span>
        {unread > 0 && <span className="notification-bell-badge">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="report-dropdown notification-bell-dropdown" role="menu" aria-label="Notificações">
          <div className="notification-bell-head">
            <strong>Notificações</strong>
            {unread > 0 && (
              <button type="button" onClick={() => void markAllRead()}>
                Marcar todas como lidas
              </button>
            )}
          </div>
          <div className="notification-bell-list">
            {items.length === 0 && <p className="notification-bell-empty">Nenhuma notificação ainda.</p>}
            {items.map((n) => {
              const canOpenReport = (n.type === "import" && typeof n.metadata.runId === "string") || (n.type === "triage" && typeof n.metadata.batchId === "string");
              return <article
                key={n.id}
                className={`${n.read ? "read " : ""}${canOpenReport ? "clickable" : ""}`}
                onClick={canOpenReport ? () => openNotification(n) : undefined}
                onKeyDown={canOpenReport ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openNotification(n);
                  }
                } : undefined}
                role={canOpenReport ? "button" : undefined}
                tabIndex={canOpenReport ? 0 : undefined}
              >
                <span className={`notification-bell-icon severity-${n.severity}`} aria-hidden="true">
                  {ICON[n.severity]}
                </span>
                <div>
                  <p className="notification-bell-title">{n.title}</p>
                  {n.body && <p className="notification-bell-body">{n.body}</p>}
                  {canOpenReport && <button
                    type="button"
                    className="notification-bell-report-link"
                    onClick={(event) => {
                      event.stopPropagation();
                      openNotification(n);
                    }}
                  >
                    Abrir log completo
                  </button>}
                  <small>{timeAgo(n.createdAt)}</small>
                </div>
                {!n.read && (
                  <button
                    type="button"
                    className="notification-bell-read-btn"
                    onClick={(event) => {
                      event.stopPropagation();
                      void markRead(n.id);
                    }}
                    aria-label="Marcar como lida"
                  >
                    ×
                  </button>
                )}
              </article>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}
