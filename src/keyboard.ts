/**
 * Browsers reserve Command-N for a new window before page JavaScript can act.
 * The web runtime therefore advertises `C`; a native shell can map capture to
 * Command-N without changing the command model.
 */
export const CAPTURE_SHORTCUT = 'C'
