"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Database } from "@/db/types";
import { getSupabaseClient } from "@/lib/supabaseClient";

export const dynamic = "force-dynamic";

type AssetFormState = {
  name: string;
  zone_id: string;
  lat: string;
  lon: string;
  energy_mwh: string;
  duration_hours: string;
  power_mw: string;
  solar_mw: string;
  wind_mw: string;
  max_charge_mw: string;
  max_discharge_mw: string;
  round_trip_efficiency: string;
  charge_efficiency: string;
  discharge_efficiency: string;
  min_soc_frac: string;
  max_soc_frac: string;
  initial_soc_frac: string;
  poi_limit_mw: string;
};

type AssetRecord = {
  name: string | null;
  zone_id: string | null;
  lat: number | null;
  lon: number | null;
  energy_mwh: number | null;
  duration_hours: number | null;
  power_mw: number | null;
  solar_mw: number | null;
  wind_mw: number | null;
  max_charge_mw: number | null;
  max_discharge_mw: number | null;
  round_trip_efficiency: number | null;
  charge_efficiency: number | null;
  discharge_efficiency: number | null;
  min_soc_frac: number | null;
  max_soc_frac: number | null;
  initial_soc_frac: number | null;
  poi_limit_mw: number | null;
};

const DEFAULT_DURATION = 2;

const toNumber = (value: string) =>
  value.trim() === "" ? null : Number(value);

export default function EditAssetPage() {
  const router = useRouter();
  const params = useParams();
  const assetId = params?.id as string;

  const [form, setForm] = useState<AssetFormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadAsset = async () => {
      setLoading(true);
      setError(null);
      const supabase = getSupabaseClient();
      if (!supabase) {
        setError(
          "Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
        );
        setForm(null);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("assets")
        .select("*")
        .eq("id", assetId)
        .single();

      if (error) {
        setError(error.message);
        setForm(null);
      } else if (data) {
        const asset = data as AssetRecord;
        setForm({
          name: asset.name ?? "",
          zone_id: asset.zone_id ?? "",
          lat: asset.lat?.toString() ?? "",
          lon: asset.lon?.toString() ?? "",
          energy_mwh: asset.energy_mwh?.toString() ?? "",
          duration_hours: asset.duration_hours?.toString() ?? "",
          power_mw: asset.power_mw?.toString() ?? "",
          solar_mw: asset.solar_mw?.toString() ?? "0",
          wind_mw: asset.wind_mw?.toString() ?? "0",
          max_charge_mw: asset.max_charge_mw?.toString() ?? "",
          max_discharge_mw: asset.max_discharge_mw?.toString() ?? "",
          round_trip_efficiency: asset.round_trip_efficiency?.toString() ?? "0.9",
          charge_efficiency: asset.charge_efficiency?.toString() ?? "0.95",
          discharge_efficiency: asset.discharge_efficiency?.toString() ?? "0.95",
          min_soc_frac: asset.min_soc_frac?.toString() ?? "0.1",
          max_soc_frac: asset.max_soc_frac?.toString() ?? "0.9",
          initial_soc_frac: asset.initial_soc_frac?.toString() ?? "0.5",
          poi_limit_mw: asset.poi_limit_mw?.toString() ?? "",
        });
      }
      setLoading(false);
    };

    if (assetId) {
      void loadAsset();
    }
  }, [assetId]);

  const derivedPower = useMemo(() => {
    if (!form) return "";
    const energy = Number(form.energy_mwh);
    const duration = Number(form.duration_hours || DEFAULT_DURATION);
    if (!Number.isFinite(energy) || energy <= 0 || duration <= 0) {
      return "";
    }
    return (energy / duration).toFixed(2);
  }, [form]);

  const handleChange = (field: keyof AssetFormState, value: string) => {
    if (!form) return;
    setForm((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [field]: value };
      if (field === "energy_mwh" || field === "duration_hours") {
        const energy = Number(
          field === "energy_mwh" ? value : prev.energy_mwh
        );
        const duration = Number(
          field === "duration_hours" ? value : prev.duration_hours
        );
        if (Number.isFinite(energy) && energy > 0 && duration > 0) {
          const power = (energy / duration).toFixed(2);
          next.power_mw = power;
          next.max_charge_mw = power;
          next.max_discharge_mw = power;
        }
      }
      return next;
    });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    setError(null);

    const supabase = getSupabaseClient();
    if (!supabase) {
      setError(
        "Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
      );
      setSaving(false);
      return;
    }

    const payload = {
      name: form.name,
      zone_id: form.zone_id,
      lat: toNumber(form.lat),
      lon: toNumber(form.lon),
      energy_mwh: Number(form.energy_mwh),
      duration_hours: Number(form.duration_hours || DEFAULT_DURATION),
      power_mw: Number(form.power_mw || derivedPower),
      solar_mw: Number(form.solar_mw || 0),
      wind_mw: Number(form.wind_mw || 0),
      max_charge_mw: Number(form.max_charge_mw || derivedPower),
      max_discharge_mw: Number(form.max_discharge_mw || derivedPower),
      round_trip_efficiency: Number(form.round_trip_efficiency || 0.9),
      charge_efficiency: Number(form.charge_efficiency || 0.95),
      discharge_efficiency: Number(form.discharge_efficiency || 0.95),
      min_soc_frac: Number(form.min_soc_frac || 0.1),
      max_soc_frac: Number(form.max_soc_frac || 0.9),
      initial_soc_frac: Number(form.initial_soc_frac || 0.5),
      poi_limit_mw: toNumber(form.poi_limit_mw),
    };

    const { error } = await supabase
      .from("assets")
      .update(payload as Database["public"]["Tables"]["assets"]["Update"])
      .eq("id", assetId);

    if (error) {
      setError(error.message);
      setSaving(false);
      return;
    }

    router.push("/assets");
  };

  const handleDelete = async () => {
    const confirmed = window.confirm(
      "Delete this asset? This cannot be undone."
    );
    if (!confirmed) return;

    const supabase = getSupabaseClient();
    if (!supabase) {
      setError(
        "Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
      );
      return;
    }

    const { error } = await supabase.from("assets").delete().eq("id", assetId);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/assets");
  };

  if (loading) {
    return (
      <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
        <p>Loading asset...</p>
      </main>
    );
  }

  if (!form) {
    return (
      <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
        <Link href="/assets">← Back to assets</Link>
        <p>Asset not found.</p>
      </main>
    );
  }

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <Link href="/assets">← Back to assets</Link>
      <h1>Edit asset</h1>
      <p>Update asset inputs and constraints.</p>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <form onSubmit={handleSubmit} style={{ maxWidth: 720 }}>
        <fieldset style={{ border: "1px solid #ddd", padding: "1rem" }}>
          <legend>Asset details</legend>
          <label>
            Asset name
            <input
              type="text"
              value={form.name}
              onChange={(event) => handleChange("name", event.target.value)}
              required
            />
          </label>
          <label>
            Zone
            <input
              type="text"
              value={form.zone_id}
              onChange={(event) => handleChange("zone_id", event.target.value)}
              required
            />
          </label>
          <label>
            Latitude (optional)
            <input
              type="number"
              step="any"
              value={form.lat}
              onChange={(event) => handleChange("lat", event.target.value)}
            />
          </label>
          <label>
            Longitude (optional)
            <input
              type="number"
              step="any"
              value={form.lon}
              onChange={(event) => handleChange("lon", event.target.value)}
            />
          </label>
        </fieldset>

        <fieldset style={{ border: "1px solid #ddd", padding: "1rem" }}>
          <legend>Battery sizing</legend>
          <label>
            Energy capacity (MWh)
            <input
              type="number"
              step="any"
              value={form.energy_mwh}
              onChange={(event) => handleChange("energy_mwh", event.target.value)}
              required
            />
          </label>
          <label>
            Duration (hours)
            <input
              type="number"
              step="any"
              value={form.duration_hours}
              onChange={(event) =>
                handleChange("duration_hours", event.target.value)
              }
              required
            />
          </label>
          <label>
            Power (MW)
            <input type="number" value={form.power_mw || derivedPower} readOnly />
          </label>
          <label>
            Max charge (MW)
            <input
              type="number"
              step="any"
              value={form.max_charge_mw || derivedPower}
              onChange={(event) =>
                handleChange("max_charge_mw", event.target.value)
              }
            />
          </label>
          <label>
            Max discharge (MW)
            <input
              type="number"
              step="any"
              value={form.max_discharge_mw || derivedPower}
              onChange={(event) =>
                handleChange("max_discharge_mw", event.target.value)
              }
            />
          </label>
        </fieldset>

        <fieldset style={{ border: "1px solid #ddd", padding: "1rem" }}>
          <legend>Renewables</legend>
          <label>
            Solar capacity (MW)
            <input
              type="number"
              step="any"
              value={form.solar_mw}
              onChange={(event) => handleChange("solar_mw", event.target.value)}
            />
          </label>
          <label>
            Wind capacity (MW)
            <input
              type="number"
              step="any"
              value={form.wind_mw}
              onChange={(event) => handleChange("wind_mw", event.target.value)}
            />
          </label>
        </fieldset>

        <fieldset style={{ border: "1px solid #ddd", padding: "1rem" }}>
          <legend>Efficiency & SOC</legend>
          <label>
            Round-trip efficiency
            <input
              type="number"
              step="0.01"
              value={form.round_trip_efficiency}
              onChange={(event) =>
                handleChange("round_trip_efficiency", event.target.value)
              }
            />
          </label>
          <label>
            Charge efficiency
            <input
              type="number"
              step="0.01"
              value={form.charge_efficiency}
              onChange={(event) =>
                handleChange("charge_efficiency", event.target.value)
              }
            />
          </label>
          <label>
            Discharge efficiency
            <input
              type="number"
              step="0.01"
              value={form.discharge_efficiency}
              onChange={(event) =>
                handleChange("discharge_efficiency", event.target.value)
              }
            />
          </label>
          <label>
            Min SOC fraction
            <input
              type="number"
              step="0.01"
              value={form.min_soc_frac}
              onChange={(event) =>
                handleChange("min_soc_frac", event.target.value)
              }
            />
          </label>
          <label>
            Max SOC fraction
            <input
              type="number"
              step="0.01"
              value={form.max_soc_frac}
              onChange={(event) =>
                handleChange("max_soc_frac", event.target.value)
              }
            />
          </label>
          <label>
            Initial SOC fraction
            <input
              type="number"
              step="0.01"
              value={form.initial_soc_frac}
              onChange={(event) =>
                handleChange("initial_soc_frac", event.target.value)
              }
            />
          </label>
        </fieldset>

        <fieldset style={{ border: "1px solid #ddd", padding: "1rem" }}>
          <legend>Grid limits</legend>
          <label>
            POI limit (MW)
            <input
              type="number"
              step="any"
              value={form.poi_limit_mw}
              onChange={(event) =>
                handleChange("poi_limit_mw", event.target.value)
              }
            />
          </label>
        </fieldset>

        <div style={{ display: "flex", gap: "1rem" }}>
          <button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Update asset"}
          </button>
          <button type="button" onClick={handleDelete}>
            Delete asset
          </button>
        </div>
      </form>
    </main>
  );
}
