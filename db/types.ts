export type Database = {
  public: {
    Tables: {
      assets: {
        Row: {
          id: string;
          name: string;
          zone_id: string;
          lat: number | null;
          lon: number | null;
          energy_mwh: number;
          duration_hours: number;
          power_mw: number;
          solar_mw: number;
          wind_mw: number;
          max_charge_mw: number;
          max_discharge_mw: number;
          min_soc_frac: number;
          max_soc_frac: number;
          initial_soc_frac: number;
          round_trip_efficiency: number;
          charge_efficiency: number;
          discharge_efficiency: number;
          poi_limit_mw: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          zone_id: string;
          lat?: number | null;
          lon?: number | null;
          energy_mwh: number;
          duration_hours?: number;
          power_mw: number;
          solar_mw?: number;
          wind_mw?: number;
          max_charge_mw: number;
          max_discharge_mw: number;
          min_soc_frac?: number;
          max_soc_frac?: number;
          initial_soc_frac?: number;
          round_trip_efficiency?: number;
          charge_efficiency?: number;
          discharge_efficiency?: number;
          poi_limit_mw?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          zone_id?: string;
          lat?: number | null;
          lon?: number | null;
          energy_mwh?: number;
          duration_hours?: number;
          power_mw?: number;
          solar_mw?: number;
          wind_mw?: number;
          max_charge_mw?: number;
          max_discharge_mw?: number;
          min_soc_frac?: number;
          max_soc_frac?: number;
          initial_soc_frac?: number;
          round_trip_efficiency?: number;
          charge_efficiency?: number;
          discharge_efficiency?: number;
          poi_limit_mw?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
  };
};
