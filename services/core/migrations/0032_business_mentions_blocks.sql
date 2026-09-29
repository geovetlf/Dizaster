-- Mencionar y bloquear negocios (ADR 0054). Los handles son únicos entre personas y negocios, así que "@x" y
-- "/v1/blocks/x" siguen siendo inequívocos.
CREATE TABLE social.post_business_mentions (
  post_id      uuid NOT NULL REFERENCES social.posts(id),
  business_id  uuid NOT NULL REFERENCES social.business_profiles(id),
  PRIMARY KEY (post_id, business_id)
);
CREATE INDEX post_business_mentions_business_idx ON social.post_business_mentions (business_id);

CREATE TABLE social.business_blocks (
  blocker_profile_id  uuid NOT NULL REFERENCES social.profiles(id),
  business_id         uuid NOT NULL REFERENCES social.business_profiles(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_profile_id, business_id)
);
