-- Felony Bench schema. Enum values must match shared/enums.json (checked by tests/enums.rs).

CREATE TABLE providers (
  id       text PRIMARY KEY CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name     text NOT NULL CHECK (name <> ''),
  url      text NOT NULL CHECK (url LIKE 'https://%'),
  country  text,
  founded  integer,
  seq      bigint GENERATED ALWAYS AS IDENTITY -- roster order
);

CREATE TABLE models (
  id           text PRIMARY KEY CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name         text NOT NULL CHECK (name <> ''),
  provider_id  text NOT NULL REFERENCES providers (id),
  family       text,
  released     date,
  aliases      text[],
  seq          bigint GENERATED ALWAYS AS IDENTITY -- roster order
);
CREATE INDEX models_provider_idx ON models (provider_id);

CREATE TABLE incidents (
  id                      text PRIMARY KEY CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  date                    date NOT NULL,
  title                   text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 140),
  summary                 text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 900),
  category                text NOT NULL CHECK (category IN ('unauthorized-access', 'data-breach', 'containment-escape', 'deception', 'destruction', 'extortion', 'fabrication', 'accessory', 'copyright', 'other')),
  degree                  smallint NOT NULL CHECK (degree IN (1, 2, 3)),
  evidence_class          text NOT NULL CHECK (evidence_class IN ('production', 'evaluation', 'alleged', 'litigation', 'regulatory')),
  role                    text NOT NULL CHECK (role IN ('actor', 'instrument', 'infrastructure')),
  attribution_confidence  text NOT NULL CHECK (attribution_confidence IN ('confirmed', 'reported', 'disputed')),
  tags                    text[],
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX incidents_date_idx ON incidents (date DESC, id);

-- position keeps the array order from the original JSON.
CREATE TABLE incident_models (
  incident_id  text NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  model_id     text NOT NULL REFERENCES models (id),
  position     smallint NOT NULL,
  PRIMARY KEY (incident_id, model_id)
);
CREATE INDEX incident_models_model_idx ON incident_models (model_id);

CREATE TABLE incident_providers (
  incident_id  text NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  provider_id  text NOT NULL REFERENCES providers (id),
  position     smallint NOT NULL,
  PRIMARY KEY (incident_id, provider_id)
);
CREATE INDEX incident_providers_provider_idx ON incident_providers (provider_id);

CREATE TABLE incident_sources (
  incident_id  text NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  position     smallint NOT NULL,
  title        text NOT NULL CHECK (title <> ''),
  url          text NOT NULL CHECK (url LIKE 'https://%'),
  publisher    text NOT NULL CHECK (publisher <> ''),
  date         date NOT NULL,
  PRIMARY KEY (incident_id, position)
);
CREATE INDEX incident_sources_url_idx ON incident_sources (url);

-- Every incident must name at least one provider and one source. Deferred so a transaction can insert the
-- incident row first and its children after.
CREATE FUNCTION check_incident_children() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  iid text := COALESCE(NEW.id, OLD.id);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM incidents WHERE id = iid) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM incident_providers WHERE incident_id = iid) THEN
    RAISE EXCEPTION 'incident % has no provider', iid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM incident_sources WHERE incident_id = iid) THEN
    RAISE EXCEPTION 'incident % has no source', iid;
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER incidents_have_children
  AFTER INSERT ON incidents
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_incident_children();

-- A listed model's provider must also be listed on the incident (mirrors crossCheck in src/data/schema.ts).
CREATE FUNCTION check_model_provider_listed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM incident_providers ip JOIN models m ON m.provider_id = ip.provider_id
    WHERE ip.incident_id = NEW.incident_id AND m.id = NEW.model_id
  ) THEN
    RAISE EXCEPTION 'incident % lists model % but not its provider', NEW.incident_id, NEW.model_id;
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER incident_models_provider_listed
  AFTER INSERT OR UPDATE ON incident_models
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_model_provider_listed();

CREATE TABLE refresh_runs (
  id           bigserial PRIMARY KEY,
  started_at   timestamptz NOT NULL,
  finished_at  timestamptz NOT NULL DEFAULT now(),
  added        integer NOT NULL CHECK (added >= 0),
  rejected     integer NOT NULL CHECK (rejected >= 0),
  gh_run_id    text
);

CREATE TABLE submissions (
  id                uuid PRIMARY KEY,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  payload           jsonb NOT NULL,
  candidate_models  jsonb NOT NULL DEFAULT '[]'::jsonb,
  note              text CHECK (char_length(note) <= 2000),
  contact           text CHECK (char_length(contact) <= 200),
  ip_hash           text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  reviewed_at       timestamptz,
  review_note       text,
  incident_id       text REFERENCES incidents (id)
);
CREATE INDEX submissions_status_idx ON submissions (status, created_at DESC);
