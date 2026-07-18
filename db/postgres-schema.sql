CREATE TABLE IF NOT EXISTS people (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 80),
  normalized_name text NOT NULL,
  edit_token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS people_normalized_name_idx
  ON people (normalized_name text_pattern_ops);

CREATE TABLE IF NOT EXISTS person_player_links (
  person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  player_id bigint NOT NULL CHECK (player_id > 0),
  position smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, player_id)
);

CREATE INDEX IF NOT EXISTS person_player_links_player_idx
  ON person_player_links (player_id);
