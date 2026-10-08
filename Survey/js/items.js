/*
 * The 48 RIASEC items (Open Psychometrics wording, UNCHANGED) plus one attention check.
 * Data only - no DOM. Works in the browser (window.ChaguoItems) and in Node (require).
 */
(function (root) {
  'use strict';

  var TYPES = ['R', 'I', 'A', 'S', 'E', 'C'];
  var ITEMS_PER_TYPE = 8;
  var ITEMS_PER_SCREEN = 8;
  var SCREEN_COUNT = 6;

  // Exact wording from Dataset/RIASEC_data12Dec2018/codebook.txt. Do not edit.
  var TEXT = {
    R: [
      'Test the quality of parts before shipment',
      'Lay brick or tile',
      'Work on an offshore oil-drilling rig',
      'Assemble electronic parts',
      'Operate a grinding machine in a factory',
      'Fix a broken faucet',
      'Assemble products in a factory',
      'Install flooring in houses'
    ],
    I: [
      'Study the structure of the human body',
      'Study animal behavior',
      'Do research on plants or animals',
      'Develop a new medical treatment or procedure',
      'Conduct biological research',
      'Study whales and other types of marine life',
      'Work in a biology lab',
      'Make a map of the bottom of an ocean'
    ],
    A: [
      'Conduct a musical choir',
      'Direct a play',
      'Design artwork for magazines',
      'Write a song',
      'Write books or plays',
      'Play a musical instrument',
      'Perform stunts for a movie or television show',
      'Design sets for plays'
    ],
    S: [
      'Give career guidance to people',
      'Do volunteer work at a non-profit organization',
      'Help people who have problems with drugs or alcohol',
      'Teach an individual an exercise routine',
      'Help people with family-related problems',
      'Supervise the activities of children at a camp',
      'Teach children how to read',
      'Help elderly people with their daily activities'
    ],
    E: [
      'Sell restaurant franchises to individuals',
      'Sell merchandise at a department store',
      'Manage the operations of a hotel',
      'Operate a beauty salon or barber shop',
      'Manage a department within a large company',
      'Manage a clothing store',
      'Sell houses',
      'Run a toy store'
    ],
    C: [
      'Generate the monthly payroll checks for an office',
      'Inventory supplies using a hand-held computer',
      'Use a computer program to generate customer bills',
      'Maintain employee records',
      'Compute and record statistical and other numerical data',
      'Operate a calculator',
      "Handle customers' bank transactions",
      'Keep shipping and receiving records'
    ]
  };

  // Item ids grouped by type: R1..R8, I1..I8, ... C8 (the order of the response-object columns).
  var ITEM_IDS = [];
  TYPES.forEach(function (t) {
    for (var n = 1; n <= ITEMS_PER_TYPE; n++) ITEM_IDS.push(t + n);
  });

  // Interleaved presentation order: R1, I1, A1, S1, E1, C1, R2, I2, ... C8.
  var ITEMS = [];
  for (var n = 1; n <= ITEMS_PER_TYPE; n++) {
    TYPES.forEach(function (t) {
      ITEMS.push({ id: t + n, type: t, text: TEXT[t][n - 1] });
    });
  }

  // Not a RIASEC item: never scored. Fixed position, same for every respondent.
  var ATTENTION_CHECK = {
    id: 'attention_check',
    text: 'For this item, please select Dislike.',
    screen: 4,
    position: 5, // 1-based position among the 9 items on that screen
    passValue: 1
  };

  // The items shown on screen `screenNumber` (1-based), in display order.
  function getScreenItems(screenNumber) {
    var start = (screenNumber - 1) * ITEMS_PER_SCREEN;
    var list = ITEMS.slice(start, start + ITEMS_PER_SCREEN);
    if (screenNumber === ATTENTION_CHECK.screen) {
      list.splice(ATTENTION_CHECK.position - 1, 0, {
        id: ATTENTION_CHECK.id,
        type: null,
        text: ATTENTION_CHECK.text
      });
    }
    return list;
  }

  root.ChaguoItems = {
    TYPES: TYPES,
    ITEMS_PER_TYPE: ITEMS_PER_TYPE,
    SCREEN_COUNT: SCREEN_COUNT,
    ITEM_IDS: ITEM_IDS,
    ITEMS: ITEMS,
    ATTENTION_CHECK: ATTENTION_CHECK,
    getScreenItems: getScreenItems
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ChaguoItems;
})(typeof window !== 'undefined' ? window : globalThis);
