import { useEffect, useRef, useState } from "react";
import { Sparkles, Send, RotateCcw, AlertTriangle, ClipboardList, Pencil, Check, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useStore } from "@/lib/store";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

type ChatMsg = { role: "user" | "model"; content: string; suggestions?: string[] };

const MIX_OPTIONS = ["Calisthenics", "Weightlifting", "Cardio", "Yoga / Pilates"];
const EQUIPMENT_MIX_OPTIONS = ["Bodyweight", "Dumbbells", "Resistance bands", "Kettlebells", "Barbell", "Cables / machines", "Pull-up bar", "Bench"];

const COACH_SUGGESTIONS = [
  "Log today's workout",
  "Adjust my routines",
  "Make my program harder",
  "Explain my current plan",
];

export function AiCoach({ embedded = false, onClose }: { embedded?: boolean; onClose?: () => void } = {}) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const generateProgram = useStore((s) => s.generateProgram);
  const applyProgramUpdate = useStore((s) => s.applyProgramUpdate);
  const receiveLoggedWorkout = useStore((s) => s.receiveLoggedWorkout);
  const onboarded = useStore((s) => s.onboarded);
  const profile = useStore((s) => s.profile);

  // Coach mode for onboarded users; onboarding interview otherwise (or when
  // explicitly restarted from Settings via ?restart=1).
  const coachMode = onboarded && params.get("restart") !== "1";

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [mixPicker, setMixPicker] = useState(false);
  const [mixSelected, setMixSelected] = useState<string[]>([]);
  const [mixOtherText, setMixOtherText] = useState("");
  const [equipMixPicker, setEquipMixPicker] = useState(false);
  const [equipMixSelected, setEquipMixSelected] = useState<string[]>([]);
  const [equipOtherText, setEquipOtherText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void startConversation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coachMode]);

  useEffect(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 60);
  }, [messages, loading]);

  const startConversation = async () => {
    setMessages([]);
    setDone(false);
    setQuotaExceeded(false);
    setInput("");

    if (coachMode) {
      // No API call — greet locally and offer quick actions. This avoids the
      // onboarding loop and saves quota for real requests.
      const name = profile?.name ? `, ${profile.name}` : "";
      setMessages([
        {
          role: "model",
          content: `Hey${name}! I'm your ForgeFit coach. Ask me anything about training, tell me how you'd like to tweak your routines, or just tell me what you did today (e.g. "1 hour biking and 5 tibetans") and I'll log it for you.`,
          suggestions: COACH_SUGGESTIONS,
        },
      ]);
      setTimeout(() => inputRef.current?.focus(), 100);
      return;
    }

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
    const next: ChatMsg[] = [...messages, { role: "user", content: text.trim() }];
    setMessages(next);
    setInput("");
    setLoading(true);
    const payload = next.map(({ role, content }) => ({ role, content }));

    try {
      if (coachMode) {
        const reply = await api.aiCoach(payload);
        if (reply.type === "update") {
          applyProgramUpdate(reply.program, reply.routines);
          toast.success("Routines updated!");
          setMessages([
            ...next,
            {
              role: "model",
              content: `${reply.text}\n\n${reply.program.summary ?? ""}`.trim(),
              suggestions: ["View my routines", "Tweak it further", "Explain the changes"],
            },
          ]);
        } else if (reply.type === "log") {
          receiveLoggedWorkout(reply.workout);
          toast.success("Workout logged!");
          const { exercises, durationSec } = reply.workout;
          const mins = Math.round(durationSec / 60);
          const recap = `${exercises.length} exercise${exercises.length === 1 ? "" : "s"}${
            mins > 0 ? ` · ~${mins} min` : ""
          }`;
          setMessages([
            ...next,
            {
              role: "model",
              content: `${reply.text}\n\nSaved to your history (${recap}).`.trim(),
              suggestions: ["View history", "Log another", "Anything else?"],
            },
          ]);
        } else {
          setMessages([...next, { role: "model", content: reply.text, suggestions: reply.suggestions }]);
        }
        return;
      }

      // Onboarding interview flow.
      const reply = await api.aiChat(payload);
      setMessages([...next, { role: "model", content: reply.text, suggestions: reply.suggestions }]);

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

  const startEdit = (i: number) => {
    setEditingIdx(i);
    setEditText(messages[i].content);
  };

  const cancelEdit = () => {
    setEditingIdx(null);
    setEditText("");
  };

  const confirmEdit = () => {
    if (editingIdx === null || !editText.trim()) return;
    const truncated = messages.slice(0, editingIdx);
    setMessages(truncated);
    setDone(false);
    setEditingIdx(null);
    void sendText(editText.trim());
  };

  const handleSuggestion = (s: string) => {
    if (s === "View my routines") {
      onClose?.();
      navigate("/routines");
      return;
    }
    if (s === "View history") {
      onClose?.();
      navigate("/history");
      return;
    }
    if (s === "Log another") {
      void sendText("I did another workout I want to log");
      return;
    }
    if (!coachMode && s === "Mixed") {
      setMixSelected([]);
      setMixPicker(true);
      return;
    }
    if (!coachMode && s === "Custom mix") {
      setEquipMixSelected([]);
      setEquipOtherText("");
      setEquipMixPicker(true);
      return;
    }
    void sendText(s);
  };

  const handleMixConfirm = () => {
    setMixPicker(false);
    const parts = [...mixSelected.filter((x) => x !== "Other")];
    if (mixSelected.includes("Other") && mixOtherText.trim()) {
      parts.push(mixOtherText.trim());
    }
    const label = parts.length > 0 ? `Mixed (${parts.join(", ")})` : "Mixed";
    setMixOtherText("");
    void sendText(label);
  };

  const handleEquipMixConfirm = () => {
    setEquipMixPicker(false);
    const custom = equipOtherText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const all = [...equipMixSelected, ...custom];
    const label = all.length > 0 ? `Custom mix (${all.join(", ")})` : "Custom mix";
    void sendText(label);
  };

  // Only the most recent model message shows chips.
  const lastModelIdx = [...messages].reverse().findIndex((m) => m.role === "model");
  const activeChipIdx = lastModelIdx === -1 ? -1 : messages.length - 1 - lastModelIdx;

  return (
    <div
      className={cn("flex flex-col", embedded && "h-full")}
      style={embedded ? undefined : { height: "calc(100dvh - 120px)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-3 pt-2">
        <div className="flex items-center gap-2">
          <div className="rounded-xl bg-primary/15 p-2 text-primary">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold leading-tight tracking-tight">AI Coach</h1>
            <p className="text-xs text-muted-foreground">
              {coachMode
                ? profile?.name
                  ? `Coaching ${profile.name}`
                  : "Ask anything · adjust routines"
                : "Building your program"}
            </p>
          </div>
        </div>
        <button
          onClick={startConversation}
          disabled={loading || generating}
          className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-medium text-muted-foreground tap disabled:opacity-40"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {coachMode ? "Reset chat" : "Restart"}
        </button>
      </div>

      {/* Quota exceeded banner */}
      {quotaExceeded && (
        <div className="mb-3 flex flex-col gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <div>
              <p className="font-semibold text-amber-500">Gemini quota exceeded</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Your API key has hit its limit. The chat is unavailable until the quota resets
                (usually a few hours).{" "}
                {coachMode
                  ? "You can still edit routines manually."
                  : "Use the quick form instead — it works offline too."}
              </p>
            </div>
          </div>
          {!coachMode && (
            <Button onClick={() => navigate("/onboarding")} className="w-full">
              <ClipboardList className="h-4 w-4" />
              Use quick setup form
            </Button>
          )}
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

              {m.role === "user" && editingIdx === i ? (
                /* ── inline edit mode ── */
                <div className="flex w-[85%] items-end gap-1.5">
                  <button
                    onClick={cancelEdit}
                    className="shrink-0 rounded-full p-1.5 text-muted-foreground tap hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                  <input
                    autoFocus
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) confirmEdit();
                      if (e.key === "Escape") cancelEdit();
                    }}
                    className="flex-1 rounded-2xl rounded-tr-sm bg-primary px-4 py-3 text-sm text-primary-foreground placeholder:text-primary-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary-foreground/40"
                  />
                  <button
                    onClick={confirmEdit}
                    disabled={!editText.trim()}
                    className="shrink-0 rounded-full bg-primary p-1.5 text-primary-foreground tap disabled:opacity-40"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                /* ── normal bubble ── */
                <div className={cn("flex items-end gap-1.5", m.role === "user" && "flex-row-reverse")}>
                  <div
                    className={cn(
                      "max-w-[78%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed",
                      m.role === "user"
                        ? "rounded-tr-sm bg-primary text-primary-foreground"
                        : "rounded-tl-sm border border-border bg-card"
                    )}
                  >
                    {m.content}
                  </div>
                  {m.role === "user" && !loading && !done && !generating && editingIdx === null && (
                    <button
                      onClick={() => startEdit(i)}
                      className="shrink-0 rounded-full p-1.5 text-muted-foreground/50 tap hover:text-muted-foreground"
                      title="Edit message"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Suggestion chips — only on the most recent model message */}
            {m.role === "model" &&
              i === activeChipIdx &&
              m.suggestions &&
              !loading &&
              !done &&
              !generating && (
                <div className="ml-8 flex flex-wrap gap-2">
                  {m.suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => handleSuggestion(s)}
                      className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary tap transition-colors hover:bg-primary/20"
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

      {/* Mix style picker */}
      {mixPicker && (
        <div className="mb-2 rounded-2xl border border-border bg-card p-4 space-y-3">
          <p className="text-sm font-semibold">Which styles do you want to mix?</p>
          <div className="flex flex-wrap gap-2">
            {[...MIX_OPTIONS, "Other"].map((opt) => {
              const checked = mixSelected.includes(opt);
              return (
                <button
                  key={opt}
                  onClick={() =>
                    setMixSelected((prev) =>
                      checked ? prev.filter((x) => x !== opt) : [...prev, opt]
                    )
                  }
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors tap",
                    checked
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                  )}
                >
                  {opt}
                </button>
              );
            })}
          </div>
          {mixSelected.includes("Other") && (
            <input
              autoFocus
              value={mixOtherText}
              onChange={(e) => setMixOtherText(e.target.value)}
              placeholder="e.g. Piloxing, CrossFit, Martial arts…"
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          )}
          <Button size="sm" className="w-full" onClick={handleMixConfirm}>
            Confirm selection
          </Button>
        </div>
      )}

      {/* Equipment mix picker */}
      {equipMixPicker && (
        <div className="mb-2 rounded-2xl border border-border bg-card p-4 space-y-3">
          <p className="text-sm font-semibold">Which equipment will you use?</p>
          <div className="flex flex-wrap gap-2">
            {EQUIPMENT_MIX_OPTIONS.map((opt) => {
              const checked = equipMixSelected.includes(opt);
              return (
                <button
                  key={opt}
                  onClick={() =>
                    setEquipMixSelected((prev) =>
                      checked ? prev.filter((x) => x !== opt) : [...prev, opt]
                    )
                  }
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors tap",
                    checked
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                  )}
                >
                  {opt}
                </button>
              );
            })}
            {/* Other chip — reveals a free-text input when active */}
            <button
              onClick={() =>
                setEquipMixSelected((prev) =>
                  prev.includes("Other") ? prev.filter((x) => x !== "Other") : [...prev, "Other"]
                )
              }
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors tap",
                equipMixSelected.includes("Other")
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
              )}
            >
              Other
            </button>
          </div>
          {equipMixSelected.includes("Other") && (
            <input
              autoFocus
              type="text"
              value={equipOtherText}
              onChange={(e) => setEquipOtherText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleEquipMixConfirm()}
              placeholder="e.g. TRX, Sandbag, Gymnastics rings"
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          )}
          <Button size="sm" className="w-full" onClick={handleEquipMixConfirm}>
            Confirm selection
          </Button>
        </div>
      )}

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
