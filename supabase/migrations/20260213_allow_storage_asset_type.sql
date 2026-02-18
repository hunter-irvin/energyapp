alter table public.assets
  drop constraint if exists assets_asset_type_check,
  add constraint assets_asset_type_check
    check (asset_type in ('solar', 'wind', 'storage'));
