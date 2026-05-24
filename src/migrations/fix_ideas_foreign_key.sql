-- Drop any foreign key from ideas that references linkedin_tokens.
-- Ideas belong to the user account, not the LinkedIn connection.
DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN
    SELECT tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_name = tc.constraint_name
    JOIN information_schema.table_constraints ref_tc
      ON ref_tc.constraint_name = rc.unique_constraint_name
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'ideas'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND ref_tc.table_name = 'linkedin_tokens'
  LOOP
    EXECUTE 'ALTER TABLE public.ideas DROP CONSTRAINT ' || quote_ident(fk.constraint_name);
    RAISE NOTICE 'Dropped FK % from ideas -> linkedin_tokens', fk.constraint_name;
  END LOOP;
END $$;

-- Ensure ideas.user_id correctly references the user table (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
    JOIN information_schema.referential_constraints rc
      ON rc.constraint_name = tc.constraint_name
    JOIN information_schema.table_constraints ref_tc
      ON ref_tc.constraint_name = rc.unique_constraint_name
    WHERE tc.table_schema = 'public'
      AND tc.table_name = 'ideas'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND kcu.column_name = 'user_id'
      AND ref_tc.table_name = 'user'
  ) THEN
    ALTER TABLE public.ideas
      ADD CONSTRAINT ideas_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE;
    RAISE NOTICE 'Added ideas -> user FK';
  ELSE
    RAISE NOTICE 'ideas -> user FK already exists, skipping';
  END IF;
END $$;
