-- ADR 0134: una persona moderadora toma un caso por un tiempo; nadie más actúa sobre él mientras tanto.
ALTER TABLE moderation.cases ADD COLUMN claimed_by uuid, ADD COLUMN claimed_until timestamptz;
