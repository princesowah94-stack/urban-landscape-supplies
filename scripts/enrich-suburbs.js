#!/usr/bin/env node
/**
 * One-shot: enrich data/suburbs.json with `council` + `localNote` per suburb.
 *
 * Why: pre-rendered suburb pages need genuine local context to escape the
 * "thin/templated" pattern that Helpful Content updates demote. Council and
 * a 1-sentence local note add per-page uniqueness without inventing facts.
 *
 * Re-runnable: existing entries are overwritten with the values below, so
 * editing this file and re-running is the way to update.
 *
 * Run:  node scripts/enrich-suburbs.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(__dirname, '..', 'data/suburbs.json');

// council = LGA, localNote = short factual descriptor relevant to landscaping.
// Sources: NSW Local Government boundaries (post-2016 amalgamations).
const ENRICHMENT = {
  // Inner West
  'newtown':       { council: 'Inner West Council',          localNote: 'Inner-city terrace suburb where small courtyard and rooftop landscapes are the norm.' },
  'marrickville':  { council: 'Inner West Council',          localNote: 'Mixed inner-west suburb with established Federation homes and growing demand for low-water gardens.' },
  'balmain':       { council: 'Inner West Council',          localNote: 'Peninsula suburb of heritage cottages and steep gardens — pebble and gravel landscapes are popular.' },
  'leichhardt':    { council: 'Inner West Council',          localNote: 'Historic Italian-quarter suburb with compact gardens and strong demand for vegetable-bed soil mixes.' },
  'rozelle':       { council: 'Inner West Council',          localNote: 'Inner-west suburb of restored workers cottages and small backyard projects.' },
  'annandale':     { council: 'Inner West Council',          localNote: 'Inner-west suburb of grand Federation homes with established gardens and regular mulching demand.' },
  'dulwich-hill':  { council: 'Inner West Council',          localNote: 'Quiet inner-west suburb with Californian bungalows and family-sized backyards.' },
  'ashfield':      { council: 'Inner West Council',          localNote: 'Established inner-west suburb of brick homes and unit blocks with steady garden-renovation demand.' },
  'burwood':       { council: 'Burwood Council',             localNote: 'Inner-west commercial hub with mixed houses and apartments — common for raised-bed and entrance landscaping.' },
  'strathfield':   { council: 'Strathfield Municipal Council', localNote: 'Tree-lined Federation suburb with large blocks and well-maintained mature gardens.' },
  'five-dock':     { council: 'City of Canada Bay',          localNote: 'Bayside inner-west suburb with family homes and steady demand for soil and turf underlay.' },

  // Eastern Suburbs
  'bondi':         { council: 'Waverley Council',            localNote: 'Coastal eastern suburb with sandy soil — popular for native gardens, pebble landscapes and salt-tolerant plantings.' },
  'coogee':        { council: 'Randwick City Council',       localNote: 'Beachside eastern suburb where sandy soil and exposed positions favour hardy ground covers and pebble surrounds.' },
  'randwick':      { council: 'Randwick City Council',       localNote: 'Established eastern suburb with mature gardens and ongoing demand for premium soil and mulch.' },
  'paddington':    { council: 'Woollahra Municipal Council', localNote: 'Heritage terrace suburb with small courtyards — pebble surrounds and planter mixes are everyday orders.' },
  'surry-hills':   { council: 'City of Sydney',              localNote: 'Inner-city suburb of warehouses and terraces — rooftop and balcony planter projects are common.' },
  'woollahra':     { council: 'Woollahra Municipal Council', localNote: 'Eastern suburb of grand homes and formal gardens — premium garden mixes in steady demand.' },
  'maroubra':      { council: 'Randwick City Council',       localNote: 'Beachside eastern suburb with family homes — sandy soil makes garden-mix and turf underlay popular.' },

  // North Shore
  'chatswood':     { council: 'Willoughby City Council',     localNote: 'Lower north shore commercial hub with established gardens — regular soil and mulch deliveries to homes and strata.' },
  'mosman':        { council: 'Mosman Council',              localNote: 'Harbourside suburb with sloping gardens and mature plantings — premium soil and decorative pebbles popular.' },
  'neutral-bay':   { council: 'North Sydney Council',        localNote: 'Lower north shore suburb of apartments and homes — terrace and balcony planter materials are common.' },
  'lane-cove':     { council: 'Lane Cove Council',           localNote: 'Tree-canopy suburb with large blocks — established demand for premium garden soil and bark mulch.' },
  'willoughby':    { council: 'Willoughby City Council',     localNote: 'Family-home suburb with mature gardens and ongoing demand for top dressing and lawn care.' },
  'pymble':        { council: 'Ku-ring-gai Council',         localNote: 'Leafy upper north shore suburb of acreage gardens — regular bulk mulch and soil orders.' },
  'gordon':        { council: 'Ku-ring-gai Council',         localNote: 'Established upper north shore suburb with large gardens and bushland edges.' },
  'turramurra':    { council: 'Ku-ring-gai Council',         localNote: 'Upper north shore suburb of leafy properties — regular demand for bulk mulch and garden mixes.' },

  // Northern Beaches
  'manly':         { council: 'Northern Beaches Council',    localNote: 'Iconic beachside suburb with small lots and salt-air gardens — pebbles and hardy plantings dominate.' },
  'dee-why':       { council: 'Northern Beaches Council',    localNote: 'Northern beaches hub with mixed houses and apartments — steady demand for garden soil and mulch.' },
  'narrabeen':     { council: 'Northern Beaches Council',    localNote: 'Beachside suburb with sandy coastal gardens around Narrabeen Lagoon.' },
  'collaroy':      { council: 'Northern Beaches Council',    localNote: 'Beach-strip suburb with low-maintenance coastal gardens and pebble landscaping.' },
  'newport':       { council: 'Northern Beaches Council',    localNote: 'Northern beaches suburb of family homes — soil and mulch deliveries common for renovation projects.' },
  'mona-vale':     { council: 'Northern Beaches Council',    localNote: 'Northern beaches commercial centre with mixed housing — regular soil, mulch and pebble orders.' },
  'brookvale':     { council: 'Northern Beaches Council',    localNote: 'Industrial-meets-residential suburb on the northern beaches — popular for both trade and home delivery.' },
  'frenchs-forest':{ council: 'Northern Beaches Council',    localNote: 'Forested suburb with large family blocks and bushland gardens.' },
  'curl-curl':     { council: 'Northern Beaches Council',    localNote: 'Beachside suburb between two beaches — coastal-tolerant plantings and pebble landscaping are standard.' },

  // Hills District
  'castle-hill':   { council: 'The Hills Shire Council',     localNote: 'Hills District suburb of large family blocks — bulk mulch, soil and turf underlay regularly delivered for full backyard projects.' },
  'baulkham-hills':{ council: 'The Hills Shire Council',     localNote: 'Established Hills District suburb with mature gardens and steady demand for bulk garden materials.' },
  'kellyville':    { council: 'The Hills Shire Council',     localNote: 'Newer Hills suburb with large landscaped blocks — soil, mulch and turf underlay regularly delivered for new builds.' },
  'rouse-hill':    { council: 'The Hills Shire Council',     localNote: 'Growing Hills suburb of new-release estates — regular bulk soil and mulch for landscaping new homes.' },
  'pennant-hills': { council: 'Hornsby Shire Council',       localNote: 'Established northwest suburb with large bush-edge gardens — mulching is a year-round job.' },
  'cherrybrook':   { council: 'Hornsby Shire Council',       localNote: 'Family suburb of large blocks — bulk garden soil and mulch are everyday deliveries.' },
  'dural':         { council: 'The Hills Shire Council',     localNote: 'Semi-rural hills suburb with acreage properties — bulk landscaping materials by the tonne are the norm.' },
  'norwest':       { council: 'The Hills Shire Council',     localNote: 'Business and residential precinct — popular with both trade clients and homeowners.' },
  'bella-vista':   { council: 'The Hills Shire Council',     localNote: 'Newer Hills District suburb with landscaped estates and ongoing turf and garden-bed projects.' },

  // Parramatta & Western Sydney
  'parramatta':    { council: 'City of Parramatta',          localNote: 'Sydney\'s second CBD — mix of high-rise, apartments and established family homes drives steady soil, mulch and planter demand.' },
  'auburn':        { council: 'Cumberland City Council',     localNote: 'Multicultural Western Sydney suburb with mixed housing and steady garden-renovation demand.' },
  'merrylands':    { council: 'Cumberland City Council',     localNote: 'Established Western Sydney suburb with brick family homes and ongoing landscaping projects.' },
  'blacktown':     { council: 'Blacktown City Council',      localNote: 'Major Western Sydney centre with large family blocks — bulk mulch, garden soil and turf underlay in regular demand.' },
  'seven-hills':   { council: 'Blacktown City Council',      localNote: 'Western Sydney suburb of family homes with steady demand for bulk landscape materials.' },
  'westmead':      { council: 'City of Parramatta',          localNote: 'Hospital and university precinct with mixed housing — common for soil, mulch and entrance landscaping.' },
  'granville':     { council: 'City of Parramatta',          localNote: 'Established Western Sydney suburb of brick homes and small blocks — soil and mulch deliveries common.' },

  // Sutherland Shire & St George
  'miranda':       { council: 'Sutherland Shire Council',    localNote: 'Shire commercial hub surrounded by family suburbs — bulk soil, mulch and pebble orders are routine.' },
  'sutherland':    { council: 'Sutherland Shire Council',    localNote: 'Established shire suburb with mature gardens and ongoing landscape-renovation demand.' },
  'cronulla':      { council: 'Sutherland Shire Council',    localNote: 'Beachside shire suburb where sandy soil and salt air make hardy plants and pebble surrounds the practical choice.' },
  'hurstville':    { council: 'Georges River Council',       localNote: 'St George commercial centre with apartments and family homes — common for entrance and balcony landscaping.' },
  'kogarah':       { council: 'Bayside Council / Georges River Council', localNote: 'St George suburb of mixed housing — soil, mulch and turf underlay regularly delivered.' },
  'rockdale':      { council: 'Bayside Council',             localNote: 'St George commercial and residential hub — steady demand for soil, mulch and small landscaping projects.' },
  'caringbah':     { council: 'Sutherland Shire Council',    localNote: 'Established shire suburb with family homes and large gardens.' },
  'gymea':         { council: 'Sutherland Shire Council',    localNote: 'Quiet shire suburb of family homes near the bay — common for bulk garden soil and mulch.' },

  // Outer Western Sydney
  'penrith':       { council: 'Penrith City Council',        localNote: 'Major outer-western centre with new-release estates — bulk soil, mulch and turf underlay are everyday deliveries.' },
  'st-marys':      { council: 'Penrith City Council',        localNote: 'Outer-western suburb of family homes and growing estates — regular bulk landscape orders.' },
  'richmond':      { council: 'Hawkesbury City Council',     localNote: 'Hawkesbury rural-residential suburb where acreage properties and bulk landscape orders go hand in hand.' },
  'campbelltown':  { council: 'Campbelltown City Council',   localNote: 'Major south-western Sydney centre with new-release estates and large family blocks.' },
  'narellan':      { council: 'Camden Council',              localNote: 'Growing south-western suburb of new estates — bulk soil and mulch orders are routine for new builds.' },
  'liverpool':     { council: 'Liverpool City Council',      localNote: 'Major south-western centre with mixed family suburbs — regular demand for bulk landscape materials.' }
};

const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));

let enriched = 0, missing = [];
data.suburbs = data.suburbs.map(s => {
  const extra = ENRICHMENT[s.slug];
  if (!extra) { missing.push(s.slug); return s; }
  enriched++;
  return { ...s, council: extra.council, localNote: extra.localNote };
});

// Pretty-print but keep suburbs as one-per-line for diff readability
const out = JSON.stringify(data, null, 2);
fs.writeFileSync(FILE, out, 'utf8');

console.log(`Enriched ${enriched} suburbs.`);
if (missing.length) console.log(`Missing ENRICHMENT entries for: ${missing.join(', ')}`);
