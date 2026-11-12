# Equipment and upgrade research

Collected 2026-11-12 as raw material for upgrades and add-ons. Sources are real
reactor physics, particle accelerators, and reactor-themed games. Game details
are from memory unless marked *confirmed* (checked against a source below).

## What we are protecting

Energy comes from mass in flight, not mass at rest. A particle earns by how far
and how fast it travels, and the player is always choosing between spending
mass on shots and holding it to meet requirements.

## Agreed direction

- Cores sit on rails. Further apart means less instability and longer, more
  valuable flights.
- Equipment is installed on a core (or later, on the link between two cores)
  instead of upgrades applying by magic.
- Energy is the only currency for now. Later: several currencies, and exotics
  that can only be made inside the reactor.
- Heat is held back. It is the core loop of every other game in the genre, and
  mass already plays that role here.

## On a core: reactivity

| Trope | Where it is from | What it could do here |
|---|---|---|
| Reflector | Real reactors; IndustrialCraft 2 (boosts adjacent fuel, wears faster the more fuel it touches — *confirmed*) | Raises a core's instability regardless of distance; wears out with use |
| Control rods | Real reactors (rod speed is deliberately limited — *confirmed*) | Per-core dial that lowers instability; moves slowly; a scram drops them all |
| Burnable poison | Real: boron, gadolinium; burns off faster than the fuel (*confirmed*) | Consumable that keeps a core quiet for a set number of emissions |
| Chemical shim | Real: boron dissolved evenly through the coolant (*confirmed*) | One facility-wide stability dial that affects every core equally |
| Startup source | Real reactors | Guaranteed trickle of emissions, so a far-out stable core is never dead |
| Moderator | Real; NuclearCraft uses graphite and beryllium next to cells (*confirmed*) | Makes arriving particles count for more: bigger mass gain, or a chance to trigger an emission |
| Plating | IndustrialCraft 2 (raises heat capacity — *confirmed*) | Raises how much mass a core can hold before gains taper |
| Xenon poisoning | Real; Nucleares models it (*confirmed*) | A core that has run hard goes sluggish for a while; rewards steady running over bursts |
| Feedback coefficient | Real: negative in most designs, positive void coefficient in RBMK | Core types: one calms as it grows, one runs away as it grows |
| Temperature-scaled fuel | IndustrialCraft 2 MOX: output rises with hull heat (*confirmed*) | A core type that pays more the fuller it is |
| Breeding blanket | Real reactors | Catches particles that leave the ring and turns them into new mass |

## On a link: flight

| Trope | Where it is from | What it could do here |
|---|---|---|
| Accelerating cavity | Accelerators | Speeds particles on that link |
| Focusing magnet | Accelerators | Tighter beam: more of the particle's mass arrives |
| Storage ring | Accelerators | Particle does laps before landing: more energy per shot, mass tied up longer |
| Kicker | Accelerators (used for extraction — *confirmed*) | Redirects shots to a different core by rule; this is how the ring gets rewired |
| Collimator | Accelerators (intercepts stray particles — *confirmed*) | Only lets through particles above or below a size; the rest is dumped |
| Beam dump | Accelerators (absorbs the full beam — *confirmed*) | A safe sink for excess mass |
| Undulator | Light sources | Particles shed light in flight; converts energy income into a second resource |
| Detector | Accelerators | A core's numbers are hidden until it is instrumented |

## Around the room and the facility

| Trope | Where it is from | What it could do here |
|---|---|---|
| Heat and cooling | Reactor Incremental, IndustrialCraft 2: vents, exchangers, finite heat sinks that need refilling | A second pressure alongside mass |
| Meltdown | IndustrialCraft 2, Reactor Incremental | Soft failure: a scram and downtime rather than losing the run |
| Turbines and storage | Most reactor games | Caps on power delivered and energy banked |
| Prestige particles | Reactor Incremental: prestige grants exotic particles that unlock components (*confirmed*) | Decommissioning a generator yields the material for next-generation equipment |
| Automation | Reactor Incremental, Factorio | Emitters and rods driven by rules the player sets |
| Loads | The original's unused "Energy output", "Plan" and "PC Room" | Things that want steady power and give something back: lab, fabricator, control room |

## Order of work

1. Rails, reflector, control rods, burnable poison, startup source. All act on
   one variable (instability), so they are cheap to build and to balance
   against each other.
2. Link equipment. It works on path length and flight time, which no reactor
   game has.
3. Loads and the facility around the generator.

## Sources

- Reactor Incremental: https://kongregate.com/yue-hk/games/Cael/reactor-incremental
- Reactor Knockoff: https://cwmonkey.github.io/reactor-knockoff
- IC2 Nuclear Reactor: https://wiki.industrial-craft.net/index.php/Nuclear_Reactor
- IC2 reactor components: https://ftbwiki.org/Nuclear_Reactor_Components
- IC2 MOX fuel rod: https://ftb.fandom.com/wiki/Fuel_Rod_(MOX)
- IC2 reactor system thread: https://forum.industrial-craft.net/thread/7643-new-reactor-system/
- NuclearCraft wiki: https://www.9minecraft.net/nuclearcraft-mod/wiki/
- Nucleares developer blog, xenon: https://nuclearesgame.blogspot.com/2024/02/chemical-module-xenon-generation-and.html
- Britannica, reactor types: https://www.britannica.com/technology/nuclear-reactor/Thermal-intermediate-and-fast-reactors
- Britannica, fuel types and control: https://www.britannica.com/technology/nuclear-reactor/Fuel-types
- nuclear-power.com, reactor power control: https://www.nuclear-power.com/nuclear-power/reactor-physics/reactor-operation/normal-operation-reactor-control/reactor-power-control
- Accelerator subsystems lecture: https://indico.fysik.su.se/event/854/contributions/10693/attachments/4415/5119/vz-4-subsystems.pdf
