import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { HEY_SOCIAL_THEMES, refreshHs, saveHsSettings, useHsSidebar } from "../../lib/heysocial";

/*
  The Hey Social Inc. themes, as on the website's Preferences. One setting on
  the server, so the website and this Mac always agree. Each swatch shows the
  light or dark version, following the app.
*/
export function ThemePicker() {
  const data = useHsSidebar().data;
  const [error, setError] = useState<string | null>(null);
  const current = data?.theme ?? "classic";
  // Changed on the website meanwhile: read it again on opening, and on coming back to this window.
  // (The window's own focus event: the app's onFocus only reaches the main window.)
  useEffect(() => {
    void refreshHs();
    const refresh = () => void refreshHs();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  async function pick(id: string) {
    setError(null);
    try { await saveHsSettings({ theme: id }); }
    catch { setError("Couldn't save. Try again."); }
  }

  return (
    <>
      <div className="hs-themes" role="radiogroup" aria-label="Hey Social Inc. theme">
        {HEY_SOCIAL_THEMES.map((theme) => (
          <button key={theme.id} role="radio" aria-checked={current === theme.id} title={theme.description}
            className={`hs-theme ${current === theme.id ? "on" : ""}`} onClick={() => void pick(theme.id)}
            style={{
              "--l-top": theme.light.top, "--l-side": theme.light.side, "--l-text": theme.light.text, "--l-active": theme.light.activeBg,
              "--d-top": theme.dark.top, "--d-side": theme.dark.side, "--d-text": theme.dark.text, "--d-active": theme.dark.activeBg,
            } as React.CSSProperties}>
            <span className="sw">
              <b /><i /><i className="act" /><i />
              {current === theme.id ? <Check className="tick" /> : null}
            </span>
            {theme.name}
          </button>
        ))}
      </div>
      {error ? <p className="late-text">{error}</p> : null}
    </>
  );
}
