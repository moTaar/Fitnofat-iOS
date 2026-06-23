import { useEffect, useRef, useState } from "react";
import { Sparkles, Send, RotateCcw, AlertTriangle, ClipboardList } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

type ChatMsg = { role: "user" | "model"; content: string; suggestions?: string[] };

export function AiCoach() {
  const navigate = useNavigate();
  const generateProgram = useStore((s) => s.generateProgram);
  const profile = useStore((s) => s.profile);

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void startConversation(); }, []);

  useEffect(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 60);
  }, [messages, loading]);

  const startConversation = async () => {
    setMessages([]);
    setDone(false);
    setQuotaExceeded(false);
    setLoading(true);
    try {
      const reply = await api.aiChat([]);
      setMessages([{ role: "model", content: reply.text, suggestions: reply.suggestions }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("QUOTA_EXCEEDED")) setQuotaExceeded(true);
      else toast.error(msg || "Couldn't reach the AI coach.");
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const sendText = async (text: string) => {
    if (!text.trim() || loading || done || generating) return;
    const userMsg: ChatMsg = { role: "user", content: text.trim() };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const reply = await api.aiChat(next.map(({ role, content }) => ({ role, content })));
      const withReply: ChatMsg[] = [
        ...next,
        { role: "model", content: reply.text, suggestions: reply.suggestions },
      ];
      setMessages(withReply);

      if (reply.type === "done" && reply.profile) {
        setDone(true);
        setLoading(false);
        setGenerating(true);
        try {
          await generateProgram(reply.profile);
          toast.success("Your new program is ready!");
          navigate("/routines", { replace: true });
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Failed to save program.");
          setGenerating(false);
          setDone(false);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("QUOTA_EXCEEDED")) {
        setQuotaExceeded(true);
      } else {
        toast.error(msg || "AI error — please try again.");
        setMessages(next.slice(0, -1));
        setInput(text.trim());
      }
    } finally {
      if (!generating) setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  // The last model message is the only one that shows chips (avoids clutter).
  const lastModelIdx = [...messages].reverse().findIndex((m) => m.role === "model");
  const activeChipIdx = lastModelIdx === -1 ? -1 : messages.length - 1 - lastModelIdx;

  return (
    <div className="flex flex-col" style={{ height: "calc(100dvh - 120px)" }}>
      {/* Header */}
      <div className="flex items-center justify-between pb-3 pt-2">
        <div className="flex items-center gap-2">
          <div className="rounded-xl bg-primary/15 p-2 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold leading-tight tracking-tight">AI Coach</h1>
            <p className="text-xs text-muted-foreground">
              {profile?.name ? `Coaching ${profile.name}` : "Building your program"}
            </p>
          </div>
        </div>
        <button
          onClick={startConversation}
          disabled={loading || generating}
          className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-muted-foreground tap disabled:opacity-40"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Restart
        </button>
      </div>

      {/* Quota exceeded banner */}
      {quotaExceeded && (
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 mb-3">
          <div className="flex gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-500">Gemini quota exceeded</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Your API key has hit its free-tier limit. The chat is unavailable until the quota
                resets (usually a few hours). Use the quick form instead — it works offline too.
              </p>
            </div>
          </div>
          <Button onClick={() => navigate("/onboarding")} className="w-full">
            <ClipboardList className="h-4 w-4" />
            Use quick setup form
          </Button>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto no-scrollbar pb-2">
        {messages.length === 0 && loading && (
          <div className="flex justify-start">
            <TypingBubble />
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className="space-y-2">
            <div className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              {m.role === "model" && (
                <div className="mr-2 mt-1 shrink-0 self-end rounded-full bg-primary/15 p-1 text-primary">
                  <Sparkles className="h-3.5 w-3.5" />
                </div>
              )}
              <div
                className={cn(
                  "max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
                  m.role === "user"
                    ? "bg-primary text-primary-foreground rounded-tr-sm"
                    : "bg-card border border-border rounded-tl-sm"
                )}
              >
                {m.content}
              </div>
            </div>

            {/* Suggestion chips — only on the most recent model message */}
            {m.role === "model" && i === activeChipIdx && m.suggestions && !loading && !done && !generating && (
              <div className="ml-8 flex flex-wrap gap-2">
                {m.suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => sendText(s)}
                    className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary tap hover:bg-primary/20 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {loading && messages.length > 0 && (
          <div className="flex items-end justify-start gap-2">
            <div className="shrink-0 rounded-full bg-primary/15 p-1 text-primary">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <TypingBubble />
          </div>
        )}

        {generating && (
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-primary/30 bg-primary/10 p-4 text-sm font-medium text-primary">
            <Spinner className="h-4 w-4" />
            Building your personalized program…
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2 border-t border-border pt-3">
        <input
          ref={inputRef}
          className="flex-1 rounded-xl border border-input bg-background px-4 py-3 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          placeholder={done || generating ? "Program is being built…" : "Type or tap a suggestion…"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && void sendText(input)}
          disabled={loading || done || generating}
        />
        <Button
          size="lg"
          onClick={() => sendText(input)}
          disabled={!input.trim() || loading || done || generating}
          className="shrink-0 px-4"
        >
          <Send className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}

function TypingBubble() {
  return (
    <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-3">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  );
}
