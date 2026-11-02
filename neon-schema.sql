CREATE TABLE IF NOT EXISTS workspace_saves (
  id text PRIMARY KEY,
  snapshot jsonb NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
