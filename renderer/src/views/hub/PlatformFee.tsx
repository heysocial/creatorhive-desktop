import { useId } from "react";
import { Plus } from "lucide-react";
import { TOO_MANY_DECIMALS, allDeals, feePlatforms, parseUsd, receivedUsd, usd2, usdInputValue, useDeals } from "../../lib/hub";

/*
  The platform's cut of a payment (Tara, Nov 18): Backstage, Fiverr and the
  like keep part of what the brand paid. Folded away behind "+ Add platform
  fee"; open, it asks which platform and how much, and says what she
  received. The deal or payment keeps its full amount; money in is less the fee.
  Used when a one-time deal is marked paid, in Edit deal's Payment section, and
  when a retainer payment is logged or edited.
*/

export interface FeeDraft { open: boolean; name: string; fee: string; had: boolean }

/** The fields as they start: open with the fee there is, folded when there's none. */
export function feeDraft(fee: number | null | undefined, name: string | null | undefined): FeeDraft {
  const has = fee != null && fee > 0;
  return { open: has, name: has ? name ?? "" : "", fee: has ? usdInputValue(fee) : "", had: has };
}

export const FEE_TOO_HIGH = "The platform fee can't be more than the amount paid.";

/**
 * What to send for the fee: both fields, or nulls to take one off that was
 * there, or nothing. An error in words when the fee isn't an amount or is more
 * than what was paid (`amount` null: not known yet, so not compared).
 */
export function feeBody(draft: FeeDraft, amount: number | null): { ok: true; body: { platform_fee_usd?: number | null; platform_fee_name?: string | null } } | { ok: false; error: string } {
  const text = draft.open ? draft.fee.trim() : "";
  if (!text) return { ok: true, body: draft.had ? { platform_fee_usd: null, platform_fee_name: null } : {} };
  const fee = parseUsd(text);
  if (fee === "decimals") return { ok: false, error: TOO_MANY_DECIMALS };
  if (fee === null) return { ok: false, error: "Type the platform fee like 50 or 12.50." };
  if (fee === 0) return { ok: true, body: draft.had ? { platform_fee_usd: null, platform_fee_name: null } : {} };
  if (amount !== null && fee > amount) return { ok: false, error: FEE_TOO_HIGH };
  return { ok: true, body: { platform_fee_usd: fee, platform_fee_name: draft.name.trim().slice(0, 60) || null } };
}

export function PlatformFeeFields({ amount, value, onChange }: { amount: number | null; value: FeeDraft; onChange: (next: FeeDraft) => void }) {
  const list = useId();
  const deals = useDeals().data;
  const suggestions = feePlatforms(allDeals(deals));
  if (!value.open) {
    return (
      <div className="fee-fold">
        <button type="button" className="link add" onClick={() => onChange({ ...value, open: true })}><Plus />Add platform fee</button>
      </div>
    );
  }
  const fee = parseUsd(value.fee);
  const feeNumber = typeof fee === "number" ? fee : null;
  const tooHigh = feeNumber !== null && amount !== null && feeNumber > amount;
  return (
    <div className="fee-block">
      <div className="fee-fields">
        <label className="fee-name">
          <span className="flabel">Platform</span>
          <input className="field" list={list} value={value.name} maxLength={60} placeholder="Backstage" aria-label="Platform"
            onChange={(e) => onChange({ ...value, name: e.target.value })} />
          <datalist id={list}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
        </label>
        <label className="fee-amount">
          <span className="flabel">Fee</span>
          <span className="fee-input"><i>$</i><input inputMode="decimal" value={value.fee} placeholder="0.00" aria-label="Platform fee" aria-invalid={tooHigh || fee === "decimals" || undefined}
            onChange={(e) => onChange({ ...value, fee: e.target.value.replace(/[^\d.,$\s]/g, "") })} /></span>
        </label>
      </div>
      <div className="fee-foot">
        {tooHigh ? <span className="form-error">{FEE_TOO_HIGH}</span>
          : fee === "decimals" ? <span className="form-error">{TOO_MANY_DECIMALS}</span>
          : amount !== null ? <span className="fee-received">You received <b>{usd2(receivedUsd(amount, feeNumber))}</b></span>
          : <span />}
        <button type="button" className="link add" onClick={() => onChange({ ...value, open: false, name: "", fee: "" })}>Remove fee</button>
      </div>
    </div>
  );
}
