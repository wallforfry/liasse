-- The daily quota of new types is no longer a setting, and the pipeline section is a strict
-- object: a saved document that still holds it would no longer parse.
UPDATE "settings" SET "document" = "document" #- '{pipeline,max_new_types_per_day}'
WHERE "document" #> '{pipeline,max_new_types_per_day}' IS NOT NULL;
