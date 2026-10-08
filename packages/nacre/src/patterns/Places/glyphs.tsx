import { createElement, type ReactElement } from 'react';
import {
  Banknote,
  Beer,
  BedDouble,
  BookOpen,
  Building2,
  Clapperboard,
  Coffee,
  Croissant,
  Drama,
  Dumbbell,
  Flower2,
  Fuel,
  Hospital,
  IceCreamCone,
  Landmark,
  Library,
  Mail,
  MapPin,
  Palette,
  Pill,
  PlugZap,
  Sandwich,
  Scissors,
  ShoppingBasket,
  SquareParking,
  Stethoscope,
  Store,
  Toilet,
  Trees,
  UtensilsCrossed,
  Wine,
  type LucideIcon,
} from 'lucide-react';

/** What kind of place, by the words OpenStreetMap uses → the glyph beside it. */
const GLYPHS: [RegExp, LucideIcon][] = [
  [/cafe|coffee|\btea\b/, Coffee],
  [/ice cream/, IceCreamCone],
  [/fast food|takeaway/, Sandwich],
  [/restaurant|food court/, UtensilsCrossed],
  [/\bpub\b|biergarten|beer/, Beer],
  [/\bbar\b|wine/, Wine],
  [/bakery|pastry|confectionery/, Croissant],
  [/supermarket|convenience|grocer|greengrocer/, ShoppingBasket],
  [/pharmacy|chemist/, Pill],
  [/\batm\b|bank|bureau de change/, Banknote],
  [/museum|attraction|monument|memorial|castle|viewpoint/, Landmark],
  [/gallery|arts? centre/, Palette],
  [/hotel|hostel|guest house|motel/, BedDouble],
  [/\bpark\b|garden|playground|nature reserve/, Trees],
  [/fitness|gym|sports centre/, Dumbbell],
  [/library/, Library],
  [/cinema/, Clapperboard],
  [/theatre/, Drama],
  [/hospital|clinic/, Hospital],
  [/doctors?|dentist/, Stethoscope],
  [/fuel/, Fuel],
  [/charging/, PlugZap],
  [/parking/, SquareParking],
  [/toilets?/, Toilet],
  [/post office/, Mail],
  [/books?/, BookOpen],
  [/florist/, Flower2],
  [/hairdresser|barber|beauty/, Scissors],
  [/city|town|village|suburb|neighbourhood|quarter|administrative|county|state|country/, Building2],
];

/** The glyph for a kind of place: a lucide icon, drawn at the size its box gives it. */
export function glyphFor(category: string): ReactElement {
  const c = category.toLowerCase();
  const glyph = GLYPHS.find(([words]) => words.test(c))?.[1];
  if (glyph) return createElement(glyph);
  return createElement(/shop|store|mall|marketplace/.test(c) ? Store : MapPin);
}
