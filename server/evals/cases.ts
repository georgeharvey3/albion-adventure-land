// The golden set (issue #62). Each case pins its date, its position and its
// user state, and the network answers from recordings.json, so a run depends
// only on the model.
//
// A "must name" list is short and generous: any one of them is a good answer.
// The sites in it come from the tools themselves, run by hand on the case's
// own slots, so a failure means the model chose badly, not that the data moved.
// If the data does move, `npm run eval` reports the case, and the list is
// updated from the tools again.

import type { EvalCase } from './checks';

const SATURDAY = '2026-09-26T10:00';

const SHEFFIELD = { lat: 53.383, lng: -1.4659 };
const WINCHESTER = { lat: 51.0651, lng: -1.3187 };
const BRISTOL = { lat: 51.454, lng: -2.588 };
const EXETER = { lat: 50.726, lng: -3.527 };
const PENZANCE = { lat: 50.1186, lng: -5.5371 };
const KESWICK = { lat: 54.5995, lng: -3.1326 };
const ILKLEY = { lat: 53.9245, lng: -1.8233 };
const PENRITH = { lat: 54.6658, lng: -2.7576 };
const BRECON = { lat: 51.946, lng: -3.39 };
const LIVERPOOL = { lat: 53.4106, lng: -2.9779 };
const HAY = { lat: 52.0745, lng: -3.1243 };
const FORT_WILLIAM = { lat: 56.8165, lng: -5.1121 };
const CANTERBURY = { lat: 51.279, lng: 1.0799 };
const TINTERN = { lat: 51.6969, lng: -2.677 };
const SNOWDON = { lat: 53.0678, lng: -4.0775 };

const APP_JOURNEY = {
  origin: { ...BRISTOL, label: 'Bristol' },
  destination: { ...EXETER, label: 'Exeter' },
};

const ILKLEY_SWIMS = [
  'ilkley-lido_53.9319_-1.8202',
  'old-bridge-ilkley_53.9292_-1.8333',
  'addingham-r-wharfe_53.9443_-1.8727',
  'bolton-abbey-r-wharfe_53.9841_-1.8870',
  'valley-of-desolation-waterfall_54.0057_-1.8816',
  'swinsty-reservoir_53.9797_-1.7014',
];

export const CASES: EvalCase[] = [
  {
    id: 'sheffield-winchester-deep-swims',
    question:
      "I'm travelling from Sheffield to Winchester tomorrow. Are there any nice swim spots on the way, preferably somewhere with deep water?",
    request: { now: SATURDAY },
    expect: {
      calls: [
        { tool: 'find_sites', journey: { origin: SHEFFIELD, destination: WINCHESTER }, types: ['wild_swims'] },
      ],
      mustName: [
        'blackbrook-reservoir_52.7488_-1.3149',
        'marsh-benham-r-kennet_51.4010_-1.3963',
        'twyford-r-itchen_51.0272_-1.3221',
        'st-cross-winchester-r-itchen_51.0477_-1.3197',
        'kislingbury-mill-pool-river-nene_52.2288_-0.9845',
      ],
      handOffs: ['show_on_map', 'use_as_journey'],
    },
  },
  {
    id: 'wells-near-me',
    question: 'Are there any holy wells near me?',
    request: { now: SATURDAY, position: PENZANCE },
    expect: {
      calls: [{ tool: 'find_sites', near: 'position', types: ['wells'] }],
      mustName: [
        'madron-well_50.1397_-5.5765',
        'giant-s-well_50.1171_-5.4776',
        'st-euny-s-well_50.1033_-5.6375',
        'alsia-well_50.0691_-5.6446',
      ],
    },
  },
  {
    id: 'on-my-way-app-journey',
    question: "What's worth stopping for on my way?",
    request: { now: SATURDAY, position: BRISTOL, journey: APP_JOURNEY },
    expect: {
      calls: [{ tool: 'find_sites', journey: 'current' }],
      mustName: [
        'avon-gorge_51.4564_-2.6270',
        'giant-s-cave_51.4567_-2.6266',
        'abbot-s-pool-abbots-leigh_51.4566_-2.6690',
        'dolbury-hill_50.7943_-3.4580',
        'st-peter-s-church-bristol_51.4520_-2.5870',
        'nova-scotia_bs1-6xj',
        'kings-head_bs1-6de',
        'avon-packet_bs3-1rf',
        'black-horse_bs20-7rh',
        'river-yeo-yatton_51.3827_-2.8587',
      ],
      handOffs: ['show_on_map'],
    },
  },
  {
    id: 'trip-to-tintern-pubs',
    question: "I'm planning a trip to Tintern Abbey. Any historic pubs on the way?",
    request: { now: SATURDAY, position: BRISTOL },
    expect: {
      calls: [{ tool: 'find_sites', journey: { origin: 'position', destination: TINTERN }, types: ['historic_pubs'] }],
      mustName: [
        'kings-head_bs1-6de',
        'avon-packet_bs3-1rf',
        'nova-scotia_bs1-6xj',
        'highbury-vaults_bs2-8de',
        'masons-arms_bs36-1pt',
        'carpenters-arms_np16-6bu',
      ],
      handOffs: ['use_as_journey'],
    },
  },
  {
    id: 'day-out-scramble-and-swim',
    question: 'I fancy a day out near Keswick with a scramble and a swim. What would you suggest?',
    request: { now: SATURDAY },
    expect: {
      calls: [
        { tool: 'find_sites', near: KESWICK, types: ['scrambles'] },
        { tool: 'find_sites', near: KESWICK, types: ['wild_swims'] },
      ],
      mustName: [
        'ashness-ghyll-scramble-ashness-gill_54.5639_-3.1103',
        'sandbed-gill-scramble_54.5867_-3.0536',
        'mill-gill_54.5689_-3.0472',
        'hall-s-fell-ridge-blencathra_54.6396_-3.0498',
        'sharp-edge-blencathra_54.6406_-3.0498',
      ],
      handOffs: ['plan_trip'],
    },
  },
  {
    id: 'stone-circles-in-cornwall',
    question: 'Which stone circles are there in Cornwall?',
    request: { now: SATURDAY },
    expect: {
      calls: [{ tool: 'find_sites', types: ['stone_circles'] }],
      mustName: ['hurlers-stone-circles_50.5164_-4.4584'],
    },
  },
  {
    id: 'liverpool-3-star-pubs',
    question: 'Which 3-star heritage pubs are there in Liverpool city centre?',
    request: { now: SATURDAY },
    expect: {
      calls: [{ tool: 'find_sites', near: { ...LIVERPOOL, km: 3 }, types: ['historic_pubs'] }],
      mustName: [
        'lion-tavern_l2-2bp',
        'crown-hotel_l1-1jq',
        'vines_l1-1jq',
        'philharmonic-dining-rooms_l1-9bx',
        'belvedere_l7-7eb',
      ],
    },
  },
  {
    id: 'kids-paddle-hay',
    question: 'Where can I take the kids for a paddle near Hay-on-Wye?',
    request: { now: SATURDAY },
    expect: {
      calls: [{ tool: 'find_sites', near: HAY, types: ['wild_swims'] }],
      mustName: [
        'the-warren-hay-on-wye_52.0761_-3.1369',
        'bredwardine-bridge-river-wye_52.0967_-2.9697',
        'pwll-y-wrach-waterfall_51.9862_-3.2109',
        'river-edw-weir_52.1244_-3.3138',
      ],
      mustNotName: ['grwyne-fawr-reservoir_51.9709_-3.1189'],
    },
  },
  {
    // The mirror of the case above. All six swims within 25 km reach the
    // model, and `meaning` only orders them: the paddling spot at Olantigh
    // ranks fourth. The model must leave out the sites whose data says the
    // water is shallow.
    id: 'deep-water-not-a-paddle',
    question: 'Where can I find deep water for a proper swim near Canterbury?',
    request: { now: SATURDAY },
    expect: {
      calls: [{ tool: 'find_sites', near: CANTERBURY, types: ['wild_swims'] }],
      mustName: [
        'chartham-r-great-stour_51.2562_1.0215',
        'westbere-marshes_51.3047_1.1479',
        'upstreet-r-great-stour_51.3226_1.2029',
      ],
      mustNotName: ['olantigh-r-wye_51.2017_0.9479', 'wickhambreaux-r-little-stour_51.2860_1.1961'],
    },
  },
  {
    id: 'hidden-sites-never-appear',
    question: 'Any good swims near Ilkley?',
    request: { now: SATURDAY, hidden: [ILKLEY_SWIMS[0], ILKLEY_SWIMS[1]] },
    expect: {
      calls: [{ tool: 'find_sites', near: ILKLEY, types: ['wild_swims'] }],
      mustName: ILKLEY_SWIMS.slice(2),
      mustNotName: ILKLEY_SWIMS.slice(0, 2),
    },
  },
  {
    id: 'visited-sites-come-last',
    question: 'Where can I swim near here?',
    request: { now: SATURDAY, position: ILKLEY, visited: [ILKLEY_SWIMS[0]] },
    expect: {
      calls: [{ tool: 'find_sites', near: 'position', types: ['wild_swims'] }],
      mustName: ILKLEY_SWIMS.slice(1),
    },
  },
  {
    id: 'visited-sites-when-asked',
    question: 'Which of the swims near Ilkley have I already been to?',
    request: { now: SATURDAY, visited: [ILKLEY_SWIMS[0], ILKLEY_SWIMS[3]] },
    expect: {
      calls: [{ tool: 'find_sites', near: ILKLEY, types: ['wild_swims'], includeVisited: true }],
      mustName: [ILKLEY_SWIMS[0], ILKLEY_SWIMS[3]],
      visitedFirstOk: true,
    },
  },
  {
    id: 'named-place-overrides-journey',
    question: 'Are there any stone circles near Penrith?',
    request: { now: SATURDAY, position: BRISTOL, journey: APP_JOURNEY },
    expect: {
      calls: [{ tool: 'find_sites', near: PENRITH, types: ['stone_circles'] }],
      forbidCalls: [{ tool: 'find_sites', journey: 'any' }],
      mustName: ['long-meg-and-her-daughters_54.7281_-2.6677', 'castlerigg-stone-circle_54.6028_-3.0984'],
    },
  },
  {
    id: 'postcode',
    question: 'Is there anything folkloric near LD3 7HP?',
    request: { now: SATURDAY },
    expect: {
      calls: [{ tool: 'find_sites', near: { ...BRECON, km: 5 } }],
      mustName: ['maen-du-well_51.9568_-3.4000', 'llanfeugan-church_51.9119_-3.3292'],
    },
  },
  {
    id: 'grid-reference',
    question: 'What is there to see within a few km of SH 609 543?',
    request: { now: SATURDAY },
    expect: {
      calls: [{ tool: 'find_sites', near: { ...SNOWDON, km: 2 } }],
      mustName: [
        'bwlch-y-saethau_53.0665_-4.0690',
        'glaslyn_53.0713_-4.0639',
        'y-gribin-yr-wyddfa-snowdon_53.0684_-4.0760',
        'mount-snowdon-summit_53.0684_-4.0762',
        'the-parson-s-nose-clogwyn-y-ddysgl_53.0770_-4.0678',
      ],
    },
  },
  {
    id: 'selection-nearby-pub',
    question: 'Is there a good historic pub near this one?',
    request: { now: SATURDAY, selection: 'tintern-abbey_51.6969_-2.6770' },
    expect: {
      calls: [{ tool: 'find_sites', near: 'selection', types: ['historic_pubs'] }],
      mustName: [
        'carpenters-arms_np16-6bu',
        'ostrich_gl16-8np',
        'old-nags-head_np25-3dr',
        'royal-oak-inn_np25-3ga',
      ],
    },
  },
  {
    id: 'follow-up-the-second-one',
    question: 'Tell me more about the second one.',
    request: {
      now: SATURDAY,
      conversation: [
        { role: 'user', content: 'Any swims near Ilkley?' },
        {
          role: 'assistant',
          content: `Near Ilkley: [Ilkley Lido](site:${ILKLEY_SWIMS[0]}) is a big 1930s unheated lido, and [Old Bridge, Ilkley](site:${ILKLEY_SWIMS[1]}) is a wide, slow pool on the Wharfe.`,
        },
      ],
    },
    expect: {
      calls: [{ tool: 'read_sites', ids: [ILKLEY_SWIMS[1]] }],
      mustName: [ILKLEY_SWIMS[1]],
      mustNotName: [ILKLEY_SWIMS[2], ILKLEY_SWIMS[3]],
    },
  },
  {
    id: 'no-swimming-is-a-formality',
    question: 'Is there a deep quarry I can swim in near Penzance?',
    request: { now: SATURDAY },
    expect: {
      calls: [{ tool: 'find_sites', near: PENZANCE, types: ['wild_swims'] }],
      mustName: ['baker-s-pit-lake-folly_50.1667_-5.5295'],
    },
  },
  {
    id: 'waterfall-swims-brecon',
    question: 'Can you find me a waterfall to swim under near Brecon?',
    request: { now: SATURDAY },
    expect: {
      calls: [{ tool: 'find_sites', near: BRECON, types: ['wild_swims'] }],
      mustName: [
        'blaen-y-glyn-falls-caerfanell_51.8485_-3.3650',
        'ystradfellte-falls-afon-mellte_51.7838_-3.5625',
        'nedd-fechan-waterfalls_51.7771_-3.5876',
        'llyn-cwm-llwch-corn-du_51.8878_-3.4516',
        'pwll-y-wrach-waterfall_51.9862_-3.2109',
      ],
    },
  },
  {
    id: 'hillforts-london-to-bath',
    question: "I'm driving from London to Bath. Are there any hillforts I could stop at on the way, even if it's a bit of a detour?",
    request: { now: SATURDAY },
    expect: {
      calls: [
        {
          tool: 'find_sites',
          journey: { origin: { lat: 51.5085, lng: -0.1257 }, destination: { lat: 51.3751, lng: -2.3617 } },
          types: ['hillforts'],
        },
      ],
      mustName: ['grimsbury-castle_51.4468_-1.2669'],
      handOffs: ['use_as_journey'],
    },
  },
  {
    id: 'ruins-in-northumberland',
    question: 'What ruins are there to explore in Northumberland?',
    request: { now: SATURDAY },
    expect: {
      calls: [{ tool: 'find_sites', types: ['ruins'] }],
      mustName: [
        'dunstanburgh-castle-near-craster_55.4894_-1.5951',
        'edlingham-castle_55.3768_-1.8184',
        'harbottle-castle-and-ruined-house_55.3371_-2.1083',
        'black-middens-bastle-house-moffat-amble_55.2036_-2.3580',
      ],
    },
  },
  {
    id: 'wild-swim-fort-william',
    question: 'Somewhere wild and beautiful to swim near Fort William?',
    request: { now: SATURDAY },
    expect: {
      calls: [{ tool: 'find_sites', near: FORT_WILLIAM, types: ['wild_swims'] }],
      mustName: [
        'water-of-nevis-steall-gorge_56.7723_-4.9814',
        'grey-mare-s-tail_56.7190_-4.9632',
        'glen-coe-lochan_56.6890_-5.0968',
        'the-witch-s-cauldron-clunes_56.9548_-5.0012',
        'achaderry-lochan-roybridge_56.8946_-4.8251',
      ],
    },
  },
  {
    id: 'day-out-ruin-and-swim',
    question: 'A day out near Winchester with a ruin and a swim, please.',
    request: { now: SATURDAY },
    expect: {
      calls: [
        { tool: 'find_sites', near: WINCHESTER, types: ['ruins'] },
        { tool: 'find_sites', near: WINCHESTER, types: ['wild_swims'] },
      ],
      mustName: ['wolvesey-castle-winchester_51.0591_-1.3099', 'netley-abbey-near-bursledon_50.8787_-1.3575'],
      handOffs: ['plan_trip'],
    },
  },
  {
    id: 'unknown-place',
    question: 'Any swims near Nowhereville-on-Sea?',
    request: { now: SATURDAY },
    expect: { noSites: true },
  },
  {
    id: 'near-me-without-a-position',
    question: "What's near me?",
    request: { now: SATURDAY },
    expect: { noSites: true },
  },
];
