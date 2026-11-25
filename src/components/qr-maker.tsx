import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { contrastRatio, isInverted, parseHex } from "@/lib/contrast";

const STORAGE_KEY = "qr-maker-v1";
const DEFAULT_TEXT = "https://example.com";
const DEFAULT_FG = "#111111";
const DEFAULT_BG = "#ffffff";
const SIZE_MIN = 128;
const SIZE_MAX = 1024;
const DEFAULT_SIZE = 320;

const LEVELS = [
  { id: "L", name: "Low", detail: "About 7% recovery. Smallest code." },
  { id: "M", name: "Medium", detail: "About 15% recovery. A good default." },
  { id: "Q", name: "Quartile", detail: "About 25% recovery. Tolerates damage." },
  { id: "H", name: "High", detail: "About 30% recovery. Largest code." },
] as const;

type Level = (typeof LEVELS)[number]["id"];

type Status =
  | { kind: "pending" }
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | { kind: "ok"; version: number; modules: number; pixels: number; png: string };

type QrApi = {
  create: (
    text: string,
    options?: { errorCorrectionLevel?: Level },
  ) => { version: number; modules: { size: number } };
  toCanvas: (
    canvas: HTMLCanvasElement,
    text: string,
    options?: {
      errorCorrectionLevel?: Level;
      margin?: number;
      width?: number;
      color?: { dark?: string; light?: string };
    },
  ) => Promise<HTMLCanvasElement>;
};

function isLevel(value: unknown): value is Level {
  return value === "L" || value === "M" || value === "Q" || value === "H";
}

function clampSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SIZE;
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(value)));
}

function contentKind(text: string): "Link" | "Text" | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return "Link";
  return "Text";
}

function linkHint(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || /^https?:\/\//i.test(trimmed)) return null;
  if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(trimmed)) {
    return "Add https:// if you want phones to open this as a link.";
  }
  return null;
}

function fileName(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || "qr-code"}.png`;
}

function friendlyError(error: unknown): string {
  const raw = error instanceof Error ? error.message : "";
  if (raw.includes("too big")) {
    return "That text is too long for this error correction level. Shorten it, or switch to Low.";
  }
  return "Could not build a code from that text.";
}

async function loadQr(): Promise<QrApi> {
  const mod = (await import("qrcode")) as unknown as QrApi & { default?: QrApi };
  if (typeof mod.toCanvas === "function") return mod;
  if (mod.default && typeof mod.default.toCanvas === "function") return mod.default;
  throw new Error("QR library failed to load");
}

function contrastCopy(foreground: string, background: string): {
  ratioLabel: string;
  verdict: string;
  note: string | null;
  tone: "muted" | "warn" | "danger";
} {
  const ratio = contrastRatio(foreground, background);
  const ratioLabel = `${ratio.toFixed(1)}:1`;
  if (ratio < 2) {
    return {
      ratioLabel,
      verdict: "Too close",
      note: "These colors are too similar. Scanners may not read the code.",
      tone: "danger",
    };
  }
  if (ratio < 3) {
    return {
      ratioLabel,
      verdict: "Low",
      note: "Contrast is low. Darker marks on a lighter ground scan more reliably.",
      tone: "warn",
    };
  }
  if (isInverted(foreground, background)) {
    return {
      ratioLabel,
      verdict: "Inverted",
      note: "Light marks on a dark ground. Many cameras read this; dark on light is safer.",
      tone: "warn",
    };
  }
  return { ratioLabel, verdict: "Strong", note: null, tone: "muted" };
}

export function QrMaker() {
  const [text, setText] = useState(DEFAULT_TEXT);
  const [fg, setFg] = useState(DEFAULT_FG);
  const [bg, setBg] = useState(DEFAULT_BG);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [sizeDraft, setSizeDraft] = useState(String(DEFAULT_SIZE));
  const [ec, setEc] = useState<Level>("M");
  const [hydrated, setHydrated] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "pending" });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as {
          text?: unknown;
          fg?: unknown;
          bg?: unknown;
          size?: unknown;
          ec?: unknown;
        };
        if (typeof saved.text === "string") setText(saved.text);
        if (typeof saved.fg === "string" && parseHex(saved.fg)) setFg(parseHex(saved.fg) as string);
        if (typeof saved.bg === "string" && parseHex(saved.bg)) setBg(parseHex(saved.bg) as string);
        if (typeof saved.size === "number") {
          const next = clampSize(saved.size);
          setSize(next);
          setSizeDraft(String(next));
        }
        if (isLevel(saved.ec)) setEc(saved.ec);
      }
    } catch {
      // Ignore unreadable preferences and keep the defaults.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ text, fg, bg, size, ec }));
  }, [hydrated, text, fg, bg, size, ec]);

  useEffect(() => {
    let cancelled = false;

    const trimmed = text.trim();
    if (!trimmed) {
      setStatus({ kind: "empty" });
      return;
    }

    void (async () => {
      try {
        const qr = await loadQr();
        if (cancelled) return;
        const created = qr.create(trimmed, { errorCorrectionLevel: ec });
        const canvas = document.createElement("canvas");
        await qr.toCanvas(canvas, trimmed, {
          errorCorrectionLevel: ec,
          width: size,
          margin: 4,
          color: { dark: fg, light: bg },
        });
        if (cancelled) return;
        setStatus({
          kind: "ok",
          version: created.version,
          modules: created.modules.size,
          pixels: canvas.width,
          png: canvas.toDataURL("image/png"),
        });
      } catch (error) {
        if (cancelled) return;
        setStatus({ kind: "error", message: friendlyError(error) });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [text, fg, bg, size, ec]);

  const kind = contentKind(text);
  const hint = linkHint(text);
  const contrast = contrastCopy(fg, bg);
  const ready = status.kind === "ok";

  function download() {
    if (status.kind !== "ok") return;
    const link = document.createElement("a");
    link.href = status.png;
    link.download = fileName(text);
    link.click();
  }

  function commitSize(raw: string) {
    const next = clampSize(Number(raw));
    setSize(next);
    setSizeDraft(String(next));
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex max-w-xl flex-col gap-3">
        <h1 className="font-display text-4xl leading-tight font-medium tracking-tight text-ink">
          QR code
        </h1>
        <p className="text-base text-muted">
          Type a link or any text. The preview updates as you go, then download a PNG.
        </p>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-5 rounded-xl border border-line bg-surface p-6 lg:sticky lg:top-6 lg:order-2">
          <div className="relative aspect-square w-full overflow-hidden rounded-md border border-line bg-paper">
            {status.kind === "ok" ? (
              <img
                src={status.png}
                alt={`QR code for ${text.trim().slice(0, 120)}`}
                className="qr-canvas"
              />
            ) : status.kind === "pending" ? null : (
              <p
                className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted"
                role="status"
              >
                {status.kind === "error" ? status.message : "Your code will show up here."}
              </p>
            )}
          </div>

          <p className="text-sm text-muted tabular-nums">
            {status.kind === "ok"
              ? `Version ${status.version} · ${status.modules}×${status.modules} modules · ${status.pixels}×${status.pixels} PNG`
              : status.kind === "error"
                ? status.message
                : "No code yet."}
          </p>

          <button
            type="button"
            className="press inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-accent-fg disabled:cursor-not-allowed disabled:opacity-40"
            onClick={download}
            disabled={!ready}
          >
            <Download className="size-4" aria-hidden="true" />
            Download PNG
          </button>
        </section>

        <form
          className="flex flex-col gap-6 rounded-xl border border-line bg-surface p-6 lg:order-1"
          onSubmit={(event) => event.preventDefault()}
        >
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="content" className="text-sm font-medium text-ink">
                Content
              </label>
              <button
                type="button"
                className="min-h-11 px-1 text-sm font-medium text-muted disabled:opacity-40"
                onClick={() => setText("")}
                disabled={text.length === 0}
              >
                Clear
              </button>
            </div>
            <textarea
              id="content"
              name="content"
              className="field"
              rows={4}
              value={text}
              spellCheck={false}
              autoComplete="off"
              placeholder="https:// or any text"
              onChange={(event) => setText(event.target.value)}
            />
            <p className="flex justify-between gap-3 text-sm text-muted">
              <span>{kind ?? "Waiting for text"}</span>
              <span className="tabular-nums">{text.length} characters</span>
            </p>
            {hint ? <p className="text-sm text-warn">{hint}</p> : null}
          </div>

          <div className="flex flex-col gap-3" role="group" aria-labelledby="colors-heading">
            <div className="flex items-center justify-between gap-3">
              <span id="colors-heading" className="text-sm font-medium text-ink">
                Colors
              </span>
              <button
                type="button"
                className="min-h-11 px-1 text-sm font-medium text-muted"
                onClick={() => {
                  setFg(DEFAULT_FG);
                  setBg(DEFAULT_BG);
                }}
              >
                Reset colors
              </button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <ColorField id="foreground" label="Foreground" value={fg} onChange={setFg} />
              <ColorField id="background" label="Background" value={bg} onChange={setBg} />
            </div>
            <p className="text-sm text-muted tabular-nums">
              Contrast {contrast.ratioLabel}
              <span className={contrast.tone === "muted" ? "" : contrast.tone === "warn" ? " text-warn" : " text-danger"}>
                {" "}
                · {contrast.verdict}
              </span>
            </p>
            {contrast.note ? (
              <p className={`text-sm ${contrast.tone === "danger" ? "text-danger" : "text-warn"}`} aria-live="polite">
                {contrast.note}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="size-number" className="text-sm font-medium text-ink">
                Size
              </label>
              <input
                id="size-number"
                className="field w-28 text-right tabular-nums"
                type="number"
                inputMode="numeric"
                min={SIZE_MIN}
                max={SIZE_MAX}
                step={1}
                value={sizeDraft}
                aria-describedby="size-help"
                onChange={(event) => {
                  const raw = event.target.value;
                  setSizeDraft(raw);
                  const next = Number(raw);
                  if (Number.isInteger(next) && next >= SIZE_MIN && next <= SIZE_MAX) {
                    setSize(next);
                  }
                }}
                onBlur={() => commitSize(sizeDraft)}
              />
            </div>
            <input
              id="size"
              className="size-range"
              type="range"
              min={SIZE_MIN}
              max={SIZE_MAX}
              step={8}
              value={size}
              aria-label="Size slider"
              aria-valuemin={SIZE_MIN}
              aria-valuemax={SIZE_MAX}
              aria-valuenow={size}
              aria-valuetext={`${size} pixels`}
              onChange={(event) => {
                const next = clampSize(Number(event.target.value));
                setSize(next);
                setSizeDraft(String(next));
              }}
            />
            <p id="size-help" className="text-sm text-muted">
              PNG edge length in pixels, from {SIZE_MIN} to {SIZE_MAX}. A quiet zone is included.
            </p>
          </div>

          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-medium text-ink">Error correction</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {LEVELS.map((level) => (
                <label
                  key={level.id}
                  className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-md border bg-paper p-3 ${
                    ec === level.id ? "border-accent" : "border-line"
                  }`}
                >
                  <input
                    className="mt-1 size-4 accent-accent"
                    type="radio"
                    name="error-correction"
                    value={level.id}
                    checked={ec === level.id}
                    onChange={() => setEc(level.id)}
                  />
                  <span>
                    <span className="block text-sm font-medium text-ink">{level.name}</span>
                    <span className="block text-sm text-muted">{level.detail}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </form>
      </div>

      <p className="text-sm text-muted">Nothing leaves this browser. The code is built on your device.</p>
    </main>
  );
}

function ColorField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`${id}-color`} className="text-sm font-medium text-ink">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={`${id}-color`}
          className="color-input"
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value.toLowerCase())}
        />
        <input
          id={`${id}-hex`}
          className="field font-medium tabular-nums"
          aria-label={`${label} hex`}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          maxLength={7}
          value={draft}
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            const parsed = parseHex(next);
            if (parsed) onChange(parsed);
          }}
          onBlur={() => setDraft(value)}
        />
      </div>
    </div>
  );
}
