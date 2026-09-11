-- Public @username of a channel, when it has one — used in card captions
-- (see src/lib/captions.js) so posts can say "@yourchannel" instead of
-- always falling back to the bot's own handle. Null for private
-- channels/groups (no public username), which is the normal case, not an
-- error.
ALTER TABLE channels ADD COLUMN IF NOT EXISTS chat_handle TEXT;
