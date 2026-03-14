-- Add parent_comment_id for reply threading
ALTER TABLE public.comments
ADD COLUMN IF NOT EXISTS parent_comment_id uuid REFERENCES public.comments(id) ON DELETE CASCADE;
