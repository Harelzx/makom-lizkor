-- Serving a public photo, a decision's cleanup and the sweep all look revisions up by the photo they name.
CREATE INDEX revisions_photo_key ON revisions(photo_key) WHERE photo_key IS NOT NULL;
