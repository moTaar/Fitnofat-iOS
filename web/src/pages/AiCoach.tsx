import { useEffect, useRef, useState } from "react";
import {
  Sparkles, Send, RotateCcw, AlertTriangle, ClipboardList, Pencil, Check, X, ImagePlus,
  Dumbbell, HeartPulse, ShieldCheck,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useStore } from "@/lib/store";
import { api, ApiError } from "@/lib/api";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

type ChatImage = { mimeType: string; data: string };
type ChatMsg = {
  role: "user" | "model";
  content: string;
  suggestions?: string[];
  images?: ChatImage[];
  /** Health mode: the emergency screen fired on this turn. */
  urgent?: boolean;
  /** Health mode: which model answered, e.g. "medlm-medium (Vertex AI)". */
  model?: string;
};

// The coach chat has two desks. "training" is the original coach (programming,
// logging, routine edits); "health" routes to the medical model instead, with
// the athlete's medical record as context — a different backend, a different
// system prompt, and its own consent gate.
type CoachDesk = "training" | "health";

const MAX_IMAGES_PER_MESSAGE = 4;

// Downscale a picked photo to ≤1280px JPEG and return raw base64. Keeps chat
// payloads small (a phone photo would otherwise be 5–15MB of base64).
async function fileToChatImage(file: File): Promise<ChatImage> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => {
      URL.revokeObjectURL(url);
      resolve(el);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't read that image."));
    };
    el.src = url;
  });
  const MAX = 1280;
  const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't process that image.");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { mimeType: "image/jpeg", data: dataUrl.slice(dataUrl.indexOf(",") + 1) };
}

const MIX_OPTIONS = ["Calisthenics", "Weightlifting", "Cardio", "Yoga / Pilates"];
const EQUIPMENT_MIX_OPTIONS = ["Bodyweight", "Dumbbells", "Resistance bands", "Kettlebells", "Barbell", "Cables / machines", "Pull-up bar", "Bench"];

const COACH_SUGGESTIONS = [
  "Log today's workout",
  "📷 Log from a photo",
  "Adjust my routines",
  "Make my program harder",
  "Explain my current plan",
];

const HEALTH_SUGGESTIONS = [
  "Something hurts",
  "Review my diet",
  "📷 Read my lab results",
  "What should I cut out?",
  "What should I be working on?",
];

// Map a thrown API error to the reason the AI is offline, or null if it's an
// ordinary (retryable) error. "unavailable" = server has no Gemini key;
// "quota" = key is rate-limited. Both route the user to the manual setup form.
function aiErrorReason(e: unknown): "quota" | "unavailable" | null {
  const msg = e instanceof Error ? e.message : "";
  if (msg.includes("QUOTA_EXCEEDED")) return "quota";
  if (msg.includes("AI_UNAVAILABLE")) return "unavailable";
  return null;
}

export function AiCoach({ embedded = false, onClose }: { embedded?: boolean; onClose?: () => void } = {}) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const generateProgram = useStore((s) => s.generateProgram);
  const applyProgramUpdate = useStore((s) => s.applyProgramUpdate);
  const receiveLoggedWorkout = useStore((s) => s.receiveLoggedWorkout);
  const onboarded = useStore((s) => s.onboarded);
  const profile = useStore((s) => s.profile);
  const health = useStore((s) => s.health);
  const medicalAi = useStore((s) => s.medicalAi);
  const loadHealth = useStore((s) => s.loadHealth);
  const setHealthConsent = useStore((s) => s.setHealthConsent);
  const receiveHealthIssue = useStore((s) => s.receiveHealthIssue);
  const receiveHealthRecord = useStore((s) => s.receiveHealthRecord);
  const receiveHealthRules = useStore((s) => s.receiveHealthRules);

  // Coach mode for onboarded users; onboarding interview otherwise (or when
  // explicitly restarted from Settings via ?restart=1).
  const coachMode = onboarded && params.get("restart") !== "1";

  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [generating, setGenerating] = useState(false);
  // Why the AI is offline, if it is: "quota" (rate-limited) or "unavailable"
  // (no server key). Both fall back to the manual quick-setup form.
  const [aiError, setAiError] = useState<null | "quota" | "unavailable">(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [mixPicker, setMixPicker] = useState(false);
  const [mixSelected, setMixSelected] = useState<string[]>([]);
  const [mixOtherText, setMixOtherText] = useState("");
  const [equipMixPicker, setEquipMixPicker] = useState(false);
  const [equipMixSelected, setEquipMixSelected] = useState<string[]>([]);
  const [equipOtherText, setEquipOtherText] = useState("");
  // Photos staged for the next message (coach mode only).
  const [pendingImages, setPendingImages] = useState<ChatImage[]>([]);
  // Which desk is answering. Only meaningful in coach mode — the onboarding
  // interview has no health desk.
  const [desk, setDesk] = useState<CoachDesk>("training");
  // Set when the health desk refuses for want of consent, so the chat can offer
  // the opt-in inline instead of sending the user to another screen.
  const [needsConsent, setNeedsConsent] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void startConversation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coachMode, desk]);

  // The health desk needs to know whether consent has been given before the
  // first message, so the opt-in can be shown up front rather than as an error.
  useEffect(() => {
    if (desk === "health") void loadHealth();
  }, [desk, loadHealth]);

  useEffect(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 60);
  }, [messages, loading]);

  const startConversation = async () => {
    setMessages([]);
    setDone(false);
    setAiError(null);
    setInput("");
    setPendingImages([]);

    setNeedsConsent(false);

    if (coachMode && desk === "health") {
      // Local greeting again — no quota spent just to say hello.
      const name = profile?.name ? `, ${profile.name}` : "";
      setMessages([
        {
          role: "model",
          content: `Health desk${name}. I'm your nutritionist and medical helper: ask me about your diet, a symptom, a medication interaction, or a lab result, and I'll answer against your own medical record. Anything worth fixing I'll add to your Medical dashboard so you can actually track it. You can attach a photo 📷 of a lab report or a medication label too.\n\nI don't diagnose or prescribe — for anything new or worrying, see a clinician.`,
          suggestions: HEALTH_SUGGESTIONS,
        },
      ]);
      setTimeout(() => inputRef.current?.focus(), 100);
      return;
    }

    if (coachMode) {
      // No API call — greet locally and offer quick actions. This avoids the
      // onboarding loop and saves quota for real requests.
      const name = profile?.name ? `, ${profile.name}` : "";
      setMessages([
        {
          role: "model",
          content: `Hey${name}! I'm your Fitnofat coach. Ask me anything about training, tell me how you'd like to tweak your routines, or just tell me what you did today (e.g. "1 hour biking and 5 tibetans" or "40 km outdoor ride") and I'll log it for you. You can also attach a photo 📷 — a screenshot from another fitness app, a cardio machine's display, or a machine you don't know the name of — and I'll read it and log or explain it.`,
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
      const reason = aiErrorReason(e);
      if (reason) setAiError(reason);
      else toast.error((e instanceof Error && e.message) || "Couldn't reach the AI coach.");
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const sendText = async (text: string) => {
    const images = coachMode ? pendingImages : [];
    if ((!text.trim() && images.length === 0) || loading || done || generating) return;
    const userMsg: ChatMsg = {
      role: "user",
      content: text.trim(),
      ...(images.length ? { images } : {}),
    };
    const next: ChatMsg[] = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setPendingImages([]);
    setLoading(true);
    const payload = next.map(({ role, content, images: imgs }) => ({
      role,
      content,
      ...(imgs?.length ? { images: imgs } : {}),
    }));

    try {
      if (coachMode && desk === "health") {
        const reply = await api.medicalChat(payload);
        const base: ChatMsg = {
          role: "model",
          content: reply.text,
          urgent: reply.urgent,
          model: reply.model,
        };

        // Rules can accompany any reply type, so they're merged before the
        // type-specific handling below.
        if (reply.rules?.length) {
          receiveHealthRules(reply.rules);
          toast.success(
            reply.rules.length === 1
              ? `Added to your list: ${reply.rules[0].subject}`
              : `${reply.rules.length} rules added to your list`
          );
        }

        if (reply.type === "issue") {
          receiveHealthIssue(reply.issue);
          toast.success(`Tracking "${reply.issue.title}"`);
          setMessages([
            ...next,
            { ...base, suggestions: ["Open my Medical tab", "Add a detail", "Anything else?"] },
          ]);
        } else if (reply.type === "record") {
          receiveHealthRecord(reply.record);
          toast.success("Added to your medical history");
          setMessages([
            ...next,
            { ...base, suggestions: ["Open my Medical tab", "Log something else", "What should I watch?"] },
          ]);
        } else {
          setMessages([
            ...next,
            {
              ...base,
              suggestions:
                reply.rules?.length && !reply.suggestions?.length
                  ? ["Open my Medical tab", "Why that rule?", "Anything else?"]
                  : reply.suggestions,
            },
          ]);
        }
        return;
      }

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
      // The health desk refuses until the user has opted in — that's a prompt,
      // not an error, so it gets its own inline card rather than a red toast.
      if (e instanceof ApiError && e.code === "medical_consent_required") {
        setNeedsConsent(true);
        setMessages(next.slice(0, -1));
        setInput(text.trim());
        return;
      }
      const reason = aiErrorReason(e);
      if (reason) {
        setAiError(reason);
      } else {
        toast.error((e instanceof Error && e.message) || "AI error — please try again.");
        setMessages(next.slice(0, -1));
        setInput(text.trim());
        if (images.length) setPendingImages(images);
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
    if (s === "📷 Log from a photo" || s === "📷 Read my lab results") {
      fileInputRef.current?.click();
      return;
    }
    if (s === "Open my Medical tab") {
      onClose?.();
      navigate("/health");
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

  const handlePickImages = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const picked = await Promise.all([...files].map(fileToChatImage));
      setPendingImages((prev) => {
        const all = [...prev, ...picked];
        if (all.length > MAX_IMAGES_PER_MESSAGE) {
          toast.error(`Up to ${MAX_IMAGES_PER_MESSAGE} photos per message.`);
        }
        return all.slice(0, MAX_IMAGES_PER_MESSAGE);
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't read that image.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
      inputRef.current?.focus();
    }
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
            {coachMode && desk === "health" ? (
              <HeartPulse className="h-5 w-5" />
            ) : (
              <Sparkles className="h-5 w-5" />
            )}
          </div>
          <div>
            <h1 className="text-lg font-extrabold leading-tight tracking-tight">
              {coachMode && desk === "health" ? "Health desk" : "AI Coach"}
            </h1>
            <p className="text-xs text-muted-foreground">
              {!coachMode
                ? "Building your program"
                : desk === "health"
                  ? medicalAi?.model
                    ? `Nutritionist + medical · ${medicalAi.model}`
                    : "Nutritionist + medical helper"
                  : profile?.name
                    ? `Coaching ${profile.name}`
                    : "Ask anything · adjust routines"}
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

      {/* Desk switch. Two different models with two different system prompts, so
          switching starts a fresh conversation rather than carrying context over. */}
      {coachMode && (
        <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-secondary p-1">
          {([
            ["training", "Training", Dumbbell],
            ["health", "Health", HeartPulse],
          ] as [CoachDesk, string, typeof Dumbbell][]).map(([value, label, Icon]) => (
            <button
              key={value}
              onClick={() => !loading && setDesk(value)}
              disabled={loading || generating}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold tap disabled:opacity-50",
                desk === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Consent prompt — the health desk sends medical data to a model, so it
          asks first, right where the user hit it. */}
      {coachMode && desk === "health" && (needsConsent || (health && !health.aiConsentAt)) && (
        <div className="mb-3 flex flex-col gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <div>
              <p className="font-semibold text-amber-500">Turn on AI health analysis</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Your medical record lives in your own database. To answer health questions it has to
                be sent to {medicalAi?.model ?? "the medical model"} for the length of the request.
                Nothing is sent until you allow it, and you can turn it off again from the Medical
                tab.
              </p>
            </div>
          </div>
          <Button
            onClick={async () => {
              try {
                await setHealthConsent(true);
                setNeedsConsent(false);
                toast.success("AI health analysis is on.");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Couldn't save that.");
              }
            }}
            className="w-full"
          >
            Allow and continue
          </Button>
        </div>
      )}

      {/* AI offline banner — quota-exceeded or no server key configured. */}
      {aiError && (
        <div className="mb-3 flex flex-col gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <div>
              <p className="font-semibold text-amber-500">
                {aiError === "quota" ? "Gemini quota exceeded" : "AI coach unavailable"}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {aiError === "quota"
                  ? "Your API key has hit its limit. The chat is unavailable until the quota resets (usually a few hours). "
                  : "The AI coach isn't set up on the server right now. "}
                {coachMode
                  ? "You can still edit routines manually."
                  : "Use the quick setup form instead — it works without AI."}
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
                        : m.urgent
                          // The emergency screen fired on this reply — it must not
                          // look like an ordinary chat bubble.
                          ? "rounded-tl-sm border border-destructive/50 bg-destructive/10"
                          : "rounded-tl-sm border border-border bg-card"
                    )}
                  >
                    {m.images && m.images.length > 0 && (
                      <div className={cn("flex flex-wrap gap-1.5", m.content && "mb-2")}>
                        {m.images.map((img, j) => (
                          <img
                            key={j}
                            src={`data:${img.mimeType};base64,${img.data}`}
                            alt="Attached photo"
                            className="h-28 w-28 rounded-lg object-cover"
                          />
                        ))}
                      </div>
                    )}
                    {m.content}
                    {m.model && (
                      <span className="mt-2 block text-[10px] text-muted-foreground">
                        {m.model} · not a diagnosis
                      </span>
                    )}
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

      {/* Pending photo previews (coach mode) */}
      {pendingImages.length > 0 && (
        <div className="flex gap-2 pt-2">
          {pendingImages.map((img, i) => (
            <div key={i} className="relative">
              <img
                src={`data:${img.mimeType};base64,${img.data}`}
                alt="Photo to send"
                className="h-16 w-16 rounded-xl border border-border object-cover"
              />
              <button
                onClick={() => setPendingImages((prev) => prev.filter((_, j) => j !== i))}
                className="absolute -right-1.5 -top-1.5 rounded-full border border-border bg-secondary p-0.5 text-muted-foreground tap"
                title="Remove photo"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2 border-t border-border pt-3">
        {coachMode && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => void handlePickImages(e.target.files)}
            />
            <Button
              size="lg"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading || done || generating}
              className="shrink-0 px-3"
              title="Attach a photo — app screenshot, machine display, or a machine you don't know"
            >
              <ImagePlus className="h-5 w-5" />
            </Button>
          </>
        )}
        <input
          ref={inputRef}
          className="flex-1 rounded-xl border border-input bg-background px-4 py-3 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          placeholder={
            done || generating
              ? "Program is being built…"
              : pendingImages.length > 0
                ? "Add a note, or just send the photo…"
                : coachMode && desk === "health"
                  ? "Ask about your diet, a symptom, a lab result…"
                  : "Type or tap a suggestion…"
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && void sendText(input)}
          disabled={loading || done || generating}
        />
        <Button
          size="lg"
          onClick={() => sendText(input)}
          disabled={(!input.trim() && pendingImages.length === 0) || loading || done || generating}
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
