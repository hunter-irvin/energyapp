"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";

export const dynamic = "force-dynamic";

type Asset = {
  id: string;
  name: string;
  zone_id: string;
  energy_mwh: number;
  power_mw: number;
  solar_mw: number;
  wind_mw: number;
};

export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAssets = async () => {
    setLoading(true);
    setError(null);
    const supabase = getSupabaseClient();
    if (!supabase) {
      setError(
        "Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
      );
      setAssets([]);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("assets")
      .select("id,name,zone_id,energy_mwh,power_mw,solar_mw,wind_mw")
      .order("created_at", { ascending: false });

    if (error) {
      setError(error.message);
      setAssets([]);
    } else {
      setAssets((data ?? []) as Asset[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    void loadAssets();
  }, []);

  const handleDelete = async (id: string) => {
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

    const { error } = await supabase.from("assets").delete().eq("id", id);
    if (error) {
      setError(error.message);
      return;
    }
    await loadAssets();
  };

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <header style={{ display: "flex", justifyContent: "space-between" }}>
        <div>
          <h1>Assets</h1>
          <p>Manage hybrid merchant assets for day-ahead optimization.</p>
        </div>
        <Link href="/assets/new">Create asset</Link>
      </header>

      {loading && <p>Loading assets...</p>}
      {error && (
        <p style={{ color: "crimson" }}>Error loading assets: {error}</p>
      )}

      {!loading && assets.length === 0 && (
        <p>No assets yet. Create your first asset to get started.</p>
      )}

      {assets.length > 0 && (
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            marginTop: "1rem",
          }}
        >
          <thead>
            <tr>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                Name
              </th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                Zone
              </th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                Energy (MWh)
              </th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                Power (MW)
              </th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                Solar/Wind (MW)
              </th>
              <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => (
              <tr key={asset.id}>
                <td style={{ padding: "0.5rem 0" }}>{asset.name}</td>
                <td>{asset.zone_id}</td>
                <td>{asset.energy_mwh}</td>
                <td>{asset.power_mw}</td>
                <td>
                  {asset.solar_mw} / {asset.wind_mw}
                </td>
                <td>
                  <Link href={`/assets/${asset.id}`}>Edit</Link>
                  <button
                    type="button"
                    onClick={() => handleDelete(asset.id)}
                    style={{ marginLeft: "0.75rem" }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
