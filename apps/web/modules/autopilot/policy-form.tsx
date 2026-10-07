"use client";
import { useState, type FormEvent } from "react";
import { useSessionFetch } from "@/lib/hooks/use-session-fetch";
import type { AutopilotVM, PolicyFormValues } from "./view-model";

export function AutopilotPolicyForm({ vm }: { vm: AutopilotVM }) {
  const { sessionFetch, signedIn, address } = useSessionFetch();
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const policy = vm.policy;
  const editable =
    vm.policyEditable === true && signedIn && address?.toLowerCase() === vm.walletAddress;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editable || saving) return;
    const fields = new FormData(event.currentTarget);
    const values: PolicyFormValues = {
      killSwitch: fields.get("killSwitch") === "on",
      perTradeCap: String(fields.get("perTradeCap")),
      dailyCap: String(fields.get("dailyCap")),
      tokenAllowList: String(fields.get("tokenAllowList") ?? "")
        .split(/[,\s]+/)
        .filter(Boolean),
      armedRules: {
        ...(fields.get("pauseArmed") === "on"
          ? { paused: { longerThanHours: Number(fields.get("pauseHours")) } }
          : {}),
        ...(fields.get("gradeArmed") === "on"
          ? { "grade-drop": { atOrBelow: fields.get("grade") === "F" ? "F" : "D" } }
          : {}),
        ...(fields.get("stopArmed") === "on"
          ? { "price-threshold": { stopUsdPerShare: String(fields.get("stopUsd")) } }
          : {}),
      },
    };
    setSaving(true);
    try {
      const response = await sessionFetch("/api/session/autopilot/policy", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!response) {
        setStatus("A verified session is required to save the policy.");
        return;
      }
      if (response.ok) setStatus("Shadow policy saved. Nothing was executed.");
      else {
        const result: { error?: { message?: string } } = await response.json();
        setStatus(result.error?.message ?? "Policy could not be saved.");
      }
    } catch {
      console.warn("Autopilot policy form request failed; details withheld");
      setStatus("Policy could not be saved. Try again.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <form onSubmit={save} aria-label="Shadow policy">
      <h3>Shadow policy</h3>
      {!editable && <p>A verified wallet session is required to edit this policy.</p>}
      <fieldset disabled={!editable || saving}>
        <p>
          <label>
            <input name="killSwitch" type="checkbox" defaultChecked={policy?.killSwitch ?? true} />{" "}
            Kill switch
          </label>
        </p>
        <p>
          <label>
            Per-trade cap (USD, 6–{vm.caps.perTradeCeiling}){" "}
            <input
              name="perTradeCap"
              inputMode="decimal"
              defaultValue={policy?.perTradeCap ?? vm.caps.perTrade}
              required
            />
          </label>
        </p>
        <p>
          <label>
            Daily cap (USD, 6–{vm.caps.dailyCeiling}){" "}
            <input
              name="dailyCap"
              inputMode="decimal"
              defaultValue={policy?.dailyCap ?? vm.caps.daily}
              required
            />
          </label>
        </p>
        <p>
          <label>
            <input name="pauseArmed" type="checkbox" defaultChecked={!!policy?.armedRules.paused} />{" "}
            Arm pause rule
          </label>
        </p>
        <p>
          <label>
            Pause hours (1–720){" "}
            <input
              name="pauseHours"
              type="number"
              min={1}
              max={720}
              defaultValue={policy?.armedRules.paused?.longerThanHours ?? 1}
            />
          </label>
        </p>
        <p>
          <label>
            <input
              name="gradeArmed"
              type="checkbox"
              defaultChecked={!!policy?.armedRules["grade-drop"]}
            />{" "}
            Arm grade rule
          </label>
        </p>
        <p>
          <label>
            Grade at or below{" "}
            <select name="grade" defaultValue={policy?.armedRules["grade-drop"]?.atOrBelow ?? "D"}>
              <option>D</option>
              <option>F</option>
            </select>
          </label>
        </p>
        <p>
          <label>
            <input
              name="stopArmed"
              type="checkbox"
              defaultChecked={!!policy?.armedRules["price-threshold"]}
            />{" "}
            Arm regular-session stop
          </label>
        </p>
        <p>
          <label>
            Stop per share (USD){" "}
            <input
              name="stopUsd"
              inputMode="decimal"
              defaultValue={policy?.armedRules["price-threshold"]?.stopUsdPerShare ?? ""}
            />
          </label>
        </p>
        <p>
          <label>
            Allowed token addresses (up to 10, separated by spaces){" "}
            <textarea
              name="tokenAllowList"
              defaultValue={policy?.tokenAllowList.join("\n") ?? ""}
            />
          </label>
        </p>
        <button type="submit">{saving ? "Saving…" : "Save shadow policy"}</button>
      </fieldset>
      {status && <p role="status">{status}</p>}
    </form>
  );
}
