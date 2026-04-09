// src/ao/aoConfig.ts

export type AoId =
  | "compass"
  | "colosseum"
  | "jurassicpark"
  | "thehill"
  | "theshadows"
  | "gatorbay"
  | "phoenixrising";

export type ScheduleBlock = {
  daysOfWeek: number[]; // JS: 0=Sun ... 6=Sat
  startTime24: string;  // "05:30"
  endTime24: string;    // "06:15"
};

export type AoConfig = {
  id: AoId;

  // Display
  shortName: string;
  displayName: string;
  whereName: string;
  address: string;
  meetingPoint?: string;

  // ✅ Multi-block schedule for per-day time blocks
  scheduleBlocks: ScheduleBlock[];

  // Links
  bandPostUrl?: string;
  bandUrl?: string; // optional (if you ever want a general band link)
  reportUrl?: string;
  qSheet: {
    tinyUrl?: string;
    googleSheetUrl?: string;
  };

  // AO-specific hashtags (generators will append #preblast/#backblast)
  hashtags: string[];
  // Optional hashtags shown in Preblast UI (not included unless selected)
  optionalHashtags?: string[];

  // Module applicability
  modules: {
    planner: boolean;
    qSheet: boolean;
    preblast: boolean;
    backblast: boolean;
  };
};

export const AO_CONFIG: Record<AoId, AoConfig> = {
  compass: {
    id: "compass",
    shortName: "Compass",
    displayName: "Compass at Lost Creek",
    whereName: "Lost Creek Park",
    address: "3703 Lost Creek Blvd, Sugar Land, TX 77479",

    // ✅ Correct per-day time blocks
    scheduleBlocks: [
      {
        daysOfWeek: [2, 4], // Tue/Thu
        startTime24: "05:30",
        endTime24: "06:15",
      },
      {
        daysOfWeek: [6], // Sat
        startTime24: "06:30",
        endTime24: "07:30",
      },
    ],

    bandPostUrl: "https://www.band.us/band/94185591/post",
    reportUrl:
      "https://lookerstudio.google.com/embed/reporting/f13d2066-eb12-4d9e-89fe-7b6113a5c884/page/p_annf64ba2d",
    qSheet: {
      tinyUrl: undefined,
      googleSheetUrl: undefined,
    },
    hashtags: ["#compass"],
    optionalHashtags: ["#lostboys"],
    modules: { planner: true, qSheet: true, preblast: true, backblast: true },
  },

  colosseum: {
    id: "colosseum",
    shortName: "Colosseum",
    displayName: "Colosseum",
    whereName: "Old Kempner Stadium",
    address: "223 5th St, Sugar Land, TX 77498",

    scheduleBlocks: [
      {
        daysOfWeek: [1, 3, 5], // Mon/Wed/Fri
        startTime24: "05:30",
        endTime24: "06:15",
      },
    ],

    bandPostUrl: "https://www.band.us/band/93641863/post",
    reportUrl:
      "https://lookerstudio.google.com/u/0/reporting/e299df64-56cc-45ca-bdc2-9863789ace26/page/p_4n9xsf5ypd",
    qSheet: {
      tinyUrl: "https://tinyurl.com/F3Colosseum",
      googleSheetUrl:
        "https://docs.google.com/spreadsheets/d/1C_AamtdoHPaodpH-pDUx92n4DYgJUKLQhII0MoZDxIM/edit?gid=0#gid=0",
    },
    hashtags: ["#colosseum"],
    optionalHashtags: ["#f3sugarland"],
    modules: { planner: true, qSheet: true, preblast: true, backblast: true },
  },

  jurassicpark: {
    id: "jurassicpark",
    shortName: "JP",
    displayName: "Jurassic Park",
    whereName: "Houston Museum of Natural Science",
    address: "13016 University Blvd, Sugar Land, TX 77479",
    meetingPoint: "Meeting point is the far south end of the parking lot.",

    scheduleBlocks: [
      {
        daysOfWeek: [0], // Sunday
        startTime24: "06:00",
        endTime24: "07:15",
      },
    ],

    // If JP has a different BAND post URL, change it here
    bandPostUrl: "https://www.band.us/band/93641863/post",
    reportUrl:
      "https://lookerstudio.google.com/u/0/reporting/e299df64-56cc-45ca-bdc2-9863789ace26/page/p_8s0t5b2wvd",
    qSheet: {
      tinyUrl: "https://tinyurl.com/F3JurassicPark",
      googleSheetUrl:
        "https://docs.google.com/spreadsheets/d/1C_AamtdoHPaodpH-pDUx92n4DYgJUKLQhII0MoZDxIM/edit?gid=1205329126#gid=1205329126",
    },
    hashtags: ["#jurassicpark", "#sundayrunday", "#sundayruckday"],
    optionalHashtags: [],
    modules: { planner: false, qSheet: true, preblast: true, backblast: true },
  },

  thehill: {
    id: "thehill",
    shortName: "The Hill",
    displayName: "The Hill",
    whereName: "The Hill",
    address: "9600 Scanlan Trce, Missouri City, TX 77459",

    scheduleBlocks: [
      {
        daysOfWeek: [1, 3], // Mon/Wed
        startTime24: "05:00",
        endTime24: "05:45",
      },
      {
        daysOfWeek: [5], // Fri
        startTime24: "05:00",
        endTime24: "06:00",
      },
      {
        daysOfWeek: [6], // Sat
        startTime24: "06:30",
        endTime24: "07:30",
      },
    ],

    bandPostUrl: "https://www.band.us/band/94185591/post",
    reportUrl:
      "https://lookerstudio.google.com/embed/reporting/f13d2066-eb12-4d9e-89fe-7b6113a5c884/page/p_978n00ea2d",
    qSheet: {
      tinyUrl: undefined,
      googleSheetUrl: undefined,
    },
    hashtags: ["#thehill"],
    optionalHashtags: ["#heavy"],
    modules: { planner: true, qSheet: false, preblast: true, backblast: true },
  },

  theshadows: {
    id: "theshadows",
    shortName: "The Shadows",
    displayName: "The Shadows",
    whereName: "The Shadows",
    address: "5855 Sienna Spgs Blvd, Missouri City, TX 77459",

    scheduleBlocks: [
      {
        daysOfWeek: [1, 3], // Mon/Wed
        startTime24: "05:30",
        endTime24: "06:15",
      },
      {
        daysOfWeek: [6], // Sat
        startTime24: "06:30",
        endTime24: "07:30",
      },
    ],

    bandPostUrl: "https://www.band.us/band/94185591/post",
    reportUrl:
      "https://lookerstudio.google.com/embed/reporting/f13d2066-eb12-4d9e-89fe-7b6113a5c884/page/p_ieuw34ea2d",
    qSheet: {
      tinyUrl: undefined,
      googleSheetUrl: undefined,
    },
    hashtags: ["#theshadows"],
    optionalHashtags: ["#heavy"],
    modules: { planner: true, qSheet: false, preblast: true, backblast: true },
  },

  gatorbay: {
    id: "gatorbay",
    shortName: "Gator Bay",
    displayName: "Gator Bay",
    whereName: "Gator Bay",
    address: "10201 Mount Logan, Missouri City, TX 77459",

    scheduleBlocks: [
      {
        daysOfWeek: [2, 4, 5], // Tue/Thu/Fri
        startTime24: "05:30",
        endTime24: "06:15",
      },
      {
        daysOfWeek: [6], // Sat
        startTime24: "06:30",
        endTime24: "07:30",
      },
    ],

    bandPostUrl: "https://www.band.us/band/94185591/post",
    reportUrl:
      "https://lookerstudio.google.com/embed/reporting/f13d2066-eb12-4d9e-89fe-7b6113a5c884/page/p_zmfqf7ea2d",
    qSheet: {
      tinyUrl: undefined,
      googleSheetUrl: undefined,
    },
    hashtags: ["#gatorbay"],
    optionalHashtags: ["#heavy"],
    modules: { planner: true, qSheet: false, preblast: true, backblast: true },
  },

  phoenixrising: {
    id: "phoenixrising",
    shortName: "Phoenix Rising",
    displayName: "Phoenix Rising",
    whereName: "Phoenix Rising",
    address: "1700 Glenn Lakes Ln, Missouri City, TX 77459",

    scheduleBlocks: [
      {
        daysOfWeek: [2], // Tue
        startTime24: "17:00",
        endTime24: "17:45",
      },
      {
        daysOfWeek: [4], // Thu
        startTime24: "05:00",
        endTime24: "05:45",
      },
      {
        daysOfWeek: [6], // Sat
        startTime24: "06:30",
        endTime24: "07:30",
      },
    ],

    bandPostUrl: "https://www.band.us/band/94185591/post",
    reportUrl:
      "https://lookerstudio.google.com/embed/reporting/f13d2066-eb12-4d9e-89fe-7b6113a5c884/page/p_ek83v9ea2d",
    qSheet: {
      tinyUrl: undefined,
      googleSheetUrl: undefined,
    },
    hashtags: ["#phoenixrising"],
    optionalHashtags: ["#frisbee"],
    modules: { planner: true, qSheet: false, preblast: true, backblast: true },
  },
};

export const AO_LIST: AoConfig[] = Object.values(AO_CONFIG).sort((a, b) =>
  a.shortName.localeCompare(b.shortName)
);

/**
 * ✅ Exported helper expected by geminiService.ts (and useful elsewhere)
 */
export const getAoById = (id: AoId): AoConfig => AO_CONFIG[id];

/**
 * ✅ Safe helper if you ever parse IDs from storage/querystring
 */
export const getAoByIdSafe = (id: string | null | undefined): AoConfig => {
  if (!id) return AO_CONFIG.compass;
  const key = id as AoId;
  return AO_CONFIG[key] ?? AO_CONFIG.compass;
};
