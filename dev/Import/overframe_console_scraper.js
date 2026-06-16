// Paste into browser console on any https://overframe.gg/ page.
// Scrapes default slot polarities for non-warframe items (companions, melee, weapons).
// Run window.__wf_stop = true in console to abort at any time.
//
// Decode types:
//   companion     — arr[4] 10 slots reversed                  → flat [s1..s10]
//   melee         — arr[4] 8 slots reversed + stance at [8]   → [stance,[s1..s8],exilus?]
//   weaponExilus  — arr[4] 8 slots reversed + exilus at [8]   → [exilus,[s1..s8]]  (primary/secondary)
//   weaponFlat    — arr[4] 8 slots reversed only               → flat [s1..s8]       (archgun/archmelee/archwing/sentinel/comp weapons)
//   necramech     — arr[4] 12 slots reversed                  → flat [s1..s12]

(async () => {
  // ── CONFIGURATION ──────────────────────────────────────────────────────────
  const RUN = {
    companions:   true,
    melee:        true,
    weaponExilus: true,   // primary, secondary
    weaponFlat:   true,   // archgun, archmelee, archwing, sentinel + companion weapons
    necramech:    false,  // already scraped: Voidrig, Bonewidow
  };
  // ───────────────────────────────────────────────────────────────────────────

  // ── COMPANIONS (10-slot reversed → [s1..s10]) ─────────────────────────────
  const COMPANION_IDS = {
    // Sentinels
    "Carrier":2235,"Dethcube":2236,"Diriga":2234,"Djinn":2237,"Helios":2238,
    "Nautilus":5415,"Oxylus":2243,"Prisma Shade":2242,"Shade":2244,"Taxon":2245,"Wyrm":2246,
    // Kubrows
    "Chesa":2233,"Helminth Charger":2229,"Huras":2230,"Raksa":2231,"Sahasa":2228,
    "Smeeta":2226,"Sunika":2232,
    // Kavats
    "Adarza":2227,"Vasca":2841,
    // Venari
    "Venari":2409,"Venari Prime":5912,
    // MOA
    "Lambeo":2536,"Nychus":4748,"Oloro":2537,"Para":2538,
    // Predasites
    "Medjay Predasite":5020,"Pharaoh Predasite":5021,"Vizier Predasite":5022,
    // Vulpaphylas
    "Crescent Vulpaphyla":5019,"Panzer Vulpaphyla":5018,"Sly Vulpaphyla":5024,
    // Hounds
    "Bhaira":5856,"Dorma":5853,"Hec":5858,
    // Prime companions
    "Carrier Prime":2239,"Dethcube Prime":2793,"Helios Prime":2240,
    "Nautilus Prime":6628,"Shade Prime":6128,"Wyrm Prime":2241,
  };

  // ── MELEE (8 slots reversed + stance at [8] → [stance,[s1..s8],exilus?]) ──
  const MELEE_IDS = {
    // Swords / Nikanas
    "Azothane":6178,"Broken War":1182,"Cronus":1107,"Dark Sword":1164,"Dex Nikana":6520,
    "Dragon Nikana":1171,"Ether Sword":1135,"Heat Sword":1168,"Jaw Sword":1169,
    "Krohkur":985,"Mire":1011,"Nikana":1170,"Pangolin Sword":1174,"Pennant":2887,
    "Plasma Sword":1175,"Prisma Skana":1253,"Skana":1136,"Skiajati":1186,
    "Sun & Moon":6145,"Syam":6176,"Tatsu":2393,
    // Dual Swords
    "Dex Dakra":1166,"Dual Cleavers":975,"Dual Ether":1117,"Dual Heat Swords":1118,
    "Dual Ichor":1104,"Dual Kamas":1115,"Dual Keres":1179,"Dual Raza":1156,
    "Dual Skana":1119,"Dual Viciss":7340,"Dual Zoren":1103,
    "Nami Skyla":1162,"Prisma Dual Cleavers":977,"Twin Basolk":983,"Twin Krohkur":984,
    // Heavy Blades
    "Dark Split-Sword":1165,"Galatine":1167,"Gram":1129,"Masseter":2854,
    "Paracesis":1438,"Sarofang":6003,"Scindo":1102,"Vitrica":5205,"War":1181,"Zenistar":1161,
    // Daggers
    "Ceramic Dagger":1109,"Dark Dagger":1111,"Heat Dagger":1110,"Innodem":5874,
    "Karyst":1172,"Rakta Dark Dagger":1039,"Rumblejack":5723,"Sheev":972,
    // Dual Daggers
    "Ether Daggers":1113,"Fang":1112,"Nepheri":5730,"Okina":1183,
    // Machetes
    "Gazal Machete":1141,"Kama":1116,"Kreska":1433,"Machete":3671,"Machete Wraith":979,
    "Nami Solo":1163,"Prisma Machete":978,"Prova":915,"Prova Vandal":918,"Slaytra":5941,
    // Fist / Sparring
    "Ankyros":1124,"Furax":1120,"Furax Wraith":1121,"Hirudo":1009,"Kogake":2531,
    "Korrudo":2466,"Obex":3594,"Prisma Obex":935,"Ruvox":6521,"Tekko":1122,
    // Sword & Shield
    "Ack & Brunt":3672,"Argo & Vel":6256,"Cobra & Crane":1466,
    "Sigma & Octantis":1188,"Silva & Aegis":1187,"Tak & Lug":7372,
    // Gunblades
    "Redeemer":1131,"Sarpa":1130,"Stropha":4646,"Vastilok":5594,
    // Warfans
    "Arum Spinosa":5297,"Gunsen":1192,"Quassus":5120,"Vericres":5871,
    // Assault Saws / Heavy Scythes
    "Amanata":7140,"Corufell":6074,"Ghoulsaw":5600,"Hespar":5835,"Thalys":7425,
    // Polearms / Staves
    "Amphis":1159,"Bo":1160,"Broken Scepter":987,"Cadus":5578,"Cassowar":1144,
    "Edun":6173,"Guandao":1143,"Kesheg":3667,"Korumm":5732,"Lesion":1012,
    "Orthos":1145,"Pupacyst":1437,"Serro":936,"Sydon":3668,"Tipedo":1157,
    "Tonbo":1142,"Vaykor Sydon":1042,
    // Whips
    "Atterax":981,"Ceti Lacera":4296,"Dorrclave":6335,"Galvacord":1464,
    "Jat Kusar":986,"Lacera":1180,"Lecta":937,"Mios":1010,
    "Scoliac":1013,"Secura Lecta":1036,"Spinnerex":7411,"Verdilac":5734,
    // Glaives
    "Cerata":1007,"Falcor":1434,"Glaive":1126,"Halikar":982,"Halikar Wraith":5428,
    "Kestrel":1125,"Orvius":1128,"Pathocyst":2731,"Xoris":4660,
    // Nunchaku / Tonfa
    "Boltace":1189,"Kronen":1190,"Ninkondi":1139,"Ohma":932,"Praedos":5839,
    "Prisma Ohma":6260,"Pulmonars":5299,"Shaku":1140,"Telos Boltace":1026,"Tonkkatt":7370,
    // MK1
    "Mk1-Bo":1018,"Mk1-Furax":1019,
    // Scythes
    "Anku":1152,"Caustacyst":1008,"Ether Reaper":1153,"Harmony":6598,"Hate":1155,"Venato":5616,
    // Hammers
    "Arca Titron":3593,"Ekhein":6426,"Fragor":1134,"Heliocor":904,"Jat Kittag":974,
    "Magistar":1138,"Sampotes":6171,"Sancti Magistar":1033,"Sibear":1133,
    "Synoid Heliocor":1029,"Volnus":1132,"Wolf Sledge":2471,
    // Rapiers / Claws (player)
    "Destreza":1185,"Endura":1184,"Keratinos":5114,"Ripkas":3663,"Venka":1106,
    // Prime Melee
    "Ankyros Prime":1123,"Bo Prime":1158,"Cobra & Crane Prime":6045,"Dakra Prime":1108,
    "Destreza Prime":1173,"Dual Kamas Prime":1147,"Dual Keres Prime":5908,
    "Dual Zoren Prime":7261,"Fang Prime":1114,"Fragor Prime":1148,
    "Galatine Prime":1176,"Galariak Prime":7558,"Glaive Prime":1127,"Gram Prime":1442,
    "Guandao Prime":5203,"Gunsen Prime":6258,"Karyst Prime":4700,"Kestrel Prime":7566,
    "Kogake Prime":1149,"Kronen Prime":1191,"Masseter Prime":6333,"Nami Skyla Prime":1178,
    "Nikana Prime":1177,"Ninkondi Prime":2682,"Okina Prime":6546,"Orthos Prime":1146,
    "Pangolin Prime":4318,"Quassus Prime":7143,"Reaper Prime":1154,"Redeemer Prime":2392,
    "Sarofang Prime":7952,"Scindo Prime":1101,"Silva & Aegis Prime":1150,
    "Tatsu Prime":5979,"Tekko Prime":2795,"Tipedo Prime":2464,"Venato Prime":7470,
    "Venka Prime":1151,"Volnus Prime":5492,
    // Kuva / Tenet / Coda
    "Coda Caustacyst":7327,"Coda Hirudo":7330,"Coda Mire":7331,"Coda Motovore":7329,
    "Coda Pathocyst":7328,"Kuva Ghoulsaw":7648,"Kuva Shildeg":2853,
    "Tenet Agendus":5565,"Tenet Exec":5580,"Tenet Grigori":5563,"Tenet Livia":5561,
    // Kavat / Kubrow / companion claws (9-slot: 8 mods reversed + stance at [8])
    "Adarza Claws":7156,"Huras Claws":7157,"Crescent Claws":7158,
    "Smeeta Claws":7160,"Pharaoh Claws":7161,"Medjay Claws":7162,"Vizier Claws":7163,
    "Raksa Claws":7164,"Panzer Claws":7165,"Sahasa Claws":7166,
    "Claws":7168,"Venari Claws":7169,"Venari Prime Claws":7171,
  };

  // ── WEAPON_EXILUS (primary/secondary: exilus at arr[4][8]) ───────────────
  // Output: [exilus, [s1..s8]]
  const WEAPON_EXILUS_IDS = {
    // ── Primary — Rifles ──
    "Acceltra":2717,"Aeolak":5833,"Alternox":5829,"Ambassador":5554,"Amprex":3574,
    "Argonak":968,"AX-52":6611,"Basmu":4287,"Battacor":1432,"Baza":1097,
    "Boltor":1224,"Braton":1229,"Braton Vandal":1235,"Bubonico":5293,"Burston":1226,
    "Buzlok":3653,"Dera":3536,"Dera Vandal":3569,"Dex Sybaris":1077,"Enkaus":7651,
    "Flux Rifle":3568,"Fulmin":2530,"Glaxion":3577,"Glaxion Vandal":2526,
    "Gorgon":1227,"Gorgon Wraith":3659,"Grakata":3631,"Grinlok":3634,"Harpak":3655,
    "Hema":1003,"Higasa":7135,"Hind":951,"Ignis":3563,"Ignis Wraith":3564,
    "Karak":956,"Karak Wraith":957,"Latron":1230,"Latron Wraith":1100,
    "Mutalist Quanta":1002,"Opticor":3576,"Opticor Vandal":2389,"Paracyst":1004,
    "Phenmor":5837,"Prisma Gorgon":969,"Prisma Grakata":1252,"Prisma Grinlok":2390,
    "Prisma Tetra":922,"Purgator 1":7342,"Quanta":925,"Quanta Vandal":926,
    "Quartakk":963,"Quellor":2886,"Reconifex":7229,"Shedu":2885,"Soma":1233,
    "Stahlta":4641,"Stradavar":1091,"Supra":3566,"Supra Vandal":930,"Sybaris":1098,
    "Synapse":1006,"Telos Boltor":1025,"Tenora":1092,"Tetra":3575,"Thornbak":7496,
    "Tiberon":1079,"Trumna":5125,"Veldt":1096,"Zenith":1081,
    // ── Primary — Shotguns ──
    "Arca Plasmor":927,"Astilla":1093,"Boar":1238,"Cedo":5358,"Convectrix":3588,
    "Corinth":1094,"Drakgoon":3633,"Exergis":1463,"Felarx":5872,"Hek":1240,
    "Kohm":967,"Phage":1005,"Phantasma":1440,"Rauta":6213,"Sancti Tigris":1032,
    "Sobek":1237,"Steflos":6079,"Strun":1241,"Strun Wraith":1242,"Tigris":1078,
    "Vaykor Hek":1041,
    // ── Primary — Snipers ──
    "Komorex":2527,"Lanka":3535,"Perigale":5998,"Rubico":1080,"Snipetron":1231,
    "Snipetron Vandal":1236,"Sporothrix":5295,"Vectis":1234,"Vulkar":3645,"Vulkar Wraith":960,
    // ── Primary — Bows ──
    "Attica":1099,"Cernos":1071,"Cinta":6169,"Daikyu":1072,"Dread":1076,"Evensong":6596,
    "Lenz":3573,"Mutalist Cernos":1001,"Nagantaka":1439,"Nataruk":5725,"Paris":1074,
    "Prisma Lenz":6190,"Proboscis Cernos":5315,"Rakta Cernos":1038,"Zhuge":1090,
    // ── Primary — Spearguns ──
    "Afentis":5945,"Ferrox":3590,"Javlok":3647,"Scourge":1095,
    // ── Primary — Launchers ──
    "Carmine Penta":5421,"Miter":3640,"Ogris":3565,"Panthera":1082,"Penta":3589,
    "Secura Penta":1035,"Simulor":905,"Synoid Simulor":1028,"Tonkor":3654,
    "Torid":3533,"Zarr":3646,
    // ── Primary — Bayonets ──
    "Vinquibus":7562,
    // ── Primary — MK1 ──
    "Mk1-Braton":1232,"Mk1-Paris":1022,"Mk1-Strun":1023,
    // ── Primary — Coda ──
    "Coda Bassocyst":7323,"Coda Bubonico":7650,"Coda Hema":7324,
    "Coda Sporothrix":7325,"Coda Synapse":7326,
    // ── Primary — Kuva ──
    "Kuva Bramma":4245,"Kuva Chakkhurr":2852,"Kuva Drakgoon":2843,"Kuva Hek":5574,
    "Kuva Hind":4247,"Kuva Karak":2844,"Kuva Kohm":2845,"Kuva Ogris":2846,
    "Kuva Quartakk":2847,"Kuva Sobek":6554,"Kuva Tonkor":2848,"Kuva Zarr":5576,
    // ── Primary — Tenet ──
    "Tenet Arca Plasmor":5544,"Tenet Envoy":5559,"Tenet Ferrox":5994,
    "Tenet Flux Rifle":5546,"Tenet Glaxion":6552,"Tenet Quanta":7646,"Tenet Tetra":5548,
    // ── Primary — Prime ──
    "Acceltra Prime":6474,"Alternox Prime":7564,"Astilla Prime":5490,"Baza Prime":4230,
    "Boar Prime":1239,"Boltor Prime":1083,"Braton Prime":1225,"Burston Prime":1084,
    "Cedo Prime":7259,"Cernos Prime":1073,"Corinth Prime":4313,"Daikyu Prime":7390,
    "Fulmin Prime":6254,"Gotva Prime":6262,"Latron Prime":1228,"Nagantaka Prime":5831,
    "Panthera Prime":4698,"Paris Prime":1075,"Phantasma Prime":5977,"Rubico Prime":1441,
    "Scourge Prime":5615,"Soma Prime":1085,"Stradavar Prime":2463,"Strun Prime":5599,
    "Sybaris Prime":1086,"Tenora Prime":5396,"Tiberon Prime":1087,"Tigris Prime":1088,
    "Trumna Prime":7137,"Vadarya Prime":7468,"Vectis Prime":1089,"Zhuge Prime":2681,
    // ── Secondary — Single ──
    "Acrid":3562,"Angstrum":944,"Arca Scisco":3612,"Athodai":5426,"Atomos":998,
    "Azima":1218,"Ballistica":1204,"Bolto":1196,"Brakk":990,"Catabolyst":5301,
    "Cestra":3600,"Cyanex":2529,"Cycron":3607,"Detron":3599,"Embolist":1017,
    "Epitaph":5439,"Furis":1193,"Gammacor":1030,"Grimoire":6429,"Hystrix":1215,
    "Knell":1223,"Kohmak":994,"Kompressa":5582,"Kraken":1364,"Kulstar":996,
    "Laetum":5841,"Lato":1201,"Lato Vandal":1200,"Lex":1198,"Magnus":1207,
    "Mara Detron":1254,"Marelok":991,"Nukor":3694,"Ocucor":1435,"Onos":6523,
    "Pandero":1221,"Plinx":1465,"Prisma Angstrum":945,"Pyrana":1216,"Quatz":2683,
    "Rakta Ballistica":1040,"Riot-848":7344,"Seer":3616,"Sepulcrum":5123,
    "Sicarus":1195,"Sonicor":941,"Spectra":3567,"Spectra Vandal":2528,"Stubba":3700,
    "Stug":989,"Synoid Gammacor":1031,"Tysis":1016,"Vasto":1202,"Vaykor Marelok":1043,
    "Velox":4656,"Vesper 77":7221,"Viper":948,"Viper Wraith":999,"Zakti":1222,
    "Zylok":1443,"Zymos":5116,
    // ── Secondary — Dual ──
    "Afuris":1046,"Akarius":2718,"Akbolto":1047,"Akbronco":1049,"Akjagara":1220,
    "Aklato":1048,"Aklex":1044,"Akmagnus":1051,"Aksomati":1217,"Akstiletto":1219,
    "Akvasto":1052,"Akzani":1206,"Dex Furis":1205,"Dual Cestra":940,
    "Dual Toxocyst":1015,"Prisma Twin Gremlins":1436,"Secura Dual Cestra":1037,
    "Staticor":3608,"Telos Akbolto":1027,"Twin Grakatas":3632,"Twin Gremlins":947,
    "Twin Kohmak":3696,"Twin Rogga":3698,"Twin Vipers":1050,"Twin Vipers Wraith":1000,
    // ── Secondary — Thrown ──
    "Aegrit":5943,"Cantare":6600,"Castanas":1247,"Despair":1250,"Fusilai":1243,
    "Hikou":1251,"Kunai":1249,"Pox":1014,"Sancti Castanas":1034,"Scyotid":7419,
    "Spira":1244,"Talons":1248,
    // ── Secondary — MK1 ──
    "Mk1-Furis":1020,"Mk1-Kunai":1021,
    // ── Secondary — Kitguns ──
    "Catchmoon":2562,"Gaze":2565,"Rattleguts":2564,"Sporelacer":5305,
    "Tombfinger":2563,"Vermisplicer":5303,
    // ── Secondary — Coda ──
    "Coda Catabolyst":7333,"Coda Pox":7334,"Coda Tysis":7335,"Dual Coda Torxica":7332,
    // ── Secondary — Kuva ──
    "Kuva Brakk":2849,"Kuva Kraken":2850,"Kuva Nukor":4249,"Kuva Seer":2851,
    "Kuva Twin Stubbas":2859,
    // ── Secondary — Tenet ──
    "Tenet Cycron":5550,"Tenet Detron":5552,"Tenet Diplos":5567,
    "Tenet Plinx":5996,"Tenet Spirex":5569,
    // ── Secondary — Prime ──
    "Afuris Prime":6047,"Akarius Prime":6476,"Akbolto Prime":1208,"Akbronco Prime":1053,
    "Akjagara Prime":2394,"Aklex Prime":1045,"Akmagnus Prime":6613,"Aksomati Prime":4235,
    "Akstiletto Prime":1209,"Akvasto Prime":1444,"Ballistica Prime":1210,"Bronco Prime":1194,
    "Epitaph Prime":6631,"Euphona Prime":1203,"Hikou Prime":1246,"Hystrix Prime":5910,
    "Knell Prime":5614,"Kompressa Prime":7392,"Lex Prime":1211,"Magnus Prime":5560,
    "Pandero Prime":5398,"Pyrana Prime":1212,"Sagek Prime":7560,"Sicarus Prime":1213,
    "Spira Prime":1245,"Vasto Prime":1214,"Zakti Prime":5207,"Zylok Prime":6337,
  };

  // ── WEAPON_FLAT (no exilus: archgun/archmelee/archwing/sentinel/comp weapons) ─
  // Output: [s1..s8]
  const WEAPON_FLAT_IDS = {
    // ── Archwing ──
    "Amesha":7,"Elytron":2918,"Itzal":6,"Odonata":5,"Odonata Prime":4,
    // ── Archgun ──
    "Arbucep":7481,"Cortege":5118,"Corvas":1067,"Cyngas":1062,"Dual Decurion":1064,
    "Fluctus":1070,"Grattler":1069,"Imperator":1065,"Imperator Vandal":1066,
    "Larkspur":2391,"Mandonel":6424,"Mausolon":5141,"Morgha":5307,"Phaedra":1063,
    "Prisma Dual Decurions":5338,"Velocitus":1068,
    "Kuva Ayanga":2842,"Kuva Grattler":5572,"Corvas Prime":5827,"Larkspur Prime":6131,
    // ── Archmelee ──
    "Agkuza":1056,"Centaur":1059,"Kaszas":1055,"Knux":1060,"Onorix":1057,
    "Prisma Veritux":1061,"Rathbone":1054,"Veritux":1058,
    // ── Sentinel weapons (8-slot, no exilus) ──
    "Cryotra":2222,"Helstrum":4666,"Multron":2223,"Sweeper":2258,"Tazicor":2224,
    "Vulcax":2225,"Prime Laser Rifle":2252,"Sweeper Prime":2253,"Verglas Prime":6630,
    // ── Other companion weapons (8-slot, no exilus) ──
    "Akaten":5864,"Artax":2250,"Batoten":5862,"Burst Laser":2248,
    "Deconstructor":2257,"Deth Machine Rifle":2249,"Lacerten":5863,"Laser Rifle":2251,
    "Prisma Burst Laser":2254,"Stinger":2255,"Verglas":5420,"Vulklok":2256,
    "Burst Laser Prime":6130,"Deconstructor Prime":2247,"Deth Machine Rifle Prime":2794,
  };

  // ── NECRAMECH (12 slots reversed, no exilus/stance) ───────────────────────
  // arr[4]: [Mod12..Mod1] — Output: flat [s1..s12]
  const NECRAMECH_IDS = {
    "Voidrig":5158,"Bonewidow":5276,
  };

  // ── HELPERS ───────────────────────────────────────────────────────────────
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const hasNextRouter = typeof window.next?.router?.push === 'function';
  console.log(`Navigation: ${hasNextRouter ? 'Next.js router' : 'history.pushState'}`);

  async function nextPush(path) {
    return new Promise(resolve => {
      const done = () => { window.next.router.events.off('routeChangeComplete', done); resolve(); };
      window.next.router.events.on('routeChangeComplete', done);
      window.next.router.push(path);
    });
  }

  async function navigateTo(id) {
    if (hasNextRouter) {
      await nextPush('/');
      await sleep(300);
      await nextPush(`/build/new/${id}/`);
    } else {
      history.pushState(null, '', `/build/new/${id}/`);
      window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    }
  }

  async function waitForInput(timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const el = document.querySelector('input[type="number"]');
      if (el && el.value !== '') return el;
      await sleep(250);
    }
    return null;
  }

  // ── DECODE ────────────────────────────────────────────────────────────────
  function decodeBs(bs, expectedId, type) {
    try {
      const arr = JSON.parse(atob(bs.replace(/-/g, '+').replace(/_/g, '/')));
      if (arr[1] !== expectedId) return { error: `wrong_item: got ${arr[1]}, expected ${expectedId}` };
      const slots = arr[4];
      if (!Array.isArray(slots)) return { error: 'bad_slots' };

      if (type === 'companion') {
        if (slots.length < 10) return { error: `slots<10 (got ${slots.length})` };
        return { result: slots.slice(0, 10).reverse().map(s => s?.[2] ?? 0) };
      }
      if (type === 'melee') {
        // Melee:  arr[4] = [Mod8..Mod1, Stance, Exilus, Arcane] — 11 slots → [stance,[mods],exilus]
        // Claws:  arr[4] = [Mod8..Mod1, Stance]                 —  9 slots → [stance,[mods]]
        if (slots.length < 9) return { error: `slots<9 (got ${slots.length})` };
        const stance = slots[8]?.[2] ?? 0;
        const mods   = slots.slice(0, 8).reverse().map(s => s?.[2] ?? 0);
        if (slots.length >= 10) {
          const exilus = slots[9]?.[2] ?? 0;
          return { result: [stance, mods, exilus] };
        }
        return { result: [stance, mods] };
      }
      if (type === 'weaponExilus') {
        // arr[4]: [Mod8..Mod1, Exilus, Arcane]
        if (slots.length < 9) return { error: `slots<9 (got ${slots.length})` };
        const exilus = slots[8]?.[2] ?? 0;
        const mods   = slots.slice(0, 8).reverse().map(s => s?.[2] ?? 0);
        return { result: [exilus, mods] };
      }
      if (type === 'necramech') {
        // arr[4]: [Mod12..Mod1] — 12 slots reversed, no exilus or stance
        if (slots.length < 12) return { error: `slots<12 (got ${slots.length})` };
        return { result: slots.slice(0, 12).reverse().map(s => s?.[2] ?? 0) };
      }
      // weaponFlat — archwing/archmelee only have 8 slots; archgun has 10 but last 2 are unused
      if (slots.length < 8) return { error: `slots<8 (got ${slots.length})` };
      return { result: slots.slice(0, 8).reverse().map(s => s?.[2] ?? 0) };
    } catch (e) {
      return { error: 'decode_failed: ' + e.message };
    }
  }

  // ── SCRAPE ONE PAGE ───────────────────────────────────────────────────────
  async function scrapeItem(expectedId, type) {
    const input = await waitForInput(15000);
    if (!input) return { error: 'input_not_found' };

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const cur = parseInt(input.value, 10);
    setter.call(input, cur > 0 ? cur - 1 : 1);
    input.dispatchEvent(new Event('input',  { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(1500);

    const bs = new URL(location.href).searchParams.get('bs');
    if (!bs) return { error: 'no_bs' };
    return decodeBs(bs, expectedId, type);
  }

  // ── SCRAPE CATEGORY ───────────────────────────────────────────────────────
  async function scrapeCategory(ids, type, label) {
    const results = {};
    const entries = Object.entries(ids);
    const total = entries.length;
    console.log(`%c[${label}] Starting ${total} items...`, 'color:#a0d0ff;font-weight:bold');

    for (let i = 0; i < total; i++) {
      if (window.__wf_stop) { console.warn(`[${label}] Aborted by user after ${i} items.`); break; }
      const [name, id] = entries[i];

      await navigateTo(id);
      await sleep(500);

      const r = await scrapeItem(id, type);

      if (r.error) {
        results[name] = { error: r.error };
        console.warn(`[${label}][${i+1}/${total}] ✗ ${name} (${id}): ${r.error}`);
      } else {
        results[name] = r.result;
        console.log(`[${label}][${i+1}/${total}] ✓ ${name}: ${JSON.stringify(r.result)}`);
      }

      await sleep(1000);
    }
    return results;
  }

  // ── FORMAT OUTPUT ─────────────────────────────────────────────────────────
  function formatLines(results) {
    return Object.entries(results).map(([name, val]) => {
      if (val && val.error) return `  // ✗ "${name}": ${val.error}`;
      return `  "${name}":${JSON.stringify(val)},`;
    }).join('\n');
  }

  // ── MAIN ──────────────────────────────────────────────────────────────────
  window.__wf_stop = false;

  const allResults = {};

  if (RUN.companions)   allResults.companions   = await scrapeCategory(COMPANION_IDS,    'companion',    'COMPANIONS');
  if (RUN.melee)        allResults.melee        = await scrapeCategory(MELEE_IDS,         'melee',        'MELEE');
  if (RUN.weaponExilus) allResults.weaponExilus = await scrapeCategory(WEAPON_EXILUS_IDS, 'weaponExilus', 'WEAPON_EXILUS');
  if (RUN.weaponFlat)   allResults.weaponFlat   = await scrapeCategory(WEAPON_FLAT_IDS,   'weaponFlat',   'WEAPON_FLAT');
  if (RUN.necramech)    allResults.necramech    = await scrapeCategory(NECRAMECH_IDS,     'necramech',    'NECRAMECH');

  window.__wf_results = allResults;

  // Build a copy-pasteable DEFAULT_POLARITIES block
  const lines = [];
  if (allResults.companions)   { lines.push('  // ── Companions ──');                              lines.push(formatLines(allResults.companions)); }
  if (allResults.melee)        { lines.push('  // ── Melee ──');                                   lines.push(formatLines(allResults.melee)); }
  if (allResults.weaponExilus) { lines.push('  // ── Primary / Secondary ──');                     lines.push(formatLines(allResults.weaponExilus)); }
  if (allResults.weaponFlat)   { lines.push('  // ── Archgun / Archmelee / Archwing / Comp weapons ──'); lines.push(formatLines(allResults.weaponFlat)); }
  if (allResults.necramech)    { lines.push('  // ── Necramech ──');                               lines.push(formatLines(allResults.necramech)); }
  const output = lines.join('\n');

  try {
    await navigator.clipboard.writeText(output);
    console.log('%cDone! Formatted output copied to clipboard.', 'color:#50d0d0;font-weight:bold');
  } catch {
    console.log('%cClipboard blocked. To copy output run: copy(window.__wf_output)', 'color:#e07060');
  }
  window.__wf_output = output;

  const ok    = Object.values(allResults).flatMap(Object.values).filter(v => !v?.error).length;
  const total = Object.values(allResults).flatMap(Object.values).length;
  console.log(`Complete: ${ok}/${total} successful.`);
  console.log('Raw data: window.__wf_results  |  Formatted: window.__wf_output');
})();
