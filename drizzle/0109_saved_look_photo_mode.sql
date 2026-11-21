ALTER TABLE saved_looks ADD COLUMN use_profile_photo INTEGER CHECK (use_profile_photo IN (0, 1));
