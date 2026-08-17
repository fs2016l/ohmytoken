export const MAX_SEARCHABLE_SESSION_TITLE_LENGTH = 512
export const USAGE_SESSION_SEARCH_CONTENT_VIEW = 'usage_sessions_search_content_v12'

const MIN_CONVERSATION_SHAPED_TITLE_LENGTH = 160
const MAX_NORMAL_TITLE_LINE_BREAKS = 7

/**
 * Returns a SQLite expression that keeps human-sized titles searchable while
 * blanking scanner mistakes where a complete prompt or conversation became a title.
 * The original `usage_sessions.title` is never changed and remains available for display.
 */
export function searchableSessionTitleSql(columnExpression: string): string {
  const value = `COALESCE(${columnExpression}, '')`
  const lowerValue = `LOWER(${value})`
  const lineBreakCount = `(
    LENGTH(${value}) - LENGTH(REPLACE(${value}, CHAR(10), '')) +
    LENGTH(${value}) - LENGTH(REPLACE(${value}, CHAR(13), ''))
  )`
  const conversationMarkers = `(
    (${lowerValue} LIKE '%"role"%' AND ${lowerValue} LIKE '%"content"%')
    OR (${lowerValue} LIKE '%<user>%' AND ${lowerValue} LIKE '%<assistant>%')
    OR (
      ${lowerValue} LIKE '%user:%'
      AND ${lowerValue} LIKE '%assistant:%'
      AND ${lineBreakCount} >= 2
    )
  )`

  return `(CASE
    WHEN LENGTH(${value}) > ${MAX_SEARCHABLE_SESSION_TITLE_LENGTH} THEN ''
    WHEN LENGTH(${value}) > ${MIN_CONVERSATION_SHAPED_TITLE_LENGTH}
      AND ${lineBreakCount} > ${MAX_NORMAL_TITLE_LINE_BREAKS} THEN ''
    WHEN LENGTH(${value}) > ${MIN_CONVERSATION_SHAPED_TITLE_LENGTH}
      AND ${conversationMarkers} THEN ''
    ELSE TRIM(${value})
  END)`
}
