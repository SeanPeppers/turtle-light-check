// Lee County Land Development Code, Ch. 14, Art. II, Div. 2 (Sea Turtle Conservation)
// and the county's Sea Turtle Conservation page. Shown next to results and fed to Gemini.
export const LEE_RULES = [
  { code: 'LDC 14-73(a)(2)(a)', text: 'If your light casts a shadow on the beach, the county assumes it breaks the rules unless you prove otherwise.' },
  { code: 'LDC 14-76(d)', text: 'Outdoor lights need to be amber, orange or red, point down, and have the bulb fully covered.' },
  { code: 'LDC 14-72', text: '"Long wavelength" means 560 nm or higher: amber, orange or red. (The county website says 570 nm.) 25 W yellow bug bulbs are fine.' },
  { code: 'LDC 14-72', text: "\"Fully shielded\" means you can't see the bulb or the glowing lens from the beach." },
  { code: 'LDC 14-76(c)', text: 'Windows on new buildings must be tinted to let out 45% of indoor light or less.' },
  { code: 'LDC 14-79', text: 'Keep indoor light from spilling onto the beach. Close the blinds at night.' },
  { code: 'Lee County', text: 'Turn off decorative uplights on buildings and palm trees.' },
] as const

export const FWC_HOTLINE = '888-404-3922'

/** Nesting season: May 1 – Oct 31, rules apply 9:00 pm – 7:00 am (LDC 14-72). */
export function nestingStatus(now = new Date()) {
  const m = now.getMonth() // 0 = Jan
  const inSeason = m >= 4 && m <= 9
  const h = now.getHours()
  const inHours = h >= 21 || h < 7
  return {
    inSeason,
    active: inSeason && inHours,
    label: inSeason
      ? inHours
        ? "It's nesting season and it's after 9 pm, so beach-facing lights should be off or shielded right now."
        : "It's nesting season. The lighting rules kick in at 9 pm tonight."
      : "Nesting season is over for this year. It starts again May 1, and the rules apply 9 pm to 7 am.",
  }
}
