// ─────────────────────────────────────────────
// KITGUN COMPONENT DATA
// Format: [vendor, syndicate, bpCost, craftCredits, [[resource, qty], ...]]
// bpCost = standing to buy blueprint from vendor
// craftCredits = credits to build in Foundry (always 5000)
// ─────────────────────────────────────────────
const KITGUN_CHAMBERS = new Map([
  ['Catchmoon',    ['Rude Zuud','Solaris United',  500, 5000, [['Mytocardia Spore',15],['Travocyte Alloy',20],['Scrubber Exa Brain',10],['Alloy Plate',1700]]]],
  ['Gaze',         ['Rude Zuud','Solaris United',  500, 5000, [['Tepa Nodule',15],['Venerdo Alloy',40],['Kriller Thermal Laser',40],['Cryotic',1200]]]],
  ['Rattleguts',   ['Rude Zuud','Solaris United',  500, 5000, [['Gorgaricus Spore',15],['Venerdo Alloy',20],['Eye-Eye Rotoblade',10],['Rubedo',900]]]],
  ['Sporelacer',   ['Father',   'Entrati',         500, 5000, [['Pustulite',15],['Adramal Alloy',20],['Benign Infested Tumor',25],['Sporulate Sac',10]]]],
  ['Tombfinger',   ['Rude Zuud','Solaris United',  500, 5000, [['Thermal Sludge',15],['Axidrol Alloy',20],['Tink Dissipator Coil',10],['Circuits',900]]]],
  ['Vermisplicer', ['Father',   'Entrati',         500, 5000, [['Ganglion',15],['Tempered Bapholite',20],['Benign Infested Tumor',25],['Dendrite Blastoma',10]]]],
]);

const KITGUN_GRIPS = new Map([
  ['Brash',      ['Rude Zuud','Solaris United', 1000, 5000, [['Smooth Phasmin',5],['Axidrol Alloy',20],['Scrap',25],['Echowinder Anoscopic Sensor',10]]]],
  ['Gibber',     ['Rude Zuud','Solaris United', 1000, 5000, [['Goblite Tears',5],['Axidrol Alloy',30],['Scrap',20],['Eye-Eye Rotoblade',10]]]],
  ['Haymaker',   ['Rude Zuud','Solaris United', 1000, 5000, [['Goblite Tears',5],['Travocyte Alloy',30],['Scrap',20],['Recaster Neural Relay',10]]]],
  ['Lovetap',    ['Rude Zuud','Solaris United',  500, 5000, [['Heart Noctrul',5],['Travocyte Alloy',30],['Scrap',20],['Sapcaddy Venedo Case',10]]]],
  ['Palmaris',   ['Father',   'Entrati',         500, 5000, [['Benign Infested Tumor',20],['Dendrite Blastoma',10],['Adramal Alloy',20],['Purged Dagonic',5]]]],
  ['Ramble',     ['Rude Zuud','Solaris United',  750, 5000, [['Smooth Phasmin',5],['Axidrol Alloy',30],['Scrap',20],['Echowinder Anoscopic Sensor',10]]]],
  ['Shrewd',     ['Rude Zuud','Solaris United', 1000, 5000, [['Heart Noctrul',5],['Travocyte Alloy',30],['Scrap',20],['Sapcaddy Venedo Case',10]]]],
  ['Steadyslam', ['Rude Zuud','Solaris United', 2000, 5000, [['Goblite Tears',5],['Travocyte Alloy',30],['Scrap',20],['Recaster Neural Relay',10]]]],
  ['Tremor',     ['Rude Zuud','Solaris United', 2000, 5000, [['Goblite Tears',5],['Axidrol Alloy',30],['Scrap',20],['Eye-Eye Rotoblade',10]]]],
  ['Ulnaris',    ['Father',   'Entrati',         500, 5000, [['Faceted Tiametrite',5],['Tempered Bapholite',20],['Benign Infested Tumor',20],['Spinal Core Section',10]]]],
]);

// ─────────────────────────────────────────────
// ZAW COMPONENT DATA
// Format: [vendor, syndicate, bpCost, craftCredits, [[resource, qty], ...]]
// Plague Star items use syndicate 'Plague Star' — their standing is event-specific.
// ─────────────────────────────────────────────
const ZAW_STRIKES = new Map([
  ['Balla',         ['Hok','Ostron',      1000, 5000, [['Nistlepod',20],['Fish Scales',15],['Tear Azurite',10],['Pyrotic Alloy',60]]]],
  ['Cyath',         ['Hok','Ostron',      1000, 5000, [['Breath of the Eidolon',1],['Fish Scales',55],['Marquise Veridos',6],['Fersteel Alloy',20]]]],
  ['Dehtat',        ['Hok','Ostron',      1000, 5000, [['Maprico',2],['Fish Scales',45],['Marquise Veridos',8],['Fersteel Alloy',40]]]],
  ['Dokrahm',       ['Hok','Ostron',      1000, 5000, [['Nistlepod',25],['Fish Scales',45],['Marquise Veridos',7],['Pyrotic Alloy',60]]]],
  ['Kronsh',        ['Hok','Ostron',      1000, 5000, [['Grokdrul',20],['Fish Scales',45],['Esher Devar',10],['Coprite Alloy',60]]]],
  ['Mewan',         ['Hok','Ostron',      1000, 5000, [['Cetus Wisp',1],['Fish Scales',55],['Fersteel Alloy',20],['Marquise Veridos',6]]]],
  ['Ooltha',        ['Hok','Ostron',      1000, 5000, [['Iradite',20],['Fish Scales',25],['Tear Azurite',10],['Pyrotic Alloy',60]]]],
  ['Rabvee',        ['Hok','Ostron',      1000, 5000, [['Grokdrul',35],['Fish Scales',50],['Esher Devar',10],['Fersteel Alloy',20]]]],
  ['Sepfahn',       ['Hok','Ostron',      1000, 5000, [['Condroc Wing',15],['Fish Scales',55],['Tear Azurite',10],['Coprite Alloy',60]]]],
  ['Plague Keewar', ['Nakak','Plague Star',2000, 5000, [['Nano Spores',1600],['Plastids',700],['Esher Devar',10],['Coprite Alloy',60]]]],
  ['Plague Kripath',['Nakak','Plague Star',2000, 5000, [['Nano Spores',1600],['Plastids',700],['Tear Azurite',10],['Pyrotic Alloy',60]]]],
]);

const ZAW_GRIPS = new Map([
  ['Jayap',        ['Hok','Ostron',       1000, 5000, [['Maprico',5],['Fish Oil',50],['Rubedo',600],['Fersteel Alloy',40]]]],
  ['Korb',         ['Hok','Ostron',       1000, 5000, [['Iradite',25],['Fish Oil',50],['Pyrotic Alloy',60],['Rubedo',650]]]],
  ['Kroostra',     ['Hok','Ostron',       1000, 5000, [['Breath of the Eidolon',1],['Fish Oil',50],['Fersteel Alloy',20],['Circuits',500]]]],
  ['Kwath',        ['Hok','Ostron',       1000, 5000, [['Cetus Wisp',1],['Fish Oil',50],['Fersteel Alloy',20],['Plastids',700]]]],
  ['Laka',         ['Hok','Ostron',       1000, 5000, [['Nistlepod',20],['Coprite Alloy',60],['Fish Oil',50],['Cryotic',750]]]],
  ['Peye',         ['Hok','Ostron',       1000, 5000, [['Iradite',20],['Fish Oil',50],['Alloy Plate',850],['Pyrotic Alloy',60]]]],
  ['Seekalla',     ['Hok','Ostron',       1000, 5000, [['Grokdrul',20],['Fish Oil',50],['Salvage',900],['Pyrotic Alloy',60]]]],
  ['Shtung',       ['Hok','Ostron',       1000, 5000, [['Grokdrul',25],['Fish Scales',55],['Pyrotic Alloy',60],['Ferrite',850]]]],
  ['Plague Akwin', ['Nakak','Plague Star', 2000, 5000, [['Iradite',20],['Fish Scales',15],['Pyrotic Alloy',30],['Plastids',1100]]]],
  ['Plague Bokwin',['Nakak','Plague Star', 2000, 5000, [['Grokdrul',20],['Fish Scales',15],['Coprite Alloy',30],['Plastids',1100]]]],
]);

const ZAW_LINKS = new Map([
  ['Jai',              ['Hok','Ostron',  1000, 5000, [['Nistlepod',10],['Pyrotic Alloy',20],['Condroc Wing',2],['Khut-Khut Venom Sac',5]]]],
  ['Jai II',           ['Hok','Ostron',  2000, 5000, [['Nistlepod',20],['Pyrotic Alloy',20],['Condroc Wing',2],['Yogwun Stomach',5]]]],
  ['Vargeet Jai',      ['Hok','Ostron',  5000, 5000, [['Nistlepod',30],['Coprite Alloy',20],['Kuaka Spinal Claw',5],['Goopolla Spleen',5]]]],
  ['Ekwana Jai',       ['Hok','Ostron',  5000, 5000, [['Nistlepod',30],['Coprite Alloy',20],['Condroc Wing',5],['Goopolla Spleen',5]]]],
  ['Vargeet II Jai',   ['Hok','Ostron',  7500, 5000, [['Maprico',5],['Fersteel Alloy',20],['Kuaka Spinal Claw',5],['Mortus Horn',5]]]],
  ['Ekwana II Jai',    ['Hok','Ostron',  7500, 5000, [['Maprico',5],['Fersteel Alloy',20],['Condroc Wing',5],['Mortus Horn',5]]]],
  ['Vargeet Jai II',   ['Hok','Ostron', 10000, 5000, [['Breath of the Eidolon',5],['Auroxium Alloy',20],['Kuaka Spinal Claw',5],['Cetus Wisp',2]]]],
  ['Ekwana Jai II',    ['Hok','Ostron', 10000, 5000, [['Breath of the Eidolon',5],['Auroxium Alloy',20],['Condroc Wing',5],['Cetus Wisp',2]]]],
  ['Ruhang',           ['Hok','Ostron',  1000, 5000, [['Nistlepod',10],['Pyrotic Alloy',20],['Kuaka Spinal Claw',2],['Mawfish Bones',5]]]],
  ['Ruhang II',        ['Hok','Ostron',  2000, 5000, [['Nistlepod',20],['Pyrotic Alloy',20],['Kuaka Spinal Claw',2],['Yogwun Stomach',5]]]],
  ['Vargeet Ruhang',   ['Hok','Ostron',  5000, 5000, [['Nistlepod',30],['Coprite Alloy',20],['Kuaka Spinal Claw',5],['Charc Electroplax',5]]]],
  ['Ekwana Ruhang',    ['Hok','Ostron',  5000, 5000, [['Nistlepod',30],['Coprite Alloy',20],['Condroc Wing',5],['Charc Electroplax',5]]]],
  ['Vargeet II Ruhang',['Hok','Ostron',  7500, 5000, [['Maprico',5],['Fersteel Alloy',20],['Kuaka Spinal Claw',5],['Tralok Eyes',5]]]],
  ['Ekwana II Ruhang', ['Hok','Ostron',  7500, 5000, [['Maprico',5],['Fersteel Alloy',20],['Condroc Wing',5],['Tralok Eyes',5]]]],
  ['Vargeet Ruhang II',['Hok','Ostron', 10000, 5000, [['Breath of the Eidolon',5],['Auroxium Alloy',20],['Kuaka Spinal Claw',5],['Cetus Wisp',2]]]],
  ['Ekwana Ruhang II', ['Hok','Ostron', 10000, 5000, [['Breath of the Eidolon',5],['Auroxium Alloy',20],['Condroc Wing',5],['Cetus Wisp',2]]]],
]);

const KITGUN_LOADERS = new Map([
  ['Arcroid',       ['Father',   'Entrati',        1000, 5000, [['Scintillant',3],['Purged Dagonic',20],['Ganglion',20],['Tubercular Gill System',15]]]],
  ['Bashrack',      ['Rude Zuud','Solaris United', 2000, 5000, [['Venerdo Alloy',30],['Circuits',1000],['Scrap',20],['Mirewinder Parallel Biode',5]]]],
  ['Bellows',       ['Rude Zuud','Solaris United', 1000, 5000, [['Thermal Sludge',20],['Axidrol Alloy',30],['Scrap',20],['Echowinder Anoscopic Sensor',5]]]],
  ['Deepbreath',    ['Rude Zuud','Solaris United',  500, 5000, [['Mytocardia Spore',20],['Travocyte Alloy',30],['Scrap',20],['Scrubber Exa Brain',5]]]],
  ['Flutterfire',   ['Rude Zuud','Solaris United', 4000, 5000, [['Marquise Veridos',10],['Goblite Tears',10],['Scrap',20],['Tromyzon Entroplasma',5]]]],
  ['Killstream',    ['Rude Zuud','Solaris United', 4000, 5000, [['Fersteel Alloy',40],['Goblite Tears',10],['Scrap',20],['Longwinder Lathe Coagulant',5]]]],
  ['Macro Arcroid', ['Father',   'Entrati',         500, 5000, [['Scintillant',3],['Faceted Tiametrite',20],['Ganglion',20],['Tubercular Gill System',15]]]],
  ['Macro Thymoid', ['Father',   'Entrati',        1000, 5000, [['Scintillant',3],['Purged Dagonic',20],['Pustulite',20],['Ferment Bladder',15]]]],
  ['Ramflare',      ['Rude Zuud','Solaris United', 4000, 5000, [['Star Crimzian',10],['Star Amarast',10],['Scrap',20],['Charamote Sagan Module',5]]]],
  ['Slap',          ['Rude Zuud','Solaris United',  500, 5000, [['Gorgaricus Spore',20],['Travocyte Alloy',30],['Scrap',20],['Sapcaddy Venedo Case',5]]]],
  ['Slapneedle',    ['Rude Zuud','Solaris United', 2000, 5000, [['Coprite Alloy',40],['Heart Noctrul',20],['Scrap',20],['Kriller Thermal Laser',5]]]],
  ['Sparkfire',     ['Rude Zuud','Solaris United', 2000, 5000, [['Venerdo Alloy',30],['Plastids',1000],['Scrap',20],['Brickie Muon Battery',5]]]],
  ['Splat',         ['Rude Zuud','Solaris United', 4000, 5000, [['Auroxium Alloy',40],['Star Amarast',10],['Scrap',20],['Synathid Ecosynth Analyzer',5]]]],
  ['Stitch',        ['Rude Zuud','Solaris United', 2000, 5000, [['Hespazym Alloy',30],['Plastids',1000],['Scrap',20],['Recaster Neural Relay',5]]]],
  ['Swiftfire',     ['Rude Zuud','Solaris United', 2000, 5000, [['Esher Devar',10],['Heart Noctrul',10],['Scrap',20],['Kriller Thermal Laser',5]]]],
  ['Thunderdrum',   ['Rude Zuud','Solaris United', 3000, 5000, [['Hespazym Alloy',30],['Rubedo',1000],['Scrap',20],['Recaster Neural Relay',5]]]],
  ['Thymoid',       ['Father',   'Entrati',         500, 5000, [['Scintillant',3],['Faceted Tiametrite',20],['Pustulite',20],['Ferment Bladder',15]]]],
  ['Zip',           ['Rude Zuud','Solaris United', 1000, 5000, [['Tepa Nodule',20],['Axidrol Alloy',30],['Scrap',20],['Tink Dissipator Coil',5]]]],
  ['Zipfire',       ['Rude Zuud','Solaris United', 3000, 5000, [['Tear Azurite',10],['Smooth Phasmin',10],['Scrap',20],['Eye-Eye Rotoblade',5]]]],
  ['Zipneedle',     ['Rude Zuud','Solaris United', 3000, 5000, [['Pyrotic Alloy',40],['Smooth Phasmin',10],['Scrap',20],['Eye-Eye Rotoblade',5]]]],
]);

