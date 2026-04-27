import Link from "next/link";
import { serverFetch } from "@/lib/server-api";

interface Message {
  id: string;
  role: "human" | "assistant";
  content: string;
  orderIdx: number;
  timestamp: string;
}

interface MessageListResponse {
  messages: Message[];
  total: number;
}

interface PageProps {
  params: Promise<{ projectId: string; sessionId: string }>;
}

export default async function TranscriptPage({ params }: PageProps) {
  const { projectId, sessionId } = await params;

  const data = await serverFetch<MessageListResponse>(
    `/api/projects/${projectId}/sessions/${sessionId}/messages`,
  );

  return (
    <div className="space-y-6">
      <header>
        <Link
          href={`/dashboard/${projectId}/sessions/${sessionId}`}
          className="text-sm text-muted hover:text-text"
        >
          ← Session detail
        </Link>
        <h1 className="text-2xl font-bold mt-2">대화 내역</h1>
        <p className="text-muted text-sm">{data.total}개 메시지</p>
      </header>

      {data.messages.length === 0 ? (
        <div className="bg-panel border rounded-lg p-8 text-center text-muted text-sm">
          저장된 대화 내역이 없습니다.
          <br />
          <span className="text-xs mt-1 block">
            Claude Code 세션 종료 시 자동으로 수집됩니다.
          </span>
        </div>
      ) : (
        <div className="space-y-3">
          {data.messages.map((msg) => (
            <div
              key={msg.id}
              className={`rounded-lg p-4 text-sm ${
                msg.role === "human"
                  ? "bg-blue-950/30 border border-blue-900/40"
                  : "bg-panel border"
              }`}
            >
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                  {msg.role === "human" ? "User" : "Assistant"}
                </span>
                <span className="text-xs text-muted">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
                {msg.content}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
