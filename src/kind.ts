import type { Kind } from './types';

const rx = (s: string) => new RegExp(`\\b(${s})\\b`, 'i');
const PERSON = rx(
  'singer|musician|composer|actor|actress|writer|poet|painter|politician|footballer|player|author|philosopher|mathematician|scientist|physicist|engineer|trumpeter|pianist|guitarist|drummer|saxophonist|bassist|violinist|vocalist|conductor|director|producer|businessman|businesswoman|artist|novelist|economist|journalist|photographer|architect|designer|lyricist|rapper|dancer|activist|bishop|king|queen|emperor|empress|general|explorer|chemist|biologist|astronomer|historian|lawyer|judge|physician|inventor|critic|educator|professor|academic|entrepreneur|comedian|cartoonist|sculptor|typographer|mycologist|botanist|theologian|saint|pope|monarch|soldier|admiral|cricketer|athlete|boxer|wrestler|swimmer|racing driver|born|died',
);
const LIFESPAN = /\(?\b(1[0-9]{3}|20[0-2][0-9])\s*[–-]\s*((1[0-9]{3}|20[0-2][0-9])|present)\)?/;
const WORK = rx('album|song|single|film|novel|book|series|television|painting|opera|poem|play|magazine|video game|game|musical film|stage musical|documentary|sculpture|symphony|newspaper|journal|ep|manga|anime|sitcom|short story|typeface|font|treatise|text|scripture');
const EVENT = rx('war|battle|festival|championship|election|conflict|revolution|riot|disaster|olympics|tournament|massacre|treaty|incident|event|expedition|season|cup|era|period|siege|uprising|rebellion');
const ORG = rx('company|label|record label|band|group|organization|organisation|university|school|club|team|corporation|party|agency|institution|orchestra|ensemble|league|museum|publisher|network|union|college|society|association|firm|brand|foundry|studio|dynasty|empire|kingdom|government|army|church');
const PLACE = rx('city|town|village|river|mountain|island|country in|state of|state in|county|region|district|neighbou?rhood|municipality|province|capital|lake|valley|street|park|building|bridge|airport|station|venue|hall|theat(?:re|er)|commune|borough|territory|continent|sea|ocean|peninsula|castle|cathedral|church in|ward');
const OBJECT = rx('instrument|device|machine|vehicle|software|tool|weapon|material|species|plant|animal|genus|mineral|chemical|compound|drug|disease|food|dish|aircraft|ship|car|computer|mushroom|fungus|fungi|family of|order of|alloy|metal|element|ink|paper|programming language|file format');

/**
 * Rough kind from the short description. The full pipeline maps Wikidata P31 instead (milestone 3);
 * this is good enough for a live prototype and the variety rule.
 */
export function kindOf(desc: string): Kind {
  if (!desc) return 'concept';
  if (LIFESPAN.test(desc) && !WORK.test(desc)) return 'person';
  if (PERSON.test(desc) && !/\b(label|company|band|group)\b/i.test(desc)) return 'person';
  if (WORK.test(desc)) return 'work';
  if (EVENT.test(desc)) return 'event';
  if (ORG.test(desc)) return 'org';
  if (PLACE.test(desc)) return 'place';
  if (OBJECT.test(desc)) return 'object';
  return 'concept';
}

export function yearOf(desc: string): number | null {
  const m = desc.match(/\b(1[0-9]{3}|20[0-2][0-9])\b/);
  return m ? +m[1] : null;
}

export const KIND_LABEL: Record<Kind, string> = {
  person: 'People',
  work: 'Works',
  place: 'Places',
  org: 'Organizations',
  concept: 'Concepts',
  event: 'Events',
  object: 'Things',
};
