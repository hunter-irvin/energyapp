"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

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

const DEFAULT_DURATION = 2;

const toNumber = (value: string) =>
  value.trim() === "" ? null : Number(value);

export default function NewAssetPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<AssetFormState>({
    name: "",
    zone_id: "",
    lat: "",
    lon: "",
    energy_mwh: "",
    duration_hours: DEFAULT_DURATION.toString(),
    power_mw: "",
    solar_mw: "0",
    wind_mw: "0",
    max_charge_mw: "",
    max_discharge_mw: "",
    round_trip_efficiency: "0.9",
    charge_efficiency: "0.95",
    discharge_efficiency: "0.95",
    min_soc_frac: "0.1",
    max_soc_frac: "0.9",
    initial_soc_frac: "0.5",
    poi_limit_mw: "",
  });

  const derivedPower = useMemo(() => {
    const energy = Number(form.energy_mwh);
    const duration = Number(form.duration_hours || DEFAULT_DURATION);
    if (!Number.isFinite(energy) || energy <= 0 || duration <= 0) {
      return "";
    }
    return (energy / duration).toFixed(2);
  }, [form.energy_mwh, form.duration_hours]);

  const handleChange = (field: keyof AssetFormState, value: string) => {
    setForm((prev) => {
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
    setSubmitting(true);
    setError(null);

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

    const { data, error } = await supabase
      .from("assets")
      .insert(payload)
      .select("id")
      .single();

    if (error) {
      setError(error.message);
      setSubmitting(false);
      return;
    }

    router.push(`/assets/${data.id}`);
  };

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <Link href="/assets">← Back to assets</Link>
      <h1>Create asset</h1>
      <p>Define the hybrid merchant asset and default constraints.</p>

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

        <button type="submit" disabled={submitting}>
          {submitting ? "Saving..." : "Save asset"}
        </button>
      </form>
    </main>
  );
}
