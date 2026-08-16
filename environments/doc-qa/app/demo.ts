// Demo documents — seeded on first boot so the bot answers something fun
// immediately, before the owner adds their own. Original factual content (no
// licensing issues). Replace these with your own docs from the owner console;
// clearing them is one click (or DELETE /api/docs).
//
// Kept deliberately small + factual so citations are crisp and easy to verify.

export const DEMO_TOPIC = "the Solar System";

export const DEMO_DOCS: Array<{ name: string; text: string }> = [
  {
    name: "Solar System — the planets.md",
    text: `# The planets

The Solar System has eight planets orbiting the Sun. In order from the Sun:
Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, and Neptune.

The four inner planets (Mercury, Venus, Earth, Mars) are small and rocky. The
four outer planets (Jupiter, Saturn, Uranus, Neptune) are gas and ice giants,
far larger than the rocky worlds.

## A day and a year on each world

A "day" is how long a planet takes to spin once; a "year" is one orbit of the Sun.

- Mercury: a day lasts about 59 Earth days; a year is only 88 Earth days — so a
  day on Mercury is longer than a large fraction of its year.
- Venus spins backwards and very slowly: a single day on Venus (about 243 Earth
  days) is longer than its year (about 225 Earth days).
- Mars has a day close to Earth's — about 24 hours and 37 minutes — and a year of
  about 687 Earth days.
- Jupiter spins fastest of all the planets: a day is under 10 hours, despite it
  being the largest planet.

Pluto is not counted among the eight planets. In 2006 it was reclassified as a
"dwarf planet."`,
  },
  {
    name: "Solar System — Jupiter and Saturn.md",
    text: `# The giants: Jupiter and Saturn

## Jupiter

Jupiter is the largest planet in the Solar System — more than twice as massive as
all the other planets combined. It is a gas giant made mostly of hydrogen and
helium, with no solid surface to stand on.

The Great Red Spot is a giant storm on Jupiter, wider than the whole Earth. It
has been observed for more than 150 years and may have raged far longer.

Jupiter has dozens of moons. The four largest — Io, Europa, Ganymede, and
Callisto — are called the Galilean moons because Galileo discovered them in 1610.
Ganymede is the largest moon in the Solar System, bigger even than the planet
Mercury.

## Saturn

Saturn is famous for its bright, wide rings, which are made almost entirely of
countless pieces of ice and rock, ranging from dust-sized grains to boulders.
Although the rings look solid from afar, they are extremely thin.

Saturn is the least dense planet — its average density is lower than water, so in
a big enough ocean, Saturn would float.`,
  },
  {
    name: "Solar System — the Sun and the Moon.md",
    text: `# The Sun and the Moon

## The Sun

The Sun is the star at the center of the Solar System. It contains about 99.8% of
all the mass in the Solar System. It is a ball of hot plasma that produces energy
by nuclear fusion, fusing hydrogen into helium in its core.

Light from the Sun takes about 8 minutes and 20 seconds to reach Earth. That
means when you look at the Sun, you see it as it was about eight minutes ago.

## The Moon

The Moon is Earth's only natural satellite. It is about 384,000 kilometers away on
average. The same side of the Moon always faces Earth, because the Moon rotates
once for each orbit it makes — a situation called "tidal locking." This is why we
never see the far side of the Moon from Earth without a spacecraft.

The Moon's gravity is the main cause of ocean tides on Earth.`,
  },
];
