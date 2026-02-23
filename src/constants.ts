/* =========================================================
   PAX LISTS
   - Compass already in place (PAX_LIST)
   - Add AO-specific lists + helper
========================================================= */

export const PAX_LIST = [
  // Compass (existing)
  "Alcatraz",
  "Aquaman (Austin)",
  "Big Sky",
  "Bill Nye",
  "Blackout (Buu Quach)",
  "Crabs",
  "Crab Legs",
  "CRJ",
  "FlexSteel",
  "Franzia",
  "HammerTime (Shawn Sidoti)",
  "HALL PASS",
  "Hardwood",
  "Jack",
  "Octagon",
  "Pink Slip",
  "Prophet",
  "swing set",
  "Test Tube",
  "Tuck N Roll",
  "Vespa “Carlos”",
  "Woodglue!",
  "Zindler",
] as const;

export const PAX_LIST_COLOSSEUM = [
  "2ndLine",
  "7Seas (Rahul)",
  "Al",
  "Archimedes",
  "bootlegger (neal robichau)",
  "Caesar",
  "Chappy (Rick)",
  "Charmin",
  "Chopper",
  "Crab Legs",
  "Cyborg",
  "Dire Wolf",
  "Everest",
  "Fear Factor",
  "Franzia",
  "Gravel",
  "Green Egg",
  "HALL PASS",
  "Hertz",
  "HOFFA",
  "Huffy",
  "Ice Cube",
  "Logan Nguyen-Reboot",
  "Microbrew",
  "Milk-Bone",
  "PeaceKeeper",
  "Probable Cause",
  "Promo",
  "Prophet",
  "Puzzle Head",
  "Robotnik",
  "Sacajawea",
  "Shawshank",
  "Shelby",
  "Slingblade",
  "Smokie (Tom James)",
  "Spring Break",
  "Swinger",
  "The Rev (Dave Short)",
  "Tonka",
  "Vespa “Carlos”",
  "Zindler",
] as const;

export const PAX_LIST_JURASSICPARK = [
  "8 Piece",
  "Aquaman (Austin)",
  "Caesar",
  "Cockpit",
  "Crab Legs",
  "CRJ",
  "Cyborg",
  "Da Bears",
  "Dire Wolf",
  "Everest",
  "Fanatic",
  "Fear Factor",
  "Fine Print",
  "Fish Onn",
  "Franzia",
  "Green Egg",
  "HALL PASS",
  "Hardwood",
  "Hertz",
  "Ice Cube",
  "Ignite",
  "Inferno",
  "Lawrence Brown (Huggies)",
  "MiniVan (Ryan)",
  "Morning Wood",
  "pilgrim",
  "Pines",
  "Pink Slip",
  "Pitcrew",
  "Podcast",
  "Prophet",
  "Sacajawea",
  "Shelby",
  "sherpa",
  "Soprano",
  "Splenda",
  "Spring Break",
  "State Farm",
  "Topo",
  "Tuck N Roll",
  "Valet",
  "Vespa “Carlos”",
  "Whiteout (Jeff Vo)",
  "Wisecrack",
] as const;

// Keep types light to avoid circular imports with ao/*
export type AoIdLite =
  | "compass"
  | "colosseum"
  | "jurassicpark"
  | "thehill"
  | "theshadows"
  | "gatorbay"
  | "phoenixrising";

export const PAX_LIST_THEHILL = [] as const;
export const PAX_LIST_THESHADOWS = [] as const;
export const PAX_LIST_GATORBAY = [] as const;
export const PAX_LIST_PHOENIXRISING = [] as const;

type PaxDirectory = {
  paxByAo: Record<string, string[]>;
  bandNameByF3Name: Record<string, string>;
};

let paxDirectoryOverride: PaxDirectory | null = null;

export const setPaxDirectory = (data: PaxDirectory | null) => {
  paxDirectoryOverride = data;
};

export const getBandNameForF3Name = (name: string): string => {
  const clean = String(name || "").trim();
  if (!clean) return "";
  const mapped = paxDirectoryOverride?.bandNameByF3Name?.[clean];
  return mapped || clean;
};

export const getPaxListByAo = (aoId: AoIdLite): readonly string[] => {
  const override = paxDirectoryOverride?.paxByAo?.[aoId];
  if (override && override.length) return override;

  switch (aoId) {
    case "colosseum":
      return PAX_LIST_COLOSSEUM;
    case "jurassicpark":
      return PAX_LIST_JURASSICPARK;
    case "thehill":
      return PAX_LIST_THEHILL;
    case "theshadows":
      return PAX_LIST_THESHADOWS;
    case "gatorbay":
      return PAX_LIST_GATORBAY;
    case "phoenixrising":
      return PAX_LIST_PHOENIXRISING;
    case "compass":
    default:
      return PAX_LIST;
  }
};

/* =========================================================
   WARMUP EXERCISES
========================================================= */

export const WARMUP_EXERCISES = [
  "Abe Vigoda",
  "Big Boy Situps (BBS)",
  "Copperhead Squats",
  "Flapjack",
  "Grass Grabbers",
  "Good Mornings",
  "Hillbilly Squat Walker",
  "Hillbilly Walkers",
  "Imperial Walkers",
  "Imperial Squat Walkers",
  "Little Baby Arm Circles",
  "Little Baby Crunches",
  "Mericans",
  "Michael Phelps",
  "Mosey",
  "Motivators",
  "Raise the Roof",
  "Ray Lewis",
  "Seal Clap",
  "Side Straddle Hop",
  "Thrusters",
];

/* =========================================================
   THE THANG EXERCISES
========================================================= */

export const THANG_EXERCISES = [
  "Abe Vigoda",
  "American Hammers",
  "Angry Bear Crawl",
  "Bear Crawl",
  "Bent-Over Rows",
  "Big Boy Situps (BBS)",
  "Blockies",
  "Burpees",
  "Calf Raises",
  "Carolina Dry Docks",
  "Cleans",
  "Copperhead Merkins",
  "Copperhead Squat",
  "Coupon Flutter Kick",
  "Coupon Lunge",
  "Coupon Press",
  "Coupon Pull Through",
  "Coupon Swing",
  "Crawl Bear",
  "Curls",
  "Deadlifts",
  "Dips",
  "Dora",
  "Farmer Carry",
  "Flutter Kicks",
  "Goblet Squats",
  "Hand Release Merkin",
  "High Plank",
  "Jump Squats",
  "Little Baby Crunches",
  "Lunges",
  "Merkins",
  "Diamond Merkins",
  "Wide Merkins",
  "Mosey",
  "Mountain Climbers",
  "Murder Bunnies",
  "Overhead Press",
  "Plank",
  "Low Plank",
  "Left Side Plank",
  "Right Side Plank",
  "Plank Jack",
  "Pull-Ups",
  "Redrum Bunnies",
  "Reverse Lunges",
  "Rifle Carry",
  "Russian Twists",
  "Shavasana",
  "Shoulder Taps",
  "Side Straddle Hops",
  "Sprint",
  "Squat",
  "Sumo Squat",
  "Superman",
  "Thrusters",
  "Ultimate Frisbee",
  "Upright Rows",
  "V-Ups",
  ];

/* =========================================================
   NOTE:
   AO-specific values (location, hashtags, band URLs)
   are defined in src/ao/aoConfig.ts
========================================================= */
