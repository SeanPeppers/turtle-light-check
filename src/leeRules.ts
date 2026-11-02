// Lee County Land Development Code, Ch. 14, Art. II, Div. 2 (Sea Turtle Conservation)
// and the county's Sea Turtle Conservation page. Shown next to results and fed to Gemini.
export const LEE_RULES = [
  { code: 'LDC 14-73(a)(2)(a)', text: 'A shadow cast by artificial lighting on an object is a rebuttable presumption of a violation.' },
  { code: 'LDC 14-76(d)', text: 'Exterior fixtures must be long wavelength, downward directed, full cutoff, fully shielded.' },
  { code: 'LDC 14-72', text: 'Long wavelength = 560 nm or greater (amber, orange, red). The county page cites 570 nm; 25 W yellow bug bulbs allowed.' },
  { code: 'LDC 14-72', text: 'Fully shielded = the bulb, lamp or glowing lens is not directly visible.' },
  { code: 'LDC 14-76(c)', text: 'New construction glass: inside-to-outside light transmittance of 45% or less.' },
  { code: 'LDC 14-79', text: 'Minimize interior light from doors and windows within line of sight of the beach (close blinds).' },
  { code: 'Lee County', text: 'Turn off decorative uplighting on buildings and landscaping.' },
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
        ? 'Nesting season rules are in effect right now (9 pm – 7 am).'
        : 'Nesting season: rules apply tonight from 9 pm to 7 am.'
      : 'Off-season. Nesting season runs May 1 – Oct 31, 9 pm – 7 am.',
  }
}
